# Canonical supplier-switch source handoff

Status: actual producer 1 PASS / 2 FAIL RED, followed by 3/3 GREEN after
the authorized narrow Z03 source handoff correction. Full native business
fixture remains OPEN.

## Actual functional RED

The new pure test
`__tests__/supplier-switch-canonical-source-handoff-20261001.test.ts` invokes
the actual exported `buildProdatZ03FromSwitch`. The actual renderer,
source-controlled version selection, envelope codec and payload preflight
run. A Proxy at the imported database boundary rejects any attempted I/O.
No Auth, SQL, role, privilege, received source, dispatch, Storage or provider
exercise occurs; no accepted switch receipt is fabricated.

After completing the synthetic business inputs required by the real renderer
(including independent address/invoice selections), the actual two-case run
returned one PASS and one FAIL. A further actual request-without-operation
control expanded the current suite to one PASS and two FAIL from three
cases. The control proves that the actual Z03 draft
preserves the exact request/customer/site/point/grid, technical party IDs and
future effective date. The failed assertion shows that a request with a
stored operation UUID produces no `sourceOperationId`,
`parsedPayload.operation_id` or `parsedPayload.operationId`.
The request-only case likewise produces no source-operation identity derived
from its actual request ID.

`lib/ediel/core/kernel.ts` reads precisely these three fields and rejects a
missing source operation before finalization. This is a functional source
handoff defect. The kernel exception itself was read, not invoked by this
three-case suite. Earlier exploratory fixture-precondition failures are not
counted as the target RED.

Evidence: `/tmp/gridex-supplier-switch-source-handoff-red.log`. Its Vitest
final start `07:00:04` is runner-local Europe/Berlin UTC+02, corresponding to
`05:00:04Z`; it is not an independently captured absolute UTC start. A separate
`date -u` after that run returned `2026-10-01T05:00:21Z`.

The narrow producer correction makes the real Z03 draft carry the current
stored switch operation when present, and an explicitly typed reference to
the actual switch request when no operation is stored. Neither value comes
from a front-end correlation hint or a fixture-repaired dispatch record.
Both the current canonical schema and generated database types declare
`supplier_switch_requests.operation_id` nullable. Only the Z03 return branch
adds `sourceOperationId`; all existing payload, policy, route and resource
logic is retained. This field is lineage, not a fabricated command receipt.

The actual GREEN command used the root-approved scratch Vitest config with
the pinned Next `server-only/empty.js` test alias. All three tests passed;
log: `/tmp/gridex-supplier-switch-source-handoff-green.log`. Vitest start
`07:05:38` is runner-local UTC+02 (`05:05:38Z` by explicit conversion);
the independent `date -u` after the run returned `2026-10-01T05:05:55Z`.
This is pure/local business verification and does not qualify native
Storage, send, current receive, switch acceptance or the whole 47-case suite.
Scoped ESLint passed with zero errors and the nine existing unused-helper
warnings in `compatAdapter.ts`; the new test had no warning. `git diff
--check` passed. No broad type or native run is attributed to this packet.

Superseding compiler receipt: after the earlier producer3 capture, an actual
independent scoped compiler found TS2339 because the manual
`lib/operations/types.ts` `SupplierSwitchRequestRow` omitted `operation_id`.
The persisted column and generated schema existed, but that custom type did
not expose it. Root authorized only `operation_id?: string | null` in that
manual Row. `getSupplierSwitchRequestById` actually SELECTs `*`; generated
database types were not edited. The subsequent actual producer scope compiler
passed using `/tmp/gridex-supplier-switch-producer-tsconfig.json` and Node22
4GiB. This correction supersedes metadata of the earlier source3 receipt;
the original captured source3 blobs remain historical and unchanged there.

## Additional source dependencies (static only)

The current `createSupplierSwitchRequest` insert stores the exact contract,
site/point/grid IDs and external document reference, but not a current grid
Ediel identity or LI reference. Current `prepareAndQueueProdatSwitch` links
the actual outgoing message row using `linkEdielMessage`; that link does not
write the switch's `outbound_z03_message_id`. The inspected current table
triggers materialize variant/confirmation/readiness, not these source links.
The old foundation's one-time RFF backfill is not a current producer.

The new inbound atomic owner requires the actual switch's saved grid Ediel
identity, exact LI and originating message. A legitimate fixture must expose
the producer handoff and use its actual returned tuple; it must not seed
these missing producer projections to manufacture a successful journey.
These additional dependencies have not yet been reproduced in an actual
exported producer run and remain OPEN.

## Delegated legal and physical parties

The repository's normative acceptance contract,
`docs/ediel/masterplan-v2/annex/D_Acceptanskontrakt.md`, SC-009, explicitly
uses technical `InterchangePartyId82150` and legal `legalPartyId62110`. It
requires preserved identities and checked delegation and prohibits requiring
the two identities always to be equal. The source annotation in
`lib/ediel/prodat/prodatPartyFields.ts` cites P26.A r3 pp45–46 and79–83:
UNB is the technical route and NAD FR/DO are legal parties.

The existing legitimate delegated fixture has a technical receiving address
different from its legal tenant NAD+DO, backed by the current tenant's
transport-agent relation. Collapsing these IDs in a fixture would erase the
original acceptance condition. A real canonical producer's returned tuple
must instead be preserved and reported.

Current inbound acceptance checks reverse the sealed originating UNB and
also compare inbound NAD+DO to the originating UNB sender. That second
comparison conflates physical and legal identity when the actual origin
uses a delegated address. This is a static normative conflict, not an
executed native delegated acceptance proof.

Root authorized the following separate minimal forward; preparation is in
progress, and no delegation SQL/core/native result is inferred from the
Z03 producer's three pure cases:

1. Parse the exact immutable, dispatch-witness-bound originating wire using
   the existing private lexer. Require exactly one header NAD+FR and one
   header NAD+DO with the canonical legal-party agency/qualifier and preserve
   their complete identity tuples.
2. Match inbound legal NAD+DO to outbound legal NAD+FR and inbound legal
   NAD+FR to outbound legal NAD+DO. Keep exact reversed UNB identity tuples
   as the independent physical correlation requirement.
3. Recheck the current canonical tenant legal actor and each active explicit
   transport delegation when a physical address differs. Bind the same
   company, environment, current resource graph, original bytes/hash and
   existing dispatch/receive receipts before first effect and replay.
4. Change only this legal/physical binding in a new forward. Preserve current
   signatures/OIDs/owner/ACL/search path, receive-capture authority and
   dispatch witness. No grants, historical backfill, fabricated receipt,
   terminal-state expansion or ordinary-user exercise is proposed.

Proposed bounded business core cases: equal-party acceptance; distinct
technical/legal acceptance with the current explicit relation; wrong legal
NAD denied; current missing/revoked relation held; exact permanent replay
with current resource tuple; last-intent fault with complete rollback. Core
would remain PostgreSQL-core only; actual canonical production preparation,
worker/transport and enabled receive owners require their separate genuine
native run. None of these new core cases has run yet.

## Scope boundary

Root captured the earlier three-path physical-service-receive/full-rollback
fixture delta as a separate immutable eighth-candidate snapshot. Its exact
native/helper/report bytes and its honest zero-native label are preserved in
that snapshot. Continuing source/builder changes belong to the next packet.
The deeper older general-PRODAT ordinary-user/privilege/Auth exercise remains
BLOCKED_AUTO_REVIEW / NOT_EXECUTED and is neither repeated nor circumvented
by these pure business tests and read-only design findings.
