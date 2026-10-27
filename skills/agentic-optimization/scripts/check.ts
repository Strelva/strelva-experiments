/**
 * Search Console and Google Analytics for one site: the fixes, the checks, and the few changes the owner approves.
 *   node scripts/check.ts sites                                  Search Console sites this account can see
 *   node scripts/check.ts report <site> [--save]                 last 28 days as a ranked list of fixes, JSON
 *   node scripts/check.ts compare <site> <page> <date>           one page's clicks 14 days before and after a fix went live
 *   node scripts/check.ts sitemaps <site>                        the site's sitemaps, when Google last read them, errors
 *   node scripts/check.ts submit-sitemap <site> <url> --confirm  submit or resubmit a sitemap (a change: owner's yes first)
 *   node scripts/check.ts properties                             Google Analytics properties and the website each measures
 *   node scripts/check.ts traffic <site> <property> [--save]     GA4 visits and key events next to the search data, with fixes
 *   node scripts/check.ts funnel <property> <step> <step>...     where people drop out; steps are event:<name> or page:/<path>
 *   node scripts/check.ts key-event <property> <event> --confirm mark an event as a key event (a change: owner's yes first)
 *   node scripts/check.ts daily <site> [<property>] [--save]     quick check for drops, errors and fixes due a follow-up
 * --save (report, traffic, daily) writes to the log folder instead of printing, for scheduled runs (scripts/schedule.ts).
 * Exit codes: 0 ok, 1 bad input or an error (message on stderr), 2 needs sign-in (run scripts/sign-in.ts).
 */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { execFile } from "node:child_process"
import { join } from "node:path"
import { listSites, pageDaily, refreshAccessToken, SignInNeeded, sitemapDetails, submitSitemap } from "../lib/google.ts"
import { createKeyEvent, listKeyEvents, listProperties, runFunnel, runTraffic } from "../lib/analytics.ts"
import { runReport } from "../lib/fixes.ts"
import { runWatch } from "../lib/watch.ts"
import { dir, loadToken, logDir, tokenPath } from "./store.ts"

