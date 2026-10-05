# SC-071: remaining producer boundary, not an implementation approval

Frozen SC071 runs an export job and grant revocation concurrently; current
version plus a transaction boundary must prevent unauthorized disclosure.
Frozen SC010 additionally requires active-at-enqueue, revoked-before-read/send,
then the actual job acquiring its lease. Both forbid stale cached authority.
Neither criterion is relaxed by the new native projection feedback job.

The extended read-only production search is saved in export-path-inventory.json
with ten exact current-main source hashes. The sole operative beneficiary
caller remains GET -> projectEdielSeriesToBeneficiary -> current public RPC.
Existing billing/invoice exports are company underlay/provider flows, customer
life-event export is source-approved masterdata, and customer-operation jobs
have fixed unrelated branches. The automation-lock primitive is available but
is neither a durable queued export nor a data-access authorization decision.
No reproduced leak or product defect is inferred from this missing producer.

The retained TEN/ESCO service source owner and SC010 owner must identify the
actual producer if it lives beyond these traced paths; otherwise assign one
first production integration, shared with SC010 rather than competing workers.
The coordinator keeps schema/manifest/fixture/generated/merge ownership.

The minimal agreed integration must make these boundaries concrete:

- Enqueue stores exact tenant, actor, grant/version, purpose, series, fields,
  interval and immutable source references; a saved page/allow decision is not
  execution authority. Grant activity at enqueue is witnessed by actual code.
- Claim has a durable job identity, current lease token/expiry and bounded
  recovery. Lease ownership and idempotence are rechecked at execution/commit.
  A generic mutex alone does not establish these job effects.
- Execution rereads current authority using the existing qualified source,
  assignment, grant, market permission, actor, field and period owners. It
  cannot refresh a stale captured grant version or silently select another grant.
- The actual disclosure/consumer commit must remain inside the rights
  serialization boundary. Calling a projection RPC and then sending cached
  page bytes after its transaction ended does not qualify that later send.
  The owner must identify whether disclosure is an atomic internal consumer
  commit or an external sink, and state its accepted serialization point.
- Derived data retain the E66 original/hash, DGI role, purpose and quality
  provenance. No full raw file, fabricated message, owner energy/ACK change,
  unauthorized receipt or unrelated-tenant write may stand in for distribution.

Required actual behavior proofs after producer assignment: revoke after
actual enqueue before actual lease; writer-first committed denial; writer-first
rollback preserving valid work; reader/disclosure-first followed by committed
revocation and refusal of later work; stale/expired lease, replay and wrong
beneficiary/object/purpose controls. Observe the real sink and persistent
receipts/state, separating legitimate revoke/version/history writes from
forbidden export effects. Reuse the current native fixture/locks and SC010570
caller receipt; do not invent issuer/legal authority or another DB harness.

Historical assignment question above is SUPERSEDED by the retained SC010
source owner's concrete claim5305992097869. That owner builds the sole first
production exporter with durable scope/version-only jobs, bounded rotating
leases, execution through the existing projection authority and an atomic
private internal result commit. No competing worker or validator is assigned.
The coordinator retains shared replay/schema/manifest/generated integration.

Current status: IMPLEMENTATION_PENDING. Exact producer commit, RPC/status
interface and coordinator schema admission must be published before the actual
SC071 parallel export/revoke tests can be qualified. Native projection feedback
remains independently executable; whole SC071 stays unapproved.
