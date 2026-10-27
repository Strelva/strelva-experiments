/**
 * Read a site's Google Search Console data and turn it into fixes. Read-only.
 *   node scripts/check.ts sites                          sites this Google account can see
 *   node scripts/check.ts report <site>                  last 28 days as a ranked list of fixes, JSON
 *   node scripts/check.ts compare <site> <page> <date>   one page's clicks 14 days before and after a fix went live
 * Exit codes: 0 ok, 1 bad input or an error (message on stderr), 2 needs sign-in (run scripts/sign-in.ts).
 */
import { listSites, pageDaily, refreshAccessToken, SignInNeeded } from "../lib/google.ts"
import { runReport } from "../lib/fixes.ts"
import { loadToken, tokenPath } from "./store.ts"

const [command, siteArg, page, done] = process.argv.slice(2)
const usage = "Usage: node scripts/check.ts sites | report <site> | compare <site> <page> <YYYY-MM-DD>"
const DAY = 86_400_000
const day = (from: string, n: number) => new Date(Date.parse(`${from}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10)

try {
  if (!["sites", "report", "compare"].includes(command)) throw new Error(usage)
  if (command !== "sites" && !siteArg) throw new Error(`${usage}\nGet <site> from "sites", for example sc-domain:example.com`)
  if (command === "compare") {
    if (!page || !/^https?:\/\//.test(page)) throw new Error(`${usage}\n<page> is the full address, like https://www.example.com/menu`)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(done ?? "") || isNaN(Date.parse(done)) || day(done, 0) !== done) throw new Error(`${usage}\n<date> is the day the fix went live, like 2026-10-20`)
  }

  const saved = loadToken()
  if (!saved) needsSignIn(`No sign-in saved at ${tokenPath}.`, false)
  let token: string
  try {
    token = await refreshAccessToken(saved.refresh_token, saved.client_id, saved.client_secret)
  } catch (e) {
    if (e instanceof SignInNeeded) needsSignIn(e.message, !e.message.includes("client"))
    throw e
  }

  const sites = await listSites(token)
  if (command === "sites") {
    if (!sites.length) console.error("This Google account has no verified sites in Search Console. Wrong Google account, or the site isn't verified in Search Console yet.")
    for (const s of sites) console.log(`${s.siteUrl}\t${s.permissionLevel}`)
    process.exit(0)
  }

  // "https://example.com" and "https://example.com/" are the same property.
  const site = sites.find((s) => s.siteUrl === siteArg || s.siteUrl === `${siteArg}/`)?.siteUrl
  if (!site) throw new Error(`This Google account can't see ${siteArg}. It can see: ${sites.map((s) => s.siteUrl).join(", ") || "nothing"}`)

  if (command === "report") {
    console.log(JSON.stringify(await runReport(token, site), null, 2))
  } else {
    const rows = await pageDaily(token, site, page, day(done, -14), day(done, 14))
    const total = (from: string, to: string) => rows.filter((r) => r.keys[0] >= from && r.keys[0] <= to)
      .reduce((s, r) => ({ clicks: s.clicks + r.clicks, impressions: s.impressions + r.impressions }), { clicks: 0, impressions: 0 })
    // Search Console data settles about 3 days after the fact, so the after window is complete 17 days on.
    const ready = day(done, 17)
    console.log(JSON.stringify({
      site, page, done,
      before: { from: day(done, -14), to: day(done, -1), ...total(day(done, -14), day(done, -1)) },
      after: { from: day(done, 1), to: day(done, 14), ...total(day(done, 1), day(done, 14)) },
      complete: new Date().toISOString().slice(0, 10) >= ready,
      completeOn: ready,
      ...(rows.length ? {} : { warning: "No data at all for this address. Check it matches the report exactly (https, www, trailing slash)." }),
    }, null, 2))
  }
} catch (e) {
  console.error((e as Error).message)
  process.exit(1)
}

function needsSignIn(why: string, reuseClient: boolean): never {
  console.error(`${why}\nSign in again: node scripts/sign-in.ts${reuseClient ? "  (reuses the saved client; pass a client file only the first time)" : " path/to/client_secret.json  (the Desktop app client file from Google Cloud)"}`)
  process.exit(2)
}
