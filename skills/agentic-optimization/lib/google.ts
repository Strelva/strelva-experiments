/** Calls to Google Search Console. Every function takes a short-lived access token. */

export type Row = { keys: string[]; clicks: number; impressions: number; ctr: number; position: number }

const GSC = "https://searchconsole.googleapis.com"

/** One Google API call. Shared with lib/analytics.ts. */
export async function call<T>(token: string, url: string, body?: object, method = body ? "POST" : "GET"): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
    cache: "no-store",
  }).catch((e: Error) => { throw new Error(`Couldn't reach Google (${e.message}). Check the internet connection and try again.`) })
  const api = new URL(url).hostname.startsWith("analytics") ? "Google Analytics" : "Search Console"
  const read = () => res.text().catch((e: Error) => { throw new Error(`Couldn't reach Google (${e.message}). Check the internet connection and try again.`) })
  if (!res.ok) {
    // Google puts the useful part (like "enable the API at <link>") in error.message.
    const text = await read()
    let message = text.slice(0, 500)
    try { message = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? message } catch {}
    if (res.status === 403 && /insufficient authentication scopes|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(text)) {
      throw new SignInNeeded(`The saved sign-in doesn't include ${api} access for this.`)
    }
    throw new Error(`${api}: HTTP ${res.status}: ${message}`)
  }
  const text = await read()
  return (text ? JSON.parse(text) : {}) as T
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

/**
 * Daily clicks and impressions for one page, for the before/after view. The report merges http/https and
 * www/no-www into one address, so this counts all of them too, with or without a trailing slash and with
 * non-English characters written either way (/café or /caf%C3%A9).
 */
export async function pageDaily(token: string, site: string, page: string, start: string, end: string): Promise<Row[]> {
  const u = new URL(page)
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const bare = u.pathname.replace(/\/+$/, "")
  let decoded = bare
  try { decoded = decodeURIComponent(bare) } catch {}
  const paths = [...new Set([bare, decoded])].map(esc).join("|")
  const expression = `^https?://(www\\.)?${esc(u.hostname.replace(/^www\./, ""))}(${paths})/?${esc(u.search)}$`
  const r = await call<{ rows?: Row[] }>(token, `${GSC}/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`, {
    startDate: start, endDate: end, dimensions: ["date"], rowLimit: 1000,
    dimensionFilterGroups: [{ filters: [{ dimension: "page", operator: "includingRegex", expression }] }],
  })
  return r.rows ?? []
}

export type Sitemap = { path: string; lastSubmitted?: string; lastDownloaded?: string; isPending?: boolean; errors?: string; warnings?: string; contents?: { type: string; submitted?: string }[] }

/** The sitemaps Search Console has for the site, with when Google last read each and any errors. */
export async function sitemapDetails(token: string, site: string): Promise<Sitemap[]> {
  const r = await call<{ sitemap?: Sitemap[] }>(token, `${GSC}/webmasters/v3/sites/${encodeURIComponent(site)}/sitemaps`)
  // Google no longer fills in contents[].indexed (it reads 0), so it's left out rather than misread.
  return (r.sitemap ?? []).map((s) => ({ ...s, contents: s.contents?.map((c) => ({ type: c.type, submitted: c.submitted })) }))
}

export async function listSitemaps(token: string, site: string): Promise<string[]> {
  return (await sitemapDetails(token, site)).map((s) => s.path)
}

/** Submits (or resubmits) a sitemap, which asks Google to read it again. This is a change to Search Console. */
export async function submitSitemap(token: string, site: string, sitemap: string): Promise<void> {
  await call(token, `${GSC}/webmasters/v3/sites/${encodeURIComponent(site)}/sitemaps/${encodeURIComponent(sitemap)}`, undefined, "PUT")
}

export type Inspection = { url: string; verdict: string; coverage: string; lastCrawl?: string }

export async function inspectUrl(token: string, site: string, url: string): Promise<Inspection> {
  const r = await call<{ inspectionResult?: { indexStatusResult?: { verdict?: string; coverageState?: string; lastCrawlTime?: string } } }>(
    token, `${GSC}/v1/urlInspection/index:inspect`, { inspectionUrl: url, siteUrl: site },
  )
  const s = r.inspectionResult?.indexStatusResult
  return { url, verdict: s?.verdict ?? "UNKNOWN", coverage: s?.coverageState ?? "Unknown", lastCrawl: s?.lastCrawlTime }
}
