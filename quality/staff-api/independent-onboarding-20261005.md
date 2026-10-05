# Independent staff onboarding — source qualification

The separately versioned `2026-10-05.1` acceptance contract is implemented and
bounded source review found no remaining evidenced critical/important issue.
The frozen Staff API `2026-10-04.1` is unchanged. Targeted API tests: **84 PASS**;
app types, scoped zero-warning lint, tenant ratchet and complete API docs PASS.
The independent portal separately passes 56 tests, 17 Chromium checks and its
production webpack build. No production data or configuration was changed.

Current source creates invitations only for a registered same-company client
origin, retains the existing leased delivery worker, refuses staff invitations
through legacy OPS acceptance, and verifies real Prod Auth plus a fresh signed
staff proof before explicit own-portal acceptance. Native service-only authority
is rechecked under company/client/provider/Auth/invitation locks before the
unchanged canonical acceptance. The profile status remains a snapshot check;
supported same-company disable shares the company lock. No global profile
writer serialization is claimed. Browser fields confer no company/role access.

The exact machine-auth forward adds this one route and explicit users.write
scope while preserving the original credential/network/rate logic. The
predecessor function body hash must match. Authenticated request credentials
provide the transient hash snapshot; no stored credential hash is exposed in
the frozen authentication RPC or persisted into canonical receipts.

**Authentic generated artifacts are imported; native acceptance is pending.**
Capture-only workflow `37299065849` succeeded on exact source `46ecb047e`.
Artifact `11341610088` matches its published ZIP digest, exact four members,
all eight captured replay inputs and the frozen migration hash. Types, schema
and fingerprint were copied byte for byte; the complete previous manifest and
capture lineage remain preserved. Only the new wrapper type, intended function
bodies and wrapper function grants differ; all nonfunction fingerprint sections
are unchanged. The aggregate migration check now passes with 1067 files.
Final native clean/upgrade/schema CI still must pass. Embedded PGlite and this
capture-only job do not establish native acceptance, RLS or concurrency proof.

The original source pilot correctly failed its generated-type tail check and
the upgrade comparison at the newly added function. It also exposed two test
mock typing errors. Those declarations now use the exact port function types;
full test TypeScript and the 28 affected acceptance tests pass. Frozen SQL and
runtime code are unchanged. The original pilot receipts remain historical;
the generated import and test typing delta have separate evidence.

**Named gridex-prod activation is blocked.** Project `ayiuxjlfazkjmmtlvhsl`
lacks Staff/canonical/runtime prerequisites and a verified Gridex tenant/admin.
Historical OPS acceptance targeted `piidsfebjqjmnepdpnas` and remains separately
recorded. Never copy its Gridex UUID/users or replay all historical migrations
into the different Prod baseline. Supabase Auth must independently allow the
registered own callback; real invite/OTP delivery can otherwise fall back to
its Site URL. Native dependency qualification, verified company/admin,
dedicated active client/provider and actual own-portal hosted acceptance must
precede any support-domain reassignment.

Frozen authored source/log bindings and bounded independent review are retained
in [the evidence manifest](independent-onboarding-evidence-20261005/manifest.json).
Implementation and activation instructions: [onboarding guide](../../docs/staff-api/independent-onboarding.md).
