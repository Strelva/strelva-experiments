/** Where the sign-in lives: ~/.config/agentic-optimization, or $AGENTIC_OPTIMIZATION_DIR. done.json (finished fixes) and log/ (scheduled runs) sit next to it. */
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

export const dir = process.env.AGENTIC_OPTIMIZATION_DIR ?? join(homedir(), ".config", "agentic-optimization")
export const logDir = join(dir, "log")
export const tokenPath = join(dir, "token.json")

export type Saved = { client_id: string; client_secret: string; refresh_token: string }

export function saveToken(t: Saved) {
  mkdirSync(dir, { recursive: true })
  chmodSync(dir, 0o700)
  // Write then rename, so a crash never leaves half a file. chmod covers a file that already existed.
  const tmp = `${tokenPath}.tmp`
  writeFileSync(tmp, JSON.stringify(t), { mode: 0o600 })
  chmodSync(tmp, 0o600)
  renameSync(tmp, tokenPath)
}

/** The saved sign-in, or null if there isn't one. */
export function loadToken(): Saved | null {
  let text: string
  try {
    text = readFileSync(tokenPath, "utf8")
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null
    throw new Error(`Couldn't open ${tokenPath}: ${(e as Error).message}`)
  }
  try {
    return JSON.parse(text) as Saved
  } catch {
    return null
  }
}
