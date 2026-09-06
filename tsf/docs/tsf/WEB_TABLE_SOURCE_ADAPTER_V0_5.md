# Web Table Source Adapter V0.5 — Live Access Preflight + Untrusted-URL Hardening

Base candidate: `530ee04f8f` (V0, verified). Main TSF integration reference
(read-only): `35aaaa9c44` / `tsf/feature/web-table-source-adapter-main-integration-v1`
(worktree `web-table-adapter-main-integration-v1`, since advanced to
`a6401ced86` — a docs-only commit confirming the same decisions and
explicitly disclosing the nested-table-warning gap this V0.5 closes).
Neither the V0 checkpoint nor the Main TSF integration worktree was modified.

## 1. Live robots preflight

New: `domain/robots-txt-parser.mjs` (pure RFC 9309 group/rule parsing,
`*`/`$` wildcards, longest-match-wins with allow-wins-ties), `adapters/robots-txt-fetch.mjs`
(fetches `/robots.txt` via the unmodified `bounded-http-fetch.mjs`, adding
the explicit user-agent token `TsfWebSourceAcquisitionBot/0.1`), and
`domain/web-source-robots-preflight.mjs` (orchestrates the two into bounded
decision evidence).

RFC 9309 interpretation used (documented in the module itself):
- 200 + parseable `text/plain` → apply matched rules.
- 4xx (`ROBOTS_NOT_FOUND`) → RFC 9309 §2.3.1.2 permits "no restrictions" →
  mapped to gate input `ALLOWED`, but this can never alone reach
  `PUBLIC_ALLOWED` (the access gate still requires a separate explicit
  affirmation).
- 5xx / network error / timeout / unsafe redirect / unparseable content →
  mapped to gate input `UNKNOWN` (fail-closed; the more conservative reading
  of RFC 9309 §2.3.1.3, not "full disallow" and never "allowed").

`applyRobotsEvidenceToAccessInput(robotsEvidence, callerAccessInput)`
always uses the live evidence's decision, discarding any `robotsDecision`
the caller tried to supply — a live `DISALLOWED` (or any other outcome)
can never be replaced by a more favorable caller claim.

Raw `robots.txt` content is retained only when a caller explicitly passes
`retainRawRobotsContent: true` to the preflight, and is unconditionally
stripped again before it can reach the acquisition receipt (see §4).

Integrated into `acquireWebSourceViaStaticTable` as opt-in:
`robotsPreflight: { enabled: true }`. Omitted (the default) preserves V0's
exact prior behavior unchanged.

## 2. Connection-time DNS-rebinding protection

**Attempted and achieved**, not blocked. Empirically verified (both by hand
during design and in the committed, offline test suite) that Node's global
`fetch` cannot be given a custom DNS resolver or post-connect socket check
without adding the `undici` package as a new dependency (`node:undici` is
not a built-in module even on Node 24; confirmed by direct import attempt).
Node's core `node:http`/`node:https`, however, accept a `lookup` option with
the same signature as `dns.lookup` — this is what closes the gap, with zero
new dependencies.

