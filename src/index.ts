interface McpToolDefinition {
  name: string;
  description: string;
  /** Human-facing one-liner (fleet #1967). Optional; consumers fall back to
   *  description. Kept in step with shared/src/types.ts — scripts/lib/
   *  check-inlined-types.mjs reports drift at publish time. */
  summary?: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    anyOf?: Array<{ required: string[] }>;
    oneOf?: Array<{ required: string[] }>;
    allOf?: Array<{ required: string[] }>;
  };
  outputSchema?: Record<string, unknown>;
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * Was this failure OUR OWN web service? — the other half of `internal-db-class.ts`.
 *
 * fleet #1089 pulled failures from our own Postgres out of `upstream_down` by
 * keying on the SQLSTATE inside PostgREST's four-key error envelope. That
 * covered the majority and structurally could not cover the rest: the rest
 * never reach Postgres, so they carry no SQLSTATE. What was left, measured over
 * the 24h to 2026-09-02T15:00Z (fleet #1096):
 *
 *     5  pipeworx-catalog  get_pack_tools     Pipeworx catalog error: 522 — error code: 522
 *     3  fleet             fleet_list_open …  upstream_down: Fleet task queue did not respond within 25s
 *
 * 521/522/523/526 are Cloudflare saying its edge could not reach an ORIGIN, and
 * in both of those rows the origin is ours — `gateway.pipeworx.io` for the
 * catalog pack (it self-fetches when the gateway hasn't injected a manifest),
 * our own Supabase for fleet. There is no third party anywhere in either call.
 * Same defect as #1089: our own outage filed under `upstream_down`, the one
 * class that means "the source is unreachable and there is nothing for us to
 * fix", which is why the problem-tools triage skips it.
 *
 * WHY NOT A WORDING RULE. The obvious fix is to match `fleet db error:` and
 * `Pipeworx catalog error:` in classifyToolError. Each is emitted from exactly
 * one site today, so it would work today. It would also rot the first time
 * somebody rewords a label — silently, and in the direction of hiding our own
 * outage, which is worse than the bug being fixed. Every prose rule in
 * error-class.ts has needed widening as packs invented new wording (#409/#450/
 * #584); that history is most of that file's comment budget.
 *
 * WHAT THIS KEYS ON INSTEAD: **the host the call actually reached.** A URL's
 * hostname is a fact about the call, not a guess about its prose. Two
 * consequences that a pack-level flag could not give us, and the reason the
 * flag was rejected:
 *
 *   - It describes the CALL, not the pack. `govcon-intel` fans out to our own
 *     Supabase AND to genuine third parties; `court-listener` holds our cache
 *     in Supabase and fetches courtlistener.com. An `internallyHosted: true` on
 *     either pack would relabel a real third-party outage as ours — inventing
 *     work, which is the same class of error in the opposite direction.
 *   - It covers every future internal pack for free, instead of one declared
 *     slug at a time.
 *
 * WHY IT SURVIVES A REWORD. The marker below is not matched as a literal by two
 * separate files. `markInternalOrigin()` writes it and `internalHostMetricsClass()`
 * reads it, both from the single exported `INTERNAL_ORIGIN_MARKER` constant in
 * this module — so changing the wording changes both sides in the same edit and
 * cannot desynchronise them. The pack's own label (`fleet db error:`,
 * `Pipeworx catalog error:`) is not read at all: reword it freely, the class is
 * unaffected. That is the property `stripClassPrefix` lacked when it drifted
 * from its own classifier three times and needed a CI gate to hold them
 * together.
 *
 * WHERE THE 5xx TEST LIVES. `markInternalOrigin` is called from the places that
 * hold the real `Response` — `httpError`/`httpErrorMessage` and the timeout
 * branch of `fetchWithTimeout` in `shared/src/http.ts` — so "is this an
 * availability failure" is decided from the actual status code, never re-derived
 * by scraping a number out of a sentence. A 404 from our own registry for a slug
 * that does not exist is a caller's bad argument and is deliberately NOT marked.
 */

/**
 * OUR OWN web service was unreachable — not an upstream, and never `upstream_down`.
 *
 * ONE value, not three, unlike `internal_db_*`. That split existed because a
 * slow query, an exhausted pool and an unknown SQLSTATE have different owners
 * and different fixes. Here there is only one story to tell — an origin we run
 * did not answer the edge — and one owner. A bucket with no distinct owner per
 * value is decoration; #724 is what happens when a class holds several
 * situations, and inventing sub-values ahead of a reason to act on them
 * differently is the same mistake with the sign flipped.
 *
 * METRICS ONLY, exactly like PLATFORM_KEY_ERROR_CLASS and the internal_db
 * values. `classifyToolError` still answers `upstream_down` for the retry and
 * hint paths, which only care whether retrying or a sibling tool might work —
 * and it might. Nothing a caller sees or is charged changes here.
 *
 * READ SIDE: this value is in BROKEN_TOOL_CLASSES, FAULT_CLASSES and
 * ALL_ERROR_CLASSES in `workers/registry-api/src/index.ts`. All three, or it
 * lands on no dashboard — fleet #721 is the warning, where the #719 split
 * worked on the write side and was invisible for weeks.
 */
const INTERNAL_SERVICE_UNREACHABLE_CLASS = 'internal_service_unreachable';

/**
 * The token that carries "this origin is ours" from the call site to the
 * classifier.
 *
 * Appended to the error message rather than attached to the Error object,
 * because the object does not survive the trip: 275 packs return `{ error:
 * string }` instead of throwing, the gateway reads `observedError` as a string,
 * and the fleet pack rebuilds its error from a captured status + body across a
 * retry loop. A property on an Error would be dropped by every one of those
 * paths and the class would work in tests and vanish in production.
 *
 * WORDING IS LOAD-BEARING, same rule as labelAge's note in authority.ts. This
 * string is appended to a pack's thrown Error message (shared/src/http.ts),
 * and a thrown Error's message is exactly what the gateway hands back to the
 * caller as `content[0].text` when nothing rewrites it (workers/gateway/src
 * catches the throw and sets `rawResult.message = stripClassPrefix(error)`,
 * which does not touch this suffix) — so the original wording,
 * " [pipeworx-hosted origin — our own service, not a third party]", was not a
 * theoretical leak: it shipped live on pipeworx-catalog's 522s, 7 times in 6
 * hours on 2026-09-02 (see tests/golden-internal-service.test.ts), verbatim
 * naming Pipeworx as the host. check:hosting-claims never caught it because it
 * did not scan shared/ at all (task #2009). Reworded to describe the
 * OBSERVATION (the origin did not answer) without a claim about who runs it —
 * the identical fix labelAge got: drop the possessive, keep the fact.
 */
const INTERNAL_ORIGIN_MARKER = ' [origin did not respond — retry before concluding the named source is down]';

/**
 * Supabase's data plane for a project is `<ref>.supabase.co`, where the ref is
 * exactly twenty lowercase letters (ours is `pqauisounztsgdgfkhke`).
 *
 * Matching the shape rather than listing the ref keeps this correct when we add
 * a project — `supabaseEnv` on a pack entry already points some packs at a
 * second one — while still excluding `status.supabase.co`, which is Supabase's
 * own status page and emphatically not our database. Verified 2026-09-02 by
 * `grep -rhoE '[a-z0-9-]+\.supabase\.(co|in)' mcps shared workers scripts`: the
 * only real project ref anywhere in the tree is ours, the rest are doc
 * placeholders (`abc`, `xyz`, `example`) which this pattern also excludes. Same
 * finding internal-db-class.ts relies on for the PostgREST envelope being ours
 * by construction.
 */
const SUPABASE_PROJECT_HOST = /^[a-z]{20}\.supabase\.(co|in)$/;

/**
 * Is this a host WE run?
 *
 * Deliberately NOT including `*.workers.dev`: plenty of third-party APIs are
 * hosted on workers.dev, so the suffix says where something runs and not who
 * owns it. Every internal call we actually make goes to a `pipeworx.io`
 * hostname or to our Supabase project, both of which are ownership facts.
 *
 * `workers/gateway/src/provenance.ts`'s `OUR_HOSTS` answers the same
 * question and DOES include `workers.dev` — a documented divergence
 * (task #2051), not a bug to converge. That list decides what a response may
 * cite as a data SOURCE, where a false negative (citing our own worker as an
 * external source) is the hosting-disclosure leak this whole file exists to
 * prevent, so it errs broad. This one decides who gets BLAMED for a 5xx in
 * outage metrics read by on-call, where a false positive (crediting our own
 * infra with a third party's outage) hides the real failure, so it errs
 * narrow. Same suffix, opposite direction, because they are never called for
 * the same reason.
 *
 * Returns false on anything unparseable rather than throwing — this runs inside
 * an error path, and an error path that can itself throw turns a diagnosable
 * failure into a mystery.
 */
function isPipeworxOrigin(url: string | URL | undefined | null): boolean {
  if (!url) return false;
  let host: string;
  try {
    host = new URL(url instanceof URL ? url.href : url).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host === 'pipeworx.io' || host.endsWith('.pipeworx.io')) return true;
  return SUPABASE_PROJECT_HOST.test(host);
}

/**
 * Append the marker when this failure was OUR origin failing to answer.
 *
 * `status` is the HTTP status when there is one, and omitted for a timeout —
 * where there is no response at all, and "the origin did not answer" is the
 * whole observation. Statuses below 500 are left alone: a 404 from our own
 * registry for a slug that does not exist is the caller's argument, not our
 * outage, and marking it would put ordinary 404s on the incident dashboard.
 *
 * Idempotent, so a message that is wrapped and re-marked on the way up (the
 * fleet pack's retry loop re-throws through two layers) carries the marker once.
 */
function markInternalOrigin(
  message: string,
  url: string | URL | undefined | null,
  status?: number,
): string {
  if (status !== undefined && status < 500) return message;
  if (!isPipeworxOrigin(url)) return message;
  if (message.includes(INTERNAL_ORIGIN_MARKER)) return message;
  return message + INTERNAL_ORIGIN_MARKER;
}

/**
 * Which blob4 value a failure from our own web services books as, or undefined
 * if this is not one.
 *
 * Ordered AFTER `internalDbMetricsClass` at the call site: a PostgREST envelope
 * from our own Supabase is a strictly more specific statement about the same
 * row (which of our services, and why), and the two cannot disagree about
 * whether the failure is ours.
 */
function internalHostMetricsClass(error: string): string | undefined {
  return error.includes(INTERNAL_ORIGIN_MARKER) ? INTERNAL_SERVICE_UNREACHABLE_CLASS : undefined;
}


/**
 * One place to turn a failed `fetch` into an error a caller can act on.
 *
 * Nearly every pack was written the same way:
 *
 *     if (!res.ok) throw new Error(`Unsplash: ${res.status}`);
 *
 * which discards the response body — and the body is usually where the upstream
 * says what was actually wrong ("**symbol** not found: GBP", "parameter `year`
 * out of range", "unknown taxonomy id"). The caller gets a number, cannot
 * self-correct, and retries the same broken call. A 2026-07-31 sweep found this
 * shape in 481 of 1,400 packs, 47 of them PLATFORM-keyed.
 *
 * It also hides bugs one level down. Two of the first three packs audited had a
 * second defect that only existed because of this line: unsplash's rate-limit
 * branch sat BELOW a catch-all and was unreachable, and bea-gov parsed
 * `BEAAPI.Error.APIErrorDescription` below a `!res.ok` throw that made the
 * parsing dead code for every non-200.
 *
 * DELIBERATELY NOT A CLASSIFIER. It does not add `user_error:` /
 * `upstream_down:` prefixes. Those decide which tier a failure lands in, and the
 * `error` tier is what the daily problem-tools list is built from — it means
 * "Pipeworx has a defect". A 400 is genuinely ambiguous: often a caller's bad
 * argument, but sometimes a query WE built wrong (ted-eu comma-joined its CPV
 * values into something TED rejected, and that bug was found only because it sat
 * in `error`). Blanket-classifying 400s as caller mistakes would have hidden it.
 * A pack that KNOWS which it is should keep saying so explicitly; this helper is
 * for the 481 that say nothing at all.
 */

/** Longest upstream explanation we'll pass through. Enough for a real message,
 *  short enough that an HTML page or a stack trace can't swamp the error. */

const MAX_DETAIL = 300;

/**
 * Default bound for `fetchWithTimeout` when a pack doesn't state its own.
 *
 * 25s mirrors the number `epo-ops` landed on after measuring the real failure:
 * a degraded upstream that doesn't error, it just never answers, and a Worker
 * sits in `await fetch()` until ITS OWN execution budget kills the request —
 * which can take minutes, not seconds (epo_ops_search_patents measured 4-8
 * MINUTE hangs before this existed). 25s is short enough that a caller gets a
 * fast, actionable error instead of holding the connection, and long enough
 * that it doesn't false-trip on a merely-slow-but-alive upstream.
 */
const DEFAULT_FETCH_TIMEOUT_MS = 25_000;

/**
 * Read the body of a failed response and fold it into a throwable Error.
 *
 * Usage — note the `await`, which is the one thing that makes this a mechanical
 * change rather than a drop-in:
 *
 *     if (!res.ok) throw await httpError(res, 'Unsplash');
 *
 * Safe to call on any non-ok response: a body that is missing, empty, unreadable
 * or HTML degrades to exactly the old `Name: 404` string rather than throwing
 * something new from inside the error path.
 */
async function httpError(res: Response, name: string): Promise<Error> {
  return new Error(await httpErrorMessage(res, name));
}

/** The message text without constructing an Error — for packs that need to wrap
 *  it in their own envelope or add an explicit classification prefix. */
async function httpErrorMessage(res: Response, name: string): Promise<string> {
  // The one place a 5xx from a host WE run gets stamped as ours. `res.url` is
  // the URL the fetch actually resolved to (after redirects), so this is a fact
  // about the call rather than a guess from the `name` the pack passed in —
  // reword that label freely, the class does not move. See
  // internal-host-class.ts; no-op for every third-party upstream, which is why
  // this touches 481 packs' error text and changes none of it.
  return markInternalOrigin(
    `${name}: ${res.status}${detailSuffix(await readDetail(res))}`,
    res.url,
    res.status,
  );
}

/**
 * Just the upstream's own explanation — no name, no status.
 *
 * For a pack that has already said both in its own sentence. epo-ops reads
 * `EPO rejected this search as too large (HTTP 413) — ${httpErrorMessage(…)}`,
 * which rendered as `… (HTTP 413) — EPO: 413.` once the XML detail was being
 * dropped: the upstream named twice, the status twice, and the one thing EPO
 * actually said ("Not enough characters before truncation character") nowhere
 * (fleet #712). Returns '' when the body carries nothing readable, so a caller
 * can fall back to its own wording.
 */
async function upstreamDetail(res: Response): Promise<string> {
  return readDetail(res);
}

/**
 * Read a SUCCESSFUL response as JSON, failing loudly when it isn't JSON.
 *
 * `httpError` above only ever runs on `!res.ok`, which leaves the nastier half
 * of the problem unhandled: an upstream that answers **HTTP 200 with an HTML
 * page**. A bot wall, a login redirect, a maintenance interstitial and a CDN
 * error page are all 200s, so `res.ok` is true, and `res.json()` then throws
 * `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`.
 *
 * That string is the problem. It names no upstream, carries no status, and
 * reads like a parser bug in Pipeworx — so it lands in the `error` tier, which
 * means "we have a defect", and the caller is told nothing they can act on.
 * data.govt.nz sat dead behind an Imperva challenge this way and every
 * status-code health check we own reported it green (7889a845). A zero-length
 * body has the same shape: `Unexpected end of JSON input`, seen this week on
 * uk-gazette (83% of external calls) and census.
 *
 * UNLIKE `httpError`, this one DOES classify, and the asymmetry is deliberate.
 * A 400 is genuinely ambiguous — often the caller's bad argument, sometimes a
 * query we built wrong — so blanket-classifying it would hide our own bugs.
 * There is no such ambiguity here: **no argument a caller can pass makes a JSON
 * API return an HTML page.** It is always the upstream, so `upstream_down:` is
 * a statement of fact rather than a guess, and it keeps these out of the
 * problem-tools list where they crowd out real defects.
 *
 *     const data = await parseJson<Feed>(res, 'UK Gazette');
 *
 * Call it only after the `!res.ok` check — on a failed response you want
 * `httpError`, which mines the body for the upstream's own explanation.
 */
async function parseJson<T>(res: Response, name: string): Promise<T> {
  let raw: string;
  try {
    raw = await res.text();
  } catch {
    throw new Error(
      `upstream_down: ${name} returned a body that could not be read (HTTP ${res.status}). ` +
        'The connection most likely dropped mid-response; retrying is reasonable.',
    );
  }

  const type = res.headers.get('content-type') ?? 'no content-type';

  if (!raw.trim()) {
    throw new Error(
      `upstream_down: ${name} answered HTTP ${res.status} with an EMPTY body where JSON was expected (${type}). ` +
        'Nothing about the request can cause this — it is an upstream fault, and the same call may well work on retry.',
    );
  }

  // Checked before parsing rather than in the catch, because knowing it is
  // markup is what turns "we failed to parse something" into "they served a
  // web page" — the second is diagnosable, the first is not.
  const head = raw.slice(0, 200).trimStart().toLowerCase();
  if (head.startsWith('<!doctype') || head.startsWith('<html') || head.startsWith('<?xml')) {
    const kind = head.startsWith('<?xml') ? 'an XML document' : 'an HTML page';
    // The summary, not the source. Pasting the first 120 characters of a web
    // page handed the agent `<!DOCTYPE html><html lang="en"…` — the same leak
    // this branch exists to describe (fleet #712).
    throw new Error(
      `upstream_down: ${name} answered HTTP ${res.status} with ${kind} instead of JSON (${type}). ` +
        'That is typically a bot wall, a login redirect or a maintenance page — it is returned as a SUCCESS, ' +
        `so status-code health checks read it as fine. No argument change will get past it. ` +
        `The page says: ${summarizeErrorBody(raw) || 'nothing readable'}`,
    );
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(
      `upstream_down: ${name} answered HTTP ${res.status} with a body that is not valid JSON (${type}). ` +
        `It begins: ${stripMarkup(raw).slice(0, 120) || '(unreadable)'}`,
    );
  }
}

/**
 * `fetch`, but bounded — the fix for a systemic gap found 2026-08-30: a grep
 * audit of every pack's `mcps/*\/src/index.ts` found 1,339 of ~1,500 call
 * `fetch()` with NO timeout guard anywhere in the file. Two of those
 * (epo-ops, statcan) were confirmed live-hanging for 4-8 minutes before this
 * existed — every unguarded call carries the same risk, just unconfirmed.
 *
 * Mirrors the `epoFetch` wrapper `mcps/epo-ops/src/index.ts` shipped first:
 * bound the request with `AbortSignal.timeout`, and on a timeout/abort throw
 * an `upstream_down:` error that names the upstream and the bound rather than
 * letting the raw `TimeoutError`/`AbortError` (which names neither) propagate.
 * `upstream_down:` is deliberate, same reasoning as `parseJson` above — no
 * argument a caller passes can make an upstream hang, so it is always the
 * upstream's fault, and marking it that way keeps a slow API off the
 * problem-tools list where it would crowd out our own defects.
 *
 * Usage — a mechanical swap for a bare `fetch(url, init)`:
 *
 *     const res = await fetchWithTimeout(url, init, 'Some API');
 *
 * Pass `timeoutMs` as a fourth argument to override the default for a pack
 * with a known-slower upstream; the label should be the same short name you'd
 * pass to `httpError`/`httpErrorMessage` for that call.
 */
async function fetchWithTimeout(
  url: string | URL,
  init: RequestInit = {},
  name: string,
  timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      // States the OBSERVATION (no response in N seconds), not a diagnosis.
      // "appears to be degraded" is an inference about the vendor that we have
      // not checked, and it is wrong in a way that misdirects whoever reads it:
      // a timeout from a Worker can equally mean OUR egress is blocked.
      //
      // Measured today (2026-09-01, fleet #1047): every call to
      // mainnet.base.org failed from the x402 facilitator while the identical
      // request from a laptop returned 200. Base was entirely healthy; the
      // public RPC refuses Cloudflare Worker egress. Had this message fired
      // there it would have blamed Base by name, and the next person would have
      // waited for a vendor outage to clear that did not exist.
      // A timeout has no status to test — there is no response at all — so
      // `markInternalOrigin` is called without one: an origin we run that never
      // answered is an availability failure by definition. This is the half of
      // fleet #1096 with neither a SQLSTATE nor a status code to key on.
      throw new Error(
        markInternalOrigin(
          `upstream_down: ${name} did not respond within ${timeoutMs / 1000}s. ` +
            `That can be ${name} being slow or down, or this environment being unable to reach it ` +
            `(some hosts refuse datacenter/Worker egress) — retry shortly, and check reachability ` +
            `from elsewhere before concluding ${name} is down.`,
          url,
        ),
      );
    }
    throw err;
  }
}

