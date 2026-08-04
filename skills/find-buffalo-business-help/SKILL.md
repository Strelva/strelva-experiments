---
name: find-buffalo-business-help
description: Find reviewed official City of Buffalo, Erie County, and New York State resources for something a Buffalo-area business wants to start, fund, permit, grow, or sell, without making eligibility claims.
---

# Find Buffalo business help

Use this skill when a person describes something they want to start, fund,
permit, grow, or sell through a Buffalo-area business.

## Contract

1. Use only entries in `catalog.ts`.
2. Treat every match as a starting point, never an eligibility decision.
3. Never invent deadlines, award amounts, requirements, URLs, or availability.
4. Prefer the smallest useful set of sources.
5. Explain what the person should check or do next.
6. If the catalog does not support the request, return broad official starting
   points and say that the match is broad.

`agent.ts` owns the model-facing contract. `catalog.ts` is the reviewed source
packet and matching implementation shared by the agent and public fallback.
`config.ts` owns runtime policy. Update its review date whenever a source changes.
