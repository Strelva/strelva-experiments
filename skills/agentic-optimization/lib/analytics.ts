/** Calls to Google Analytics 4, and what they say next to the site's Search Console data. */
import { call, searchRows } from "./google.ts"

const ADMIN = "https://analyticsadmin.googleapis.com/v1beta"
const DATA = "https://analyticsdata.googleapis.com"

export type Property = { property: string; name: string; account: string; websites: string[]; error?: string }

/** Every GA4 property this account can see, with the website each one measures. */
export async function listProperties(token: string): Promise<Property[]> {
  type Page = { accountSummaries?: { displayName: string; propertySummaries?: { property: string; displayName: string }[] }[]; nextPageToken?: string }
  const summaries: NonNullable<Page["accountSummaries"]> = []
  let pageToken = ""
  do {
    const r: Page = await call<Page>(token, `${ADMIN}/accountSummaries?pageSize=200${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`)
    summaries.push(...(r.accountSummaries ?? []))
    pageToken = r.nextPageToken ?? ""
  } while (pageToken)
  const props = summaries.flatMap((a) => (a.propertySummaries ?? []).map((p) => ({ property: p.property, name: p.displayName, account: a.displayName })))
  return Promise.all(props.map(async (p) => {
    try {
      const s = await call<{ dataStreams?: { webStreamData?: { defaultUri?: string } }[] }>(token, `${ADMIN}/${p.property}/dataStreams`)
      return { ...p, websites: (s.dataStreams ?? []).flatMap((d) => (d.webStreamData?.defaultUri ? [d.webStreamData.defaultUri] : [])) }
    } catch (e) {
      // Say so, rather than look like a property with no website.
      return { ...p, websites: [], error: (e as Error).message }
    }
  }))
}

export async function listKeyEvents(token: string, property: string): Promise<string[]> {
  const r = await call<{ keyEvents?: { eventName: string }[] }>(token, `${ADMIN}/${property}/keyEvents`)
  return (r.keyEvents ?? []).map((k) => k.eventName)
}

/** Marks an event as a key event (what GA4 counts as a conversion). This is a change to Google Analytics. */
export async function createKeyEvent(token: string, property: string, eventName: string): Promise<void> {
  await call(token, `${ADMIN}/${property}/keyEvents`, { eventName, countingMethod: "ONCE_PER_EVENT" })
}

type ReportRow = { dimensionValues?: { value: string }[]; metricValues?: { value: string }[] }

async function report(token: string, property: string, body: object): Promise<{ keys: string[]; values: number[] }[]> {
  const r = await call<{ rows?: ReportRow[] }>(token, `${DATA}/v1beta/${property}:runReport`, body)
  return (r.rows ?? []).map((row) => ({ keys: (row.dimensionValues ?? []).map((d) => d.value), values: (row.metricValues ?? []).map((m) => Number(m.value)) }))
}

/** completionRate and abandonments are about moving on to the next step, so the last step has none. */
export type Step = { name: string; users: number; completionRate: number | null; abandonments: number | null }

/**
 * Where people drop out between steps, over the last 28 days. Each step is "event:<name>" (like
 * event:sign_up) or "page:<path>" (a page whose address starts with that path, like page:/pricing).
 */
export async function runFunnel(token: string, property: string, steps: string[], start: string, end: string): Promise<Step[]> {
  const expression = (s: string) => {
    const [type, value] = [s.slice(0, s.indexOf(":")), s.slice(s.indexOf(":") + 1)]
    if (type === "event" && value) return { funnelEventFilter: { eventName: value } }
    if (type === "page" && value.startsWith("/")) return { funnelFieldFilter: { fieldName: "unifiedPagePathScreen", stringFilter: { matchType: "BEGINS_WITH", value } } }
    throw new Error(`"${s}" isn't a step. Use event:<event name> or page:/<path>, like event:sign_up or page:/pricing`)
  }
  const r = await call<{ funnelTable?: { rows?: ReportRow[] } }>(token, `${DATA}/v1alpha/${property}:runFunnelReport`, {
    dateRanges: [{ startDate: start, endDate: end }],
    funnel: { steps: steps.map((s) => ({ name: s, filterExpression: expression(s) })) },
  })
  // GA4 leaves out steps nobody reached; they count as zero.
  // Rows are named "1. <step>"; key them by number, so two steps with the same name stay apart.
  const byIndex = new Map((r.funnelTable?.rows ?? []).map((row) => [Number(row.dimensionValues?.[0]?.value.match(/^(\d+)\./)?.[1]) - 1, (row.metricValues ?? []).map((m) => Number(m.value))]))
  return steps.map((s, i) => {
    const [users = 0, completionRate = 0, abandonments = 0] = byIndex.get(i) ?? []
    return i === steps.length - 1 ? { name: s, users, completionRate: null, abandonments: null } : { name: s, users, completionRate, abandonments }
  })
}

