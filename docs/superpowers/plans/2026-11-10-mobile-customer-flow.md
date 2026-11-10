# Mobile customer flow implementation plan

Goal: prove two isolated customers read only their own OPS contracts, sites and invoices through Gridex Web, then verify Android against that same integration.

Architecture: disposable Supabase clean replay; real Auth users; ordinary scoped API credential, completed installation receipt and signed customer assertions. Fixtures remain on loopback and are destroyed with the stack. Pin both repositories by SHA in CI.

Skill routing: using-superpowers (routing), writing-plans/executing-plans (sequence), full-e2e-verification (HTTP and emulator evidence), Supabase (Auth/RLS), verification-before-completion (exact evidence). Conditional: systematic-debugging/TDD for confirmed defects, requesting-code-review for final independent reviews. Skip UI design, performance, Ediel market producers and external provider scans: no corresponding change or live external delivery.

- [ ] Fix confirmed mobile invoice denial mapping with a regression proving sanitized 404 and private/no-store; retain sanitized 503 on other failures.
- [ ] Add loopback-only fixture script creating company, two customer resource graphs, verified Auth users, protected Web profiles, OPS portal identities, scoped API client/receipt and RSA assertion public key. Store generated secrets in runner temporary files with mode 0600.
- [ ] Wire fixture setup and HTTP acceptance into isolated replay job, preserving replay cleanup and stopping owned servers. Assert exact references for A/B, own/foreign invoice details, unlinked, missing/invalid session, override rejection, controlled OPS failure and no-store headers.
- [ ] Run full acceptance on one OPS commit and pinned Web commit; diagnose failures and rerun full suite. Record run URL and both SHAs.
- [ ] Run mobile typecheck/account/lifecycle tests; build isolated test APK; exercise A/logout/B, network interruption, session expiry and background/resume in emulator. Verify release signature/package/version/production settings only with actual release configuration.
- [ ] Record explicit PASS/FAIL/BLOCKED evidence, cleanup and next action; obtain two independent final reviews before completion.

Scope excludes production data, production deployment and merging. Package 1 acceptance is the user's explicit HTTP matrix; broader repository release gates do not establish Android release readiness.
