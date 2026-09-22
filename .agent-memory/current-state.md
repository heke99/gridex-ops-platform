# E035 live-owner runtime continuation — 2026-09-22

PARTIAL / NOT MERGE-READY. Existing PR370 on codex/e035-durable-source-ledger-20260922.
The containing Git commit/live PR identifies this candidate. Baseline d7fb49fde3dae153693acae1cefa33aeef45ad4f
already passed ordinary OPS35758893367 (all three jobs); do not repeat its recovery.
Accepted main/PR369 remains eb2b8693130af8fa7976a93891b95973bc473b50.

Substantive new runtime code: fresh canonical receipt handoff; exact-count bounded tenant
identity reads; selected facility/grid-owner legal-party binding; a callback from the actual
successful Z04 switch-confirmation AND supply-period writes; immutable owner composition
plus a separate committed-availability RPC. The real inbound processor invokes these paths.
All physical objects remain represented. No callback, copied receipts/status JSON, incomplete
reads, unmatched namespaces, or missing owners can create accepted evidence. Diagnostic
failures retain original business and ACK behavior. Supported approval is the source-bound
Z04 legacy switch/supply path, not arbitrary Z06/Z10 review cases or SMTP authentication.

New source is newly implemented here, not a recovery of the previously reported5758/347
continuation (still NOT RECOVERED / NOT REVERIFIED). Existing original source/discovery,
canonical register facets, database owner/snapshot contracts and regression assertions remain.
The authentic new forward20260922175540_ediel_source_owner_timezone.sql was CLI-created in
run35763799597, artifact10710533967. No existing migration was edited.

Test-first evidence: initial business/count-owner tests9FAIL/3PASS, then34PASS including
retained identity cases; composition21FAIL/6PASS then27PASS; actual processor missing-hook
assertions2FAIL/1PASS then3PASS. These unit tests replace only external IO. The separate
native suite uses actual Supabase HTTP, real canonical registry, real business writes and
PostgreSQL RPCs, and must pass with repeated generated contracts before acceptance.
Native qualification, current-head ordinary CI and independent review are tracked in PR370
terminal receipts. Do not infer PASS from this implementation checkpoint or baseline CI.

Full E035/F3/masterplan and temporal comparison remain INCOMPLETE. D110/110+parents10/10 retained.
PR310 OPEN/DRAFT/PAUSED at e961135199f292b8210884f07de3b616a670161a, excluded and untouched.
No hosted database, deployment, provider/market change or external message. Known existing
public.gridex_grid_owner_name_key mutable-search_path advisor remains disclosed.

Next action: Inspect current runtime-owner native qualification and exact published-head CI/review; finish any real failures, then implement dated completeness, timeline/supersession and E61/E62 only from fully witnessed owner evidence. Keep existing PR370 draft; no checkpoint merge or repeated database recovery.

## Historical records — superseded where contradicted above

# E035 recovered database continuation — 2026-09-22

PARTIAL / NOT MERGE-READY. Active PR370, codex/e035-durable-source-ledger-20260922.
Resolve the current candidate from the containing Git commit and live PR metadata.
Last verified published baseline: bc6085e192bbab4da50b9db9d47bb27b73178b87,
ordinary OPS run35741940986, all three jobs PASS. Main/accepted PR369 remains
 eb2b8693130af8fa7976a93891b95973bc473b50.

Preserved implementations: immutable received originals/discovery/canonical evidence,
actual per-object register validation and explicit-time tenant identity provenance.
Recovered database work: immutable owner assessments, committed-availability witnesses,
bounded immutable decision snapshots and message-local LIN uniqueness via a forward
migration. This does NOT deliver full runtime source approval or E61/E62 selection.

Native run35747547629 at4a502344: 71 owner SQL checks, 61 register SQL checks,
retained suites and real concurrency/snapshot/role/budget probes PASS. The valid
multi-message LIN case failed before the correction and passed afterward. Repeated
schema/type bytes and artifact checksums were independently checked by the implementing
assistant, not an independent reviewer. New regressions are wired into ordinary replay.

