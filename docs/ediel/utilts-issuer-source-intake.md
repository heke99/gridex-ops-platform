# UTILTS issuer source intake

This interface archives original material and requests native review. A received
artifact or a successful HTTP request does not establish issuer authority. The
native owner independently checks actual current company membership and explicit
permissions, separate review, protected source scope, time and configured policy.

The supported controlled policy creates **new closed synthetic TEST data**. It
does not establish market authority, activate production or qualify an earlier
issuer such as70007. General/production approval without established official
trust returns `held` with reason codes. No default permission grants or trust
keys are supplied by these endpoints.

## Two stages

First archive prospective issuer/mandate originals before matching source
capture. Under the closed TEST policy, `test_birth` also freezes the entire
issuing application inventory and its actual producer/source bindings. Separate
native review must establish that policy using actual protected private
cryptographic keys; caller flags, uploaded hashes and identity UUIDs do not
replace those keys or independent approval. An `actorUserId` inside the frozen
application inventory is an untrusted claim about an issuing application. It
never selects the authenticated submitting or reviewing actor.

Managed issuance uses the approved fresh epoch and application. `test_issue`
creates an actual server issuance ID, RFC Message-ID and exact full MIME before
APPEND. `test_replay` retains that same issuance/MIME; `test_correction` creates
a distinct issuance with a prior link. Delete/retention journal records preserve
identifier history. They do not erase original bytes or prove a legal right to
delete them. A separately reviewed checkpoint covers the complete frozen
application inventory and actual journal cutoff.

After actual physical reception and admission, archive `history` with the exact
epoch, source, current issuance and checkpoint IDs. Native review derives the
protected company/environment/source hash/admission namespace/version/epoch from
the actual source, RFC identity and full MIME. It cannot repair an earlier
namespace-NULL admission or use equal payload hashes to identify an issuance.
Earlier measurement periods are observation claims; birth, issuance, capture,
approval and checkpoint clocks are actual server events and are never backdated.

## Endpoints

`POST /api/ediel/utilts-issuer-sources` requires current own-company
`ediel.utilts_issuer_source.submit`. Its strict envelope is:

```text
{version:1,commandId:UUID,environment:"test"|"production",kind,body,originals}
```

Each kind has an exact body; unknown keys are rejected. The kinds are
`prospective`, `history`, `test_birth`, `test_issue`, `test_replay`,
`test_correction`, `test_delete`, `test_retention` and `test_checkpoint`.
Every `test_*` kind requires environment `test`. Original entries retain exact
canonical base64 bytes, MIME type, reference/version/URI and SHA256. The adapter
independently checks each supplied byte hash, required role set and aggregate
8MiB limit. URIs are reference text and are never fetched.

Prospective originals use roles `registry`, `legal_decision`,
`transport_mandate`. Birth uses `test_policy`, `test_mandate`,
`test_retention_decision`, `test_application_inventory`. Issue/correction require
one `payload` of type `application/edifact`. Retention requires
`test_retention_decision`; checkpoint requires `checkpoint_approval`.
History/replay/delete reference retained originals and accept an empty original
array. Other original roles allow JSON, plain text or PDF. Arbitrary additional
roles and secret key fields are rejected.

An archive receipt has status `archived` or `held`; a completed managed issuance
can return `issued` and exactly one verified `issued_mime` original. The adapter
checks actual returned MIME bytes/hash/length and its unique Message-ID against
the native issuance receipt before exposing those bytes to the caller. A
qualified producer must still independently verify and APPEND those exact bytes;
this API does not perform APPEND, intake, source adoption or business processing.

`GET /api/ediel/utilts-issuer-sources?artifactId=<UUID>` requires the same submit
permission and current selected company. It returns typed metadata only. Original
bytes, native opaque scope and cryptographic keys are not public metadata;
duplicate selectors and include-bytes/company overrides are rejected. Epoch-bound
metadata includes the immutable test birth clock, declared measurement usage
window, legal/transport composites, approved retention artifact, frozen
application inventory hash and server application bindings. These nonsecret
selectors let an authorized ordinary producer issue/checkpoint without SQL
discovery; they confer no production or general-market authority.

`POST /api/ediel/utilts-issuer-sources/<artifactId>/review` requires current
own-company `ediel.utilts_issuer_source.review`. A review command contains:

```text
{version:1,commandId:UUID,decision:"approve"|"hold"|"reject",reason,
 artifactSha256,scopeSha256}
```

The server supplies the authenticated actor and selected company; the artifact
is selected only by the path. Native review must be independent of the submitter
and issuing application actors and verify the unchanged original/scope hashes.
No reviewer identity, approval timestamp, namespace epoch, signature-valid flag
or policy-approved boolean is accepted from the request.

The same endpoint accepts `decision:"revoke"` with version/command/environment,
target kind and ID, original withdrawal decision and reason. It invokes the
separate native revoke RPC, removing the HTTP dispatch selector and supplying
the authoritative path artifact ID. Native revocation uses the actual current
server time, preserves originals and affects future eligibility. It does not
delete or rewrite prior source admissions or observations.

All commands bind an immutable command ID; unknown failures are not retried by
the adapter. A caller must observe the retained operation receipt before deciding
whether a new action is appropriate. No HTTP fallback can turn HOLD into approval.

## Results and limits

All responses carry `private, no-store` and `nosniff`. Archive/issue uses201,
metadata uses200, review/revocation uses200 and an explicit native HOLD uses409.
Invalid JSON/UTF-8/shape is400, oversized bodies413, unavailable authentication503,
and other source/permission/native refusals403 with generic messages. Native
errors, secret paths and key material are not copied into error responses.

Responses bind command, selected company, kind/environment, artifact and hashes.
Approved/issued controlled TEST receipts must carry complete native effect IDs
and an empty reason-code list. Both `marketActivationGranted` and
`productionAuthorityGranted` are always false. An opaque native artifact/scope
hash is not recomputed with JavaScript serialization or claimed to prove custody
by itself. Malformed, contradictory, foreign or secret-bearing results are
rejected before HTTP output.

Finite HTTP/adapter tests exercise actual handlers, schemas, byte checks and RPC
arguments against substituted authentication/native ports. They do not prove
native grants, independent review, cryptographic custody, complete issuance
history, physical reception, PostgreSQL/Supabase policy or scenario PASS. Genuine
native review and actual data effects require the separately qualified producer
and independent output reviews.
