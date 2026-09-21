# E035B — insertion-owned receive context and replay cutoff

## Accepted baseline and scope

Base: actual main `a0e7ebdd8f08b62e70246684f8baf6e7cb0234f9`, tree `ab46686f81dd7194b1179d02a56b3d96374f671c`.
PR368 acceptance: https://github.com/heke99/gridex-ops-platform/pull/368#issuecomment-5766791083.
Accepted inventory is **5300 tests / 330 files; 78 PR368 cases (46+26+3+3), 5222 prior**.
The old 5303/81/49 notes and pre-merge pending memory are superseded, not repeated or reimplemented.
D110/110 + parents10/10 retained. PR310 paused at e961135199f292b8210884f07de3b616a670161a, excluded.

This finite unit closes **row-lifetime original insertion context and receipt-cutoff integrity**.
It is NOT accepted source disposition, authenticated transport, a durable receipt ledger, complete discovery,
object indexing, deleted-source history, latest-source selection, timeline/completeness/supersession or E61/E62.
The later durable receipt/object/assessment producer is still necessary before authority claims.

## Directly verified defect and owners

`lib/inbound-mail/inboundStatusUpdater.ts:createInboundEdielMessage` puts `message_received_at: nowIso()`
in insertPayload and spreads it into an existing-row UPDATE. An exact-byte retry therefore moves the cutoff anchor.
`lib/ediel/core/tenantResolver.ts:patchMessageTenant` can alter current tenant/routing metadata; that is not historic context.
`lib/ediel/utilts/receivedStructuralSources.ts` uses current row receipt/scope. SHA256 alone seals bytes, not context.
Existing case/application receipts and mutable validated/applied JSON do not prove original acceptance.
Advisory review5767563592 recommended a future durable receipt/object/assessment ledger; review5767675347
accepts this smaller prerequisite subject to isolation and immutability constraints. Legacy-diagnostic clarification
is tracked in request5767707078 and must be resolved before implementation acceptance.

## Exact implementation contract

1. Extend existing `public.gridex_validate_ediel_message_contract()` through ONE forward migration only.
   Reserve `execution_context_snapshot.receivedProdatContext`. Under a write-blocking table lock,
   migration preflight must reject any already populated reserved namespace (including JSON null), rather than
   blessing arbitrary historic JSON. No historical row backfill or historical migration edits.
2. On INSERT remove client-supplied reserved content. Only inbound EDIFACT PRODAT with non-null raw bytes,
   ID/company/environment/code/received timestamp and the DB-calculated byte seal gets an object containing:
   version1, contextOrigin=database_insert, sourceMessageId, companyId, environment, messageCode, payloadHash,
   sourceReceivedAt, capturedAt. Capture time is `clock_timestamp()` separately from supplied row receipt time.
   Empty raw text still has a byte seal; null raw or null receipt never becomes invented provenance.
   Preserve unrelated object keys; a non-object snapshot cannot smuggle a trusted reserved leaf.
3. UPDATE cannot introduce, replace, mutate or remove the reserved leaf. For context-bearing rows protect source
   ID, direction, standard, family and code as well as receipt instant/raw/hash. Keep original raw/hash rejection
   precedence. PostgreSQL timestamptz IS DISTINCT FROM accepts equivalent offset representations, not microsecond drift.
   Current operational company/environment/link/status and unrelated snapshot keys remain editable;
   immutable original scope is not silently rebound. No new grants, RLS, tables, columns or callable RPC.
4. Real existing-row PRODAT writer omits received timestamp, preserving even an old unknown/null value.
   New insertion and other families retain their existing timestamp behavior. Exact new storage guard errors
   propagate as INBOUND_PRODAT_SOURCE_CONFLICT with original cause; unrelated errors retain existing handling.
