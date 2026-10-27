# Check Google Search

A free agent skill from Strelva. Ask your AI agent "how is my site doing on Google?" and it reads your site's Google Search Console data and tells you what to fix first. Each fix comes with the numbers behind it: a page Google shows often but nobody clicks, a search you're just off page one for, pages Google hasn't added yet, old addresses that redirect badly. About two weeks after you make a fix, it checks whether clicks went up.

It's read-only and runs on your computer. You sign in to Google with your own small Google Cloud app, which the agent walks you through once (about 10 minutes). Nothing is sent to Strelva.

## Install

You need Node 22.18 or newer (`node -v`) and a site in [Google Search Console](https://search.google.com/search-console).

Claude Code:

```bash
git clone --depth 1 https://github.com/Strelva/strelva-experiments.git ~/strelva-experiments
mkdir -p ~/.claude/skills && cp -R ~/strelva-experiments/skills/check-google-search ~/.claude/skills/
```

Codex: copy the same folder into `~/.codex/skills/`.

Any other agent: point it at [`SKILL.md`](./SKILL.md) in this folder.

Then ask your agent: "Check how my site is doing on Google." On first use it takes you through the Google sign-in.

## What it can't do

- Change anything in Search Console, Google or your site. If you ask, the agent can help edit your site, and it shows you each change first.
- Work without Search Console data. A site added in the last few days has none yet.
- Promise rankings. It shows where the numbers point.

The setup has you publish your Google Cloud app so the sign-in keeps working. Google doesn't review it, and you're its only user. If you'd rather leave it in Testing mode, that works too, but Google ends the sign-in every 7 days.

## Remove it

Delete `~/.config/check-google-search/`, remove the app at [myaccount.google.com/permissions](https://myaccount.google.com/permissions), and if you like delete the client at [console.cloud.google.com/auth/clients](https://console.cloud.google.com/auth/clients).

MIT licensed, like the rest of this repo.
