/** The quick daily check: things that broke or dropped since last week, and fixes that are due a follow-up. */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { call, searchRows, SignInNeeded, sitemapDetails } from "./google.ts"
import { readPage } from "./page.ts"

export type Alert = { id: string; level: "warn" | "info"; message: string }
export type Watch = { site: string; checkedAt: string; alerts: Alert[] }

type Done = { site: string; id: string; page: string | null; change: string; done: string }

const DAY = 86_400_000
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10)
/** A failed read becomes an alert with Google's message, except a sign-in problem, which stops the run. */
const failed = (e: unknown): { error: string } => { if (e instanceof SignInNeeded) throw e; return { error: (e as Error).message } }

export async function runWatch(token: string, site: string, dir: string, property?: string): Promise<Watch> {
  const now = Date.now()
  // Search Console data settles about 3 days after the fact.
  const end = now - 3 * DAY
  const alerts: Alert[] = []

  const [daily, pages, sitemaps] = await Promise.all([
    searchRows(token, site, day(end - 13 * DAY), day(end), ["date"]),
    searchRows(token, site, day(end - 6 * DAY), day(end), ["page"]),
    sitemapDetails(token, site).catch(failed),
  ])
  const week = (from: number, to: number) => daily.filter((r) => r.keys[0] >= day(from) && r.keys[0] <= day(to)).reduce((s, r) => s + r.clicks, 0)
  const thisWeek = week(end - 6 * DAY, end), lastWeek = week(end - 13 * DAY, end - 7 * DAY)
  if (lastWeek >= 20 && thisWeek <= lastWeek * 0.6) {
    alerts.push({ id: "clicks-drop", level: "warn", message: `Clicks from Google fell to ${thisWeek} this week from ${lastWeek} the week before. Run the full report to see which pages lost them.` })
  }

  if ("error" in sitemaps) alerts.push({ id: "sitemaps-unread", level: "warn", message: `Couldn't read the sitemaps from Search Console: ${sitemaps.error}` })
  for (const s of "error" in sitemaps ? [] : sitemaps) {
    if (Number(s.errors ?? 0) > 0) alerts.push({ id: `sitemap-errors:${s.path}`, level: "warn", message: `Google found ${s.errors} error${s.errors === "1" ? "" : "s"} in ${s.path}. Open Search Console > Sitemaps to see them.` })
    const read = s.lastDownloaded ? Date.parse(s.lastDownloaded) : 0
    if (!s.isPending && read && now - read > 30 * DAY) alerts.push({ id: `sitemap-stale:${s.path}`, level: "info", message: `Google last read ${s.path} on ${day(read)}. If the site has new pages, resubmit it.` })
  }

  // The pages that bring the clicks: one going down costs the most.
  const top = [...pages].sort((a, b) => b.clicks - a.clicks).filter((p) => p.clicks > 0).slice(0, 10)
  const heads = await Promise.all(top.map((p) => readPage(p.keys[0])))
  // Every top page failing to load at all usually means the site (or its DNS) is down.
  if (heads.length >= 3 && heads.every((h) => h.status === 0)) alerts.push({ id: "site-unreachable", level: "warn", message: `None of the ${heads.length} pages Google sends the most people to would load from here (${heads[0].url} included). Check the site is up.` })
  for (const h of heads) {
    if (h.status === 0 || [401, 403, 429, 503].includes(h.status)) continue
    if (h.status >= 400) alerts.push({ id: `page-down:${h.url}`, level: "warn", message: `${h.url} returns an error (HTTP ${h.status}). It's one of the pages Google sends the most people to.` })
    else if (h.noindex) alerts.push({ id: `page-noindex:${h.url}`, level: "warn", message: `${h.url} now tells Google not to show it (noindex). It's one of the pages Google sends the most people to.` })
  }

  if (property) {
    // Two full weeks ending two days ago: GA4 can still be adding to the last day or two.
    const gaEnd = now - 2 * DAY
    const rows = await call<{ rows?: { dimensionValues: { value: string }[]; metricValues: { value: string }[] }[] }>(token, `https://analyticsdata.googleapis.com/v1beta/${property}:runReport`, {
      dateRanges: [{ startDate: day(gaEnd - 13 * DAY), endDate: day(now - DAY) }], dimensions: [{ name: "date" }], metrics: [{ name: "sessions" }, { name: "keyEvents" }],
    // A sign-in without Analytics shouldn't stop the Search Console checks; it becomes an alert instead.
    }).catch((e) => ({ error: (e as Error).message }))
    if ("error" in rows) alerts.push({ id: "analytics-unread", level: "warn", message: `Couldn't read Google Analytics, so its checks didn't run: ${rows.error}` })
    else {
      const ga = (rows.rows ?? []).map((r) => ({ date: `${r.dimensionValues[0].value.slice(0, 4)}-${r.dimensionValues[0].value.slice(4, 6)}-${r.dimensionValues[0].value.slice(6)}`, sessions: Number(r.metricValues[0].value), keyEvents: Number(r.metricValues[1].value) }))
      const total = (from: number, to: number, k: "sessions" | "keyEvents") => ga.filter((r) => r.date >= day(from) && r.date <= day(to)).reduce((s, r) => s + r[k], 0)
      const [thisFrom, lastFrom, lastTo] = [gaEnd - 6 * DAY, gaEnd - 13 * DAY, gaEnd - 7 * DAY]
      if (total(lastFrom, lastTo, "sessions") >= 50 && total(gaEnd + DAY, now - DAY, "sessions") === 0 && total(gaEnd - DAY, gaEnd, "sessions") === 0) {
        alerts.push({ id: "analytics-silent", level: "warn", message: "Google Analytics has recorded no visits for days, after a normal week. The tracking code may have come off the site." })
      }
      const thisKey = total(thisFrom, gaEnd, "keyEvents"), lastKey = total(lastFrom, lastTo, "keyEvents")
      if (lastKey >= 10 && thisKey <= lastKey * 0.5) alerts.push({ id: "key-events-drop", level: "warn", message: `Key events fell to ${thisKey} in the last week from ${lastKey} the week before. Check the form or checkout still works.` })
    }
  }

  let done: Done[] = []
  try { done = JSON.parse(readFileSync(join(dir, "done.json"), "utf8")) } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") alerts.push({ id: "done-unreadable", level: "warn", message: `done.json isn't valid JSON, so no fix follow-ups can be tracked: ${(e as Error).message}` })
  }
  for (const d of done.filter((d) => d.site === site)) {
    const due = Date.parse(`${d.done}T00:00:00Z`) + (d.page ? 17 : 28) * DAY
    if (due <= now && due > now - 7 * DAY) alerts.push({ id: `due:${d.id}`, level: "info", message: `The fix "${d.change}" (${d.done}) can be checked now.` })
  }

  return { site, checkedAt: new Date(now).toISOString(), alerts }
}