const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith("--")))
const [command, ...args] = process.argv.slice(2).filter((a) => !a.startsWith("--"))
const usage = "Usage: node scripts/check.ts sites | report <site> | compare <site> <page> <YYYY-MM-DD> | sitemaps <site> | submit-sitemap <site> <url> --confirm | properties | traffic <site> <property> | funnel <property> <step>... | key-event <property> <event> --confirm | daily <site> [<property>]"
const DAY = 86_400_000
const day = (from: string, n: number) => new Date(Date.parse(`${from}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10)
const today = new Date().toISOString().slice(0, 10)
const print = (x: unknown) => console.log(JSON.stringify(x, null, 2))
const property = (p: string | undefined) => {
  if (!p || !/^(properties\/)?\d+$/.test(p)) throw new Error(`${usage}\n<property> is from "properties", like properties/123456789`)
  return p.startsWith("properties/") ? p : `properties/${p}`
}
const SITE_COMMANDS = ["report", "compare", "sitemaps", "submit-sitemap", "traffic", "daily"]

try {
  if (![...SITE_COMMANDS, "sites", "properties", "funnel", "key-event"].includes(command)) throw new Error(usage)
  if (SITE_COMMANDS.includes(command) && !args[0]) throw new Error(`${usage}\nGet <site> from "sites", for example sc-domain:example.com`)
  if (command === "compare") {
    if (!args[1] || !/^https?:\/\//.test(args[1])) throw new Error(`${usage}\n<page> is the full address, like https://www.example.com/menu`)
    const done = args[2] ?? ""
    if (!/^\d{4}-\d{2}-\d{2}$/.test(done) || isNaN(Date.parse(done)) || day(done, 0) !== done) throw new Error(`${usage}\n<date> is the day the fix went live, like 2026-10-20`)
  }
  // Changes need the flag, so a change is never made by a mistyped command.
  if (["submit-sitemap", "key-event"].includes(command) && !flags.has("--confirm")) throw new Error(`${command} changes Google's settings. Get the owner's yes, then add --confirm.`)

  const saved = loadToken()
  if (!saved) throw new SignInNeeded(`No sign-in saved at ${tokenPath}.`)
  const token = await refreshAccessToken(saved.refresh_token, saved.client_id, saved.client_secret)

  if (command === "properties") {
    const props = await listProperties(token)
    if (!props.length) console.error("This Google account has no Google Analytics properties, or Analytics wasn't ticked at sign-in.")
    print(props)
  } else if (command === "funnel") {
    if (args.length < 3) throw new Error(`${usage}\nGive at least two steps, like event:page_view page:/pricing event:sign_up`)
    const end = day(today, -1)
    const steps = await runFunnel(token, property(args[0]), args.slice(1), day(end, -27), end)
    print({
      property: property(args[0]), window: { start: day(end, -27), end }, steps,
      ...(steps[0].users ? {} : { warning: "Nobody matched the first step in 28 days. Check the event name against the events in traffic, or the page path." }),
    })
  } else if (command === "key-event") {
    const p = property(args[0]), name = args[1]
    if (!name || !/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) throw new Error(`${usage}\n<event> is an event name GA4 already receives, like generate_lead (see "events" in traffic)`)
    if ((await listKeyEvents(token, p)).includes(name)) console.log(`${name} is already a key event.`)
    else { await createKeyEvent(token, p, name); console.log(`${name} is now a key event in ${p}. GA4 counts it from now on, not backwards.`) }
  } else {
    const sites = await listSites(token)
    if (command === "sites") {
      if (!sites.length) console.error("This Google account has no verified sites in Search Console. Wrong Google account, or the site isn't verified in Search Console yet.")
      for (const s of sites) console.log(`${s.siteUrl}\t${s.permissionLevel}`)
      process.exit(0)
    }
    // "https://example.com" and "https://example.com/" are the same property.
    const site = sites.find((s) => s.siteUrl === args[0] || s.siteUrl === `${args[0]}/`)?.siteUrl
    if (!site) throw new Error(`This Google account can't see ${args[0]}. It can see: ${sites.map((s) => s.siteUrl).join(", ") || "nothing"}`)

    if (command === "report") {
      const r = await runReport(token, site)
      if (flags.has("--save")) save(`report-${today}.json`, r)
      else print(r)
    } else if (command === "compare") {
      const [, page, done] = args
      const rows = await pageDaily(token, site, page, day(done, -14), day(done, 14))
      const total = (from: string, to: string) => rows.filter((r) => r.keys[0] >= from && r.keys[0] <= to)
        .reduce((s, r) => ({ clicks: s.clicks + r.clicks, impressions: s.impressions + r.impressions }), { clicks: 0, impressions: 0 })
      // Search Console data settles about 3 days after the fact, so the after window is complete 17 days on.
      const ready = day(done, 17)
      print({
        site, page, done,
        before: { from: day(done, -14), to: day(done, -1), ...total(day(done, -14), day(done, -1)) },
        after: { from: day(done, 1), to: day(done, 14), ...total(day(done, 1), day(done, 14)) },
        complete: today >= ready,
        completeOn: ready,
        ...(rows.length ? {} : { warning: "No data at all for this address. Check it matches the report exactly (https, www, trailing slash)." }),
      })
    } else if (command === "sitemaps") {
      print(await sitemapDetails(token, site))
    } else if (command === "submit-sitemap") {
      const url = args[1]
      if (!url || !/^https?:\/\//.test(url)) throw new Error(`${usage}\n<url> is the sitemap's full address, like https://www.example.com/sitemap.xml`)
      await submitSitemap(token, site, url)
      console.log(`Submitted ${url}. Google usually reads it within a few days; "sitemaps" shows when it did.`)
    } else if (command === "traffic") {
      // The same 28 days as the search report, so the two line up.
      const end = day(today, -3)
      const t = await runTraffic(token, property(args[1]), site, { start: day(end, -27), end }, { start: day(end, -55), end: day(end, -28) })
      if (flags.has("--save")) save(`traffic-${today}.json`, t)
      else print(t)
    } else {
      const w = await runWatch(token, site, dir, args[1] ? property(args[1]) : undefined)
      if (!flags.has("--save")) print(w)
      else {
        mkdirSync(logDir, { recursive: true })
        const log = join(logDir, "daily.jsonl")
        // Notify only about problems that weren't there yesterday, so an unfixed one doesn't nag every morning.
        let seen = new Set<string>()
        try {
          const last = readFileSync(log, "utf8").trim().split("\n").reverse().map((l) => JSON.parse(l) as typeof w).find((x) => x.site === site)
          seen = new Set(last?.alerts.map((a) => a.id))
        } catch {}
        appendFileSync(log, JSON.stringify(w) + "\n")
        const warn = w.alerts.filter((a) => a.level === "warn" && !seen.has(a.id))
        if (warn.length) notify(`${warn.length} new thing${warn.length === 1 ? "" : "s"} to look at on ${site.replace(/^sc-domain:|^https?:\/\/|\/$/g, "")}. Ask your agent.`)
      }
    }
  }
} catch (e) {
  // A scheduled run has no one watching the terminal: log the failure and say so on screen.
  if (flags.has("--save")) {
    mkdirSync(logDir, { recursive: true })
    appendFileSync(join(logDir, "errors.jsonl"), JSON.stringify({ at: new Date().toISOString(), command, args, error: (e as Error).message }) + "\n")
    notify(e instanceof SignInNeeded ? "The Google sign-in needs renewing. Ask your agent." : `A scheduled check failed: ${(e as Error).message.slice(0, 120)}`)
  }
  if (e instanceof SignInNeeded) needsSignIn(e.message, !!loadToken() && !e.message.includes("client"))
  console.error((e as Error).message)
  process.exit(1)
}

function save(name: string, x: unknown) {
  mkdirSync(logDir, { recursive: true })
  writeFileSync(join(logDir, name), JSON.stringify(x, null, 2))
  console.log(`Saved ${join(logDir, name)}`)
}

/** A desktop notification, so an alert from a scheduled run doesn't wait for someone to look. */
function notify(message: string) {
  if (process.platform === "darwin") execFile("osascript", ["-e", `display notification ${JSON.stringify(message)} with title "Agentic Optimization"`], () => {})
  else if (process.platform === "linux") execFile("notify-send", ["Agentic Optimization", message], () => {})
}

function needsSignIn(why: string, reuseClient: boolean): never {
  console.error(`${why}\nSign in again: node scripts/sign-in.ts${reuseClient ? "  (reuses the saved client; pass a client file only the first time)" : " path/to/client_secret.json  (the Desktop app client file from Google Cloud)"}`)
  process.exit(2)
}