function detailSuffix(detail: string): string {
  return detail ? ` — ${detail}` : '';
}

async function readDetail(res: Response): Promise<string> {
  let raw: string;
  try {
    raw = await res.text();
  } catch {
    // Body already consumed, or the connection died mid-read. The status alone
    // is still worth throwing — never let the error path throw its own error.
    return '';
  }
  return summarizeErrorBody(raw);
}

/**
 * Turn ANY error body — JSON, HTML, XML or plain text — into one short phrase
 * that never contains markup.
 *
 * This used to just drop an HTML or XML body on the floor, on the reasoning
 * that markup crowds out the status. That was half right. Dropping it loses the
 * one sentence a caller could have acted on: an `Access Denied` title, an SDMX
 * `<message:Error>` text, an OPS fault string. A 2026-08-30 support sweep
 * measured 13 of 291 caller-facing error rows carrying a raw page or document
 * verbatim, across 11 packs, and in every one of them the useful content —
 * "Access Denied", "Invalid country code", "SCRAPE_TIMEOUT" — was in there,
 * buried in markup the agent had to parse out of a string (fleet #712).
 *
 * So: extract the meaning, discard the markup. The output is passed through
 * `stripMarkup` unconditionally, which is what lets `check:error-body-leak`
 * assert mechanically that no caller-facing message can contain `<?xml`,
 * `<!DOCTYPE` or `<html`.
 */
