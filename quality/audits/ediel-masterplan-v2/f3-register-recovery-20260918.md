# F3-H recovered continuation — 2026-09-18

Status: IMPLEMENTED_NOT_VERIFIED as a final delivery. Ordinary final-head CI and
substantive independent review are still required. Base PR328 head 2c11f276cdf30e80d234752d96c9914e7b30af5d,
base tree465efef0115c16836ed9eedce77ebf6487d49d89. PR310 stays paused; PR327 stays merged.

## Recovery provenance and honest scope

The published source archive was restored and its complete Git tree matched the
remote base exactly. The later original complete patch was not available. Two
compressed fragments yielded fourteen complete files whose Git blob checksums
matched the historical patch: nine tests, four admin/UI files and row preflight.
The remaining runtime was reconstructed from source, recoverable hunks and the
restored tests, then rechecked. This is NOT a claim of byte-identical recovery of
the entire lost worktree. Older 2088/2105 results from interrupted attempts were
not accepted as current verification.

All nine recovered suites were first run against unchanged PR328 runtime:
145 cases,46 passed/99 failed. Current fresh runs have progressed to343 passing
register cases across16 files (146 retained,197 new versus PR328). Fresh full
suite at the earlier recovery boundary:2152/2152 in229 files. Five additional
source/send-boundary tests now pass, but the full final-source run is in progress.
Application and script typechecks passed. A new test-helper nullable notes type
was corrected, and the subsequent test typecheck passed. The final sequential
app/test/script rerun and full verification are not replaced by those earlier
observations. Initial parallel app TypeScript was killed by memory pressure;
it was rerun sequentially successfully without changing the committed budget.

## Source authority

Unchanged P26.A r3 source SHA256:
83c2f1d2915851d2e670731f6ab404ef06c9b9def282afbafdfa0eda836a6e95.
The existing f3-register-source-map documents §2.2 and annex2 pp114–116;
page47 distinguishes314 global LIN from258 per object. Field213 n..15 and its
quantity/unit structure were checked against the original page54. No original
package bytes,13 usage columns,110 base-D cells or package integrity thresholds
have been changed. No new regulatory inference is taken from test success.

## Implemented execution paths

* The actual TGT part1–4 chain groups source columns by object, exact agency and
  own register, retains raw annotations separately, and serializes through the
  existing canonical register renderer. Empty indexed columns fail rather than
  disappear. Source inventory, not the built payload, supplies expected counts.
* Both expected-context/canonical and payload/TGT comparators use exact
  object+agency+register matching, own213/214/218/259 values, missing whole objects
  and first-register authority. LIN314/source ordinal is never a register index.
* Canonical engine/profile diagnostics and row metadata retain independent copied
  register facts bound to the decoded body. Explicit snapshot null/empty overrides
  clear stale facts; malformed values reject. These hashes are integrity bindings,
  never authorization or factual proof. Unknown conditions block outbound test and
  production, including dependent_only and the invalid-test-send override.
* Admin draft creation and autopilot share a source-bound factual operator input
  in the existing tenant-owned test-run notes. Company/run/role/case/step/function
  and exact source digest must match. Missing facts stay unknown. The authorized
  write action requires a source note and actor, validates each object and uses
  optimistic concurrency. The workbench exposes this form. JSONB key order alone
  does not invalidate a source. No new schema or parallel policy store is used.
* Multi-object staging exposes individual decisions in both admin case views.
  Every selected customer/site/meter belongs to the same tenant and exact source
  object before the first canonical customer RPC. A durable immutable plan stores
  per-object operation receipts, with stable identity-based idempotency keys and
  compare-and-set revisions. Retries rederive commands from the wire and decisions,
  reject drift/tampering and skip completed objects. The whole message is not
  linked to the first customer. Failure of final audit/event recording preserves
  receipts and allows retry; this is per-object atomicity, NOT an all-or-nothing
  cross-object database transaction.
* Register defects cannot produce a guessed positive or invented negative APERAK.
  The existing derivation stops with PRODAT_REGISTER_ACK_REVIEW_REQUIRED before
  positive shortcuts or database lookup. Full national error-code mapping remains
  source-governed; no invented ERC was introduced to force completion.

## Fresh review findings and reproductions

