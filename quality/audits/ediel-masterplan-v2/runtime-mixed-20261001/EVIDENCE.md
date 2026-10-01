# Mixed PRODAT own-object implementation evidence

Base: `852b03dc`; isolated branch `codex/ediel-mixed-20261001`. Original recovery runtime snapshot files `inboundProcessing.ts` and `orchestrator.ts` were preserved before adding this implementation. Normal native fixture producer commits: `0ea080c5`, `d845c169`.

The actual original mixed fixture has an unavailable sibling full guide. The old BGM34 omits that sibling outcome; the real canonical ACK guide emits `ACK_PRODAT_OBJECT_OUTCOME_MISSING`. The renderer now rejects that incomplete response. No sibling success is added to this fixture.

A distinct complete own-field fixture reaches `['rejected','accepted']` through the real canonical engine and full guide projection. Native positive processing requires the protected full-object facet, physical first LIN/agency/own LI, current original/source rule/legal context, actual sent own Z03, actor/membership/permission and exact signed own contract/customer/site/point. It does not replace the original with a synthetic single-object message.

Own market effects, normal confirmations, exact source-transition audit, immutable mixed outcomes and private reply outbox are one PostgreSQL transaction. Positive ERC100 requires that actual own confirmation. The private reader revalidates current source/actor evidence. The consumer requires a real BGM34 mixed ACK passing the native shared guide and a real public dispatch outbox. A whole-source positive ACK on rejected PRODAT is forbidden. An identical fresh primary facet can revalidate the historical committed result; a missing or changed facet cannot.

## Executed evidence

- Seven focused mixed full-guide/renderer regressions passed; original incomplete renderer case was red before the fix.
- Four focused Vitest files: 62/62 passed (mixed object outcomes, received source validation, register evidence, APERAK label wire).
- Complete new forward migration loaded in PGlite: 48 mechanical checks passed. Checks include source/tenant/actor/membership revocation, exact physical facet shape, forbidden sibling effects, immutable receipt/reply outbox/consumption, final-outbox failure rolling back prior mutations/audit, complete own ACK versus forbidden whole-source success, real private reader/consumer, current-facet replacement and bounds. These are declared synthetic issuer/route/canonical/transport fixture facts; this is NOT authentic native acceptance evidence.
- Changed new implementation/helper/native-test ESLint: zero errors. The preserved inbound snapshot retains its preexisting unused facilityRecognition warning.
- Isolated app/targeted TypeScript checks remain blocked by four unrelated integration dependencies: kernel companyId duplicated twice, shared OutboundRequestRow.environment, and missing acceptedProjectionRepair module imported by the preserved orchestrator. No new mixed/helper diagnostic.

## Candidate-only native evidence, not yet executed locally

`scripts/ediel-prodat-mixed-native.test.ts` has three native HTTP/database cases: actual signed contract/publication/archive/POA/originated and provider-accepted Z03; complete own mixed ACK/actual outbox consumption with parallel retry and membership revocation; unsent-original hold; and actual final-outbox fault rollback/prohibited ACK and market effects. The shared helper creates source proofs through actual publication/signature/archive/Z03/transport owners. Only external SMTP is replaced. Customer/POA acceptance remains explicit test-only synthetic evidence. No local Docker/psql/Supabase service is available. Ordinary authentic replay/HTTP suite on the integrated frozen candidate must produce its own actual verdict.

No F0–F7/masterplan approval is asserted. No main merge, live migration, customer communication or Ediel/counterparty/TGT/AGT traffic occurred.

## Older isolated baseline failures

The preexisting fixtures do not provide current protected source/admission/RBAC owner ports in this isolated 852b + preserved snapshot tree. The recovery integration branch has modern replacements; these titles are retained so the final integrated candidate can verify them explicitly. They are not waived.

### __tests__/ediel-prodat-z04-persisted-ack.test.ts

- qualifies missing field 202 from the physical original for a whole-message response
- qualifies unlisted field 202 from the physical original for a whole-message response
- rejects supplied forbidden C002 metadata in field 202 as a whole-message ACK before business effects
- accepts an ordinary field 202 code and holds a malformed header when the tenant has no ACK route
- rejects invalid optional header 204 as one routed whole-message ACK with stable retry and no business effect
- keeps optional missing 204 and documented 9/5 outside header rejection, and holds no-route invalid 204
- stores one routed CONTRL and one first-object negative APERAK without a sibling success or business effect
- reuses both persisted ACKs and their unique outbox locks on the same original retry
- persists whole-message P-17 rejection as BGM27, with original correlation and no case effect
- holds both ACKs when the tenant has no qualified outbound route
- rejects missing required header 313 as a whole message with a routed, retry-stable ACK and no business effects
- rejects invalid required header 313 as a whole message with a routed, retry-stable ACK and no business effects
- rejects lowercase required header 313 as a whole message with a routed, retry-stable ACK and no business effects
- holds a required 313 rejection without source-bound evidence or a qualified route
- persists one whole-message rejection for missing required header 205, correlated without business effects, and reuses it on retry
- rejects a malformed supplied header date as ERC42/205 for the whole P message before business writes
- rejects a duplicate header date as one whole message before business writes
- rejects missing required header offset 206 as one whole P message before business writes
- rejects invalid required header offset 206 as one whole P message before business writes
- holds a header rejection without a qualified tenant ACK route and never enters business processing

### __tests__/ediel-source-owner-runtime.test.ts

- uses a real fully accepted canonical register source as the positive oracle
- composes the real canonical, tenant, selected-party and committed Z04 owners, then witnesses separately
- a caller-provided commit-shaped object cannot impersonate the successful business path
- without the successful write handoff, preexisting accepted rows and status reports are insufficient
- does not approve when actual tenant_ediel_profiles evidence is unavailable
- does not approve when actual tenant_actor_identifiers evidence is unavailable
- does not approve when actual tenant_actor_roles evidence is unavailable
- does not approve when actual metering_points evidence is unavailable
- does not approve when actual customer_sites evidence is unavailable
- does not approve when actual grid_owners evidence is unavailable
- truncated tenant reads never become accepted
- withholds mismatched grid_owners.ediel_id
- withholds mismatched grid_owners.environment
- withholds mismatched grid_owners.is_active
- withholds mismatched tenant_actor_identifiers.identifier_value
- withholds mismatched tenant_actor_roles.role_code
- withholds mismatched metering_points.meter_point_id
- withholds mismatched metering_points.site_id
- withholds mismatched customer_sites.grid_owner_id
- withholds mismatched customer_supply_periods.start_date
- rejects a foreign-company gridex_record_source_object_decisions_v1 receipt
- rejects a foreign-company gridex_witness_source_objects_v1 receipt
- binds the committed message to the immutable original rather than its mutable report
- a failed supply write cannot create any accepted assessment
- retires the in-process capability after callback completion
- timeline consumes actual composed owners without minting a new capability: none
- timeline consumes actual composed owners without minting a new capability: foreign-business
- timeline consumes actual composed owners without minting a new capability: foreign-party
- timeline consumes actual composed owners without minting a new capability: missing-owner

Migration SHA-256: `14cbfc9d62b94e441b396f76d5b39a1357391e07aceaf05c6f069cab22dd3ab5`.
