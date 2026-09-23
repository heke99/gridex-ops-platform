# E035 live-owner runtime continuation — 2026-09-22

PARTIAL / NOT MERGE-READY. Existing PR370 on codex/e035-durable-source-ledger-20260922.
The containing Git commit/live PR identifies this candidate. Baseline d7fb49fde3dae153693acae1cefa33aeef45ad4f
already passed ordinary OPS35758893367 (all three jobs); do not repeat its recovery.
Accepted main/PR369 remains eb2b8693130af8fa7976a93891b95973bc473b50.

Substantive new runtime code: fresh canonical receipt handoff; exact-count bounded tenant
identity reads; selected facility/grid-owner legal-party binding; a callback from the actual
successful Z04 switch-confirmation AND supply-period writes; immutable owner composition
plus a separate committed-availability RPC. The real inbound processor invokes these paths.
All physical objects remain represented. No callback, copied receipts/status JSON, incomplete
reads, unmatched namespaces, or missing owners can create accepted evidence. Diagnostic
failures retain original business and ACK behavior. Supported approval is the source-bound
Z04 legacy switch/supply path, not arbitrary Z06/Z10 review cases or SMTP authentication.

New source is newly implemented here, not a recovery of the previously reported5758/347
continuation (still NOT RECOVERED / NOT REVERIFIED). Existing original source/discovery,
canonical register facets, database owner/snapshot contracts and regression assertions remain.
The authentic new forward20260922175540_ediel_source_owner_timezone.sql was CLI-created in
run35763799597, artifact10710533967. No existing migration was edited.

Test-first evidence: initial business/count-owner tests9FAIL/3PASS, then34PASS including
retained identity cases; composition21FAIL/6PASS then27PASS; actual processor missing-hook
assertions2FAIL/1PASS then3PASS. These unit tests replace only external IO. The separate
native suite uses actual Supabase HTTP, real canonical registry, real business writes and
PostgreSQL RPCs, and must pass with repeated generated contracts before acceptance.
Native qualification, current-head ordinary CI and independent review are tracked in PR370
terminal receipts. Do not infer PASS from this implementation checkpoint or baseline CI.

Full E035/F3/masterplan and temporal comparison remain INCOMPLETE. D110/110+parents10/10 retained.
PR310 OPEN/DRAFT/PAUSED at e961135199f292b8210884f07de3b616a670161a, excluded and untouched.
No hosted database, deployment, provider/market change or external message. Known existing
public.gridex_grid_owner_name_key mutable-search_path advisor remains disclosed.

## Skill routing and trust boundaries

Used existing repo using-superpowers/executing-plans, test-driven-development,
systematic-debugging, verification-before-completion and code-review workflows;
Supabase/PostgreSQL security and multitenant invariants for real owner reads, RPCs
and immutable migration verification. Existing Next app behavior/ACK unchanged;
no UI/design/deployment/hosted-administration skill is triggered. Independent review
is requested through the existing PR reviewer, never asserted by the implementer.

The former architecture owner map remains useful as history. Canonical semantics
come from resolveCanonicalRuntimeDecisionWithRegistry/validateProdatRegisterPolicy;
legal receiver/roles/delegation come from resolveCanonicalTenantEdielIdentity with
an opt-in complete bounded read contract; selected facility sender identity comes
from actual scoped point/site rows and the existing getGridOwner projection. Existing
structural parser helpers preserve FR/DO qualifier/agency and complete UNB components.
No routing success or pre-populated company ID stands in for legal-party evidence.

Z04 business approval is a same-invocation handoff after both actual writes. A fresh
canonical source seed is cloned before its RPC; copied/serialized receipts cannot
rehydrate it. The separate composition binds every physical tuple to original source
bytes/hash/receipt, canonical facts hash and owner scope. The existing SQL append
rechecks the live owner sets in its single SELECT snapshot, including actual switch/
supply/source/customer/site/point relations. A subsequent RPC must observe the committed
assessment. Neither a bare receipt nor the presence of accepted rows is application
authority. No market supersession is inferred from assessment predecessors.

Native suite scripts/ediel-source-owner-native.test.ts uses actual local HTTP/API keys
read only from a runner temporary CLI status file and never uploaded. Actual application
canonical registry, business writes, owner reads and both RPCs are unmocked. Unrelated
notification/event sinks alone are withheld. It checks committed vs unavailable evidence,
actual last-moment row drift, real second-write failure, foreign company rejection and
caller timezones. Native and ordinary CI artifacts are necessary evidence, not this text.

## Retained limits

Z06/Z10 pending review/safe-apply is not complete business acceptance. Agency89, multi-
message source cases, delegated senders and nonempty subaddresses stay unavailable for
this concrete legacy graph owner. Such a source can still be observed/discovered. No
historical authority before the recorded decision/witness is inferred from current rows.
E61/E62 must not yet consume any accepted row as a current baseline without dated
completeness, correction closure and independently reviewed temporal selection.

## Native-discovered namespace correction

Native run35767048661 assembled the exact input tree5672e0f3 and passed the
retained71 owner/61 register SQL and concurrency suites, but the real HTTP
canonical assessment path returned unconfirmed. The actual registry intentionally
returns a semantic source profileKey; SQL correctly requires the distinct stable
activation-row profile_key. Preserve both namespaces: databaseProfileKey now
travels from that same real registry read through the runtime evidence, and only
that technical key enters the existing closed SQL facts. Normative profileKey,
policy/ACK decisions and the SQL rule-pack ID/hash/profile-key check are unchanged.

Test-first namespace correction reproduced6 assertion failures/56 retained passes;
then65/65 focused tests passed. The native suite must additionally demonstrate
that passing the real semantic key is rejected by SQL and the genuine activation
key is accepted. Its delegated transport fixtures now use unique synthetic Ediel
identifiers rather than colliding under the real platform identifier constraint.
Those fixture corrections do not alter production grants or acceptance rules.
