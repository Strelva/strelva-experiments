---
name: buffalo-property-sources
description: Build a dated, source-linked property evidence record for a Buffalo or Erie County address without declaring vacancy, ownership, safety, or compliance.
---

# Buffalo property sources method

## Input

- One street address, parcel, or small list of addresses.
- One question, such as "What public records show recent work?" or "What
  vacancy signals should we verify?"
- An observation date and a notes file.

## Procedure

1. Normalize the address exactly as displayed by the first successful lookup.
   Keep alternate spellings in a notes field, not as separate properties.
2. Search **Search for a Property** and record the SBL or parcel ID, owner or
   mailing field as displayed, property class, roll or record year, and the
   source URL. Do not call the displayed owner a titleholder.
3. Search the **City Property Record Card** and compare its parcel or print key,
   class, and assessment fields with the county result. If the keys disagree,
   stop and record an unresolved identifier mismatch.
4. Search City **Permits**, **Code Violations**, and **Rental Registry** by the
   exact address and by the parcel key when available. Save the case or permit
   number, date, status, and dataset last-updated date for every matching row.
5. For a location question, use **Erie County On-Map** to inspect parcel shape
   and relevant layers. Save the layer names and map date. Treat imagery as
   context, not proof of occupancy or condition.
6. If the question includes title, liens, or recorded ownership, use the
   **Erie County Clerk Official Records Public Search** with the parcel ID or
   party name. Record instrument identifiers and refer title questions to a
   title professional.
7. Add environmental or flood context only when it is relevant. Use the NYS
   DEC site search, FEMA Flood Map Service Center, or EPA Envirofacts, and keep
   each program's status and disclaimer with the observation.
8. Write a short result with three sections: **observed**, **not found in the
   checked sources**, and **needs confirmation**. Never turn a blank search
   into "none," "safe," "vacant," or "compliant."

## Vacancy-signal worksheet

Use one row per signal. A signal is not a conclusion.

| Field | What to write |
| --- | --- |
| Address and SBL | Exact matching identifiers |
| Source and URL | Official page or dataset, plus observed date |
| Signal | Example: active code case, stale permit, rental record, parcel class |
| Source wording | Short quote or exact field value |
| Coverage/date | Dataset update date or record date |
| Alternative explanations | At least one plausible explanation |
| Next confirmation | Agency, record, or site visit to check |

## Output contract

Return a dated note containing:

- the question and address;
- identifier matches and mismatches;
- a source-linked table of observations;
- explicit unknowns and alternative explanations;
- a next confirmation step;
- a reminder that this is public-record research, not professional advice.

## Failure handling

- If a page is down, record the URL, time, and error, then use the listed
  agency contact or a current official landing page. Do not silently substitute
  a third-party listing.
- If two sources disagree, preserve both values and compare record dates,
  identifiers, and definitions before drawing a conclusion.
- If the address is outside Buffalo but inside Erie County, keep City fields as
  not applicable and use the county, State, or federal source that covers it.
- If a user asks whether a property is legal, safe, vacant, or theirs, describe
  the records that can be checked and suggest contacting the responsible office
  or a qualified professional. Do not answer the legal or safety question.

