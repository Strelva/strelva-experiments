# Agentic Optimization

A free agent skill from Strelva. Ask your AI agent "how is my site doing on Google?" and it works through your site's search and conversions with you:

- **Reads** Google Search Console and, if you use it, Google Analytics 4: every search and page from the last 28 days against the 28 before, your sitemaps, Google's verdict on pages it hasn't added, and your pages as a visitor sees them.
- **Ranks** what to fix, biggest likely gain first, each with the numbers behind it: titles that get shown but not clicked, searches you're almost on page one for, searches with no page, pages competing with each other, pages Google hasn't added, bad redirects, broken pages, pages search sends traffic to that never convert, and pages that convert but Google hides.
- **Fixes** it with your OK: new titles and pages, links, redirects, sitemaps (and resubmitting them), conversion tracking and key events. Every change is shown first and waits for your yes.
- **Measures funnels**: where people drop off between landing and buying or signing up.
- **Keeps watching**: a quick check every morning for drops and breakages, and the full report every Monday.
- **Proves it**: two to four weeks after a fix, it compares before and after.

It runs on your computer with your own Google sign-in, which the agent walks you through once (about 10 minutes, no card).

## Install

You need Node 22.18 or newer (`node -v`) and a site in [Google Search Console](https://search.google.com/search-console). Google Analytics is optional.

Claude Code:

```bash
git clone --depth 1 https://github.com/Strelva/strelva-experiments.git ~/strelva-experiments
mkdir -p ~/.claude/skills && cp -R ~/strelva-experiments/skills/agentic-optimization ~/.claude/skills/
```

Codex: copy the same folder into `~/.codex/skills/`.

Any other agent: point it at [`SKILL.md`](./SKILL.md) in this folder.

Then ask your agent: "Check how my site is doing on Google." On first use it takes you through the Google sign-in.

## What to know

- It only changes things you approve: each site edit, each publish, each sitemap resubmit or key event, and the schedule.
- It needs data. A site added to Search Console in the last few days has none yet.
- It doesn't promise rankings. It shows where the numbers point and checks what happened.
- The setup has you publish your own Google Cloud app so the sign-in keeps working for the scheduled checks. Google doesn't review it, and you're its only user. Left in Testing mode, Google ends the sign-in every 7 days.
- Scheduling uses cron (macOS and Linux). On Windows, ask your agent to run the check instead.

## Remove it

Run `node scripts/schedule.ts --remove --confirm` from this folder, delete `~/.config/agentic-optimization/`, remove the app at [myaccount.google.com/permissions](https://myaccount.google.com/permissions), and if you like delete the client at [console.cloud.google.com/auth/clients](https://console.cloud.google.com/auth/clients).

MIT licensed, like the rest of this repo.