The previously reported 5758-tests/347-files TypeScript continuation was not recovered
in this session. Neither pinned preparation source nor its native artifact contains it.
Do not claim those results were reproduced or that missing runtime code is published.
Application and test source from the 5565-test published baseline stays unchanged.
Full tenant/legal-party/business runtime dispositions, source approval,
timeline/supersession/E61/E62 remain incomplete. Exact-head final CI and independent
whole-PR/requirement/tenant-boundary review are mandatory. Green CI alone is not merge approval.

PR310 stays OPEN/DRAFT/PAUSED at e961135199f292b8210884f07de3b616a670161a.
No PR310 source/proof infrastructure, hosted database, deployment or market message.
Native advisors retain the existing public.gridex_grid_owner_name_key mutable
search_path warning; this is not a globally clean advisor result.

Next action: Inspect ordinary CI and independent review for the current PR head; then complete runtime tenant/legal-party/business disposition owners, full source approval and later timeline/supersession/E61/E62. Preserve implemented facets and the qualified database continuation; do not repeat qualification/publication or merge a checkpoint.

See quality/audits/ediel-masterplan-v2/e035-source-ledger/resume-db-qualification-20260922.md

## Historical records — superseded where contradicted above

# Continuation update — 2026-09-22

Authoritative baseline is PR370 head92d4980e5f1e068a3d33826f4ef75d086bfaf714, main eb2b8693130af8fa7976a93891b95973bc473b50. OPS35719151591 all three ordinary jobs passed. Other workflows were inspected separately: public browser, coverage and smoke passed; staging/real-customer and production crawler skips are NOT executions. The two prior CodeRabbit findings were confirmed resolved; no full E035 approval follows from that.

New work in progress: capture actual canonical register-owner results per physical object and register occurrence, bind to original bytes and registry evidence, extend append-only validation SQL with strict optional facets. Full source flags remain closed. Bounded independent TS review and static SQL review found no blocker; native35733978604 passed58SQL and actual concurrent immutable corrections; overall preparation failed later because marker migrations were not restored before file-contract tests. CLI-created forward migration20260922131136 and repeated DB-generated schema/types are verified; manifests updated. Local5565/340tests, app/tests typechecks and lint0errors pass. No final-head verification or merge is claimed.

Owner mapping found reusable legal tenant/role/delegation and facility grid-owner decisions; missing hooks are implementation work, not a user-policy blocker by themselves. Explicit-time identity provenance is implemented and independently reviewed; it remains current-read evidence, not historical knowledge or full source approval. Full tenant/party/business approval integration, immutable full dispositions, timeline/supersession and actual E61/E62 comparison are still outstanding. Continue substantive implementation. See continuation-20260922.md and owner-map-20260922.md in the E035 audit folder. PR310 remains OPEN/DRAFT/PAUSED e9611351, excluded. No live operations.

## Earlier notes (historical, superseded where contradicted above)

# Current state — E035 PR370 correction published

PR370 contains real forward-only received-source ledger, immutable saved read sets/discovery attempts, actual UTILTS integration and canonical-runtime facets. Accepted main remains eb2b8693/PR369; PR310paused/untouched.

Originala89275ba ordinaryCI passed in35715146276. External review raised2confirmed findings; review fix native35718179577 has64/64newSQL (55redbefore), retained105+62+84SQL/3upgrades,2timestamp mutation failures,5514/337tests and allrootchecksPASS. Correction adds real forward20260922105251 and coherent time fixtures; two SQL positive payloads were subsequently matched to physical wires with the production reader. New actual-head ordinaryCI/review remains required. Details in review-fix-20260922.md.

Full per-object/source/accepted-tenant/legal-party/business-acceptance owners remain unimplemented; no timelines/supersession/E61/E62 authority. Continue that substantive task without claiming completeE035/F3/masterplan. No hosted writes, deployment or market messages.