function summarizeErrorBody(raw: string): string {
  if (!raw || !raw.trim()) return '';

  const head = raw.slice(0, 400).trimStart().toLowerCase();

  // An HTML error page (Cloudflare interstitial, nginx default, a login
  // redirect) says what it is in its <title>, and almost nowhere else.
  if (head.startsWith('<!doctype') || head.startsWith('<html')) {
    const title = htmlTitle(raw);
    return title
      ? `${title} (upstream returned an HTML error page, not an API response)`
      : 'upstream returned an HTML error page, not an API response';
  }

  // XML fault documents — EPO OPS, SDMX (`<message:Error>`), SOAP faults. The
  // human sentence sits in a child element whose tag name says what it is.
  if (head.startsWith('<?xml') || head.startsWith('<')) {
    const fault = xmlFaultText(raw);
    return fault
      ? `${stripMarkup(fault).slice(0, MAX_DETAIL)} (from the upstream's XML error document)`
      : 'upstream returned an XML error document with no readable message';
  }

  // Most JSON error bodies bury one human sentence among ids and echoed request
  // params. Prefer that sentence; fall back to the whole body when the shape is
  // unfamiliar, since an unfamiliar shape is exactly when we can least afford to
  // guess wrong and show nothing.
  const fromJson = messageFromJson(raw);
  return stripMarkup(fromJson ?? raw).slice(0, MAX_DETAIL);
}

/** The `<title>` of an HTML error page, or its first `<h1>` — the two places a
 *  bot wall, a 502 and an "Access Denied" all state what happened. */
function htmlTitle(raw: string): string | null {
  const head = raw.slice(0, 4000);
  for (const re of [/<title[^>]*>([\s\S]*?)<\/title>/i, /<h1[^>]*>([\s\S]*?)<\/h1>/i]) {
    const m = re.exec(head);
    const text = m ? stripMarkup(m[1]) : '';
    if (text) return text.slice(0, 160);
  }
  return null;
}

/** Tag names that carry the explanation in an XML fault document, namespace
 *  prefix optional (`<message:Error>`, `<com:Text>`, `<faultstring>`). */
const XML_FAULT_TAG_RE =
  /<(?:[A-Za-z0-9_.-]+:)?(?:text|message|description|faultstring|reason|detail|title|errormessage|error)\b[^>]*>([^<]{2,400})</i;

function xmlFaultText(raw: string): string | null {
  const head = raw.slice(0, 8000);
  const tagged = XML_FAULT_TAG_RE.exec(head);
  if (tagged && tagged[1].trim()) return tagged[1];

  // Nothing conventionally named — take the longest text node instead. A fault
  // document with one sentence in an oddly named element is still readable;
  // returning nothing at all is not.
  let best = '';
  for (const m of head.matchAll(/>([^<>]{8,400})</g)) {
    const text = m[1].trim();
    if (text.length > best.length) best = text;
  }
  return best || null;
}

