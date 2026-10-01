# Current legal and physical supplier-switch binding

Status: bounded PostgreSQL service/business core 9/9 PASS. Native delegation
and full source-owner47 qualification remain NOT_EXECUTED / OPEN. No ordinary
user, Auth, privilege, older general-PRODAT or provider exercise is included.

## Requirement and actual baseline

SC-009 in `docs/ediel/masterplan-v2/annex/D_Acceptanskontrakt.md` requires
technical InterchangePartyId82150 and legalPartyId62110 to remain distinct,
with checked current delegation. TEN-04 / IMP-02 forbid requiring identical
legal and physical parties. `lib/ediel/prodat/prodatPartyFields.ts` cites
P26.A r3 pp45–46 and79–83: UNB is technical; NAD FR/DO are legal parties.

The actual new atomic inbound owner previously required inbound NAD+DO to
equal the sealed originating UNB sender. The pure service/business core
loads the actual canonical table definitions, received-source owners and
atomic lifecycle SQL. It supplies isolated synthetic business rows, then
explicitly simulates the dispatcher UPDATE under service_role; this is not
native evidence for a genuine production send or dispatch witness.

The actual baseline six cases returned 1 PASS / 5 FAIL. Two failures are
independent functional RED: an exact delegated physical envelope82150 with
legal NAD12345 was rejected; an inbound legal NAD82150 incorrectly borrowed
the physical envelope and was accepted. The other three failing cases were
blocked at the first correlation precondition, so they are not claimed as
independent baseline expiry/revocation/rollback reproductions.
Log: `/tmp/gridex-inbound-legal-transport-red.log`.

## Narrow forward

Supabase CLI created
`20261001050658_inbound_switch_current_legal_transport_binding.sql`.
The forward replaces only the current private atomic function body. Every
catalog patch anchor must appear exactly once. The same signature/OID,
owner, ACL, configuration/search path, invoker behavior, volatility and
parallel setting are checked before and after replacement. No grants,
historical relabel/backfill, capture authority, immutable witness, source
eligibility, switch terminal state, activation or transport policy changes.
The earlier frozen11 migration bytes remain unchanged.

The exact immutable originating Z03 retains one header legal NAD+FR and
NAD+DO, with 160/SVK tuples. Received FR/DO must reverse those legal tuples.
The full reversed UNB tuples remain the separate physical requirement.
Current enabled electricity profile, unique supplier legal actor/Ediel ID,
current supplier market role and zero or exactly one current active explicit
transport-agent relation are read and locked before first effects or replay.
The relation's current unique verified platform Ediel identifier uses UTC
DATE and half-open validity. The existing grid physical=legal floor remains;
this does not expand supported delegated grid-sender semantics. A current
expiry during the final intent is held and rolls back the transaction.

## Actual bounded verification

Command:
`NODE_PATH=/tmp/ediel-service-check/node_modules node22 --test scripts/inbound-switch-legal-transport-20261001.postgres.test.cjs`.

Actual final9/9 PASS:

- Equal-party accepted effects and permanent replay.
- Distinct physical transport82150 / legal supplier12345 with current explicit relation.
- Wrong received legal NAD denied without effects.
- Revoked current relation denied before permanent replay.
- Half-open expired platform identifier denied before first effect.
- Last required intent fault rolls all declared business rows back; retry commits once.
- Current profile, supplier-role and unambiguous relation prerequisites remain required.
- Actual clock expiry during final intent rolls the complete transaction back.
- Actual clock expiry during the final permanent receipt INSERT rolls all effects back.

The earlier eight-case candidate checked before the final receipt INSERT.
Independent peer ops_ui reproduced a real service/business final-receipt
delay that expired the relation after that check and still returned accepted.
Our permanent ninth case reproduced the same actual8PASS/1FAIL RED, then
passed9/9 after adding the expiry guard after the last owned receipt INSERT,
before return. No source/policy/record clock or guard was disabled. The earlier
SQL453b76a5/core81f5f384/report013aeed2 receipt is superseded, known incomplete
and must not be published as the final owner. Original frozen11 remains unchanged.
Logs: `/tmp/gridex-inbound-legal-transport-receipt-red.log` and
`/tmp/gridex-inbound-legal-transport-receipt-green.log`. Counts refer only to
these exact service/business PostgreSQL-core cases; no full Auth/RLS,
Storage, message preparation, SMTP, different-switch concurrency or native
runtime result is inferred. No stale/caller verified field or ledger INSERT
establishes source authority. Whole receive/request preparation remains a
separate upstream transaction boundary. The committed-switch observer must
still emit only for a genuinely new committed switch/period effect; permanent
replay creates no new observer witness.

## Native and producer dependencies

The existing legitimate source-owner fixture's physical service receive
partial3 was captured separately in the eighth candidate. Its normal/structural
seed origins were explicitly not qualified, and its complete graph rollback
assertion deliberately cannot pass on an earlier precondition error.

A separate actual exported `prepareAndQueueEdielZ03` local-memory test now
reproduces missing durable request↔origin/LI/grid projections and a missing
canonical legal actor handoff to the renderer. Both must be repaired at the
real business producer before a genuine delegated prepare→worker→receive
native fixture can qualify this forward. A native test must preserve the
actual producer's returned tuple and current schedule, use only controlled
Nodemailer loopback transport, and retain MIME/S-MIME/Storage/readiness and
true service receive owners. No synthetic initially-sent row or fabricated
private dispatch/receive witness is an acceptable native substitute.

The deeper older general-PRODAT ordinary-role/Auth/privilege tests remain
BLOCKED_AUTO_REVIEW / NOT_EXECUTED. They are not repeated or circumvented.
