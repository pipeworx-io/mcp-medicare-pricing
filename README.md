# medicare-pricing

What Medicare **pays** — physician fee schedule, lab rates, and per-day unit
limits. The companion to `medicare-coverage`, which answers whether something is
covered but not what it is worth.

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1679+ live data sources.

## Tools

| Tool | Answers |
|---|---|
| `medicare_physician_payment` | "How much does Medicare pay for 99213 in Los Angeles?" — RVUs and dollars, locality-adjusted. |
| `medicare_lab_rate` | "What does a comprehensive metabolic panel reimburse?" — national CLFS rate. |
| `medicare_dmepos_rate` | "How much does Medicare pay for a CPAP machine (E0601) in Texas?" — state-priced, rural vs non-rural. |
| `medicare_code_units_limit` | "How many units of this code will they pay for in one day?" — NCCI MUE. |
| `check_code_pair` | "Can I bill 00142 and 64474 together?" — NCCI PTP edit + modifier indicator for a code pair. |
| `explain_ncci_edit` | "What is bundled into (or bundles into) this code?" — every recorded PTP edit for one code. |
| `medicare_pricing_coverage` | Which vintages are loaded, including the PTP baseline vintage. |

## Auth

None. No key, no account.

## Data sources

All from CMS, all downloadable files with no API:

- **Physician Fee Schedule relative value files** (RVUs + GPCIs) — annual
- **Clinical Laboratory Fee Schedule** — quarterly
- **DMEPOS fee schedule** (durable medical equipment, prosthetics, orthotics, supplies) — quarterly (as necessary): A=Jan, B=Apr, C=Jul, D=Oct
- **NCCI Medically Unlikely Edits** — quarterly
- **NCCI PTP quarterly additions/deletions/revisions files** — quarterly (see below — a narrower source than the other three)

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
```

Loaded as of writing: 19,226 RVU rows, 109 localities, 2,081 lab rates, 3,531
DMEPOS code/modifier rows (2026 release C, 53 states/territories each), 33,354
MUEs, **4,109,749 distinct NCCI PTP pairs** — the FULL CMS baseline (2026q3,
v322r0) with the 2025q1..2026q3 quarterly change files layered on top (fleet
#1293, 2026-09-07; superseded the prior 182,286-pair change-window-only
coverage). All loaders refuse rather than reporting an empty parse as success.

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

Both URLs reach the same gateway and the same 1679+ data sources. The
only difference is which pack's tools are listed **directly**; `ask_pipeworx`
reaches all of them from either one.

## No MCP client? Call it over HTTP

```bash
curl -X POST https://gateway.pipeworx.io/v1/tools/medicare_physician_payment \
  -H 'Content-Type: application/json' \
  -d '{"code":"99213","locality":"CA"}'
```

No account needed for the first calls. Inspect any tool: `GET https://gateway.pipeworx.io/v1/tools/medicare_physician_payment`. Find one: `POST https://gateway.pipeworx.io/v1/tools/search_packs` with `{"query":"..."}`.

## Standalone (no gateway account)

This package also runs as a local stdio MCP server — no Pipeworx account, no
gateway round-trip:

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

Or run it directly to confirm it starts:

```bash
npx -y @pipeworx/mcp-medicare-pricing
```

It speaks MCP over stdin/stdout and answers `initialize`/`tools/list`/`tools/call`
for **only** this pack's tools — none of the shared meta-tools the gateway
connection above adds. Same source, same tools, no ask_pipeworx routing.

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
