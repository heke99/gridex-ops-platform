# PR364 — unresolved PRODAT staging tenant isolation

Status: IMPLEMENTED_NOT_VERIFIED. Accepted main is34eb943046ab87761b071bc508ea48b7af70eea9/PR363. Candidate is a child of test-first6c9f0f29fc648441e3943140e1b05492fbd33418; fetch the actual final branch head before review or merge.

## Qualification and observed RED

Independent review5759320966 verified the actual helper/caller, source plan and51-case public staging oracle. It confirmed the existing outer unresolved-tenant stop in processInboundEdielMessage. The defect is therefore a lower exported service-contract isolation gap, not a demonstrated live-mail bypass.

Root read completed ordinaryOPS35590870160/job106304715600 on6c9f0f29, Node22.23.2. npm test finished2026-09-21T10:53:55.088Z:5153total,5126PASS,27FAIL;323files,322PASS,1FAIL. The27 failures all occur in the new suite because unresolved staging queries global masterdata or retains foreign links/confidence. Its24 controls and all5102 pre-existing tests passed. Actual parser fixtures, imports and typechecks succeeded; this is behavioral RED, not setup failure. Receipt5759395557 records the observed result and root authorization of the independently qualified finite fix. Tests are unchanged.

## Production delta

Only lib/ediel/inboundCases.ts changes. The public staging function uses the existing trimOrNull for its internal company scope. The private matching helper returns an empty match before any masterdata query when that scope is missing. All resolved point, site, organization and personal-identity queries have unconditional company_id filters.

Parsing and register validation still precede I/O. Unresolved messages may still create/update pending-review cases with raw-derived diagnostics, null links and confidence0. Scoped matching priorities/confidence, real database errors, existing-case ownership checks, null-scoped optimistic updates, reviewed/applied-case behavior and all other application functions remain intact. External object IDs are not newly normalized; cached JSON cannot supply company scope. The source-message ownership contract remains caller-owned; this change is not a new authorization layer.

Git comparison was inspected before publication. Besides the bounded matcher/scope delta, the complete-file transfer changed only two blank separators and final newline formatting; no other function body or test was changed. No schema, RLS, migration, rule, ACK, workflow, dependency, threshold or live operation is part of this delivery.

## Verification and continuation

The51 new cases cover three existing service alphabets through the actual exported staging function and parser; only external database/events are mocked. Negative unscoped queries deliberately return foreign rows, while positive A/B and fallback controls require actual company filters. Existing5102 assertions remain unchanged. A mocked query contract is not a physical database execution certificate.

Require final exact-head ordinaryCI and independent completed TASK/SPEC,QUALITY,TENANT-BOUNDARY,WHOLE-PR review. Then expected-head guarded merge, fresh actual-mainfull73/73 and allOPS, downloaded-artifact hash/row/JUnit/commit/unit verification, and a durable acceptance receipt. No new GREEN or merge is claimed here. Local tools inspected downloaded CI evidence; no local repository test run is claimed.

PR363 actual-main receipt is retained with root5759348778. Prior E035 B reconnaissance5759151611 is corrected by current source inspection: PRODAT staging already persists observed objects/registers; do not add a duplicate diagnostic projection. Such JSON is still not independently qualified, dated, accepted and complete inventory. That producer/loader, source-qualified E61/E62 comparator and guide/ACK/persistence outcomes remain separate work, along with remaining F3 criteria and later phases. FullE035/F3/masterplan NOT_COMPLETE; D110/110+parents10/10 retained.

Skills: retained execution plan, current-source/false-positive tenant qualification, TDD, bounded differential/independent review and verification-before-completion. No broad audit, UI, schema, infrastructure or performance-remediation task. PR310 remains OPEN/DRAFT/PAUSED at e961135199f292b8210884f07de3b616a670161a, untouched. PR362 remains closed unmerged. No liveDB/provider/market/settings/explicitdeployment action.
