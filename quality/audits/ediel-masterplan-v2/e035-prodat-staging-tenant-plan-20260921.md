# E035 source-path prerequisite: unresolved PRODAT staging tenant boundary

Base: accepted PR363/main 34eb943046ab87761b071bc508ea48b7af70eea9. Status: TEST_FIRST_REVIEW_CANDIDATE. No production code changed in this test-first revision.

## Resume and qualification

PR361 and PR363 are already merged; do not repeat their observation projection/handoff. PR363 actual-main full35588522782/job106297385609 and OPS35588522787 succeeded; downloaded artifact10634000893 was independently inspected for73/73, all rows/JUnit, commit34eb and5102/5102 unit cases. Its durable receipt is included with this delivery.

Read-only B reconnaissance5759151611 correctly distinguishes wire data/caller expectations from a qualified dated inventory, but its proposal for another PRODAT diagnostic projection is NOT adopted: actual inboundCases.ts already preserves parsed objects/registers and stores parsed_metering_point/proposed_action in ediel_inbound_cases. That persistence is not a valid-time, completeness or accepted-structure certificate. No new parallel parser or duplicate diagnostic field is needed.

Inspection of this actual producer exposes a narrower existing boundary defect. maybeFindExistingCustomer uses service-role masterdata queries and adds company_id filters only if the optional companyId is truthy. createOrUpdateInboundProdatCase explicitly supports unresolved null-company staging and passes that optional value to the helper. A direct unresolved invocation can therefore select a foreign point/site/customer and copy those links/confidence into an unbound pending case and its event.

Severity: medium defense-in-depth / unsafe exported service contract, pending behavioral reproduction. IMPORTANT mitigation: the normal processInboundEdielMessage caller resolves the tenant and returns before business processing when routing is unresolved (inboundProcessing.ts around795–818). This work does NOT assert a demonstrated live-mail exploit or bypass that outer gate. The lower staging function's documented null-company path must itself avoid global masterdata lookups, especially before reuse as a future received-structure producer.

## Finite behavior and fix

- Preserve parsing, actual wire source selection and register-chain validation before I/O.
- Normalize only the internal company scope at the staging boundary (blank/absent -> null); do not normalize external object identity or infer a tenant from parsed_payload.
- When no company is resolved, return an empty match with confidence0 BEFORE any masterdata query. Continue to permit null-company pending staging, with raw-derived diagnostics and no foreign links.
- Once a nonempty company is present, every point/site/org/person lookup must include its company_id filter unconditionally. Retain point-first/fallback matching, errors, existing-case ownership checks, null-scoped updates, optimistic state/version conditions and applied/reviewed-case behavior.
- No change to tenant resolution, source-message ownership authorization, case listing APIs, actor scope, RLS/schema, national E61/E62, expected inventory, guide/ACK/disposition, transport or live operations. Existing caller-owned EdielMessageRow remains the source; this is not a new raw-message authorization mechanism.

## Test-first oracle and acceptance

51 new cases call the actual exported staging function and actual PRODAT parser across three existing service alphabets. Only external Supabase/event/link I/O is mocked. The database mock deliberately returns a foreign row for an unscoped lookup instead of hiding the defect behind an empty result. Literal expected IDs and query filters distinguish companies with the same external identity. Cover null/undefined/empty/blank, stale payload tenant claims, org/person fallbacks, two real company scopes, internal DB failure, multi-object behavior, malformed register/wire gates, null-scoped pending updates and foreign-case mismatch.

Observe ordinary behavioral RED and independently review this exact bounded design/oracle before implementing the minimum fix. Preserve all existing5102 tests and the newly published assertions. Require exact final-head ordinary CI and completed independent TASK/SPEC,QUALITY,TENANT-BOUNDARY,WHOLE-PR review; expected-head guarded merge; then fresh actual-main73/73+allOPS and inspected artifact receipt. Mocked database arguments are not physical live commits. No local repository suite run is claimed.

## Skill routing and remaining scope

Active: retained executing-plan workflow, current-code/false-positive qualification, security/tenant-boundary review, test-driven-development, differential review and verification-before-completion. Independent reviewer checks scope and concrete findings. Conditional: systematic-debugging on actual failures, receiving-review, finishing branch on green. This is not a repository-wide audit; UI, schema migration, infrastructure, performance and source-grammar redesign triggers are absent.

After this bounded prerequisite: qualify a genuine independent received dated-structure producer/loader with tenant/environment/actor, exact object+agency, source message/line, valid-time, accepted disposition/supersession/completeness; then source-qualified E61/E62 and operational outcomes. No observed-count or local-absence inference. FullE035/F3/masterplan NOT_COMPLETE; D110/110+parents10/10 retained. PR310 stays OPEN/DRAFT/PAUSED e961135199f292b8210884f07de3b616a670161a, untouched. PR362 closed unmerged.
