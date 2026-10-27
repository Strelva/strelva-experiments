import { inspectUrl, listSitemaps, searchRows, type Inspection, type Row } from "./google.ts"
import { readPage, sitemapUrls, type PageHead } from "./page.ts"

/**
 * One run: the site's last 28 days of Google search, turned into a short list of fixes.
 *
 * Rules decide what's a problem and every fix carries the numbers behind it. Nothing is
 * suggested that the data doesn't show. Search Console data is final about 3 days back,
 * so the window ends there.
 */

export type FixKind = "retitle" | "almost" | "missing-page" | "split" | "moved" | "not-indexed" | "page-problem" | "more-like-this"

export type Fix = {
  id: string
  kind: FixKind
  page: string | null
  headline: string
  evidence: string[]
  todo: string[]
  /** Extra clicks a month if the fix works, roughly. Used to rank. */
  worth: number
}

export type Report = {
  site: string
  origin: string
  window: { start: string; end: string }
  totals: { clicks: number; impressions: number; position: number; clicksPrev: number; impressionsPrev: number }
  fixes: Fix[]
  winners: { page: string; clicks: number; share: number }[]
  rising: { query: string; impressions: number; prev: number }[]
  indexing: { sitemapPages: number; withImpressions: number; checked: Inspection[]; sitemaps: string[] }
  notes: string[]
}

// Rough share of searchers who click a result at each position. Real curves vary by query; this only has
// to say "far below normal", so a page needs to be under half of it before it's called out.
const CTR = [0, 0.28, 0.16, 0.11, 0.08, 0.065, 0.05, 0.04, 0.033, 0.028, 0.025]
const expectedCtr = (pos: number) => (pos < 1 ? CTR[1] : pos <= 10 ? CTR[Math.round(pos)] : pos <= 15 ? 0.015 : pos <= 20 ? 0.008 : 0.003)

const STOP = new Set("a an and the of for in on to at by with is are what how near me my your best top vs or from".split(" "))
const words = (s: string) => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1 && !STOP.has(w))
/** Words of the query the text doesn't contain, ignoring a trailing s. */
const missing = (query: string, text: string | null) => {
  const have = new Set(words(text ?? "").map((w) => w.replace(/s$/, "")))
  return words(query).filter((w) => !have.has(w.replace(/s$/, "")))
}

/** Pages nobody needs to rank: legal, account and checkout pages. */
const UTILITY = /\/(privacy|terms|cookie|legal|login|log-in|signin|sign-in|signup|sign-up|register|account|cart|checkout|status|support|accessibility)([./-]|$)/i
/** Search operators people type to inspect a site, not to find it. */
const OPERATOR = /^(site|inurl|intitle|cache|related):/i

const iso = (d: Date) => d.toISOString().slice(0, 10)
const daysAgo = (n: number) => iso(new Date(Date.now() - n * 86_400_000))
const pathOf = (u: string) => { try { return new URL(u).pathname } catch { return u } }
/** One key for http/https, www or not, trailing slash or not. */
const norm = (u: string) => { try { const x = new URL(u); return x.host.replace(/^www\./, "") + x.pathname.replace(/\/$/, "") + x.search } catch { return u } }
const isHome = (u: string) => pathOf(u) === "/" || pathOf(u) === ""
const perMonth = (n: number) => n * (30 / 28)
const fmt = (n: number) => Math.round(n).toLocaleString("en-US")
const pos = (p: number) => p.toFixed(1)
const imp = (n: number) => `${fmt(n)} impression${n === 1 ? "" : "s"}`
const sum = (rows: Row[], k: "clicks" | "impressions") => rows.reduce((s, r) => s + r[k], 0)
const avgPos = (rows: Row[]) => { const i = sum(rows, "impressions"); return i ? rows.reduce((s, r) => s + r.position * r.impressions, 0) / i : 0 }

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let i = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]) }
  }))
  return out
}