New: `adapters/pinned-connection-fetch.mjs`.
- `pinConnectionToAddresses(url, init, vettedAddresses)`: opens the actual
  socket using `agent: false` (never reuses a pooled socket from a
  differently-vetted prior request) and a `lookup` override that always
  answers with the caller-supplied, already-vetted address(es) — never
  performing a second, real DNS lookup at connect time. Verifies
  `res.socket.remoteAddress` is one of the vetted addresses before
  resolving (defense in depth; by construction this can only fail if
  Node's own `lookup` contract were violated).
- `createPinnedFetch({resolveImpl})`: wraps the above with
  `assertPublicHttpUrl` (the same SSRF guard V0 already uses, unmodified)
  so the addresses being pinned were actually vetted first.
- Preserves the real hostname for the HTTP `Host` header and TLS SNI (both
  derive from `hostname`, which is never rewritten); never touches
  `rejectUnauthorized` (stays at its secure default).
- Matches global `fetch`'s `(url, init) => Response` contract exactly, so
  it drops straight into `bounded-http-fetch.mjs` as `fetchOptions.fetchImpl`
  — byte cap, timeout, content-type allowlist, retry, and **per-redirect-hop
  re-validation** (bounded-http-fetch.mjs already calls `fetchImpl` fresh
  for every hop) all continue to come from the unmodified, already-verified
  V0 primitive. This module only changes how the socket opens.

Design validated live (manual, one-time, during design — not part of the
automated suite) against a real HTTPS host: pinning to the real resolved
address succeeds with a normal, `authorized: true` TLS handshake; pinning to
a non-routable address times out rather than silently reaching a different
server, proving the override is real. The automated suite proves the same
mechanism offline against local loopback servers (a genuinely different,
unreachable pinned address — `127.0.0.2` — fails instead of silently
succeeding elsewhere; the `Host` header still reflects the real hostname,
not the pinned IP).

**Not yet the adapter's default.** `bounded-http-fetch.mjs`'s own default
`fetchImpl` (global `fetch`) is untouched, preserving Main TSF's existing V0
adoption exactly as integrated. `createPinnedFetch` is available for a
caller to opt into per Main TSF's own recorded usage-policy constraint
("reviewed source candidates / allowlisted domains only... until
connection-time IP pinning... closes the gap") — this V0.5 closes that gap
technically, but wiring it as the default for arbitrary/unreviewed
candidates is a policy decision for a future integration, not made here.

## 3. Nested-table warning

`html-table-tokenizer.mjs`: tracks the row index (and, where available, the
enclosing cell tag) at the moment a nested `<table>` is entered, and on
finalize emits `NESTED_TABLE_FLATTENED: outer table index N contains K
nested <table> element(s) at row index(es) [...]. Behavior applied:
flattened to plain text... This may distort the outer table's inferred
schema.` One warning per outer table, listing every affected row.
Non-nested tables (including sibling tables) produce no such warning.

## 4. Retention and canonical receipt regression

`web-source-acquisition-receipt.mjs` gained an additive, nullable
`robotsEvidence` field (schema `web-table-source-acquisition-receipt.schema.v1.json`
updated to match — no other field's shape changed). Raw `robots.txt`
content is always stripped from this field regardless of what the
preflight evidence itself retained (`robotsContentRetained` is forced
`false` on the receipt), mirroring the same defense-in-depth stance V0
already applied to `artifactRef.rawHtml`.

`test/main-tsf-receipt-mapping-contract.test.mjs` is a consumer-side
contract test reproducing Main TSF's *published* mapping contract
(`webSourceReceiptToSourceSnapshot`, documented in their integration doc's
decision #1 — not their file, which is untouched) to prove, entirely from
this worktree: raw HTML is stripped even when retention was enabled
upstream; hashes and permitted metadata survive; the new nested-table
warning and robots evidence survive intact; web-specific fields
(`schema`, `warnings`, `tableIdentity`, `robotsEvidence`) never get promoted
to top-level canonical `SourceSnapshot` fields, staying subordinate inside
`modeEvidence`; a refusal/failure receipt is rejected outright, never
silently admitted.

**Integration delta for Main TSF: none required.** Their mapper already
carries the entire receipt object verbatim under `modeEvidence` (only
stripping `rawHtml`), so a new receipt field or a new warning string
requires no change on their side — confirmed by reading their mapper
(`webSourceReceiptToSourceSnapshot`) directly. They would only need to
re-copy this worktree's updated `web-source-acquisition-receipt.mjs` /
`html-table-tokenizer.mjs` into their own worktree at their next
integration pass to pick up `robotsEvidence` and the nested-table warning.

## 5. Tests

70 new/changed tests across `robots-txt-parser.test.mjs` (10),
`web-source-robots-preflight.test.mjs` (13), `pinned-connection-fetch.test.mjs`
(8), `main-tsf-receipt-mapping-contract.test.mjs` (7), plus additions to
`html-table-tokenizer.test.mjs` (+4) and `web-table-source-adapter.test.mjs`
(+5), and the updated receipt/schema tests. All deterministic, offline
(mocked `fetchImpl`/`resolveImpl` or local loopback servers) — no live
internet access required.

## 6. Independent verification

See the final governance return for the fresh verifier's findings.
