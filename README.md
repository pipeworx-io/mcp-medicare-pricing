# medicare-pricing

What Medicare **pays** — physician fee schedule, lab rates, and per-day unit
limits. The companion to `medicare-coverage`, which answers whether something is
covered but not what it is worth.

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1856+ live data sources. This is an independent, unofficial integration — not affiliated with, endorsed by, or published by the upstream provider.

## Tools

| Tool | Answers |
|---|---|
| `medicare_physician_payment` | "How much does Medicare pay for 99213 in Los Angeles?" — RVUs and dollars, locality-adjusted. |
| `medicare_lab_rate` | "What does a comprehensive metabolic panel reimburse?" — national CLFS rate. |
| `medicare_lab_test_lookup` | "What does Medicare pay for Signatera, and which MolDX LCD applies?" — brand name → PLA code, current CLFS rate, and the MolDX LCDs/articles for the test's category. |
| `medicare_dmepos_rate` | "How much does Medicare pay for a CPAP machine (E0601) in Texas?" — state-priced, rural vs non-rural. |
| `medicare_opps_rate` | "What does Medicare pay a hospital outpatient department for CPT 33289 (CardioMEMS implant)?" — status indicator, APC, relative weight, national payment rate, copay, device/drug pass-through status. |
| `medicare_code_units_limit` | "How many units of this code will they pay for in one day?" — NCCI MUE. |
| `check_code_pair` | "Can I bill 00142 and 64474 together?" — NCCI PTP edit + modifier indicator for a code pair. |
| `explain_ncci_edit` | "What is bundled into (or bundles into) this code?" — every recorded PTP edit for one code. |
| `medicare_fqhc_pps_rate` | "What is the FQHC PPS base rate for 2026?" — CMS's national Federally Qualified Health Center per-visit base rate, by year. |
| `medicare_pricing_coverage` | Which vintages are loaded, including the PTP baseline vintage. |

## Auth

None. No key, no account.

## Data sources

All from CMS, all downloadable files with no API:

- **Physician Fee Schedule relative value files** (RVUs + GPCIs) — annual
- **Clinical Laboratory Fee Schedule** — quarterly
- **DMEPOS fee schedule** (durable medical equipment, prosthetics, orthotics, supplies) — quarterly (as necessary): A=Jan, B=Apr, C=Jul, D=Oct
- **OPPS Addendum B** (Hospital Outpatient Prospective Payment System payment rates by HCPCS code) — quarterly: Q1=Jan, Q2=Apr, Q3=Jul, Q4=Oct
- **NCCI Medically Unlikely Edits** — quarterly
- **NCCI PTP quarterly additions/deletions/revisions files** — quarterly (see below — a narrower source than the other three)
- **FQHC Prospective Payment System base payment rate** — annual (see below — a hand-maintained table, not a downloaded file)

## FQHC PPS base payment rate — a hand-maintained table, and why

`medicare_fqhc_pps_rate` is different from the rest of this pack: it is not
backed by Supabase or a downloaded bulk file, because there is neither. CMS
publishes the FQHC PPS national base rate exactly once a year, as a single new
dollar figure inside a CMS Manual System "Recurring Update Notification"
Change Request PDF — one number, one PDF, once a year. Standing up an ingest
pipeline for that is not proportionate, so the pack carries a small table of
`{year, base_rate_usd, effective_date, market_basket_update_pct,
prior_year_rate_usd, transmittal, change_request, publication}` in
`src/index.ts` (`FQHC_PPS_BASE_RATES`), five rows (CY2022–CY2026), each read
directly off its own primary CMS transmittal.

This is the national BASE rate only — before the per-FQHC Geographic
Adjustment Factor (GAF) CMS applies on top. The GAF-adjusted amount for a
locality is `medicare_fqhc_gaf` (below).

## Geographic adjustment: `medicare_gpci_lookup` and `medicare_fqhc_gaf` (fleet #3398)