1. CONFIRMED/FIXED — snapshot facts lost or replaced by stale context.12/16 new
   snapshot cases failed before correction;16/16 after. Existing resolver and
   profile now use one authoritative snapshot precedence helper.
2. CONFIRMED/FIXED — admin/autopilot did not transmit authorized source facts.
   Nine real entry-path tests failed before wiring and pass after. Eighteen
   additional helper cases cover source mutation, tenant, run, step and bad facts.
   These database boundaries are mocks, not a live portal approval certificate.
3. CONFIRMED/FIXED — link-only canonical graph commands could reset selected
   masterdata; selected meter could be moved without its selected site; retries
   could silently change actor. Four added cases failed before correction and
   all33 batch cases pass after. Link-only sends only validated identity fields;
   update strips absent/default masterdata, and original-operator retry is enforced.
4. CONFIRMED/FIXED — ambiguous function-free register columns could attach to a
   mixed-function group, unknown Z99 columns could masquerade as unlabelled, and
   Z05 local expected IDs could use the wrong233/209 precedence. Three new cases
   failed before repair; the31-case TGT suite passes after.
5. FALSE POSITIVE — suspected standalone invalid-test override of malformed own
   register quantities. Two new cases already pass through canonical scoped
   register issues; no speculative runtime patch was made. Tests remain as guards.
6. FIXED TEST TYPING — fact-source helper default inferred nonnullable notes.
   Corrected explicit EdielTestRunRow parameter; no assertion removed.

## Database observation and explicit unsupported boundaries

Read-only Supabase function inspection confirmed the actual canonical graph RPC
chain and that selected site/meter rows may update even when update_existing is
false. public.gridex_onboard_customer_graph_core definition md5:
5e907f34c39f1a15ac9642843c730b80 (30615 characters); no function was changed.
The existing masterdata schema normalizes identifiers and has no agency namespace.
Staging, parsing, rendering and comparisons retain exact IDs/agency; graph writes
for normalization-changing IDs or duplicate IDs across agencies remain blocked
with IDENTITY_SCHEMA_REQUIRED/NAMESPACE_UNSUPPORTED. This cannot be safely fixed
by stripping punctuation or importing paused PR310. Supported multi-object graphs
are executable; these explicit unsupported masterdata cases are not certified.

Receipts are durable server-owned state, not signatures. A different operator
cannot resume an existing graph plan without a separately designed reauthorization
flow. UI states this rather than silently attributing writes to another actor.

## Skill routing and remaining gates

Used: repository memory/knowledge, executing-plans, test-driven/systematic debugging,
source-to-code mapping, differential/variant review, tenant/ownership analysis,
Supabase read-only schema verification, installed Next.js server action/RSC guidance,
verification-before-completion. No separate subagent runner was available and none
is claimed. Independent review must come from actual PR review. No unrelated GPU,
performance tuning, infra deployment, schema migration or PR310 workflow was run.

Next: finish same-source local qualification; publish this bounded continuation to
PR328, run all four ordinary workflows on the final head, request substantive
review and address findings before guarded merge. No final merge readiness or full
GOV-02/P-05/F3/110D/live-TGT approval is asserted by this recovery checkpoint.


## Publication qualification snapshot

Fresh full application Vitest:2157/2157 in229 files;343 register cases in16files.
All three TypeScript projects pass. Lint0errors/99warnings, mechanical checks,
quality tests, RBAC and unchanged source-size/specification budgets pass.
Retained source run initially stopped at module loading: the recovered customer
consumer imports tenantDb and node:crypto. Three source-only harnesses now expose
native pure crypto and an explicitly UNREACHABLE tenantDb stub that throws on
use. All code after their runtime loaders, including every fixture/assertion,
was byte-compared against the base and is unchanged. The fresh9-suite run passes
851/851 (the former848 plus the3 existing route-destination cases).

Local production build was terminated by SIGKILL in the Next build worker under
this container's memory limit. It is NOT marked successful. Ordinary GitHub CI
must execute and pass its real production build on the exact published head.
No required check or committed memory budget was weakened.

The shared send guard already rejects malformed register syntax despite the
intentional-invalid-test flag; the two extra tests passed before any runtime
change. The candidate retains all earlier DTM/NAD/RFF/BGM checks. Normal CI,
full review and merge remain pending at publication.
