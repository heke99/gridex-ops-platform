# E035B source qualification: application receipt boundary

2026-09-21. Baseline b6bb10328b173267882238804bbbeefd048040c4 (documentation-only PR365 over accepted runtime840720c7). Status SOURCE_AND_TEST_FIRST; no implementation or new GREEN claimed.

## Producer trace and finite finding

The E035B investigation followed actual inboundCases.ts parseInboundProdatBusinessData -> inboundCustomerCommand -> onboardCustomerGraph -> canonical_onboard_customer_graph -> gridex_onboard_customer_graph and customer_onboarding_applications/operations. Existing PRODAT object/register JSON is already persisted; a second diagnostic projection is not needed. Expected-structure authority still lacks a fully qualified environment/actor/valid-time/supersession/completeness contract. Current mutable point rows and a pending case are not that authority.

One narrower source-admission defect is directly visible in this path. CanonicalOnboardingSuccess requires application_id, and the SQL inserts an application and returns its id. For nonempty site/meter payloads it creates or selects those rows and returns their ids. Yet canonicalOnboarding.ts accepts a truthy success based only on customer_id/customer_number/operation_id. It accepts absent application_id, absent requested graph ids, malformed success discriminants and arbitrarily the first item of a multirow response. The single-object approveEdielInboundCase consumer can consequently proceed toward status applied without a complete application receipt. The multi-object path has additional receipt checks; those are retained, not called broken.

This is a lower client/consumer contract defect under malformed or version-skewed RPC output, NOT evidence that the current SQL produces malformed output, that an external actor can inject it, or that the database did not commit. Client rejection after an RPC cannot roll back a committed transaction. Existing idempotency and caller retry/error behavior remain important.

## Authority inspected

- lib/customers/canonicalOnboarding.ts: CanonicalOnboardingSuccess and onboardCustomerGraph response validation.
- lib/ediel/inboundCases.ts: inboundCustomerCommand, single-object approveEdielInboundCase result use, ObjectApplication receipt checks.
- supabase/migrations/20260720110000_canonical_customer_onboarding_transaction.sql: applications/operations schema; nonempty object site/meter branches; unconditional application insert and success return including application_id; idempotent operation result.
- supabase/migrations/20260831095000_admin_signed_contract_import_canonicalization.sql: current public wrapper returns the underlying transaction result; its admin-only contract adjustment does not change Ediel receipt shape.

This contract is the repository's own RPC return contract, not a new national E61/E62 rule. No outside-source or physical database verification is claimed by code inspection.

## Proposed bounded correction

Only for channel ediel_inbound, reject ambiguous multirow RPC responses (preserve the existing one-row compatibility), require exact boolean ok/code pairing (true/customer_onboarding_committed or false/ambiguous_customer_match), and require nonblank string application_id on success. Require site_id and metering_point_id only when the corresponding command payload is a nonempty object, matching the inspected SQL branches. Preserve current customer/operation checks, tenant/actor validation, valid ambiguity, original returned values and historical correlation on idempotent replay. Do not enforce new UUID syntax or equality to a fresh correlation id. Other intake channels are unchanged.

Errors remain CanonicalOnboardingError with current correlation: invalid shape/discriminants use canonical_onboarding_invalid_response; incomplete successful identity uses canonical_onboarding_incomplete_response. No automatic compensating writes, extra DB reads, retries, source snapshots, national ACKs or peer errors. A nonblank receipt is necessary, not sufficient, for qualified dated expected structure; it does not prove immutability, actor authority, semantic equality or completeness.

## Tests and delivery

New tests call the existing real onboardCustomerGraph with only the external RPC mocked. Missing application/requested graph ids and malformed/multirow success must fail at the actual service, while valid object/single-row results, ambiguity, customer-only/empty optional payloads, one-sided graph requests, non-Ediel calls, tenant/actor holds, RPC errors and replay correlation remain compatible. Publish these before implementation and observe meaningful behavioral RED, not import failure. Preserve every pre-existing test/expectation. Independent source/design/oracle approval precedes the finite fix. Then unchanged exact-head ordinary CI and final independent review, expected-head guarded merge, actual-main73/73+allOPS and evidence receipt.

## Routing and remaining scope

Activated: executing-plans, TDD, direct false-positive/root-cause tracing, bounded source-to-code comparison, differential/independent review and verification-before-completion. No claim of executing unavailable slash-command/subagent scripts; the repository review channel supplies independent adjudication. Conditional: systematic-debugging on actual failures, finishing-a-development-branch after acceptance. Skip UI/performance/infrastructure/DB-schema/security-scanner campaigns: no relevant code or threat-model change; this is not a repository-wide audit. SQL was read for the return contract only, not applied or certified here.

PR365 publication confirmation belongs in PR365, not another receipt-only loop. Preserve accepted PR361/363/364 and D110/110+10/10. After this finite receipt repair, E035B still needs real independent dated structure and loader/semantic admission; then source-qualified E61/E62 and guide/ACK/persistence integration, remaining F3 and later masterplan work. FullE035/F3/masterplan NOT_COMPLETE. PR310 stays paused at e961135199f292b8210884f07de3b616a670161a; no writes/imports/live operations.
