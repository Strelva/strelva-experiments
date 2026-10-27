/** What a search result shows for a page: its title and description, plus the tags that decide whether it's indexed. */
import { lookup } from "node:dns/promises"
import { BlockList, isIP } from "node:net"
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

/** Page text is the site's, not ours: no control characters, and short enough that it can't flood a report. */
const decode = (s: string) =>
  s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim().slice(0, 300)

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

const blocked = new BlockList()
for (const [net, bits] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 4], ["240.0.0.0", 4]] as const) blocked.addSubnet(net, bits, "ipv4")
for (const [net, bits] of [["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8]] as const) blocked.addSubnet(net, bits, "ipv6")

/** The IPv4 address inside an IPv6 one (::ffff:7f00:1, ::127.0.0.1, 64:ff9b::7f00:1), if there is one. */
function embeddedV4(ip: string): string | null {
  let tail = ip.toLowerCase()
  const dotted = tail.match(/(\d+\.\d+\.\d+\.\d+)$/)
  if (dotted) tail = tail.slice(0, -dotted[1].length) + dotted[1].split(".").map(Number).reduce((h, n, i) => h + (i % 2 ? n.toString(16).padStart(2, "0") : (i ? ":" : "") + n.toString(16).padStart(2, "0")), "")
  const [head, rest = ""] = tail.split("::")
  const left = head ? head.split(":") : [], right = tail.includes("::") ? (rest ? rest.split(":") : []) : []
  const groups = tail.includes("::") ? [...left, ...Array(8 - left.length - right.length).fill("0"), ...right] : left
  if (groups.length !== 8) return null
  const n = groups.map((g) => parseInt(g || "0", 16))
  const v4 = `${n[6] >> 8}.${n[6] & 255}.${n[7] >> 8}.${n[7] & 255}`
  if (n.slice(0, 5).every((x) => x === 0) && (n[5] === 0xffff || n[5] === 0)) return v4
  if (n[0] === 0x64 && n[1] === 0xff9b && n.slice(2, 6).every((x) => x === 0)) return v4
  return null
}

const isBlocked = (ip: string) => {
  if (isIP(ip) === 4) return blocked.check(ip, "ipv4")
  const v4 = embeddedV4(ip)
  return blocked.check(ip, "ipv6") || (v4 !== null && blocked.check(v4, "ipv4"))
}

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
    return ips.length > 0 && !ips.some(isBlocked)
  } catch {
    return false
  }
}

/** Follows up to 5 redirects by hand, checking every hop is public. Null if a hop isn't. */
async function fetchPublic(url: string, signal: AbortSignal): Promise<{ res: Response; at: string; hops: number } | { blocked: string; hops: number }> {
  let at = url, hops = 0
  for (;;) {
    if (!(await isPublic(new URL(at)))) return { blocked: at, hops }
    const res = await fetch(at, { headers: { "user-agent": UA }, redirect: "manual", signal, cache: "no-store" })
    const next = res.headers.get("location")
    if (res.status < 300 || res.status >= 400 || !next || hops >= 5) return { res, at, hops }
    await res.body?.cancel()
    at = new URL(next, at).href
    hops++
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
    const got = await fetchPublic(url, signal)
    if ("blocked" in got) return { ...empty, finalUrl: got.blocked, hops: got.hops }
    const { res, at, hops } = got
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
      const got = await fetchPublic(new URL(u).href, AbortSignal.timeout(20_000))
      if ("blocked" in got) { out.failed = true; return "" }
      const r = got.res
      if (r.status === 404) { out.missing = true; await r.body?.cancel(); return "" }
      if (!r.ok) { out.failed = true; await r.body?.cancel(); return "" }
      const body = await readCapped(r, 50_000_000)
      // maxOutputLength: a small gzip can unpack to gigabytes.
      return (body[0] === 0x1f && body[1] === 0x8b ? gunzipSync(body, { maxOutputLength: 50_000_000 }) : body).toString("utf8")
    } catch {
      out.failed = true
      return ""
    }
  }
  const locs = (xml: string) => [...xml.matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\s\]]+)\s*(?:\]\]>)?\s*<\/loc>/gi)].map((m) => decode(m[1]))
  const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, "") } catch { return "" } }
  const xml = await get(sitemap)
  // A malformed <loc> is skipped, not allowed to stop the whole report.
  const pages = (list: string[]) => list.filter((u) => { try { return !/\.xml(\.gz)?$/i.test(new URL(u, sitemap).pathname) } catch { return false } })
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