/**
 * Remove every tag and stray angle bracket, then collapse whitespace.
 *
 * Applied to everything on the way out, including the JSON and plain-text
 * paths, because an upstream is free to embed markup in a JSON string field —
 * and a leak is a leak regardless of which branch produced it.
 */
function stripMarkup(s: string): string {
  return collapse(decodeEntities(s.replace(/<[^>]*>/g, ' ')).replace(/[<>]/g, ' '));
}

/** The handful of entities that show up in error-page titles. Decoded AFTER
 *  tags are stripped and BEFORE the angle-bracket sweep, so `&lt;script&gt;`
 *  in a title cannot decode into markup that survives — EMBL-EBI's ChEMBL 500
 *  page renders as `500 Internal Server Error &lt; EMBL-EBI` otherwise. */
function decodeEntities(s: string): string {
  return s
    .replace(/&(?:amp|#0*38);/gi, '&')
    .replace(/&(?:lt|#0*60);/gi, '<')
    .replace(/&(?:gt|#0*62);/gi, '>')
    .replace(/&(?:quot|#0*34);/gi, '"')
    .replace(/&(?:#0*39|apos|#x0*27);/gi, "'")
    .replace(/&nbsp;/gi, ' ');
}

/** The conventional "what went wrong" field, under any of the names upstreams
 *  actually use. Checked in order; first non-empty string wins. */
const MESSAGE_KEYS = [
  'message', 'error_message', 'errorMessage', 'detail', 'details',
  'description', 'error_description', 'reason', 'title', 'fault',
];

function messageFromJson(raw: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return pickMessage(parsed, 0);
}

function pickMessage(node: unknown, depth: number): string | null {
  // Two levels covers `{error: {message}}` and `{errors: [{detail}]}`, the two
  // shapes that account for nearly all of them, without walking a large payload.
  if (depth > 2 || node == null) return null;

  if (typeof node === 'string') return node.trim() || null;

  if (Array.isArray(node)) {
    for (const item of node) {
      const found = pickMessage(item, depth + 1);
      if (found) return found;
    }
    return null;
  }

  if (typeof node !== 'object') return null;
  const obj = node as Record<string, unknown>;

  for (const key of MESSAGE_KEYS) {
    const v = obj[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  // `{error: …}` where error is itself an object or a string — the single most
  // common wrapper, so it is worth descending into by name rather than scanning
  // every key and risking picking up an echoed request parameter.
  for (const key of ['error', 'errors', 'fault', 'Error', 'data']) {
    if (key in obj) {
      const found = pickMessage(obj[key], depth + 1);
      if (found) return found;
    }
  }
  return null;
}

/** Errors are read in a single line of log output; newlines and runs of
 *  whitespace make a multi-line body unreadable there. */
function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}
/**
 * What does Medicare PAY — physician fee schedule, lab rates, and per-day unit
 * limits.
 *
 * mcps/medicare-coverage answers "is this covered?" over the CMS Coverage API.
 * This answers the next two questions every caller asks: what does it pay, and
 * how many units will they pay for. Both live in downloadable CMS files with no
 * API behind them.
 *
 * VINTAGE IS THE TRAP AND IT IS LOAD-BEARING. Fee schedules change annually and
 * NCCI/CLFS quarterly. Answering a 2026 question with 2024 rates is a
 * confidently wrong answer with billing consequences, so every response states
 * the year (and quarter, where quarterly) it used. When a caller does not name a
 * year, the newest loaded vintage is used and SAID — never silently picked.
 *
 * LOCALITY IS THE SECOND TRAP. Medicare pays by geographic LOCALITY, not by
 * state: California alone carries nine of them. The same office visit (99213)
 * pays $99.52 in Bakersfield and $87.79 in Alabama — a 13% swing that a
 * state-shaped answer would hide. So a locality is resolved explicitly, the
 * resolution is stated, and where a query matches several localities they are
 * returned rather than one being chosen quietly.
 *
 * NCCI PTP (procedure-to-procedure) EDITS — "can I bill these two codes
 * together" — cover the FULL baseline as of fleet #1293 (2026-09-07). CMS
 * distributes the complete PTP edit table behind a /license/ama?file=... AMA
 * CPT licence click-through (verified: that URL 503s to any non-interactive
 * fetch, and even a same-tab GET of the file URL — accepting only works when
 * driven through the actual license page's Accept button in a real browser
 * session). Bruce authorized accepting that licence on the company's behalf
 * (Needs Bruce, 2026-09-07); the licence text was read before shipping — see
 * this pack's README ("NCCI PTP licence" section) for the quoted
 * redistribution terms and why serving pair verdicts/modifier indicators
 * (never CPT descriptors) is believed to stay inside them.
 *
 * Loaded: the full 2026 Quarter 3 baseline (v322r0, effective 2026-07-01 —
 * the newest vintage actually in effect at ingest time; CMS had already
 * posted Q4 2026 but that isn't effective until 2026-10-01) — 4,109,749
 * distinct pairs across both settings, collapsed from 4,498,118 raw
 * historical-episode rows (a pair can have multiple add/delete/re-add
 * episodes; the open episode, or else the most recent closed one, wins) — with
 * the prior 2025q1..2026q3 QUARTERLY CHANGE files re-applied ON TOP, in that
 * order, so a pair the quarterly files show deleted cannot be resurrected by a
 * baseline row that predates the deletion. A NOT-FOUND answer from
 * check_code_pair/explain_ncci_edit now means CMS has never recorded a PTP
 * edit for that pair — not merely "no change in a rolling window" as before
 * this fleet task. Both tools still state the loaded vintage on every
 * response, and future quarters continue to layer on top via
 * ingest-ncci-ptp.mjs.
 *
 * NO CPT DESCRIPTIONS. Every source file opens with "CPT codes, descriptions and
 * other data only are copyright <year> American Medical Association", and the
 * RVU file scopes it to "codes and DESCRIPTIONS only". The CMS-computed numbers
 * are federal data and are returned; the AMA's descriptive text is not stored or
 * served. A caller passes a code they already hold.
 *
 * DMEPOS (durable medical equipment, prosthetics, orthotics, supplies) is the
 * fourth data source in this pack, added for fleet task #1289. It is HCPCS
 * LEVEL II (E/K/L/A-codes), maintained by CMS itself — unlike CPT (HCPCS Level
 * I), which is AMA copyright — so unlike pfs_rvu, medicare_dmepos_rate DOES
 * return the code description; the DMEREAD/DMEBACK documentation shipped with
 * the source file carries no AMA/copyright notice anywhere (checked). DMEPOS
 * pays by STATE (not Medicare locality) with a separate RURAL and NON-RURAL
 * amount per state, so both are always returned and labelled, never collapsed
 * into one number. Vintage discipline is identical to the rest of the pack:
 * year AND release (quarterly-ish: A=Jan primary annual update, B=Apr, C=Jul,
 * D=Oct as needed) are stated on every response, and an unloaded year/release
 * returns year_not_loaded rather than silently substituting another vintage.
 */


// Bound every fetch() in this pack to a fixed timeout — an upstream that
// degrades without erroring would otherwise hold the Worker in `await fetch()`
// until its own execution budget kills the request (minutes, not seconds).
// Mirrors the epoFetch / usaspending retryFetch pattern (fleet #685).
async function pwFetch(url: string | URL, init?: RequestInit): Promise<Response> {
  return fetchWithTimeout(url, init ?? {}, 'Medicare Pricing');
}


interface Cfg { url: string; key: string }

async function pg<T>(cfg: Cfg, path: string): Promise<T[]> {
  const res = await pwFetch(`${cfg.url}/rest/v1/${path}`, {
    headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`upstream ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json() as Promise<T[]>;
}

async function rpc<T>(cfg: Cfg, fn: string, body: Record<string, unknown>): Promise<T[]> {
  const res = await pwFetch(`${cfg.url}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`upstream ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json() as Promise<T[]>;
}

interface Rvu {
  year: number; release: string; hcpcs: string; modifier: string; status_code: string | null;
  work_rvu: number | null; pe_rvu_nonfacility: number | null; pe_rvu_facility: number | null;
  mp_rvu: number | null; total_nonfacility: number | null; total_facility: number | null;
  global_days: string | null; conversion_factor: number | null;
}
interface Gpci {
  year: number; state: string; locality_number: string; locality_name: string;
  pw_gpci: number | null; pe_gpci: number | null; mp_gpci: number | null; score?: number;
}
interface PtpEdit {
  service_type: string; column1: string; column2: string; modifier_indicator: string;
  status: string; effective_date: string; first_seen_quarter: string; last_seen_quarter: string;
}

const PTP_WINDOW_NOTE = 'ncci_ptp_edits holds the FULL NCCI PTP baseline (2026q3, v322r0, effective 2026-07-01) with the 2025q1..2026q3 quarterly change files layered on top — see medicare_pricing_coverage for the loaded vintage.';

function ptpModifierMeaning(mi: string): string {
  if (mi === '0') return 'Never allowed — Column 2 is bundled into Column 1 with no bypass; billing both is not payable regardless of modifier.';
  if (mi === '1') return 'Bypass allowed — a clinically-appropriate NCCI-associated modifier (e.g. 59, XE/XP/XS/XU) can unbundle the pair with documentation.';
  return 'Not applicable — this pair carries no active modifier bypass rule (often shown on a deleted edit).';
}

const code = (v: unknown) => (typeof v === 'string' ? v.trim().toUpperCase() : '');
const round2 = (n: number) => Math.round(n * 100) / 100;

/** The Medicare formula, written out so a caller can audit the number. */
function payment(r: Rvu, g: Gpci, facility: boolean) {
  const pe = facility ? r.pe_rvu_facility : r.pe_rvu_nonfacility;
  if (r.work_rvu === null || pe === null || r.mp_rvu === null || !r.conversion_factor
      || g.pw_gpci === null || g.pe_gpci === null || g.mp_gpci === null) return null;
  const adjusted = (r.work_rvu * g.pw_gpci) + (pe * g.pe_gpci) + (r.mp_rvu * g.mp_gpci);
  return {
    payment_usd: round2(adjusted * r.conversion_factor),
    adjusted_rvus: round2(adjusted),
    formula: `((work ${r.work_rvu} x PW ${g.pw_gpci}) + (PE ${pe} x PE ${g.pe_gpci}) + (MP ${r.mp_rvu} x MP ${g.mp_gpci})) x CF ${r.conversion_factor}`,
  };
}

// DMEPOS is priced by STATE (2-letter USPS/territory code), not Medicare
// locality. Callers say "California"; the rates jsonb is keyed "CA".
const STATE_NAME_TO_ABBR: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', 'district of columbia': 'DC',
  florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL',
  indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA',
  maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN',
  mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK',
  oregon: 'OR', pennsylvania: 'PA', 'puerto rico': 'PR', 'rhode island': 'RI',
  'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX',
  utah: 'UT', vermont: 'VT', 'virgin islands': 'VI', virginia: 'VA',
  washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
};
const VALID_STATE_ABBRS = new Set(Object.values(STATE_NAME_TO_ABBR));
function resolveState(q: unknown): { abbr: string | null; note: string } {
  if (typeof q !== 'string' || !q.trim()) {
    return { abbr: null, note: 'No state given, so no rate is calculated — pass state (e.g. "CA" or "California") for a dollar amount.' };
  }
  const t = q.trim();
  const upper = t.toUpperCase();
  if (VALID_STATE_ABBRS.has(upper)) return { abbr: upper, note: `Resolved to ${upper}.` };
  const byName = STATE_NAME_TO_ABBR[t.toLowerCase()];
  if (byName) return { abbr: byName, note: `Resolved "${t}" to ${byName}.` };
  return { abbr: null, note: `"${t}" is not a recognized US state, DC, or territory (PR/VI). Pass a 2-letter code or full name.` };
}
const DME_CATEGORY: Record<string, string> = {
  IN: 'Inexpensive and Other Routinely Purchased Items', FS: 'Frequently Serviced Items',
  CR: 'Capped Rental Items', OX: 'Oxygen and Oxygen Equipment',
  OS: 'Ostomy, Tracheostomy & Urological Items', SD: 'Surgical Dressings',
  PO: 'Prosthetics & Orthotics', SU: 'Supplies', TE: 'Transcutaneous Electrical Nerve Stimulators',
  TS: 'Therapeutic Shoes', IL: 'Intraocular Lenses', SC: 'Splints and Casts',
  LC: 'Lymphedema Compression Treatment Items', LT: 'Labor Rates',
};
const DME_JURISDICTION: Record<string, string> = {
  D: 'DMEMAC jurisdiction (priced by the regional DME Medicare Administrative Contractor)',
  L: 'Local Part B Carrier jurisdiction',
  J: 'Joint DMEMAC/Local Carrier jurisdiction',
};
const DME_RELEASE_MONTH: Record<string, string> = { A: 'January (primary annual update)', B: 'April', C: 'July', D: 'October (as necessary)' };

const STATUS: Record<string, string> = {
  A: 'Active — separately payable under the fee schedule',
  B: 'Bundled — payment is always included in another service',
  C: 'Carrier priced — the local contractor sets the price, so no national amount exists',
  I: 'Not valid for Medicare — another code is used for this',
  N: 'Non-covered',
  R: 'Restricted coverage — special circumstances only',
  T: 'Paid only when no other separately payable service is billed on the same day',
  X: 'Statutorily excluded from the fee schedule',
};

const tools: McpToolExport['tools'] = [
  {
    name: 'medicare_physician_payment',
    description:
      'What does Medicare pay a doctor for a procedure code, in a specific place? Returns the relative value units (work, practice expense, malpractice) and the actual dollar payment for a HCPCS/CPT code, adjusted for the Medicare LOCALITY — payment varies geographically, not just by state. Answers "how much does Medicare pay for 99213", "what is code 27130 worth in Los Angeles", "reimbursement rate for an office visit in Texas", and fee-schedule or contract-rate benchmarking. '
      + 'Gives both the facility and non-facility amount (a procedure pays less in a hospital, because the hospital bills the overhead separately), the global period, and the status code saying whether the code is separately payable at all. States the fee-schedule YEAR and the locality it resolved to on every response, because a rate quoted for the wrong year or locality is a wrong number. Sourced from the CMS Physician Fee Schedule relative value files.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        code: { type: 'string', description: 'HCPCS or CPT code, e.g. "99213" (office visit) or "27130" (hip replacement).' },
        locality: { type: 'string', description: 'Where the service is provided — a state code ("CA"), state name, or Medicare locality name ("Bakersfield", "Manhattan"). Payment varies by locality; omit only if you want the national picture.' },
        year: { type: 'number', description: 'Fee-schedule year, e.g. 2026. Omit to use the newest loaded year, which is stated in the response.' },
        modifier: { type: 'string', description: 'Optional HCPCS modifier, e.g. "26" (professional component) or "TC" (technical component).' },
      },
      required: ['code'],
    },
  },
  {
    name: 'medicare_lab_rate',
    description:
      'What does Medicare pay for a laboratory test? Returns the national Clinical Laboratory Fee Schedule rate for a lab HCPCS/CPT code — lab tests are paid from their own national fee schedule rather than the physician schedule, so there is one rate and no locality adjustment. Answers "how much does Medicare pay for a comprehensive metabolic panel", "CLFS rate for 80053", "what does a lipid panel reimburse". States the year and quarter of the schedule used, since lab rates are republished quarterly. Sourced from the CMS Clinical Laboratory Fee Schedule.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        code: { type: 'string', description: 'Lab HCPCS/CPT code, e.g. "80053" (comprehensive metabolic panel) or "85025" (complete blood count).' },
        year: { type: 'number', description: 'Schedule year. Omit for the newest loaded, which is stated in the response.' },
      },
      required: ['code'],
    },
  },
  {
    name: 'medicare_dmepos_rate',
    description:
      'What does Medicare pay for a piece of durable medical equipment, prosthetic, orthotic, or medical supply (DMEPOS)? Returns the fee-schedule amount for a HCPCS Level II code (E/K/L/A-codes — CPAP machines, wheelchairs, ostomy supplies, braces, oxygen equipment...) in a given US state, with SEPARATE rural and non-rural amounts, since Medicare pays DMEPOS by state rather than by the physician-fee-schedule locality. Answers "how much does Medicare pay for a CPAP machine (E0601)", "DMEPOS rate for a wheelchair in Texas", "what is the rural rate for this HCPCS code in Montana". '
      + 'Unlike medicare_physician_payment, this DOES include the HCPCS code description — DMEPOS uses HCPCS Level II, which CMS itself maintains and is not AMA copyright (CPT/HCPCS Level I is). States the fee-schedule YEAR and RELEASE (quarterly-ish: A=January, B=April, C=July, D=October) used on every response, and the modifier resolved (many DMEPOS codes price differently for rental "RR" vs. new purchase "NU" vs. used "UE" — pass one if you know it, otherwise the first modifier on file for the code is used and stated).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        code: { type: 'string', description: 'HCPCS Level II code, e.g. "E0601" (CPAP device) or "E1390" (oxygen concentrator).' },
        state: { type: 'string', description: 'US state, DC, or territory (PR/VI) where the equipment is furnished — a 2-letter code ("TX") or full name ("Texas"). DMEPOS is priced by STATE, not by Medicare locality. Omit only for the raw record without a resolved dollar amount.' },
        modifier: { type: 'string', description: 'Optional HCPCS modifier, e.g. "RR" (rental), "NU" (purchase, new), "UE" (purchase, used). Many DMEPOS codes are priced only under one modifier; omit to use whichever is on file (stated in the response).' },
        year: { type: 'number', description: 'Fee-schedule year, e.g. 2026. Omit to use the newest loaded year, which is stated in the response.' },
        release: { type: 'string', description: 'Quarterly release letter within the year: "A" (Jan), "B" (Apr), "C" (Jul), or "D" (Oct). Omit to use the newest loaded release for the resolved year.' },
      },
      required: ['code'],
    },
  },
  {
    name: 'medicare_code_units_limit',
    description:
      'How many units of a procedure code will Medicare pay for one patient in one day? Returns the NCCI Medically Unlikely Edit (MUE) — the maximum units allowed — with the adjudication indicator saying whether the limit is absolute or can be overridden with documentation, and the rationale for it. Answers "what is the MUE for 99213", "how many units of this code can I bill", "why was my claim denied for units". Available for practitioner, outpatient hospital and DME settings, which have different limits for the same code. States the quarterly edit vintage in force. Sourced from the CMS National Correct Coding Initiative.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        code: { type: 'string', description: 'HCPCS/CPT code, e.g. "99213".' },
        setting: { type: 'string', description: 'Which MUE table: "practitioner" (default), "outpatient_hospital", or "dme". The same code can carry different limits in each.' },
      },
      required: ['code'],
    },
  },
  {
    name: 'check_code_pair',
    description:
      'Can two procedure codes be billed together on the same day? Checks the CMS National Correct Coding Initiative procedure-to-procedure (PTP) edit for a pair of HCPCS/CPT codes and returns the modifier indicator saying whether the pair can never be unbundled, can be unbundled with an appropriate modifier and documentation, or carries no edit in the loaded data. Answers "can I bill 99214 and 93000 together", "is there an NCCI edit between these two codes", "do I need a modifier for this code combination". '
      + 'Built from CMS\'s FULL NCCI PTP edit baseline (2026q3, v322r0), not just a rolling change window — a pair not found here has never had a CMS-recorded PTP edit as of the loaded vintage. The response always states the loaded vintage and setting resolved.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        code_a: { type: 'string', description: 'First HCPCS/CPT code, e.g. "99214".' },
        code_b: { type: 'string', description: 'Second HCPCS/CPT code, e.g. "93000".' },
        setting: { type: 'string', description: 'Which edit table: "practitioner" (default) or "hospital" (outpatient facility). Edits can differ between them.' },
      },
      required: ['code_a', 'code_b'],
    },
  },
  {
    name: 'explain_ncci_edit',
    description:
      'What NCCI procedure-to-procedure edits exist for a single code? Lists the other codes this HCPCS/CPT code has a recorded PTP edit with — whether it is the code you bill (Column 1) or the one bundled into another (Column 2) — with each pair\'s modifier indicator. Answers "what codes conflict with 99214", "what is bundled into this procedure", "why would this code be denied when billed with something else". '
      + 'Same full-baseline coverage as check_code_pair (CMS\'s FULL NCCI PTP edit baseline, 2026q3 v322r0, not just a rolling change window) — an empty result means no PTP edit has ever been recorded for this code, not merely "no recent change".',
    inputSchema: {
      type: 'object' as const,
      properties: {
        code: { type: 'string', description: 'HCPCS/CPT code, e.g. "99214".' },
        setting: { type: 'string', description: 'Which edit table: "practitioner" (default) or "hospital".' },
        status: { type: 'string', description: 'Filter to "active" (default — currently in effect) or "all" (include deleted edits too).' },
      },
      required: ['code'],
    },
  },
  {
    name: 'medicare_pricing_coverage',
    description:
      'What Medicare pricing data is loaded and how current it is: the fee-schedule years and quarters held, how many codes are in each dataset, how many localities, and the PTP pair-edit change window. Use to check a vintage is current enough to quote before relying on a rate, and to see the scope limit on check_code_pair / explain_ncci_edit — they see only pairs that changed within the loaded quarterly window, not the full AMA-licence-gated PTP baseline.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
];

async function resolveLocality(cfg: Cfg, q: unknown, year: number): Promise<{ chosen: Gpci | null; alternatives: Gpci[]; note: string }> {
  if (typeof q !== 'string' || !q.trim()) {
    return { chosen: null, alternatives: [], note: 'No locality given, so no geographic adjustment was applied — the RVUs below are national and the payment figures are omitted. Pass locality for an actual dollar amount.' };
  }
  const rows = await rpc<Gpci>(cfg, 'resolve_medicare_locality', { q: q.trim(), yr: year });
  if (!rows.length) return { chosen: null, alternatives: [], note: `No Medicare locality matched "${q}".` };
  const chosen = rows[0];
  const others = rows.slice(1, 6);
  const sameState = rows.filter((r) => r.state === chosen.state);
  const note = sameState.length > 1
    ? `Resolved to ${chosen.locality_name} (${chosen.state}, locality ${chosen.locality_number}). ${chosen.state} has ${sameState.length} Medicare localities and they pay differently — name a city or locality if you need a different one.`
    : `Resolved to ${chosen.locality_name} (${chosen.state}, locality ${chosen.locality_number}).`;
  return { chosen, alternatives: others, note };
}

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const url = (args._supabaseUrl as string | undefined)?.trim();
  const key = (args._supabaseKey as string | undefined)?.trim();
  if (!url || !key) {
    throw new Error('medicare-pricing is not configured on this deployment — an operator must enable its data credentials. This is a setup problem, not your arguments.');
  }
  const cfg: Cfg = { url, key };

  switch (name) {
    case 'medicare_physician_payment': {
      const hcpcs = code(args.code);
      if (!hcpcs) return { found: false, reason: 'no_code', hint: 'Pass code, e.g. "99213".' };
      const askedYear = typeof args.year === 'number' ? Math.floor(args.year) : null;
      const mod = typeof args.modifier === 'string' ? args.modifier.trim().toUpperCase() : '';
      const rows = await pg<Rvu>(cfg,
        `pfs_rvu?hcpcs=eq.${hcpcs}${askedYear ? `&year=eq.${askedYear}` : ''}${mod ? `&modifier=eq.${mod}` : ''}`
        + '&select=*&order=year.desc&limit=5');
      if (!rows.length) {
        const any = await pg<{ year: number }>(cfg, 'pfs_rvu?select=year&order=year.desc&limit=1');
        return {
          found: false,
          reason: askedYear && any.length && any[0].year !== askedYear ? 'year_not_loaded' : 'code_not_found',
          hint: askedYear && any.length && any[0].year !== askedYear
            ? `No ${askedYear} fee schedule is loaded; the newest is ${any[0].year}. Rates differ every year, so this will not answer with a different year's numbers.`
            : `No physician fee schedule entry for ${hcpcs}. Lab codes are paid from a separate schedule — try medicare_lab_rate.`,
        };
      }
      const r = rows[0];
      const { chosen, alternatives, note } = await resolveLocality(cfg, args.locality, r.year);
      const nonFac = chosen ? payment(r, chosen, false) : null;
      const fac = chosen ? payment(r, chosen, true) : null;
      return {
        found: true,
        code: hcpcs,
        modifier: r.modifier || null,
        // Vintage first, deliberately: it qualifies every number below it.
        fee_schedule_year: r.year,
        release: r.release,
        year_was_defaulted: askedYear === null,
        locality: chosen ? {
          name: chosen.locality_name, state: chosen.state, locality_number: chosen.locality_number,
          pw_gpci: chosen.pw_gpci, pe_gpci: chosen.pe_gpci, mp_gpci: chosen.mp_gpci,
        } : null,
        locality_note: note,
        other_localities_matched: alternatives.map((a) => `${a.locality_name} (${a.state} ${a.locality_number})`),
        status_code: r.status_code,
        status_meaning: r.status_code ? (STATUS[r.status_code] ?? `Status ${r.status_code}`) : null,
        rvus: {
          work: r.work_rvu,
          practice_expense_nonfacility: r.pe_rvu_nonfacility,
          practice_expense_facility: r.pe_rvu_facility,
          malpractice: r.mp_rvu,
          total_nonfacility: r.total_nonfacility,
          total_facility: r.total_facility,
        },
        conversion_factor: r.conversion_factor,
        payment_nonfacility: nonFac,
        payment_facility: fac,
        payment_note: chosen
          ? 'Non-facility is the rate when the practice bears the overhead (an office). Facility is lower because a hospital or ASC bills its own facility fee separately.'
          : 'No locality given, so no dollar amount is calculated — RVUs alone are national and are not a payment.',
        global_days: r.global_days,
        source: 'CMS Physician Fee Schedule relative value files',
        caveat: 'National fee-schedule amount before sequestration, beneficiary coinsurance and any contractor adjustment. Codes with status C are priced by the local contractor and have no national amount.',
      };
    }

    case 'medicare_lab_rate': {
      const hcpcs = code(args.code);
      if (!hcpcs) return { found: false, reason: 'no_code', hint: 'Pass code, e.g. "80053".' };
      const askedYear = typeof args.year === 'number' ? Math.floor(args.year) : null;
      const rows = await pg<{ year: number; quarter: string; hcpcs: string; rate: number }>(cfg,
        `clfs_rates?hcpcs=eq.${hcpcs}${askedYear ? `&year=eq.${askedYear}` : ''}&select=*&order=year.desc,quarter.desc&limit=1`);
      if (!rows.length) {
        return {
          found: false, reason: 'code_not_found',
          hint: `${hcpcs} is not on the Clinical Laboratory Fee Schedule. Physician services are paid from a different schedule — try medicare_physician_payment.`,
        };
      }
      const r = rows[0];
      return {
        found: true,
        code: hcpcs,
        rate_usd: r.rate,
        fee_schedule_year: r.year,
        quarter: r.quarter,
        year_was_defaulted: askedYear === null,
        note: 'National rate. The Clinical Laboratory Fee Schedule is not adjusted by locality, unlike physician services.',
        source: 'CMS Clinical Laboratory Fee Schedule',
      };
    }

    case 'medicare_dmepos_rate': {
      const hcpcs = code(args.code);
      if (!hcpcs) return { found: false, reason: 'no_code', hint: 'Pass code, e.g. "E0601".' };
      const askedYear = typeof args.year === 'number' ? Math.floor(args.year) : null;
      const askedRelease = typeof args.release === 'string' && args.release.trim() ? args.release.trim().toUpperCase() : null;
      const askedMod = typeof args.modifier === 'string' && args.modifier.trim() ? args.modifier.trim().toUpperCase() : null;
      interface DmeRow {
        year: number; release: string; hcpcs: string; modifier: string; modifier2: string;
        mac_jurisdiction: string | null; category: string | null; ceiling: number | null; floor: number | null;
        description: string | null; rates: Record<string, { non_rural?: number | null; rural?: number | null }>;
      }
      const filters = `hcpcs=eq.${hcpcs}${askedYear ? `&year=eq.${askedYear}` : ''}${askedRelease ? `&release=eq.${askedRelease}` : ''}${askedMod ? `&modifier=eq.${askedMod}` : ''}`;
      const rows = await pg<DmeRow>(cfg, `dmepos_rates?${filters}&select=*&order=year.desc,release.desc&limit=5`);
      if (!rows.length) {
        const any = await pg<{ year: number; release: string }>(cfg, 'dmepos_rates?select=year,release&order=year.desc,release.desc&limit=1');
        const yearOrReleaseMismatch = any.length && ((askedYear && any[0].year !== askedYear) || (askedRelease && any[0].release !== askedRelease));
        return {
          found: false,
          reason: yearOrReleaseMismatch ? 'year_not_loaded' : 'code_not_found',
          hint: yearOrReleaseMismatch
            ? `No ${askedYear ?? '(any year)'} release ${askedRelease ?? '(any release)'} DMEPOS fee schedule is loaded; the newest is ${any[0].year} release ${any[0].release}. Rates differ every release, so this will not answer with a different vintage's numbers.`
            : askedMod
              ? `No DMEPOS entry for ${hcpcs} with modifier ${askedMod}. Try without a modifier to see what is on file.`
              : `No DMEPOS fee schedule entry for ${hcpcs}. This may be a physician or lab code instead — try medicare_physician_payment or medicare_lab_rate.`,
        };
      }
      const r = rows[0];
      const { abbr, note } = resolveState(args.state);
      const stateRates = abbr ? r.rates[abbr] : null;
      return {
        found: true,
        code: hcpcs,
        modifier: r.modifier || null,
        modifier_note: !askedMod && rows.length > 0
          ? `No modifier requested; using ${r.modifier || '(none on file)'}, the modifier on record for this code.`
          : null,
        // Vintage first, deliberately: it qualifies every number below it.
        fee_schedule_year: r.year,
        release: r.release,
        release_month: DME_RELEASE_MONTH[r.release] ?? null,
        year_was_defaulted: askedYear === null,
        release_was_defaulted: askedRelease === null,
        state: abbr,
        state_note: note,
        rate_non_rural_usd: stateRates?.non_rural ?? null,
        rate_rural_usd: stateRates?.rural ?? null,
        rural_note: stateRates && stateRates.rural == null
          ? 'No separately-adjusted rural amount is published for this code/state — the non-rural amount is what CMS pays regardless of rural status.'
          : stateRates
            ? 'This code/state carries a rural amount that differs from the non-rural amount — furnished-in-a-rural-ZIP claims are paid at rate_rural_usd, not rate_non_rural_usd.'
            : null,
        mac_jurisdiction: r.mac_jurisdiction,
        mac_jurisdiction_meaning: r.mac_jurisdiction ? (DME_JURISDICTION[r.mac_jurisdiction] ?? r.mac_jurisdiction) : null,
        category: r.category,
        category_meaning: r.category ? (DME_CATEGORY[r.category] ?? r.category) : null,
        ceiling_usd: r.ceiling || null,
        floor_usd: r.floor || null,
        description: r.description,
        source: 'CMS DMEPOS (Durable Medical Equipment, Prosthetics, Orthotics, Supplies) fee schedule',
        note: 'DMEPOS is priced by STATE, not by the physician-fee-schedule Medicare locality. Ceiling/floor of 0 means not applicable to this code (e.g. competitive-bid-priced or special payment rules) rather than a real $0 limit.',
      };
    }

    case 'medicare_code_units_limit': {
      const hcpcs = code(args.code);
      if (!hcpcs) return { found: false, reason: 'no_code', hint: 'Pass code, e.g. "99213".' };
      const setting = typeof args.setting === 'string' && args.setting.trim()
        ? args.setting.trim().toLowerCase().replace(/[\s-]+/g, '_') : 'practitioner';
      const rows = await pg<{ effective_date: string; service_type: string; hcpcs: string; mue_value: number; adjudication_indicator: string | null; rationale: string | null }>(
        cfg, `ncci_mue?hcpcs=eq.${hcpcs}&service_type=eq.${setting}&select=*&order=effective_date.desc&limit=1`);
      if (!rows.length) {
        const other = await pg<{ service_type: string }>(cfg, `ncci_mue?hcpcs=eq.${hcpcs}&select=service_type&limit=5`);
        return {
          found: false,
          reason: other.length ? 'not_in_this_setting' : 'code_not_found',
          hint: other.length
            ? `No MUE for ${hcpcs} in "${setting}", but there is one for: ${[...new Set(other.map((o) => o.service_type))].join(', ')}. Limits differ by setting.`
            : `No medically-unlikely edit published for ${hcpcs}. Not every code has one.`,
        };
      }
      const r = rows[0];
      return {
        found: true,
        code: hcpcs,
        setting: r.service_type,
        max_units_per_patient_per_day: r.mue_value,
        adjudication_indicator: r.adjudication_indicator,
        can_be_overridden: r.adjudication_indicator?.startsWith('3')
          ? 'Yes — this is a date-of-service edit based on clinical judgement, so units above the limit can be paid with appropriate documentation and modifiers.'
          : r.adjudication_indicator?.startsWith('2')
            ? 'No — this is an absolute date-of-service policy edit; units above the limit are not payable regardless of documentation.'
            : 'Depends on the indicator; a line-item edit can sometimes be resubmitted on separate lines.',
        rationale: r.rationale,
        edit_effective_from: r.effective_date,
        source: 'CMS National Correct Coding Initiative — Medically Unlikely Edits',
        note: 'This is the UNITS limit for one code. Whether two DIFFERENT codes may be billed together is a procedure-to-procedure edit, which is not available here — see medicare_pricing_coverage.',
      };
    }

    case 'check_code_pair': {
      const a = code(args.code_a);
      const b = code(args.code_b);
      if (!a || !b) return { found: false, reason: 'missing_code', hint: 'Pass code_a and code_b, e.g. code_a="99214", code_b="93000".' };
      const setting = typeof args.setting === 'string' && args.setting.trim().toLowerCase() === 'hospital' ? 'hospital' : 'practitioner';
      const rows = await pg<PtpEdit>(cfg,
        `ncci_ptp_edits?service_type=eq.${setting}&or=(and(column1.eq.${a},column2.eq.${b}),and(column1.eq.${b},column2.eq.${a}))&select=*`);
      if (!rows.length) {
        return {
          found: false,
          reason: 'no_edit_found',
          code_a: a, code_b: b, setting,
          hint: `No PTP edit on file for ${a}/${b} in either order — this pack now loads CMS's FULL NCCI PTP baseline (2026q3, v322r0), not just a rolling change window, so this means CMS has never recorded an edit between these two codes as of that vintage. Not a guarantee for future quarters, and modifier-bypass documentation rules still apply to any pair.`,
          window_note: PTP_WINDOW_NOTE,
        };
      }
      // Prefer an active row over a deleted one if both directions somehow matched.
      const r = rows.find((x) => x.status === 'active') ?? rows[0];
      return {
        found: true,
        column1: r.column1,
        column2: r.column2,
        billed_as: `Column 1 (${r.column1}) is the code you bill; Column 2 (${r.column2}) is bundled into it when both are reported for the same patient on the same date of service.`,
        setting: r.service_type,
        modifier_indicator: r.modifier_indicator,
        modifier_indicator_meaning: ptpModifierMeaning(r.modifier_indicator),
        status: r.status,
        status_meaning: r.status === 'active'
          ? 'This edit is in effect as of the stated date.'
          : 'This edit was REMOVED as of the stated date — CMS no longer considers this pair an edit (the two codes may now be billed together, subject to normal medical-necessity documentation).',
        effective_date: r.effective_date,
        change_quarter: r.last_seen_quarter,
        window_note: PTP_WINDOW_NOTE,
        source: 'CMS NCCI PTP quarterly additions/deletions/revisions files',
      };
    }

    case 'explain_ncci_edit': {
      const hcpcs = code(args.code);
      if (!hcpcs) return { found: false, reason: 'no_code', hint: 'Pass code, e.g. "99214".' };
      const setting = typeof args.setting === 'string' && args.setting.trim().toLowerCase() === 'hospital' ? 'hospital' : 'practitioner';
      const wantAll = typeof args.status === 'string' && args.status.trim().toLowerCase() === 'all';
      const statusFilter = wantAll ? '' : '&status=eq.active';
      const [asCol1, asCol2] = await Promise.all([
        pg<PtpEdit>(cfg, `ncci_ptp_edits?service_type=eq.${setting}&column1=eq.${hcpcs}${statusFilter}&select=*&order=last_seen_quarter.desc&limit=50`),
        pg<PtpEdit>(cfg, `ncci_ptp_edits?service_type=eq.${setting}&column2=eq.${hcpcs}${statusFilter}&select=*&order=last_seen_quarter.desc&limit=50`),
      ]);
      const total = asCol1.length + asCol2.length;
      if (!total) {
        return {
          found: false,
          reason: 'no_edit_found',
          code: hcpcs, setting,
          hint: `No PTP edit on file involving ${hcpcs} — this pack loads CMS's FULL NCCI PTP baseline (2026q3, v322r0), not just a rolling change window, so this means CMS has never recorded a procedure-to-procedure edit for this code as of that vintage.`,
          window_note: PTP_WINDOW_NOTE,
        };
      }
      return {
        found: true,
        code: hcpcs,
        setting,
        status_filter: wantAll ? 'active and deleted' : 'active only',
        billed_as_column1: asCol1.map((r) => ({
          bundles_in: r.column2, modifier_indicator: r.modifier_indicator,
          modifier_indicator_meaning: ptpModifierMeaning(r.modifier_indicator),
          status: r.status, effective_date: r.effective_date, change_quarter: r.last_seen_quarter,
        })),
        billed_as_column2: asCol2.map((r) => ({
          bundled_into: r.column1, modifier_indicator: r.modifier_indicator,
          modifier_indicator_meaning: ptpModifierMeaning(r.modifier_indicator),
          status: r.status, effective_date: r.effective_date, change_quarter: r.last_seen_quarter,
        })),
        note: `When ${hcpcs} is Column 1, the codes under billed_as_column1 are bundled INTO it (don't bill them separately unless the modifier indicator allows a bypass). When ${hcpcs} is Column 2 (billed_as_column2), ${hcpcs} itself is the one bundled into the other code.`,
        window_note: PTP_WINDOW_NOTE,
        source: 'CMS NCCI PTP quarterly additions/deletions/revisions files',
      };
    }

    case 'medicare_pricing_coverage': {
      const [rvuN, gpciN, clfsN, mueN, ptpRange, dmeN] = await Promise.all([
        pg<{ year: number; release: string }>(cfg, 'pfs_rvu?select=year,release&order=year.desc&limit=1'),
        pg<{ year: number }>(cfg, 'pfs_gpci?select=year&order=year.desc&limit=1'),
        pg<{ year: number; quarter: string }>(cfg, 'clfs_rates?select=year,quarter&order=year.desc,quarter.desc&limit=1'),
        pg<{ effective_date: string }>(cfg, 'ncci_mue?select=effective_date&order=effective_date.desc&limit=1'),
        pg<{ first_seen_quarter: string; last_seen_quarter: string }>(cfg, 'ncci_ptp_edits?select=first_seen_quarter,last_seen_quarter&order=last_seen_quarter.desc&limit=1'),
        pg<{ year: number; release: string }>(cfg, 'dmepos_rates?select=year,release&order=year.desc,release.desc&limit=1'),
      ]);
      return {
        found: true,
        physician_fee_schedule: rvuN.length ? { year: rvuN[0].year, release: rvuN[0].release } : null,
        geographic_localities: gpciN.length ? { year: gpciN[0].year } : null,
        clinical_lab_fee_schedule: clfsN.length ? { year: clfsN[0].year, quarter: clfsN[0].quarter } : null,
        dmepos_fee_schedule: dmeN.length ? { year: dmeN[0].year, release: dmeN[0].release, release_month: DME_RELEASE_MONTH[dmeN[0].release] ?? null, priced_by: 'state (not Medicare locality), with separate rural/non-rural amounts' } : null,
        medically_unlikely_edits: mueN.length ? { effective_from: mueN[0].effective_date } : null,
        procedure_to_procedure_edits: ptpRange.length ? {
          baseline_vintage: '2026q3 (v322r0, effective 2026-07-01) — CMS\'s FULL NCCI PTP edit baseline, AMA-CPT-licence-gated; licence accepted on the company\'s behalf by Bruce, 2026-09-07 (fleet #1293)',
          quarterly_overlay_window: '2025q1..2026q3 (re-applied on top of the baseline so a pair the quarterly files show deleted cannot be resurrected by an older baseline row)',
          coverage: 'FULL, not a rolling window: a pair with no row here has never had a CMS-recorded PTP edit as of the loaded vintage. Before fleet #1293 (2026-09-07) this only covered the 2025q1..2026q3 change window and a NOT-FOUND answer could not rule out a pre-2025 edit.',
        } : null,
        refresh_cadence: 'Physician fee schedule annually (with intra-year releases); lab fee schedule, DMEPOS fee schedule, MUE units edits, and PTP pair-edit changes all quarterly (as necessary).',
        no_descriptions_note:
          'CPT procedure descriptions (physician fee schedule, lab schedule) are not returned — American Medical Association copyright. DMEPOS is the exception: it uses HCPCS Level II codes, which CMS itself maintains, so medicare_dmepos_rate DOES return the code description.',
        source: 'CMS Physician Fee Schedule, Clinical Laboratory Fee Schedule, DMEPOS fee schedule, and National Correct Coding Initiative (MUE + PTP quarterly change files)',
      };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;
