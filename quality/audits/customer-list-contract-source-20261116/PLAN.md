# Customer-list schema contract repair

Goal: restore customer lists against the committed schema, deriving displayed/filterable stored contract preferences from their owning customer_contracts rows. No schema migration, auth change or effective billing-policy change. User-authorized reversible scoped remediation; no extra generic approval gate.

Custody: receipt39e46e0ff885ee4f4126940cf3b98c0a382ec1bd, seven exact files; root sole writer, reviewers read-only. Clean basec94f9cb2, branchcodex/simulation-customer-list; separate managed worktree preserves simulation audit.

Design: removing two invalid customer columns alone would incorrectly erase semantics; adding customer columns would duplicate canonical contract data. Use contract-owned summaries grouped by real company/customer, deterministic complete bounded reads, explicit unknown/mixed/unavailable, and fail closed for contract-dependent filters. This is the minimal coherent preserved a9b5+1d2 source design.

- [x] First execute actual paged/filtered/staff list loader against a schema-aware SDK fixture; reproduce missing customer projection42703 before product edits. Keep real tenantDb/tenantSelect; mock only external service.
- [x] Port only reviewed product/test hunks froma9b5+1d2; preserve staff DTO, page guards and unrelated1053 changes. No historical audit patch adoption.
- [x] Run summary/pagination and actual list boundary regressions, including foreign tenant/customer responses and unavailable filtered reads.
- [x] Verify downstream types, scoped lint, relevant customer/staff/operations tests and required local gates; investigate failures, never weaken gates.
- [ ] Freeze exact source hashes/commit, obtain two independent final reviewers, publish scoped branch/PR and track mandatory checks. Serial owner retains main merge.

Skills: systematic-debugging (source/schema rootcause), brainstorming (design above under existing autonomous mandate), writing-plans (bounded sequence), test-driven-development (actual listREDbeforefix), code-security/supabase (company-bound queries), verification-before-completion/requesting-code-review (exact results and two final reviews). Installed Next16 docs fetching-data guide read; no new NextAPI/caching behavior.
