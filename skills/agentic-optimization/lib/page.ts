/** What a search result shows for a page: its title and description, plus the tags that decide whether it's indexed. */
import { lookup } from "node:dns/promises"
import { isIP } from "node:net"
import { gunzipSync } from "node:zlib"

export type PageHead = {
  url: string
  /** Where the address ends up after redirects, and how many hops it took. */
  finalUrl: string
  hops: number
  /** 0 when the page couldn't be fetched at all. */
  status: number
  /** True only for an HTML page we could read. Title advice is only given for these. */
  readable: boolean
  title: string | null
  description: string | null
  canonical: string | null
  noindex: boolean
  h1: string | null
}

const UA = "Mozilla/5.0 (compatible; StrelvaAgenticOptimization/0.2; +https://github.com/Strelva/strelva-experiments)"

const decode = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim()

/** An attribute's value, in either quote style ("Joe's" inside double quotes stays whole). */
const attr = (tag: string, name: string) => {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"))
  return m ? (m[1] ?? m[2]) : null
}

function meta(html: string, name: string): string | null {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    if ((attr(tag, "name") ?? attr(tag, "property"))?.toLowerCase() === name) {
      const c = attr(tag, "content")
      if (c !== null) return decode(c)
    }
  }
  return null
}

const PRIVATE = [/^127\./, /^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^169\.254\./, /^0\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, /^::1$/, /^f[cd]/i, /^fe80/i, /^::ffff:(127|10|192\.168|169\.254)\./i]

/**
 * Only public web addresses. The sites being checked choose where their redirects and sitemaps point,
 * so a hacked one could otherwise make this computer fetch its own network.
 */
async function isPublic(u: URL): Promise<boolean> {
  if (u.protocol !== "https:" && u.protocol !== "http:") return false
  const host = u.hostname.replace(/^\[|\]$/g, "")
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return false
  try {
    const ips = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address)
    return ips.length > 0 && !ips.some((ip) => PRIVATE.some((p) => p.test(ip)))
  } catch {
    return false
  }
}

/** Reads at most `max` bytes of a body, so a huge page or file can't stall the run. */
async function readCapped(res: Response, max: number): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  const reader = res.body?.getReader()
  if (!reader) return Buffer.alloc(0)
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(Buffer.from(value))
    size += value.length
    if (size >= max) { await reader.cancel(); break }
  }
  return Buffer.concat(chunks)
}

export async function readPage(url: string): Promise<PageHead> {
  const empty = { url, finalUrl: url, hops: 0, status: 0, readable: false, title: null, description: null, canonical: null, noindex: false, h1: null }
  // One deadline for the page, across all its redirects.
  const signal = AbortSignal.timeout(20_000)
  try {
    let at = url, hops = 0, res: Response
    for (;;) {
      if (!(await isPublic(new URL(at)))) return { ...empty, finalUrl: at, hops }
      res = await fetch(at, { headers: { "user-agent": UA }, redirect: "manual", signal, cache: "no-store" })
      const next = res.headers.get("location")
      if (res.status < 300 || res.status >= 400 || !next || hops >= 5) break
      await res.body?.cancel()
      at = new URL(next, at).href
      hops++
    }
    const noindexHeader = /noindex/i.test(res.headers.get("x-robots-tag") ?? "")
    const html = /text\/html|application\/xhtml/i.test(res.headers.get("content-type") ?? "")
    if (!res.ok || !html) {
      await res.body?.cancel()
      return { ...empty, finalUrl: at, hops, status: res.status, noindex: noindexHeader }
    }
    // Only the head matters, and some pages are megabytes.
    const text = (await readCapped(res, 300_000)).toString("utf8")
    const title = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
    const canonicalTag = text.match(/<link\b[^>]*rel=["']canonical["'][^>]*>/i)?.[0]
    const h1 = text.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)
    return {
      url,
      finalUrl: at,
      hops,
      status: res.status,
      readable: true,
      title: title ? decode(title[1]) || null : null,
      description: meta(text, "description"),
      canonical: canonicalTag ? attr(canonicalTag, "href") : null,
      noindex: /noindex/i.test(meta(text, "robots") ?? "") || noindexHeader,
      h1: h1 ? decode(h1[1].replace(/<[^>]+>/g, " ")) : null,
    }
  } catch {
    return empty
  }
}

export type SitemapRead = {
  urls: string[]
  /** True when a sitemap was listed but couldn't be read (blocked, timed out, not XML). */
  failed: boolean
  /** True when the fetch got a definite 404: there's no sitemap at that address. */
  missing: boolean
  /** True when there were more pages than `limit` and only the first ones were kept. */
  truncated: boolean
}

/** URLs listed in a sitemap, following one level of sitemap index on the same site. */
export async function sitemapUrls(sitemap: string, limit = 2000): Promise<SitemapRead> {
  const out: SitemapRead = { urls: [], failed: false, missing: false, truncated: false }
  const get = async (u: string) => {
    try {
      const url = new URL(u)
      if (!(await isPublic(url))) { out.failed = true; return "" }
      const r = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(20_000), cache: "no-store" })
      if (r.status === 404) { out.missing = true; await r.body?.cancel(); return "" }
      if (!r.ok) { out.failed = true; await r.body?.cancel(); return "" }
      const body = await readCapped(r, 50_000_000)
      return (body[0] === 0x1f && body[1] === 0x8b ? gunzipSync(body) : body).toString("utf8")
    } catch {
      out.failed = true
      return ""
    }
  }
  const locs = (xml: string) => [...xml.matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\s\]]+)\s*(?:\]\]>)?\s*<\/loc>/gi)].map((m) => decode(m[1]))
  const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, "") } catch { return "" } }
  const xml = await get(sitemap)
  const pages = (list: string[]) => list.filter((u) => !/\.xml(\.gz)?$/i.test(new URL(u, sitemap).pathname))
  if (/<sitemapindex/i.test(xml)) {
    for (const child of locs(xml).filter((c) => host(c) === host(sitemap)).slice(0, 10)) {
      out.urls.push(...pages(locs(await get(child))))
      if (out.urls.length >= limit) break
    }
  } else {
    out.urls = pages(locs(xml))
  }
  if (out.urls.length > limit) { out.truncated = true; out.urls = out.urls.slice(0, limit) }
  return out
}
