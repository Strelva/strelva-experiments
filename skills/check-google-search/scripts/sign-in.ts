/**
 * Google sign-in with the site owner's own Google Cloud client.
 *   node scripts/sign-in.ts path/to/client_secret.json    first time
 *   node scripts/sign-in.ts                               again later, reusing the saved client
 * Opens Google in the browser (and prints the link), waits up to 5 minutes for the owner to approve,
 * then saves a refresh token to ~/.config/check-google-search/token.json. Access is read-only Search Console.
 */
import { createHash, randomBytes } from "node:crypto"
import { execFile } from "node:child_process"
import { createServer } from "node:http"
import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { loadToken, saveToken, tokenPath } from "./store.ts"

const client = readClient(process.argv[2])
const state = randomBytes(16).toString("hex")
const verifier = randomBytes(32).toString("base64url")
let redirect = ""
let busy = false

const server = createServer(async (req, res) => {
  const u = new URL(req.url ?? "/", "http://127.0.0.1")
  if (u.pathname !== "/" || busy) return void res.writeHead(404).end()
  if (u.searchParams.get("state") !== state) return void res.end("This link is from an old sign-in. Use the newest one.")
  busy = true
  try {
    const denied = u.searchParams.get("error")
    if (denied) {
      res.end("Sign-in cancelled. You can close this tab.")
      fail(denied === "access_denied"
        ? "Sign-in was cancelled, or Google blocked it (access_denied). If Google said access is blocked, the app is still in Testing and this account isn't a test user: publish the app or add the account under Audience in Google Cloud (SKILL.md step 3b.2)."
        : `Google returned an error: ${denied}`)
    }
    const tok = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code: u.searchParams.get("code") ?? "", code_verifier: verifier, ...client, redirect_uri: redirect, grant_type: "authorization_code" }),
      signal: AbortSignal.timeout(30_000),
    }).catch((e: Error) => { throw new Error(`Couldn't reach Google (${e.message}). Check the internet connection and try again.`) })
    const body = (await tok.json().catch(() => ({}))) as { refresh_token?: string; scope?: string; error?: string; error_description?: string }
    if (!body.refresh_token) throw new Error(`Google refused the sign-in: ${body.error_description ?? body.error ?? `HTTP ${tok.status}, no refresh token`}`)
    if (!body.scope?.includes("webmasters")) throw new Error("Search Console access wasn't granted. Run this again and tick the Search Console box on Google's screen.")
    saveToken({ ...client, refresh_token: body.refresh_token })
    res.end("Signed in. You can close this tab.")
    console.log(`Signed in. Saved to ${tokenPath}`)
    process.exit(0)
  } catch (e) {
    res.end("Sign-in failed. Check the terminal.")
    fail((e as Error).message)
  }
})

server.listen(0, "127.0.0.1", () => {
  redirect = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth")
  url.search = new URLSearchParams({
    client_id: client.client_id, redirect_uri: redirect, response_type: "code",
    scope: "https://www.googleapis.com/auth/webmasters.readonly",
    access_type: "offline", prompt: "consent select_account", state,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256",
  }).toString()
  console.log(`Sign in with the Google account that has the site in Search Console. A browser tab should open; if it doesn't, open this link in a browser on this computer:\n\n${url}\n\nWaiting up to 5 minutes...`)
  const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open"
  execFile(opener, [url.href], () => {})
})

setTimeout(() => fail("Timed out after 5 minutes without a sign-in. Run this again when you're ready."), 5 * 60_000).unref()

function readClient(file: string | undefined): { client_id: string; client_secret: string } {
  if (!file) {
    const saved = loadToken()
    if (saved?.client_id && saved.client_secret) return { client_id: saved.client_id, client_secret: saved.client_secret }
    fail("No saved client yet. First time: node scripts/sign-in.ts path/to/client_secret.json (the file downloaded when making the Desktop app client).")
  }
  const path = file.replace(/^~(?=\/|$)/, homedir())
  let json: { installed?: { client_id?: string; client_secret?: string }; web?: unknown }
  try {
    json = JSON.parse(readFileSync(path, "utf8"))
  } catch {
    fail(`Couldn't read ${path} as the client file from Google Cloud. Check the path; put it in single quotes if it has spaces or brackets.`)
  }
  if (json.web) fail("That client is a Web application. Make a new client of type Desktop app and use its file.")
  if (!json.installed?.client_id || !json.installed.client_secret) fail("That file isn't a Google OAuth client file, or it has no secret. Download the JSON for a Desktop app client from Google Cloud > Google Auth Platform > Clients.")
  return { client_id: json.installed.client_id, client_secret: json.installed.client_secret }
}

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}
