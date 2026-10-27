/**
 * Runs the checks on a timer with cron (macOS and Linux), so problems turn up without anyone asking.
 *   node scripts/schedule.ts                                       show what's scheduled
 *   node scripts/schedule.ts <site> [<property>] --confirm         daily check at 8:00, full report Mondays at 8:30
 *   node scripts/schedule.ts --remove [<site>] --confirm           stop one site's runs, or all of them
 * Results go to the log folder (~/.config/agentic-optimization/log). A daily run that finds something
 * new shows a desktop notification. The computer has to be awake at those times; a missed run is skipped.
 */
import { execFileSync, spawnSync } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { logDir } from "./store.ts"

const TAG = "# agentic-optimization"
const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith("--")))
const [site, property] = process.argv.slice(2).filter((a) => !a.startsWith("--"))

if (process.platform === "win32") fail("Scheduling uses cron, which Windows doesn't have. Use Task Scheduler to run `node scripts/check.ts daily <site> --save` each morning instead.")

// Only "no crontab for <user>" means there's nothing yet. Any other failure stops here, so the owner's
// existing scheduled tasks are never overwritten with a blank list.
const listed = spawnSync("crontab", ["-l"], { encoding: "utf8" })
if (listed.error) fail(`Couldn't run crontab: ${listed.error.message}`)
if (listed.status !== 0 && !/no crontab/i.test(listed.stderr)) fail(`Couldn't read the current crontab, so nothing was changed: ${listed.stderr.trim()}`)
const current = listed.status === 0 ? listed.stdout : ""
const ours = current.split("\n").filter((l) => l.includes(TAG))

if (!site && !flags.has("--remove")) {
  console.log(ours.length ? ours.join("\n") : "Nothing scheduled.")
  process.exit(0)
}
if (!flags.has("--confirm")) fail("This changes the computer's scheduled tasks (crontab). Get the owner's yes, then add --confirm.")
if (site && !/^(sc-domain:[a-z0-9.-]+|https?:\/\/[a-z0-9.-]+(:\d+)?(\/[A-Za-z0-9._~/-]*)?)$/i.test(site)) fail(`"${site}" isn't a Search Console site. Use one from: node scripts/check.ts sites`)
if (property && !/^(properties\/)?\d+$/.test(property)) fail(`"${property}" isn't a property. Use one from: node scripts/check.ts properties`)

// Remove only our own lines (all of them, or one site's); everything else stays exactly as it was.
const lines = (current ? current.replace(/\n$/, "").split("\n") : []).filter((l) => !(l.includes(TAG) && (!site || l.endsWith(`${TAG} ${site}`))))
if (!flags.has("--remove")) {
  // Single-quote for the shell, then escape % (cron turns a bare % into a newline).
  const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`
  const cron = (s: string) => s.replace(/%/g, "\\%")
  // cron starts with almost no PATH, so name node and the script by full path.
  const check = join(dirname(fileURLToPath(import.meta.url)), "check.ts")
  // The node on PATH (like /opt/homebrew/bin/node) survives Homebrew upgrades; under nvm it's a versioned path.
  const node = (() => { try { return execFileSync("which", ["node"], { encoding: "utf8" }).trim() || process.execPath } catch { return process.execPath } })()
  const env = process.env.AGENTIC_OPTIMIZATION_DIR ? `AGENTIC_OPTIMIZATION_DIR=${q(resolve(process.env.AGENTIC_OPTIMIZATION_DIR))} ` : ""
  // Output goes to cron.log, so a run that can't even start (no access to the folder, node moved) leaves a trace.
  const run = (...args: string[]) => cron(`${env}${q(node)} ${q(check)} ${args.map(q).join(" ")} --save >>${q(join(logDir, "cron.log"))} 2>&1`)
  lines.push(`0 8 * * * ${run("daily", site, ...(property ? [property] : []))} ${TAG} ${site}`)
  lines.push(`30 8 * * 1 ${run("report", site)} ${TAG} ${site}`)
  if (property) lines.push(`35 8 * * 1 ${run("traffic", site, property)} ${TAG} ${site}`)
}
mkdirSync(logDir, { recursive: true })
writeFileSync(join(logDir, "crontab.bak"), current)
execFileSync("crontab", ["-"], { input: lines.join("\n") + "\n" })
console.log(flags.has("--remove")
  ? `Removed ${site ? `${site}'s` : "all"} scheduled runs.`
  : `Scheduled ${site}: a quick check every day at 8:00 and the full report every Monday at 8:30. Results go to ${logDir}.`)

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}
