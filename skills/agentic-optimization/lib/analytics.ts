/** Calls to Google Analytics 4, and what they say next to the site's Search Console data. */
import { call, searchRows } from "./google.ts"

const ADMIN = "https://analyticsadmin.googleapis.com/v1beta"
const DATA = "https://analyticsdata.googleapis.com"

export type Property = { property: string; name: string; account: string; websites: string[] }

/** Every GA4 property this account can see, with the website each one measures. */
export async function listProperties(token: string): Promise<Property[]> {
  const r = await call<{ accountSummaries?: { displayName: string; propertySummaries?: { property: string; displayName: string }[] }[] }>(token, `${ADMIN}/accountSummaries?pageSize=200`)
  const props = (r.accountSummaries ?? []).flatMap((a) => (a.propertySummaries ?? []).map((p) => ({ property: p.property, name: p.displayName, account: a.displayName })))
  return Promise.all(props.map(async (p) => {
    const s = await call<{ dataStreams?: { webStreamData?: { defaultUri?: string } }[] }>(token, `${ADMIN}/${p.property}/dataStreams`).catch(() => ({ dataStreams: [] }))
    return { ...p, websites: (s.dataStreams ?? []).flatMap((d) => (d.webStreamData?.defaultUri ? [d.webStreamData.defaultUri] : [])) }
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

export type Step = { name: string; users: number; completionRate: number; abandonments: number }

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
  const byName = new Map((r.funnelTable?.rows ?? []).map((row) => [row.dimensionValues?.[0]?.value.replace(/^\d+\.\s*/, "") ?? "", (row.metricValues ?? []).map((m) => Number(m.value))]))
  return steps.map((s) => {
    const [users = 0, completionRate = 0, abandonments = 0] = byName.get(s) ?? []
    return { name: s, users, completionRate, abandonments }
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
const LIKELY_KEY = /^(purchase|sign_?up|generate_lead|form_submit|contact|book|booking|schedule|subscribe|begin_checkout|call|click_to_call|request_quote|quote|submit)/i

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
    report(token, property, { dateRanges: [both[0]], dimensions: [{ name: "landingPage" }], metrics: [{ name: "sessions" }, { name: "keyEvents" }, { name: "engagementRate" }, { name: "sessionKeyEventRate" }], dimensionFilter: organic, orderBys: [{ metric: { metricName: "sessions" }, desc: true }], limit: 500 }),
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

  // Search Console gives full addresses, GA4 gives paths. Match on the path without a trailing slash.
  const norm = (p: string) => (p.replace(/[?#].*$/, "").replace(/\/+$/, "") || "/")
  const search = new Map<string, { clicks: number; impressions: number }>()
  for (const r of gsc) {
    let path: string
    try { path = norm(new URL(r.keys[0]).pathname) } catch { continue }
    const s = search.get(path) ?? { clicks: 0, impressions: 0 }
    search.set(path, { clicks: s.clicks + r.clicks, impressions: s.impressions + r.impressions })
  }
  const pages = pageRows.filter((r) => r.keys[0] && r.keys[0] !== "(not set)").map((r) => ({
    path: r.keys[0], organicSessions: r.values[0], keyEvents: r.values[1], convertRate: Math.round(r.values[3] * 1000) / 1000, engagementRate: Math.round(r.values[2] * 100) / 100,
    ...(search.get(norm(r.keys[0])) ?? { clicks: 0, impressions: 0 }),
  }))

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
        headline: `Search brings people to ${p.path}, but none of them convert`,
        evidence: [`${fmt(p.organicSessions)} visits from Google in 28 days, none ended in a key event.`, `Across the site, ${pct(rate)} of search visits do.`],
        todo: ["Make the next step obvious on this page: one clear button or form above the fold, matching what people searched for.", "Link to the page that converts best."],
      })
    }
    for (const p of pages.filter((p) => p.organicSessions >= 10 && p.convertRate * p.organicSessions >= 3 && p.convertRate >= 2 * rate && p.impressions < 500).slice(0, 2)) {
      fixes.push({
        id: `converts-hidden:${p.path}`, kind: "converts-hidden", page: p.path,
        headline: `${p.path} turns search visits into customers. Get it seen more`,
        evidence: [`${pct(p.convertRate)} of its ${fmt(p.organicSessions)} search visits ended in a key event, against ${pct(rate)} site-wide.`, `Google showed it only ${fmt(p.impressions)} times in 28 days.`],
        todo: ["Link to it from the homepage and your most-visited pages.", "Use the search report's fixes for this page first (title, almost on page one)."],
      })
    }
  }
  if (totals.sessions < 100) notes.push("Under 100 visits in 28 days: too little to judge pages yet.")
  if (!pages.length) notes.push("No visits from Google search were recorded in 28 days.")
  return { property, window, totals, channels, keyEvents, events, pages: pages.slice(0, 25), fixes, notes }
}