`medicare_gpci_lookup` returns the work / practice-expense / malpractice GPCIs
for a locality or a whole state with no procedure code (years 2024-2026 loaded;
2024 and 2025 were backfilled with `scripts/ingest-medicare-pricing.mjs
--gpci-only`). `medicare_fqhc_gaf` returns CMS's own published FQHC GAF per
locality for CY2018-2026 (each year from CMS's own GAF publication for that year; 2018 uses CMS's February 2018 updated table, 2021 and 2020 the updated releases) and the GAF-adjusted per-visit rate (2022-2026; null for 2018-2021, whose national base rate is not carried). The GAF table is
CMS's published number, not derived here, and is a small generated source file
(`src/fqhc-gaf.ts`, 109-112 localities per year; ~50 KB). **Refresh** each January: download
the new year's FQHC GAF file from CMS and run
`node scripts/build-fqhc-gaf-table.mjs 2018=<file> ... 2026=<file> 2027=<file>` (ascending; the script finds columns by header name because CMS's layout changes yearly).

**Refresh**: CMS issues the following year's transmittal in Nov/Dec (the
CY2026 update was dated 2025-12-05 for a Jan 1, 2026 effective date). Add a
row to `FQHC_PPS_BASE_RATES` each year once it posts — search CMS's own
transmittals (Pub 100-04 Medicare Claims Processing, or Pub 100-02 Medicare
Benefit Policy) for "FQHC PPS Calendar Year".

## ADLT list — brand name to billing code

