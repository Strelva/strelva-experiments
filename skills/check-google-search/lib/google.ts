/** Read-only calls to Google Search Console. Every function takes a short-lived access token. */

export type Row = { keys: string[]; clicks: number; impressions: number; ctr: number; position: number }

const GSC = "https://searchconsole.googleapis.com"

async function call<T>(token: string, url: string, body?: object): Promise<T> {
  const res = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
    cache: "no-store",
  }).catch((e: Error) => { throw new Error(`Couldn't reach Google (${e.message}). Check the internet connection and try again.`) })
  if (!res.ok) {
    // Google puts the useful part (like "enable the API at <link>") in error.message.
    const text = await res.text()
    let message = text.slice(0, 500)
    try { message = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? message } catch {}
    throw new Error(`Search Console: HTTP ${res.status}: ${message}`)
  }
  return (await res.json()) as T
}

/** Thrown when the saved sign-in no longer works and the owner has to sign in again. */
export class SignInNeeded extends Error {}

export async function refreshAccessToken(refreshToken: string, clientId: string, clientSecret: string): Promise<string> {
  let res: Response
  try {
    res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }),
      signal: AbortSignal.timeout(30_000),
    })
  } catch (e) {
    throw new Error(`Couldn't reach Google (${(e as Error).message}). Check the internet connection and try again.`)
  }
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; error?: string }
  if (body.error === "invalid_grant") throw new SignInNeeded("The Google sign-in has expired or was revoked.")
  if (body.error === "invalid_client" || body.error === "unauthorized_client") throw new SignInNeeded("Google doesn't recognise the saved client any more (it was probably deleted). Make a new Desktop app client and sign in with its file.")
  if (!res.ok || !body.access_token) throw new Error(`Google couldn't refresh the sign-in (HTTP ${res.status}${body.error ? `, ${body.error}` : ""}). Try again in a minute.`)
  return body.access_token
}

export async function listSites(token: string): Promise<{ siteUrl: string; permissionLevel: string }[]> {
  const r = await call<{ siteEntry?: { siteUrl: string; permissionLevel: string }[] }>(token, `${GSC}/webmasters/v3/sites`)
  return (r.siteEntry ?? []).filter((s) => s.permissionLevel !== "siteUnverifiedUser")
}

/** Search analytics for one window, up to 100K rows (Google returns 25K at a time). */
export async function searchRows(token: string, site: string, start: string, end: string, dimensions: string[]): Promise<Row[]> {
  const out: Row[] = []
  for (let startRow = 0; startRow < 100_000; startRow += 25_000) {
    const r = await call<{ rows?: Row[] }>(token, `${GSC}/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`, {
      startDate: start, endDate: end, dimensions, rowLimit: 25_000, startRow, dataState: "final",
    })
    out.push(...(r.rows ?? []))
    if ((r.rows?.length ?? 0) < 25_000) break
  }
  return out
}

/** Daily clicks and impressions for one page, for the before/after view. */
export async function pageDaily(token: string, site: string, page: string, start: string, end: string): Promise<Row[]> {
  const r = await call<{ rows?: Row[] }>(token, `${GSC}/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`, {
    startDate: start, endDate: end, dimensions: ["date"], rowLimit: 1000,
    dimensionFilterGroups: [{ filters: [{ dimension: "page", operator: "equals", expression: page }] }],
  })
  return r.rows ?? []
}

export async function listSitemaps(token: string, site: string): Promise<string[]> {
  const r = await call<{ sitemap?: { path: string }[] }>(token, `${GSC}/webmasters/v3/sites/${encodeURIComponent(site)}/sitemaps`)
  return (r.sitemap ?? []).map((s) => s.path)
}

export type Inspection = { url: string; verdict: string; coverage: string; lastCrawl?: string }

export async function inspectUrl(token: string, site: string, url: string): Promise<Inspection> {
  const r = await call<{ inspectionResult?: { indexStatusResult?: { verdict?: string; coverageState?: string; lastCrawlTime?: string } } }>(
    token, `${GSC}/v1/urlInspection/index:inspect`, { inspectionUrl: url, siteUrl: site },
  )
  const s = r.inspectionResult?.indexStatusResult
  return { url, verdict: s?.verdict ?? "UNKNOWN", coverage: s?.coverageState ?? "Unknown", lastCrawl: s?.lastCrawlTime }
}
