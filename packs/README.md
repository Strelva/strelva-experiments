# Buffalo public research packs

These packs are small, versioned source packets for people doing public-interest
research in Buffalo and Erie County. They are reusable artifacts, not apps: each
one has a source catalog, a plain-language method, and explicit limits.

## Shelf

| Pack | Use it for | Core output |
| --- | --- | --- |
| [Research a Buffalo property](./research-buffalo-property/) | Parcel, ownership, vacancy signals, permits, and property condition research | A dated property evidence record with source links and unresolved questions |
| [Follow a Buffalo public decision](./follow-buffalo-public-decision/) | Following public decisions, meetings, records, and supporting evidence | A claim-to-source ledger that separates official action from inference |
| [Understand a Buffalo notice](./understand-buffalo-notice/) | Organizing a notice, deadline, hearing, or appeal | A fact timeline and next-contact checklist tied to the issuing agency |

## Use a pack

1. Read the pack README and `SKILL.md` before starting.
2. Start with the smallest official source that can answer the question. Keep
   the exact URL, page or dataset title, and the date you looked at it.
3. Record what the source actually says. Mark gaps as unknown rather than
   filling them with an assumption.
4. Recheck the issuing agency before acting on a deadline, status, or procedure.

The packs do not submit forms, monitor sites, calculate legal rights, or give
legal advice. A person can execute every method with a browser, a notes file,
and ordinary downloads. If a source is unavailable, use the agency contact or
records process listed in that pack and record the attempt.

## Update contract

Each pack's `pack.json` records its version and review metadata. `sources.json`
is a curated list, not a promise that a page will stay online. Before relying on
a source, verify its current page and any date printed on the notice or record.
When a URL, publisher, purpose, or limitation changes, update the source entry,
the pack README if needed, and the `reviewedAt` field in both JSON files. Keep
the pack at `0.1.0` for content corrections; increment the version when the
method or contract changes.
