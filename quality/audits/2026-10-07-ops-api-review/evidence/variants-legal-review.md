# Variants of F28: bounded legal evidence review

Scope: two nearest legal write chains only: Website POA repair/retry and secure-link online contract signing. Read-only source review and a synthetic actual-helper probe. No production writes. F28 itself was not retested.

## V-L1 — Website repair accepts another offer's POA document: refuted

Public retry repair in lib/website/customerApplicationRepair.ts150–156 re-runs assertWebsiteLegalAcceptances and186–202 calls ensureWebsitePowerOfAttorney. Admin stored-payload repair repeats those gates at887–899 and917–937. Unlike initial canonical creation, both callers use the helper carrying the exact legal-version comparison.

lib/website/customerApplicationLegal.ts870–895 compares submitted textVersionId to the accepted offer POA document and raises409 power_of_attorney_offer_version_mismatch. Its exact document loader765–799 binds document to company through the bundle and checks lock/status/unresolved variables. Legacy fallback811–818 is company-scoped and published. Existing POA reuse955–1030 is company/customer/contract scoped and compares exact legal version and signed scopes; otherwise it creates a new POA rather than broadening an existing one.

Executed variants-legal-repair-guards.probe.ts:2/2 passed. Actual ensureWebsitePowerOfAttorney rejected another valid-looking UUID against offer document with409 before any database call. With no known offer POA version and a synthetic missing/foreign result, it rejected422 power_of_attorney_version_tenant_mismatch after both company-scoped canonical/legacy lookups. Database query results were synthetic; this does not simulate a complete repair request.

Minor considered observations: reuse compares immutable legal version and scope but does not require newly submitted signer data to equal the original signer; reuse retains original evidence and may be intentional valid authorization reuse, so no independent defect established. The repair checks existence of one legal acceptance before deciding whether to recreate all; this might preserve a pre-existing partial set, but the inspected normal insertion is a bulk write and no automatic partial-set creation chain was established. These are explicitly unconfirmed observations, not findings.

## V-L2 — Secure-link signing accepts arbitrary frontend legal version/hash: refuted by inspected native chain

app/sign/contract/[token]/actions.ts delegates to finalizeOnlineContractSignature in lib/customer-contracts/onlineSigning.ts. The finalizer sends only hashed token, request IP hash and user agent to gridex_finalize_customer_contract_signature_v1; it does not accept a caller legal document ID or hash override.

supabase/migrations/20260818165847_canonical_online_signature_v1.sql409–445 scopes request/contract to the same company, requires operational tenant and pending_signature, and checks the exact publication/product/price/legal-bundle chain with locks and published state. Legal versions453 are loaded solely from documents whose legal_bundle_version_id equals the bound contract bundle. The signature snapshot457–470 and inserted customer_legal_acceptances475–487 use that same server-loaded document set/version/hash. PDF legal mapping in onlineSigning.ts194–228 uses those receipt document IDs and immutable content fields. No analogous submitted-document-versus-persisted-document mismatch was found in this chain.

This secure-link conclusion is source-backed for the inspected local native function and TS caller, not a production execution. It does not assert authentication of the legal signer beyond the secure-link contract's own semantics. Existing separate confirmation-delivery findings are outside this variant review.

## Result

No new confirmed defect beyond F28 from these two chains. Preserve V-L1/V-L2 as refuted variants and the two repair observations as unconfirmed observations in the central findings register, without promoting them to bugs. Evidence: variants-legal-repair-guards.probe.ts and variants-legal-repair-guards.log (2/2 pass). No source modifications; repository temporary test removed.