5. Actual linked-source reader adds ONLY `received_prodat_context:execution_context_snapshot->receivedProdatContext`
   to its existing bounded, batched tenantDb SELECT. It must not load the complete snapshot.
   Missing legacy context retains the already accepted PR368 diagnostic candidate, explicitly marked
   receiptContext.status=unavailable, never authority. Present context must be an exact supported object,
   match original/current company+environment, source ID/code/hash and receipt instant including microseconds,
   and have a valid capture instant not later than the incoming original receipt cutoff.
   Check the entire returned context set BEFORE emitting ANY source identifier: malformed/mismatched records
   return only generic read_failed diagnostics (no IDs, hashes, objects, dates or register contents).
   Valid candidates carry only receiptContext.status=recorded and capturedAt, not the snapshot or extra keys.
   All reports keep not_established/not_performed, and acceptance=not_checked. No business decision input changes.

## Tests first and acceptance

New `ediel-inbound-received-context.test.ts` exercises the actual writer, status updater and email processor;
only external DB/matching/task boundaries are mocked. New `ediel-received-context-reader.test.ts` invokes the
real individual UTILTS processor and real parsers. Oracles use explicit scope/time/field literals, not new runtime helpers.
No existing test assertion or fixture changes. Existing PR368 outcome/deadline/calendar coverage remains intact.

New physical `scripts/ediel-inbound-received-context-regression.sql` is included by the existing ordinary replay
SQL entrypoint, following the untouched 62 source controls. It has 83 explicit controls over real table/trigger
insertions, spoofing, timestamp microseconds/offsets, source-field mutation, reserved JSON null/removal, operational
reassignment, no-source/legacy no-backfill and service_role. All synthetic transactions roll back. No trigger disabling,
role widening, mocked SQL execution or production calls. A baseline test failure must name actual wrong behavior,
not missing imports, bad fixture setup or unavailable schema. Inspect actual terminal logs; do not infer RED/GREEN.

Publish tests first and inspect normal OPS RED; then independent SOURCE/DESIGN/ORACLE review of exact head.
Only after qualification implement. Get native replay-generated schema/fingerprint bytes from ordinary CI;
inspect the entire schema diff before adoption. Existing generated type surface should be byte-identical;
record actual comparison rather than manufacture a generated baseline. No thresholds or workflows changed.
Require exact final-head normal OPS, Ediel/browser/full PR CI and completed independent TASK/SPEC, QUALITY,
TENANT-BOUNDARY and WHOLE-PR review. Merge guarded by expected head; fresh actual-main full73 and OPS,
inspect every artifact row/JUnit/source binding, and write acceptance on the SAME PR, not a receipt-only PR.

## Skill routing / execution

Activated: using-superpowers and executing/writing-plans (bounded ordered increment); TDD and systematic-debugging
(reproduced writer defect and missing storage contract); spec-to-code-compliance/differential-review/fp-check
(trace exact owners, not normative invention); Supabase/Postgres best practices (invoker trigger, same privileges,
forward-only migration); requesting/receiving-code-review and verification-before-completion/finishing-a-development-branch.
Reviewed actual local source archive: exact Git tree equals accepted main. Local workbench Git is an inspection
snapshot, not claimed remote ancestry. Dependencies/network are unavailable locally; ordinary GitHub CI is the
execution authority. No local repository-wide test success is claimed.
Conditional: variant analysis for concrete findings; schema/type generation only if real replay demonstrates delta.
Skipped UI/React/Next docs, hooks, new skills, app integrations, supply-chain/dependency changes, broad audit
or parallel execution groups: no matching change/trigger in this narrow unit. Existing normal CI supplies dependency,
RBAC, lint, typing, build and release gates. No unavailable external scanner is claimed to have run.

## Remaining after this unit

Durable received-source receipts/object discovery, immutable accepted disposition assessments and temporal source
selection remain unimplemented. Missing context stays unavailable; a matching snapshot is not source acceptance.
Reclassified operational scope is detected, not retroactively certified. Deleted rows have no durable history here.
Full E035/F3/masterplan remain incomplete. No direct live DB/provider/market/settings or explicit deployment actions.
