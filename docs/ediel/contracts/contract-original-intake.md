# Contract original intake v1

The OPS page `/admin/ediel/contract-originals`, its Server Actions, and `/api/admin/ediel/contract-originals` use the same authenticated server module. Tenant and operator come from the current session. Contract/artifact IDs are selectors. No caller-supplied tenant, actor, role, `verified`, approval flag, business effect or native source ID is accepted.

An operator uploads the existing signed-contract PDF and a separately issued original JSON packet. Each file is limited to 10 MiB; their combined decoded limit is 20 MiB. The HTTP envelope has a 29 MiB streaming limit. Archive checks the PDF against the actual verified signed-contract document, signature snapshot, owned customer/site/point, legal supplier and current company-bound network source. Original bytes and hashes are immutable. An independent operator reviews those exact hashes. Approval inserts the existing native source row, review, qualification and audit in one transaction. A failed final audit or current policy check rolls everything back. Staging and approval do not deliver a market message.

`POST` commands have exactly these fields:

| operation | fields after operation |
|---|---|
| scope | contractId, environment, kind |
| archive | contractId, environment, kind, agreementBase64, sourceBase64, issuerKeyId, representationId, signatureHex |
| review | artifactId, sourceHash, agreementHash, claimsHash, decision, reason |
| prepare | artifactId |

`GET` accepts exactly one `artifactId` or `contractId`. Scope returns the actual native scope that the issuer must authenticate. The original packet is UTF-8 JSON with exactly `agreementHash`, `claims`, `expiresAt`, `format`, `issuedAt`, `issuerCode`, `legalAuthorityReference`, `nativeScope`, `purpose`, `receiptId`, `representationReference`. `format` is `ediel_contract_original_source_v1`; `nativeScope` must equal the verified scope. `signatureHex` authenticates the unchanged packet bytes using the existing canonical receipt-HMAC helper and the independently configured issuer key. No UI operation registers issuer authority or legal representation.

| kind | exact purpose | exact claims fields |
|---|---|---|
| masterdata_declaration | signed_contract_customer_masterdata | customerIdentity, endUserMasterdata, sourceReference, sourceVersion, validFrom, validTo |
| contract_requested_method | signed_contract_requested_metering_method | previousDeclarationId, requestedMethod, sourceReference, sourceVersion |
| metering_method_event | signed_contract_customer_agreed_method_event | effectiveAt, requestedMethodDeclarationId, sourceReference, sourceVersion, subtype, supplyPeriodId |
| production_contract_event | signed_production_contract_event | boundaryAt, contractReference, eventKind, sourceReference, sourceVersion, startEventId |

F/G claims use the existing canonical method tuple, the genuine approved requested-method declaration and a current source-owned supply relation. Production `signed` and `ceased` events use separate exact-minute boundaries; cessation identifies the same contract's genuine signed start event. Claims are authenticated source assertions, then checked by existing native domain validators. They are not duplicate acceptance contracts.

Read needs current tenant membership and explicit communication/customer/contract read permissions. Archive and review need their write equivalents; metering sources also need current metering permission. Review additionally needs `ediel.source.review`, and the reviewer must differ from the submitter. Actual native consumers recheck issuer/representation expiry/revocation, original availability, current contract/actor/network scope, current reviewer permission and exact approved row hash. The common consumer function OIDs, owners, ACLs and configuration are preserved, so existing API, import, prepare, reserve, send and replay callers receive the additional qualification check.

Approved masterdata and requested-method declarations are selected by existing source owners. Prepare selects the actual current qualified event from the artifact and invokes the established F/G or production-contract producer. Existing source commands create persistent requests, intents, message lineage, transport status and process effects. A source's original authority does not substitute for the producer's current route, role, permission or market activation checks.

The two independent staging copies use `contract_intake_agreement_original_bytes` and `contract_intake_source_original_bytes` in the existing protected-original retention engine. Exact independently approved lawful policies and current retention permissions are required before physical erasure. Their separate native domain copies keep their existing retention classes. Erasure preserves hashes, metadata, review and tombstones and makes affected source execution fail closed. No period, issuer, permission grant, source approval or market activation is seeded.

Required external records are genuine legal issuer authority and current representation configuration for each tenant/environment/purpose, the genuine signed packet and matching retained PDF, and any existing producer's genuine BRP, network and route evidence. A bounded synthetic regression is evidence of mechanisms only. Full original acceptance still requires the composed candidate's native migration/upgrade, authenticated HTTP, UI, actual external source and CI evidence. Application rollback may remove the new UI while retaining native source enforcement and archive custody; no destructive down-migration is supplied.
