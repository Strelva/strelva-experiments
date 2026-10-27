# Strelva Experiments

Public experiments and reusable research packs from Strelva Labs.

## Find Buffalo Business Help

A small Strelva Labs chat experiment that connects an ordinary business description to useful Buffalo, Erie County, and New York State resources.

GPT-5.6 Luna runs through the Codex SDK on the server, using the host's cached
ChatGPT subscription session. It does not determine eligibility or submit
applications. Every result points back to its official source.

## Run it

```bash
npm install
npm run dev
```

Install Codex, run `codex login`, and choose ChatGPT authentication. Confirm the
host with `codex login status`. No API key is required. The model is fixed to
`gpt-5.6-luna`.

For UI development without an API call, explicitly set
`NAVIGATOR_MODE=fixture`. Production should not set fixture mode.

This backend needs a trusted Node host with the Codex runtime and a private
credential store. Do not expose the Codex app server or its credentials to the
browser, and do not deploy this endpoint as an untrusted public execution host.

## Verify it

```bash
npm test
npm run build
```

## Packs

The [`packs`](./packs/) shelf contains small, versioned source catalogs and
human-executable methods for Buffalo property research, public evidence, and
notice-to-resolution casework. Packs do not require the app or an API key.

## Check Google Search

[`skills/check-google-search`](./skills/check-google-search/) is an agent skill
for any website owner. It reads the site's last 28 days of Google Search Console
data, read-only, and returns a ranked list of fixes with the numbers behind each,
then checks about two weeks later whether a fix worked. It runs on the owner's computer
with their own Google sign-in. See its [README](./skills/check-google-search/README.md).

## Add or update a source

Edit `src/catalog.ts`. Keep the catalog small, use only authoritative sources, and update the visible review date after checking every changed source. Never add a deadline or eligibility claim without an official source.

## License

MIT