export type TrafficFix = { id: string; kind: "no-key-events" | "key-events-silent" | "search-no-convert" | "converts-hidden"; page: string | null; headline: string; evidence: string[]; todo: string[] }

export type Traffic = {
  property: string
  window: { start: string; end: string }
  totals: { sessions: number; sessionsPrev: number; organicSessions: number; organicSessionsPrev: number; keyEvents: number; keyEventsPrev: number }
  channels: { channel: string; sessions: number; keyEvents: number }[]
  keyEvents: string[]
  events: { name: string; count: number; key: boolean }[]
  /** convertRate: the share of search visits to the page that ended in a key event. */
  pages: { path: string; organicSessions: number; keyEvents: number; convertRate: number; engagementRate: number; clicks: number; impressions: number }[]
  fixes: TrafficFix[]
  notes: string[]
}

/** Events sites often send for the action that matters: a sale, a sign-up, a lead. */
const LIKELY_KEY = /^(purchase|generate_lead|form_submit|submit_form|begin_checkout|click_to_call|phone_call|call_click|request_quote|quote_request|contact(_form)?_submit(ted)?|(sign_?up|subscribe|booking|book_appointment|schedule_appointment)(_complete(d)?|_success)?)$/i

/** GA4 traffic for the same 28 days as the search report, with each landing page next to its Search Console numbers. */
export async function runTraffic(token: string, property: string, site: string, window: { start: string; end: string }, prev: { start: string; end: string }): Promise<Traffic> {
  const both = [{ startDate: window.start, endDate: window.end }, { startDate: prev.start, endDate: prev.end }]
  const organic = { filter: { fieldName: "sessionDefaultChannelGroup", stringFilter: { value: "Organic Search" } } }
  const [channelRows, prevRows, organicPrevRows, organicRate, eventRows, pageRows, keyEvents, gsc] = await Promise.all([
    report(token, property, { dateRanges: [both[0]], dimensions: [{ name: "sessionDefaultChannelGroup" }], metrics: [{ name: "sessions" }, { name: "keyEvents" }] }),
    report(token, property, { dateRanges: [both[1]], metrics: [{ name: "sessions" }, { name: "keyEvents" }] }),
    report(token, property, { dateRanges: [both[1]], metrics: [{ name: "sessions" }], dimensionFilter: organic }),
    report(token, property, { dateRanges: [both[0]], metrics: [{ name: "sessionKeyEventRate" }], dimensionFilter: organic }),
    report(token, property, { dateRanges: [both[0]], dimensions: [{ name: "eventName" }], metrics: [{ name: "eventCount" }], limit: 100 }),
    report(token, property, { dateRanges: [both[0]], dimensions: [{ name: "hostName" }, { name: "landingPage" }], metrics: [{ name: "sessions" }, { name: "keyEvents" }, { name: "engagementRate" }, { name: "sessionKeyEventRate" }], dimensionFilter: organic, orderBys: [{ metric: { metricName: "sessions" }, desc: true }], limit: 2000 }),
    listKeyEvents(token, property),
    searchRows(token, site, window.start, window.end, ["page"]),
  ])

  const sum = (rows: { values: number[] }[], i: number) => rows.reduce((s, r) => s + (r.values[i] ?? 0), 0)
  const channels = channelRows.map((r) => ({ channel: r.keys[0], sessions: r.values[0], keyEvents: r.values[1] })).sort((a, b) => b.sessions - a.sessions)
  const totals = {
    sessions: sum(channelRows, 0), sessionsPrev: sum(prevRows, 0),
    organicSessions: channels.find((c) => c.channel === "Organic Search")?.sessions ?? 0, organicSessionsPrev: sum(organicPrevRows, 0),
    keyEvents: sum(channelRows, 1), keyEventsPrev: sum(prevRows, 1),
  }
  const events = eventRows.map((r) => ({ name: r.keys[0], count: r.values[0], key: keyEvents.includes(r.keys[0]) }))

  // Search Console gives full addresses; GA4 gives a host and a landing page with its query string.
  // Both are keyed as host (without www) + decoded path without the query or a trailing slash.
  const host = (h: string) => h.toLowerCase().replace(/^www\./, "")
  const path = (p: string) => {
    const bare = p.replace(/[?#].*$/, "").replace(/\/+$/, "") || "/"
    try { return decodeURIComponent(bare) } catch { return bare }
  }
  const search = new Map<string, { clicks: number; impressions: number }>()
  for (const r of gsc) {
    let key: string
    try { const u = new URL(r.keys[0]); key = host(u.hostname) + path(u.pathname) } catch { continue }
    const s = search.get(key) ?? { clicks: 0, impressions: 0 }
    search.set(key, { clicks: s.clicks + r.clicks, impressions: s.impressions + r.impressions })
  }
  // One row per page: GA4 splits a page by query string (?utm_source=...), which would double-count it.
  const merged = new Map<string, { host: string; path: string; sessions: number; keyEvents: number; withKey: number; engaged: number }>()
  for (const r of pageRows) {
    if (!r.keys[1] || r.keys[1] === "(not set)") continue
    const key = host(r.keys[0]) + path(r.keys[1])
    const m = merged.get(key) ?? { host: host(r.keys[0]), path: path(r.keys[1]), sessions: 0, keyEvents: 0, withKey: 0, engaged: 0 }
    m.sessions += r.values[0]; m.keyEvents += r.values[1]; m.engaged += r.values[2] * r.values[0]; m.withKey += r.values[3] * r.values[0]
    merged.set(key, m)
  }
  // Show the host only when the property measures more than one.
  const manyHosts = new Set([...merged.values()].map((m) => m.host)).size > 1
  const pages = [...merged].map(([key, m]) => ({
    path: manyHosts ? m.host + m.path : m.path,
    organicSessions: m.sessions, keyEvents: m.keyEvents,
    convertRate: m.sessions ? Math.round((m.withKey / m.sessions) * 1000) / 1000 : 0,
    engagementRate: m.sessions ? Math.round((m.engaged / m.sessions) * 100) / 100 : 0,
    ...(search.get(key) ?? { clicks: 0, impressions: 0 }),
  })).sort((a, b) => b.organicSessions - a.organicSessions)

  const fixes: TrafficFix[] = []
  const notes: string[] = []
  const fmt = (n: number) => Math.round(n).toLocaleString("en-US")

  if (!keyEvents.length) {
    const candidates = events.filter((e) => LIKELY_KEY.test(e.name))
    fixes.push({
      id: "no-key-events", kind: "no-key-events", page: null,
      headline: "Google Analytics isn't counting any sales, sign-ups or leads",
      evidence: [`No key events are set up, so there's no way to tell which searches and pages bring customers.`, ...(candidates.length ? [`Events already coming in that look like the main action: ${candidates.map((e) => `${e.name} (${fmt(e.count)})`).join(", ")}.`] : [])],
      todo: candidates.length
        ? [`Mark ${candidates[0].name} as a key event (key-event command, with the owner's yes).`]
        : ["Pick the one action that matters most (a booking, a sale, a sign-up, a form sent). Add an event for it to the site, then mark it as a key event."],
    })
  } else if (totals.keyEvents === 0 && totals.sessions >= 100) {
    fixes.push({
      id: "key-events-silent", kind: "key-events-silent", page: null,
      headline: "Your key events counted nothing in 28 days",
      evidence: [`${fmt(totals.sessions)} visits and 0 of ${keyEvents.join(", ")}.`],
      todo: ["Check the event still fires: complete the action on the site yourself, then look in GA4 > Reports > Realtime. A redesign or a new form often drops the tracking."],
    })
  }

  // The share of search visits that end in a key event, across the site.
  const rate = organicRate[0]?.values[0] ?? 0
  const pct = (x: number) => `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`
  if (rate > 0) {
    for (const p of pages.filter((p) => p.organicSessions >= 20 && p.keyEvents === 0).slice(0, 3)) {
      fixes.push({
        id: `search-no-convert:${p.path}`, kind: "search-no-convert", page: p.path,
        headline: `Search engines bring people to ${p.path}, but none of them convert`,
        evidence: [`${fmt(p.organicSessions)} visits from search engines in 28 days, none with a key event.`, `Across the site, ${pct(rate)} of search visits have one.`],
        todo: ["Make the next step obvious on this page: one clear button or form above the fold, matching what people searched for.", "Link to the page that converts best."],
      })
    }
    for (const p of pages.filter((p) => p.organicSessions >= 10 && p.convertRate * p.organicSessions >= 3 && p.convertRate >= 2 * rate && p.impressions < 500).slice(0, 2)) {
      fixes.push({
        id: `converts-hidden:${p.path}`, kind: "converts-hidden", page: p.path,
        headline: `${p.path} turns search visits into customers. Get it seen more`,
        evidence: [`${pct(p.convertRate)} of its ${fmt(p.organicSessions)} search visits had a key event, against ${pct(rate)} site-wide.`, `Google showed it only ${fmt(p.impressions)} times in 28 days.`],
        todo: ["Link to it from the homepage and your most-visited pages.", "Use the search report's fixes for this page first (title, almost on page one)."],
      })
    }
  }
  if (totals.sessions < 100) notes.push("Under 100 visits in 28 days: too little to judge pages yet.")
  if (totals.keyEvents > 0 && totals.keyEventsPrev === 0) notes.push("No key events were counted in the 28 days before, so tracking probably started recently. Don't present the change as growth.")
  if (!pages.length) notes.push("No visits from Google search were recorded in 28 days.")
  return { property, window, totals, channels, keyEvents, events, pages: pages.slice(0, 25), fixes, notes }
}