export async function runReport(token: string, site: string): Promise<Report> {
  const end = daysAgo(3), start = daysAgo(30)
  const prevEnd = daysAgo(31), prevStart = daysAgo(58)
  const [pqAll, pagesAll, queriesAll, queriesPrev, total, totalPrev] = await Promise.all([
    searchRows(token, site, start, end, ["page", "query"]),
    searchRows(token, site, start, end, ["page"]),
    searchRows(token, site, start, end, ["query"]),
    searchRows(token, site, prevStart, prevEnd, ["query"]),
    searchRows(token, site, start, end, []),
    searchRows(token, site, prevStart, prevEnd, []),
  ])
  const notes: string[] = []
  const queries = queriesAll.filter((r) => !OPERATOR.test(r.keys[0]))

  // The origin Google mostly shows (domain properties don't say whether it's www).
  const origins = new Map<string, number>()
  for (const r of pagesAll) { try { const o = new URL(r.keys[0]).origin; origins.set(o, (origins.get(o) ?? 0) + r.impressions) } catch {} }
  const origin = [...origins].sort((a, b) => b[1] - a[1])[0]?.[0]
    ?? (site.startsWith("sc-domain:") ? `https://${site.slice(10)}` : site.replace(/\/$/, ""))

  // http://site.com/ and https://www.site.com/ are one page to the owner: merge them under the main origin.
  const canon = (u: string) => { try { const x = new URL(u); return new URL(origin).hostname.replace(/^www\./, "") === x.hostname.replace(/^www\./, "") ? origin + x.pathname + x.search : u } catch { return u } }
  const pq = merge(pqAll.filter((r) => !OPERATOR.test(r.keys[1])).map((r) => ({ ...r, keys: [canon(r.keys[0]), r.keys[1]] })))
  const pages = merge(pagesAll.map((r) => ({ ...r, keys: [canon(r.keys[0])] }))).sort((a, b) => b.impressions - a.impressions)

  // Read the pages people see, so fixes can quote what's there now and skip addresses that moved.
  const toRead = pages.slice(0, 40).map((p) => p.keys[0])
  const heads = new Map<string, PageHead>((await pool(toRead, 6, readPage)).map((h) => [h.url, h]))
  const read = async (url: string) => heads.get(url) ?? heads.set(url, await readPage(url)).get(url)!

  // Addresses that now redirect somewhere else (not just http -> https or adding www).
  const moved = toRead.map((u) => heads.get(u)!).filter((h) => h.status > 0 && h.hops > 0 && norm(h.finalUrl) !== norm(h.url))
  const movedSet = new Set(moved.map((h) => h.url))
  const live = (u: string) => !movedSet.has(u)

  // Searches for the business by name: the homepage already wins them, or they name the brand (the
  // domain's name, or the brand part of the homepage title). Google shows other pages as sitelinks under
  // those results; sitelinks rack up impressions but rarely get clicked, and that's normal.
  const homeHead = await read(`${origin}/`)
  // The name part of the domain: "example" for shop.example.com. Too short a name would match everything.
  const parts = new URL(origin).hostname.replace(/^www\./, "").split(".")
  const label = parts.length > 2 && parts[parts.length - 2].length > 3 ? parts[parts.length - 2] : parts[0]
  // The brand is the part of the homepage title that contains the domain's name ("Joe's Pizza" in
  // "Joe's Pizza | Pizza in Springfield" on joespizza.com). No such part, no brand words.
  const squash = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "")
  const brandPart = label.length >= 4 ? (homeHead.title ?? "").split(/\s[|\-–—:·]\s/).find((t) => squash(t).includes(label)) : undefined
  const brand = [...new Set(words(brandPart ?? "").map((w) => w.replace(/s$/, "")))]
  // Two brand words, one of them part of the domain's name: "joes pizza" yes, "pizza springfield" no.
  const matchesBrand = (hit: string[]) => hit.length >= 2 && hit.some((x) => x.length >= 4 && label.includes(x))
  const namesBrand = (q: string) => {
    const w = [...new Set(words(q).map((x) => x.replace(/s$/, "")))]
    return (label.length >= 4 && q.replace(/[^\p{L}\p{N}]/gu, "").toLowerCase().includes(label)) || matchesBrand(w.filter((x) => brand.includes(x)))
  }
  const navigational = new Set([
    ...pq.filter((r) => isHome(r.keys[0]) && r.position <= 3).map((r) => r.keys[1]),
    ...queries.map((q) => q.keys[0]).filter(namesBrand),
  ])
  // Sitelinks also show as several pages with the exact same numbers for one search.
  const sig = new Map<string, number>()
  for (const r of pq) { const k = `${r.keys[1]}|${r.impressions}|${r.position.toFixed(1)}`; sig.set(k, (sig.get(k) ?? 0) + 1) }
  const sitelink = (r: Row) => r.impressions >= 3 && (sig.get(`${r.keys[1]}|${r.impressions}|${r.position.toFixed(1)}`) ?? 0) >= 2
  const real = pq.filter((r) => !navigational.has(r.keys[1]) && live(r.keys[0]) && !sitelink(r))

  const byPage = new Map<string, Row[]>()
  for (const r of real) { const l = byPage.get(r.keys[0]) ?? []; l.push(r); byPage.set(r.keys[0], l) }
  for (const l of byPage.values()) l.sort((a, b) => b.impressions - a.impressions)
  const byQuery = new Map<string, Row[]>()
  for (const r of real) { const l = byQuery.get(r.keys[1]) ?? []; l.push(r); byQuery.set(r.keys[1], l) }

  const fixes: Fix[] = []
  /** Pages we couldn't read (blocked, timed out, not HTML): no advice about their titles. */
  const unreadable = new Set<string>()
  const covered = new Set<string>()
  /** A search gets one piece of advice, from the first fix that uses it. */
  const usedQ = new Set<string>()

  // 1. Shows up, nobody clicks: the title isn't what people searched for.
  const retitle = [...byPage]
    .filter(([url]) => !UTILITY.test(pathOf(url)))
    .map(([url, rows]) => ({ url, rows, i: sum(rows, "impressions"), c: sum(rows, "clicks"), p: avgPos(rows) }))
    .filter((x) => x.i >= 40 && x.p <= 15)
    .map((x) => ({ ...x, missed: x.i * expectedCtr(x.p) - x.c }))
    .filter((x) => x.c < 0.5 * x.i * expectedCtr(x.p) && x.missed >= 2)
    .sort((a, b) => b.missed - a.missed)
    .slice(0, 8)

  for (const x of retitle) {
    const head = await read(x.url), top = x.rows.slice(0, 3), lead = top[0].keys[1]
    if (!head.readable) { unreadable.add(x.url); continue }
    const gap = missing(lead, head.title)
    const todo: string[] = []
    if (gap.length) todo.push(`Rewrite the title to start with what people type: "${lead}". It's missing ${gap.map((w) => `"${w}"`).join(", ")}.`)
    else todo.push(`The title has the right words. Rewrite the description so it says plainly what someone searching "${lead}" gets on this page.`)
    if ((head.title?.length ?? 0) > 60) todo.push(`Shorten the title to under 60 characters (now ${head.title!.length}). Google cuts off the rest.`)
    if (!head.description) todo.push("Add a meta description. Right now Google writes its own snippet for this page.")
    covered.add(x.url)
    top.forEach((r) => usedQ.add(r.keys[1]))
    fixes.push({
      id: `retitle:${pathOf(x.url)}`,
      kind: "retitle",
      page: x.url,
      headline: `Shows up ${fmt(x.i)} times, ${fmt(x.c)} click${x.c === 1 ? "" : "s"}`,
      evidence: [
        `Average position ${pos(x.p)}, where about ${Math.round(expectedCtr(x.p) * 100)}% of people usually click. This page gets ${((x.c / x.i) * 100).toFixed(1)}%.`,
        ...(head.title ? [`Title now: "${head.title}"`] : []),
        ...(head.description ? [`Description now: "${head.description}"`] : []),
        ...top.map((r) => `"${r.keys[1]}": ${imp(r.impressions)}, position ${pos(r.position)}`),
      ],
      todo,
      worth: perMonth(x.missed),
    })
  }

  // 2. Searches the site is close on (bottom of page 1, page 2), or has no real page for.
  const almost = new Map<string, Row[]>()
  const deep: { q: Row; page: string }[] = []
  for (const q of queries) {
    if (navigational.has(q.keys[0]) || usedQ.has(q.keys[0])) continue
    const landing = byQuery.get(q.keys[0])?.sort((a, b) => b.impressions - a.impressions)[0]?.keys[0]
    if (!landing || covered.has(landing) || UTILITY.test(pathOf(landing))) continue
    if (q.impressions >= 15 && q.position > 8.5 && q.position <= 20) {
      const l = almost.get(landing) ?? []; l.push(q); almost.set(landing, l)
    } else if (q.impressions >= 25 && q.position > 20 && q.position <= 80) {
      // Far-off searches that land on the homepage join the homepage's fix.
      if (isHome(landing)) { const l = almost.get(landing) ?? []; l.push(q); almost.set(landing, l) }
      else deep.push({ q, page: landing })
    }
  }

  const almostRanked = [...almost].sort((a, b) => sum(b[1], "impressions") - sum(a[1], "impressions")).slice(0, 6)
  for (const [url, qs] of almostRanked) {
    qs.sort((a, b) => b.impressions - a.impressions)
    const head = await read(url), top = qs.slice(0, 3), lead = top[0].keys[0]
    const home = isHome(url)
    covered.add(url)
    top.forEach((q) => usedQ.add(q.keys[0]))
    fixes.push({
      id: `almost:${pathOf(url)}`,
      kind: home && !/\bnear me\b/i.test(lead) ? "missing-page" : "almost",
      page: url,
      // Positions 9-10 are still page one, just at the bottom of it.
      headline: home ? `People search "${lead}" and Google sends them to your homepage, past page 1` : top[0].position < 10.5 ? `At the bottom of page 1 for "${lead}"` : `Just off page 1 for "${lead}"`,
      evidence: top.map((q) => `"${q.keys[0]}": ${imp(q.impressions)}, position ${pos(q.position)}`),
      todo: home
        ? homeTodo(lead, head)
        : [
            `Add a section with a heading that uses these words, and answer the question in its first two sentences.`,
            ...(head.readable && missing(lead, `${head.title ?? ""} ${head.h1 ?? ""}`).length ? [`Neither the title nor the main heading says "${lead}".`] : []),
            `Link to this page from 2-3 of your other pages, using those words in the link.`,
          ],
      worth: perMonth(top.reduce((s, q) => s + q.impressions * (expectedCtr(4) - expectedCtr(q.position)), 0)),
    })
  }

  let deepCount = 0
  for (const { q, page } of deep.sort((a, b) => b.q.impressions - a.q.impressions)) {
    if (deepCount >= 4) break
    const head = await read(page)
    if (!head.readable) { unreadable.add(page); continue }
    const about = `${head.title ?? ""} ${head.h1 ?? ""} ${pathOf(page).replace(/[-/_.]/g, " ")}`
    if (missing(q.keys[0], about).length < Math.ceil(words(q.keys[0]).length / 2)) continue
    deepCount++
    usedQ.add(q.keys[0])
    fixes.push({
      id: `missing:${q.keys[0]}`,
      kind: "missing-page",
      page,
      headline: `People search "${q.keys[0]}" and you have no page for it`,
      evidence: [`${imp(q.impressions)} in 28 days at position ${pos(q.position)}, landing on ${pathOf(page)}${head.title ? ` ("${head.title}")` : ""}.`],
      todo: [`Make a page about "${q.keys[0]}": put those words in the title, the main heading and the address, and answer it in the first paragraph.`, `Link to it from your homepage or menu so Google finds it.`],
      worth: perMonth(q.impressions * (expectedCtr(8) - expectedCtr(q.position))),
    })
  }

  // Google splitting one search between two of your pages, both below the top 3.
  let splits = 0
  for (const q of queries.filter((q) => q.impressions >= 30 && !navigational.has(q.keys[0]) && !usedQ.has(q.keys[0]))) {
    if (splits >= 2) break
    const rows = (byQuery.get(q.keys[0]) ?? []).filter((r) => r.impressions >= 0.25 * q.impressions && r.position > 3)
    if (new Set(rows.map((r) => norm(r.keys[0]))).size < 2) continue
    splits++
    usedQ.add(q.keys[0])
    fixes.push({
      id: `split:${q.keys[0]}`,
      kind: "split",
      page: rows[0].keys[0],
      headline: `Two of your pages compete for "${q.keys[0]}"`,
      evidence: rows.slice(0, 3).map((r) => `${pathOf(r.keys[0])}: ${imp(r.impressions)}, position ${pos(r.position)}`),
      todo: [`Pick the one page that should rank for this. Link to it from the other using those words, and make the other page's title about something else.`],
      worth: perMonth(q.impressions * 0.01),
    })
  }

  // Old addresses Google still shows. Fine if each lands on the matching new page; a problem if it
  // lands on the homepage or takes several hops.
  if (moved.length) {
    const impOf = new Map(pages.map((p) => [p.keys[0], p.impressions]))
    const toHome = moved.filter((h) => isHome(h.finalUrl) && !isHome(h.url))
    const chains = moved.filter((h) => h.hops >= 2)
    if (!toHome.length && !chains.length) notes.push(`Google still shows ${moved.length} old address${moved.length === 1 ? " that now redirects" : "es that now redirect"} to the right pages (like ${pathOf(moved[0].url)} → ${pathOf(moved[0].finalUrl)}). That's normal after a redesign and clears up as Google recrawls.`)
    else fixes.push({
      id: "moved",
      kind: "moved",
      page: null,
      headline: `Google still shows ${moved.length} old address${moved.length === 1 ? " that now redirects" : "es that now redirect"}`,
      evidence: moved.slice(0, 6).map((h) => `${pathOf(h.url)} → ${sameHost(h.url, h.finalUrl) ? pathOf(h.finalUrl) : h.finalUrl}${h.hops >= 2 ? ` (${h.hops} hops)` : ""}: ${imp(impOf.get(h.url) ?? 0)}`),
      todo: [
        ...(toHome.length ? [`${toHome.length} old page${toHome.length === 1 ? "" : "s"} redirect to your homepage. Point each at the matching new page instead; Google treats a redirect to the homepage like a missing page.`] : []),
        ...(chains.length ? [`${chains.length} redirect${chains.length === 1 ? " takes" : "s take"} more than one hop. Point the old address straight at the final page.`] : []),
        `Make sure your sitemap lists only the new addresses.`,
      ],
      worth: perMonth(toHome.length * 5 + chains.length * 2),
    })
  }

  // Page problems on pages people already see.
  for (const p of pages.slice(0, 15)) {
    const h = heads.get(p.keys[0])
    // 401/403/429/503 usually means the site blocked this check, not that visitors see an error.
    if (!h || h.status === 0 || [401, 403, 429, 503].includes(h.status) || movedSet.has(h.url) || p.impressions < 20) continue
    const problems: string[] = []
    if (h.status >= 400) problems.push(`The page returns an error (HTTP ${h.status}) but Google still shows it.`)
    if (h.noindex) problems.push("The page tells Google not to index it (noindex). If that's a mistake, it will drop out of search.")
    const canonical = (() => { try { return h.canonical ? new URL(h.canonical, h.finalUrl).href : null } catch { return null } })()
    if (canonical && !new URL(h.url).search && norm(canonical) !== norm(h.finalUrl)) problems.push(`The page tells Google a different address is the main one: ${h.canonical}`)
    if (h.readable && !h.title) problems.push("The page has no title.")
    if (problems.length) fixes.push({
      id: `problem:${pathOf(p.keys[0])}`, kind: "page-problem", page: p.keys[0],
      headline: "Problem on a page people find", evidence: [`${imp(p.impressions)} in 28 days.`], todo: problems,
      worth: perMonth(Math.max(p.clicks, 5)),
    })
  }

  // 3. What works: the pages that bring the clicks, and the next pages to write from them.
  const totalClicks = total[0]?.clicks ?? 0
  const winners = pages.filter((p) => p.clicks > 0 && live(p.keys[0])).sort((a, b) => b.clicks - a.clicks).slice(0, 3)
    .map((p) => ({ page: p.keys[0], clicks: p.clicks, share: totalClicks ? p.clicks / totalClicks : 0 }))
  for (const w of winners.filter((w) => !isHome(w.page) && !covered.has(w.page)).slice(0, 2)) {
    const next = (byPage.get(w.page) ?? []).filter((r) => r.position > 10 && r.impressions >= 5 && !usedQ.has(r.keys[1])).slice(0, 3)
    if (!next.length) continue
    fixes.push({
      id: `more:${pathOf(w.page)}`,
      kind: "more-like-this",
      page: w.page,
      headline: `This page brings ${Math.round(w.share * 100)}% of your search clicks. Write the next one`,
      evidence: next.map((r) => `"${r.keys[1]}": ${imp(r.impressions)}, position ${pos(r.position)}. Google shows this page for it, but the page isn't really about it.`),
      todo: [`Write a page for "${next[0].keys[1]}" in the same style, and link the two pages to each other.`],
      worth: perMonth(next.reduce((s, r) => s + r.impressions * expectedCtr(6), 0)),
    })
  }

  const prevQ = new Map(queriesPrev.map((q) => [q.keys[0], q.impressions]))
  const rising = (total[0] && (totalPrev[0]?.impressions ?? 0) < 0.1 * total[0].impressions ? [] : queries.filter((q) => !navigational.has(q.keys[0])))
    .map((q) => ({ query: q.keys[0], impressions: q.impressions, prev: prevQ.get(q.keys[0]) ?? 0 }))
    .filter((q) => q.impressions >= 20 && q.impressions >= 2 * q.prev)
    .sort((a, b) => b.impressions - b.prev - (a.impressions - a.prev))
    .slice(0, 5)

  // 4. Pages Google hasn't picked up. Inspect a sample of sitemap pages nobody saw in 28 days.
  let sitemaps: string[] = [], sitemapsKnown = true
  try { sitemaps = await listSitemaps(token, site) } catch { sitemapsKnown = false; notes.push("Couldn't read your sitemaps from Search Console.") }
  const reads = sitemaps.length ? await Promise.all(sitemaps.slice(0, 3).map((s) => sitemapUrls(s))) : [await sitemapUrls(`${origin}/sitemap.xml`)]
  const listed = [...new Set(reads.flatMap((r) => r.urls))]
  const truncated = reads.some((r) => r.truncated)
  if (truncated) notes.push("Your sitemap is large, so only its first 2,000 pages were looked at.")
  if (!listed.length && reads.some((r) => r.failed)) notes.push("Couldn't read your sitemap (the site blocked this check or it timed out), so pages Google hasn't added weren't checked.")
  const seen = new Set(pages.map((p) => norm(p.keys[0])))
  const unseen = listed.filter((u) => !seen.has(norm(u)))
  const sample = pickSample(unseen.filter((u) => !UTILITY.test(pathOf(u))), 8)
  const checked = (await pool(sample, 4, (u) => inspectUrl(token, site, u).catch(() => null))).filter((x): x is Inspection => !!x)
  if (sample.length && !checked.length) notes.push("Google didn't answer which sitemap pages it has added (URL Inspection failed), so that wasn't checked.")
  // Only pages Google hasn't added yet. Pages left out on purpose (noindex, redirects, duplicates) aren't a problem.
  const notIndexed = checked.filter((c) => c.verdict !== "PASS" && /not indexed|unknown to google/i.test(c.coverage))
  if (!listed.length && sitemapsKnown && !sitemaps.length && reads[0].missing) {
    fixes.push({
      id: "sitemap", kind: "not-indexed", page: null, headline: "Google has no sitemap for your site",
      evidence: ["No sitemap is submitted in Search Console and none was found at /sitemap.xml."],
      todo: ["Most site builders make one for you at /sitemap.xml. Submit it in Search Console under Sitemaps."],
      worth: 10,
    })
  } else if (notIndexed.length) {
    fixes.push({
      id: "not-indexed", kind: "not-indexed", page: null,
      headline: `Google hasn't added ${notIndexed.length} of the ${checked.length} unseen sitemap pages we checked`,
      evidence: [
        `${fmt(unseen.length)} of the ${truncated ? "first " : ""}${fmt(listed.length)} pages in your sitemap got no impressions in 28 days. We checked ${checked.length} of them:`,
        ...notIndexed.map((c) => `${pathOf(c.url)}: ${c.coverage}`),
      ],
      todo: [
        // Nearly the whole sitemap unseen is usually a quality signal, not a links problem.
        ...(listed.length >= 200 && unseen.length >= 0.9 * listed.length
          ? [`Almost none of your sitemap's pages get seen in Google. When a site has many similar or generated pages, Google often skips most of them as not worth showing. Make sure each page has something the others don't, and leave thin or near-duplicate pages out of the sitemap so Google spends its time on the best ones.`]
          : []),
        "Link these pages from pages Google already shows (your homepage, menu, or popular pages). Google finds pages through links, and new sites get crawled slowly.",
        "\"Discovered, not indexed\" means Google knows the page but hasn't got to it yet: more links fix it. \"Crawled, not indexed\" means it looked and passed: the page needs more that's unique to it.",
      ],
      worth: perMonth(notIndexed.length * 2),
    })
  }

  if (unreadable.size) notes.push(`Couldn't read ${unreadable.size} page${unreadable.size === 1 ? "" : "s"} (the site blocked this check, it timed out, or it isn't a web page), so there's no title advice for ${unreadable.size === 1 ? "it" : "them"}: ${[...unreadable].slice(0, 3).map(pathOf).join(", ")}.`)
  fixes.sort((a, b) => b.worth - a.worth)
  if (!pages.length) notes.push("No search data in the last 28 days. New sites take a few weeks to show up.")
  if (navigational.size) notes.push(`Searches for your name (like "${[...navigational][0]}") are left out of the fixes. Your homepage already wins those.`)

  return {
    site, origin, window: { start, end },
    totals: {
      clicks: totalClicks, impressions: total[0]?.impressions ?? 0, position: total[0]?.position ?? 0,
      clicksPrev: totalPrev[0]?.clicks ?? 0, impressionsPrev: totalPrev[0]?.impressions ?? 0,
    },
    fixes, winners, rising,
    indexing: { sitemapPages: listed.length, withImpressions: listed.length - unseen.length, checked, sitemaps },
    notes,
  }
}

