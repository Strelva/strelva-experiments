---
name: follow-buffalo-public-decision
description: Follow a Buffalo or Erie County public decision from its official notice or agenda through minutes, recordings, records, and supporting data.
---

# Follow a Buffalo public decision

## Input

- A single claim, decision, project, or public body.
- A date range and place, if known.
- A notes file with a claim-to-source ledger.

## Procedure

1. Write the claim as a testable sentence. Example: "The County Legislature
   adopted item X on date Y." Split compound claims into separate rows.
2. Identify the responsible body. Search the City **Agenda Center** or the
   Erie County Legislature **Session Agendas & Minutes** page before using
   secondary coverage. Save the body's name, meeting date, item number, and
   agenda or notice URL.
3. Open the packet and capture the exact action language, sponsor, attachments,
   and any status label such as draft, introduced, referred, tabled, or adopted.
   Do not call an agenda item a decision.
4. Find the corresponding minutes and, when available, the official recording.
   Record the vote or disposition as written. Mark any gap between the agenda,
   minutes, and recording as unresolved.
5. Search **Open Data Buffalo** or **Open NY** only for supporting facts such as
   permits, violations, spending, service volume, or program outcomes. Save the
   dataset ID, field definition, row identifier, and last-updated date. Do not
   use a chart without checking the underlying dataset.
6. Search Erie County Clerk records when a recorded instrument is relevant.
   Use the parcel ID or party name because the Clerk says its official-records
   index is not searchable by address.
7. If a needed record is not posted, write a narrow request to the responsible
   City or County records officer. Use the FOIL pages in `sources.json`, include
   date range, body, record type, and preferred format, and log the request
   number and every response. Do not state that the record is absent until the
   agency says so or the search has a documented limit.
8. For a State or federal action, use New York's **Open Government**, **Open
   NY**, **Federal Register**, or **FOIA.gov** source that matches the action.
   Keep local and federal records in separate rows even when they describe the
   same project.

## Claim-to-source ledger

| Claim ID | Claim text | Source and URL | Exact support | Record date/status | Confidence note |
| --- | --- | --- | --- | --- | --- |
| C1 | One short, testable sentence | Official page or dataset | Quote or field value | Date and draft/final status | Direct, attributed, or unresolved |

Use **direct** when the source itself states the fact, **attributed** when a
person or document says it, and **unresolved** when sources conflict or leave a
gap. Keep interpretation in a separate paragraph labeled **inference**.

## Output contract

Return:

- a one-sentence scope and date range;
- a timeline of notice, agenda, meeting, vote, and follow-up;
- the claim-to-source ledger;
- source status and coverage caveats;
- unresolved questions and a records request, if needed;
- a note that the packet is public-record research, not proof of wrongdoing or
  legal advice.

## Failure handling

- If an agenda or dataset URL changes, use the agency's current landing page and
  record the redirect or replacement URL.
- If minutes are missing, say **minutes not located in the checked archive**;
  do not say no minutes exist.
- If a recording and minutes differ, quote both and contact the clerk rather than
  choosing one silently.
- If a source includes personal data, minimize or redact it in your output.
- If the question asks "was this illegal?" or "who is at fault?", report the
  public record and refer the legal question to a qualified professional.