`medicare_lab_test_lookup` exists because callers name a test by its brand
("Signatera"), not its code ("0340U"), and nothing else in the catalog maps one
to the other (fleet #2426).

**Source, and why it is the only one.** CMS's list of Advanced Diagnostic
Laboratory Tests
(<https://www.cms.gov/files/document/advanced-diagnostic-laboratory-tests-under-medicare-clfs.pdf>)
gives code, lab, proprietary test name, approval date and initial-period
payment for 18 tests. It is a US federal work (17 USC 105). The sources that
were checked and rejected:

- **AMA PLA long-descriptor PDF** — "CPT® Copyright 2026 American Medical
  Association. All rights reserved." It also lists only the codes changed in
  the latest cycles (143 of them), and 0340U is not among them.
- **Palmetto MolDX DEX registry** — needs a registered account, even for the
  "public user" catalog, and hides Z-codes from public users. That's an auth
  wall.
- **CMS Coverage API article code tables** — need a caller's CMS/AMA licence
  token (already how `medicare-coverage` handles it).
- **NCBI GTR** — knows Signatera and Guardant360 but its `cptcode` field is
  empty for them.

That made coverage ADLT-only, and fleet #2458 measured the cost: Oncotype DX
(81519, a Category I MAAA code, not an ADLT) routed here 5/5 and came back
`found: false`. Resolution now runs through three sources in order:

1. **CMS ADLT list** (`src/adlt.ts`, below).
2. **MAAA brand table** (`src/brand-codes.ts`) -- non-ADLT branded tests whose
   proprietary name is tied to a code in CPT Appendix O and which each have a
   brand-named or category MolDX billing article on the CMS MCD (Oncotype DX
   breast/DCIS/colon/prostate, Prosigna, MammaPrint, EndoPredict, Breast
   Cancer Index, Cologuard, Prolaris, Decipher, Afirma, ConfirmMDx, 4Kscore).
   Only brand -> code -> lab FACTS are kept, never AMA descriptor text. Every
   code was checked to carry a CLFS rate on 2026-09-26. To add a row: confirm
   the pair in a public source, confirm `medicare_lab_rate` has a rate, and set
   `coverage_topic` to a phrase from a live MolDX article title.
3. **NCBI GTR, live** -- where the performing lab registered a CPT code
   (e.g. Afirma -> 81546, Decipher -> 81542). Labelled lab-reported. Sparse:
   Oncotype DX and Signatera carry no code there, which is why it is last.

A test found in none returns `found: false, reason: brand_not_found` with
`sources_checked` naming all three, and a pointer to `medicare_lab_rate`.

**Copy, not proxy.** The list is a two-page PDF with no API, and the gateway
has no PDF parser, so the rows are baked into `src/adlt.ts`. The PDF's "Test
Descriptor" column is AMA PLA text and is **not** copied. Every call sends a
HEAD to the PDF and compares `Last-Modified` with the snapshot's. If CMS has
republished, the response carries `snapshot_current: false`. To refresh:
download the PDF, extract its text (`pypdf` works), update the rows in
`src/adlt.ts`, and bump `ADLT_DATA_AS_OF` and `SNAPSHOT_LAST_MODIFIED`.

**Coverage.** Each test has a `coverage_topic`, a phrase that is ours and not
CMS's. It matches the title of the MolDX LCD/article family for the test's
category (for Signatera, "Minimal Residual Disease"). The tool reads the live,
keyless CMS Coverage API reports and returns the active LCDs and billing
articles with that title. Retired ones come back only with
`include_retired: true`. This matters because contractors re-issue MolDX
policies under new numbers: Noridian's L38816 and A58456 were retired
2026-02-05 and replaced by L38814 and A58454. Whether a specific test is listed
is answered by the billing article's code table, not by the title match.

## Vintage is not a detail

Fee schedules change annually and NCCI/CLFS quarterly. Quoting a 2026 procedure
at 2024 rates is a wrong number with billing consequences, so **every response
states the year** (and quarter where quarterly) it used, and sets
`year_was_defaulted` when the caller did not name one. Asking for a year that is
not loaded returns `year_not_loaded` rather than silently answering with a
different year's rates.

## Locality is not state

Medicare pays by geographic **locality**. California alone has nine. The same
office visit (99213, 2026) pays:

| Locality | Non-facility |
|---|---|
| Bakersfield, CA | $99.52 |
| Alabama | $87.79 |

A 13% swing a state-shaped answer would hide. `medicare_physician_payment`
resolves the locality explicitly, states what it resolved to, and lists other
localities that matched so a caller can pick a different one.

Payment is computed with the real formula and the arithmetic is returned so it
can be audited:

```
((work RVU × PW GPCI) + (PE RVU × PE GPCI) + (MP RVU × MP GPCI)) × conversion factor
```

Facility and non-facility are both given — a procedure pays less in a hospital
because the facility bills its own fee separately.

## Whether two codes can be billed together — the full PTP baseline

**`check_code_pair` and `explain_ncci_edit` now cover the FULL NCCI
procedure-to-procedure (PTP) edit baseline, not a rolling change window
(fleet #1293, 2026-09-07).** CMS distributes the complete PTP edit table
behind an AMA CPT licence click-through (`/license/ama?file=...` on
cms.gov). Bruce authorized accepting that licence on the company's behalf via
the Needs Bruce dashboard (2026-09-07); the licence text was read in full
before any data shipped — see "NCCI PTP licence" below for the quoted terms
and the reasoning for why this pack's serving shape stays inside them.

**Loaded:** the 2026 Quarter 3 baseline (v322r0, effective 2026-07-01 — the
newest vintage actually in effect; CMS had already posted Q4 2026 at ingest
time, but that isn't effective until 2026-10-01 and using it would have
answered today's queries with tomorrow's rules). The 8 baseline files
(practitioner + hospital × 4 code-range splits each) hold 4,498,118 raw
historical-episode rows — the same `(column1, column2)` pair can have several
add/delete/re-add episodes over the years — collapsed to **4,109,749 distinct
pairs** by keeping each pair's open-ended (currently active) episode, or else
its most recently closed one. The prior **2025q1..2026q3 quarterly change
files are re-applied ON TOP of the baseline**, in that order, so a pair the
quarterly files recorded as deleted cannot be resurrected by an older baseline
row.

**A NOT-FOUND answer now means CMS has never recorded a PTP edit for that
pair** — not merely "no recorded change in this window", which was the
scope limit before this fleet task. `medicare_code_units_limit` remains the
separate **units** edit (one code, not a pair) and was never affected by this
limit.

### NCCI PTP licence

The CMS licence click-through (same boilerplate CMS uses across its whole AMA
CPT-derived file family — the physician fee schedule, MUE, and PTP downloads
all carry it) reads, in relevant part:

> CPT codes, descriptions and other data only are copyright 1995-2025 American
> Medical Association. All rights reserved... You, your employees and agents
> are authorized to use CPT only as contained in the following authorized
> materials of Centers for Medicare and Medicaid Services (CMS) internally
> within your organization within the United States for the sole use by
> yourself, employees and agents. Use is limited to use in Medicare, Medicaid
> or other programs administered by CMS... Any use not authorized herein is
> prohibited, including... making copies of CPT for resale and/or license,
> transferring copies of CPT to any party not bound by this agreement,
> creating any modified or derivative work of CPT, or making any commercial
> use of CPT.

Read maximally literally, "internal use" and "CMS-administered programs only"
would forbid nearly all third-party commercial reuse of ANY Medicare
fee-schedule data — an interpretation the entire health-IT industry operates
against daily (claims clearinghouses, EHR vendors, and billing software all
reference CPT codes commercially). This pack's existing, already-shipped
design applies the standard industry reading of the opening sentence — "CPT
codes, **descriptions** and other data" are the copyrighted, licensed
material; the CMS-computed derivative numbers indexed by those codes (RVUs,
payment amounts, edit modifier indicators) are federal work product and are
returned, while the AMA's own descriptive text is never stored or served. The
PTP baseline's own "PTP Edit Rationale" column (a ~12-value CMS-authored
categorical reason set, e.g. "Standards of medical/surgical practice") is not
stored either, purely to keep this load a strict superset of the existing
table shape (no schema change) — not because it reads as AMA content. This is
the same theory already governing this pack's RVU/CLFS/MUE data; the PTP
click-through does not introduce a new prohibition beyond what the rest of the
pack already operates under, but the literal breadth of "internal use" /
"CMS-administered programs" language is flagged here for anyone reviewing
licence exposure across the pack.

## No procedure descriptions — except DMEPOS

Every PFS/CLFS source file opens with *"CPT codes, descriptions and other data
only are copyright <year> American Medical Association"*. The RVU file scopes
it precisely — *codes and descriptions only* — so the CMS-computed numbers are
federal data and are returned, while the AMA's descriptive text is neither
stored nor served. Callers pass a code they already hold.

**DMEPOS is the exception, on purpose.** It uses HCPCS **Level II** codes
(E/K/L/A-codes), which CMS itself maintains — unlike CPT (HCPCS Level I),
which is AMA copyright. The DMEPOS source file's own DMEREAD/DMEBACK
documentation carries no AMA/copyright notice anywhere (checked), so
`medicare_dmepos_rate` DOES return the code description.

## OPPS — what a hospital outpatient department is paid

`medicare_opps_rate` answers the same "what does Medicare pay" question for a
**hospital outpatient department** claim, as opposed to a physician office
(`medicare_physician_payment`) or a lab (`medicare_lab_rate`). Source: CMS,
OPPS Addendum B, the quarterly national payment-rate file by HCPCS code.
Measured size: 19,278 rows for the CY2026 October release — small, loaded
whole, same shape as `clfs_rates`/`dmepos_rates` already in this pack.

**Device and drug/biological pass-through is the status indicator, not a
separate column.** CMS's own "Drug and Device Pass-Through Expiration during
Calendar Year" column in Addendum B is, in practice, not a usable date field —
checked against the CY2026 October release, every non-blank value in that
column was a stray change-marker rather than a date. The reliable signal is
the status indicator itself: **SI='H'** is a pass-through device category
(paid separately, outside the standard APC amount, for as long as the device
holds that status — typically 2-3 years from market entry, after which CMS
reprices it, often to packaged SI='N'), and **SI='G'** is a pass-through
drug/biological. `device_pass_through`/`drug_or_biological_pass_through` on
every response are derived from SI, not from the expiration column.

A **packaged** code (SI='N', among several other status indicators) returns a
valid `status_indicator` and `status_indicator_meaning` but `apc: null` and no
payment rate — that is a correct, normal answer: OPPS pays for that code only
as part of whatever procedure it is billed alongside, never on its own.
CardioMEMS (C2624, the implantable pulmonary-artery pressure sensor) is a
worked example of exactly this: it has been on the market long enough that it
is no longer pass-through (SI='N', packaged into the implant procedure
33289's payment), which is the expected, current state — not a missing-data
gap.

## No OPPS short descriptors — a mixed-code-type file

Addendum B's own header states *"CPT codes and descriptions only are
copyright ... American Medical Association"*, and the file mixes AMA-
copyright CPT (HCPCS Level I, numeric codes like 33289) with CMS-owned HCPCS
Level II codes (like C2624) under **one shared** descriptor column, with no
per-row schema signal to tell which is which. Unlike `medicare_dmepos_rate`
(Level II only, so the description is safely CMS-owned), `medicare_opps_rate`
follows the stricter `pfs_rvu` convention instead: no descriptor is stored at
all, for any code in this table. A caller passes a code they already hold.

## DMEPOS pays by state, not locality

Medicare pays DMEPOS by **state** (not by the physician-fee-schedule
locality), with a separate **rural** and **non-rural** amount per state. CMS's
own source file is one row per (HCPCS, modifier) with 53 state/territory
columns × 2 (non-rural/rural) = 106 rate columns; this pack keeps that row
grain and folds the 106 columns into one JSONB map rather than exploding to
~374,000 rows per release. `medicare_dmepos_rate` always returns both figures,
labelled, and says explicitly when a state carries no separately-adjusted
rural amount (a real "no adjustment" fact from the source file, not a missing
value) rather than presenting a bare `null`.

## Refreshing

```bash
node scripts/ingest-medicare-pricing.mjs                    # current vintages: RVU, GPCI, CLFS, MUE
node scripts/ingest-medicare-pricing.mjs --year 2025 --rvu rvu25d --clfs 25clabq4

node scripts/ingest-ncci-ptp.mjs                             # PTP quarterly change overlay (default: 2025q1..2026q3)
node scripts/ingest-ncci-ptp.mjs --quarters 2026q4            # add just the newest quarter on a refresh

node scripts/ingest-ncci-ptp-baseline.mjs --dir /path/to/8-zips  # full PTP baseline re-load (rare — new CMS vintage only)
                                                                  # ALWAYS re-run ingest-ncci-ptp.mjs immediately after —
                                                                  # the quarterly overlay must land on top of the baseline,
                                                                  # not the other way around (see script header comment).
                                                                  # Requires manually downloading the 8 baseline zips
                                                                  # through the CMS AMA-licence click-through first — no
                                                                  # automated fetch can complete that flow (503s to curl
                                                                  # and to a bare browser GET of the file URL; only a real
                                                                  # interactive click on the license page's Accept button
                                                                  # works).

node scripts/ingest-dmepos.mjs                                # newest DMEPOS release (default: 2026 release C)
node scripts/ingest-dmepos.mjs --year 2026 --release D         # add a new release when CMS posts one

node scripts/ingest-opps.mjs                                   # newest OPPS Addendum B release (default: 2026 October)
node scripts/ingest-opps.mjs --year 2026 --month january       # add a new quarterly release when CMS posts one
```

Loaded as of writing: 19,226 RVU rows, 109 localities, 2,081 lab rates, 3,531
DMEPOS code/modifier rows (2026 release C, 53 states/territories each), 19,278
OPPS Addendum B rows (CY2026 October / Q4), 33,354
MUEs, **4,109,749 distinct NCCI PTP pairs** — the FULL CMS baseline (2026q3,
v322r0) with the 2025q1..2026q3 quarterly change files layered on top (fleet
#1293, 2026-09-07; superseded the prior 182,286-pair change-window-only
coverage). All loaders refuse rather than reporting an empty parse as success.

`ingest-opps.mjs` resolves the current download from the OPPS Addendum B
release landing page, same pattern as `ingest-dmepos.mjs`. The landing page's
own link routes through CMS's `/apps/ama/license.asp?file=...` AMA licence
click-through page — but, unlike the NCCI PTP baseline elsewhere in this pack,
the underlying file is NOT actually gated: fetching the plain
`https://www.cms.gov/files/zip/<name>.zip` URL directly (bypassing
license.asp entirely) returns the zip with no click-through, no cookie, and no
Referer needed — verified live, 2026-10-21. The script extracts that direct
URL from the landing page and fetches it, rather than going through
license.asp at all.

`ingest-dmepos.mjs` resolves the current download from the DMEPOS release
subpage rather than guessing the zip filename — CMS's DMEPOS naming is not
stable (a release page 404s before it is posted, and old release URLs have
301-redirected to renamed paths), so it reads
`.../dmepos-fee-schedule/dme<yy>[-<letter>]` for the current `.zip` href on
every run, the same pattern `ingest-medicare-pricing.mjs` already uses for the
PFS RVU page.

`ingest-ncci-ptp.mjs` is additive/idempotent by design — re-running the full
default window is safe (upserts on `service_type,column1,column2`), and adding
a new quarter to `--quarters` widens the window forward without needing to
re-fetch history.

## Quick Start

Add to your MCP client (Claude Desktop, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "medicare-pricing": {
      "url": "https://gateway.pipeworx.io/medicare-pricing/mcp"
    }
  }
}
```

### What this endpoint actually serves

`tools/list` at `https://gateway.pipeworx.io/medicare-pricing/mcp` returns the tools in the table
above **plus the shared Pipeworx meta-tools** — `ask_pipeworx`,
`discover_tools`, `search_within`, `remember`/`recall` and the rest of the
gateway-wide set. So the tool count you see is larger than this table: a
single-pack endpoint currently lists roughly 30 shared tools alongside the
pack's own. The connection's `initialize` response states its exact scope, and
is the authoritative answer for a given day.

This is deliberate, not multiplexing by accident. The meta-tools are what let a
scoped connection answer a question this pack does not cover — via
`ask_pipeworx`, which routes across the whole catalog — without you adding a
second MCP server. There is currently no way to mount a pack endpoint without
them; if the extra schemas cost you more context than the routing is worth,
connect to the full gateway once rather than to several pack endpoints.

Or connect to the full Pipeworx gateway to get every pack's tools listed
directly, instead of just this one's:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

Both URLs reach the same gateway and the same 1856+ data sources. The
only difference is which pack's tools are listed **directly**; `ask_pipeworx`
reaches all of them from either one.

## No MCP client? Call it over HTTP

```bash
curl -X POST https://gateway.pipeworx.io/v1/tools/medicare_physician_payment \
  -H 'Content-Type: application/json' \
  -d '{"code":"99213","locality":"CA"}'
```

No account needed for the first calls. Inspect any tool: `GET https://gateway.pipeworx.io/v1/tools/medicare_physician_payment`. Find one: `POST https://gateway.pipeworx.io/v1/tools/search_packs` with `{"query":"..."}`.

## Run it from npm

`@pipeworx/mcp-medicare-pricing` is a local stdio bridge to the Pipeworx gateway: your MCP client
starts it with `npx`, and it forwards every call to the same
`https://gateway.pipeworx.io/medicare-pricing/mcp` endpoint shown above. It needs network access;
there is no offline mode.

```json
{
  "mcpServers": {
    "medicare-pricing": {
      "command": "npx",
      "args": ["-y", "@pipeworx/mcp-medicare-pricing"]
    }
  }
}
```

Without a key it calls anonymously, capped at 50 calls a day. A free account
raises that to 200 a day: get a key at https://pipeworx.io/signup and add
`"env": { "PIPEWORX_API_KEY": "<your key>" }` to the server entry.
The key is sent as a Bearer token, the same way a hosted connection sends it,
so calls are metered and billed exactly as they are there.

It lists **only** this pack's tools by default. Set `PIPEWORX_META_TOOLS=1` to
also list `ask_pipeworx` and the other gateway-wide tools.

Behind an HTTPS proxy: Node's built-in `fetch` does not read `HTTPS_PROXY` by
default. Newer Node releases honour it when `NODE_USE_ENV_PROXY=1` is set; check
your Node version's documentation.

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English —
this works on the pack endpoint above as well as on the full gateway:

```
ask_pipeworx({ question: "your question about Medicare Pricing data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