const sameHost = (a: string, b: string) => { try { return new URL(a).hostname.replace(/^www\./, "") === new URL(b).hostname.replace(/^www\./, "") } catch { return true } }

/** Sum rows that share keys, weighting position by impressions. */
function merge(rows: Row[]): Row[] {
  const m = new Map<string, Row>()
  for (const r of rows) {
    const k = r.keys.join("\u0000"), o = m.get(k)
    if (!o) { m.set(k, { ...r }); continue }
    const i = o.impressions + r.impressions
    o.position = i ? (o.position * o.impressions + r.position * r.impressions) / i : o.position
    o.clicks += r.clicks; o.impressions = i; o.ctr = i ? o.clicks / i : 0
  }
  return [...m.values()]
}

/** Small sites win searches like "bakery springfield il" on the homepage, so say that first. */
function homeTodo(lead: string, head: PageHead): string[] {
  if (!head.readable) return [`Make sure your homepage title and main heading say what you are and your town. (Your homepage couldn't be read to check.)`, `If "${lead}" is about something that isn't your main thing, give it its own page and link it from your menu.`]
  if (/\bnear me\b/i.test(lead)) return [
    `"Near me" searches are mostly won in Google's map results by your Google Business Profile, not your website. Check its categories, hours and photos, and keep reviews coming.`,
    `On your site, make sure the homepage title and main heading say what you are and your town, and that your address and phone are on every page.`,
  ]
  const gap = missing(lead, `${head.title ?? ""} ${head.h1 ?? ""}`)
  return gap.length
    ? [
        `Put what you are and where in your homepage title and main heading. They don't say ${gap.map((w) => `"${w}"`).join(", ")}.`,
        `If these searches are about something you do that isn't your main thing, give it its own page and link it from your menu.`,
      ]
    : [
        `Your homepage title and main heading already say "${lead}", so the wording isn't what's holding it back. Climbing for it takes other sites linking to yours: directories, partners, your Google Business Profile, articles that mention you.`,
        `If "${lead}" is one part of what you do rather than all of it, a page just for it, linked from your menu, helps too.`,
      ]
}

/** Spread the sample across sections of the site instead of taking the first 8 of one. */
function pickSample(urls: string[], n: number) {
  const groups = new Map<string, string[]>()
  for (const u of urls) { const k = pathOf(u).split("/")[1] ?? ""; const g = groups.get(k) ?? []; g.push(u); groups.set(k, g) }
  const out: string[] = []
  while (out.length < n && [...groups.values()].some((g) => g.length)) {
    for (const g of groups.values()) { const u = g.shift(); if (u) out.push(u); if (out.length >= n) break }
  }
  return out
}
