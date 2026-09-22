# Continuation update — 2026-09-22

Authoritative baseline is PR370 head92d4980e5f1e068a3d33826f4ef75d086bfaf714, main eb2b8693130af8fa7976a93891b95973bc473b50. OPS35719151591 all three ordinary jobs passed. Other workflows were inspected separately: public browser, coverage and smoke passed; staging/real-customer and production crawler skips are NOT executions. The two prior CodeRabbit findings were confirmed resolved; no full E035 approval follows from that.

New work in progress: capture actual canonical register-owner results per physical object and register occurrence, bind to original bytes and registry evidence, extend append-only validation SQL with strict optional facets. Full source flags remain closed. Bounded independent TS review and static SQL review found no blocker; native35733978604 passed58SQL and actual concurrent immutable corrections; overall preparation failed later because marker migrations were not restored before file-contract tests. CLI-created forward migration20260922131136 and repeated DB-generated schema/types are verified; manifests updated. Local5565/340tests, app/tests typechecks and lint0errors pass. No final-head verification or merge is claimed.

Owner mapping found reusable legal tenant/role/delegation and facility grid-owner decisions; missing hooks are implementation work, not a user-policy blocker by themselves. Explicit-time identity provenance is implemented and independently reviewed; it remains current-read evidence, not historical knowledge or full source approval. Full tenant/party/business approval integration, immutable full dispositions, timeline/supersession and actual E61/E62 comparison are still outstanding. Continue substantive implementation. See continuation-20260922.md and owner-map-20260922.md in the E035 audit folder. PR310 remains OPEN/DRAFT/PAUSED e9611351, excluded. No live operations.

## Earlier notes (historical, superseded where contradicted above)

# Active task — E035 / PR370

Continue existing PR370, branch codex/e035-durable-source-ledger-20260922. Accepted main remains PR369/eb2b8693130af8fa7976a93891b95973bc473b50; do not redo369 or merge a receipt-only checkpoint.

Original PR heada89275ba passed ordinary OPS35715146276 including5514/337tests, types/lint/build/API/RBAC/replay. External CodeRabbit found mandatory physical-observation SQL fields and masked receipt-time fixtures. Forward20260922105251_ediel_received_discovery_shape.sql plus fixture corrections were genuinely CLI/native-tested in35718179577:64newSQL (55actualREDbefore), all priorSQL/upgrades,2detected timestamp mutants, full5514tests/rootchecksPASS. Delivered2positive SQL wires were additionally made faithful after native; ordinary CI on this new head must verify the exact last delivery. See review-fix-20260922.md. Do not repeat the already repaired provider crash or BigInt issue.

Next: corrected-head CI and review closure, then real per-object canonical register/accepted tenant/legal-party/business-acceptance immutable dispositions. Canonical-runtime facets are not source approval. After those owners, implement dated timelines/completeness/supersession/E61/E62 selection. User explicitly requested continuation to complete the substantive unit, not stopping at green CI. PR310 remains OPEN/DRAFT/PAUSED e9611351 and excluded. No hosted/live operations.
