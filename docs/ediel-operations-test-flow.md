# Ediel operations test flow

## SQL order

Run migrations in timestamp order. For this branch, run the new patch after all existing `20260601*` migrations:

1. `supabase/migrations/20260601184500_ediel_runtime_hardening_rls_route_history.sql`
2. `supabase/migrations/20260602090000_ediel_operations_platform_core.sql`
3. `supabase/migrations/20260602093200_ediel_operations_rls_completion.sql`
4. `supabase/migrations/20260602101500_ediel_shared_mailbox_subaddress_security.sql`

The new migration is idempotent and only creates missing runtime tables/columns for payloads, queue, send locks, dedupe, energy-service permissions, metering batches/values, customer communications, certificates, IT-system profiles, optional route subaddress policy, shared `ediel@gridex.se` mailbox and encrypted/unencrypted test-run storage.

## Manual browser flow

1. Sign in as platform admin.
2. Open `/admin/ediel/control-tower` and verify actor settings, route profiles, mailbox status, outbound queue and unresolved counts.
3. Open `/admin/ediel/routes` and verify:
   - `ediel@gridex.se` is the mailbox/transport address;
   - tenant Ediel ID is used as UNB/NAD actor identity, not Gridex;
   - `Subadress krävs` is off by default;
   - routes that require subaddress have either receiver subaddress or receiver message-subaddress;
   - Edielportalen PRODAT can be configured explicitly, e.g. receiver `91100` and message-subaddress `PRODAT`.
4. Open `/admin/ediel/certificates`, upload a `.p12`, enter PIN and verify subject, issuer, serial, SHA-256 fingerprint and validity are stored while PIN/private key are not stored in DB columns.
5. Open `/admin/ediel/test-center` and choose the appropriate security mode:
   - `Kör okrypterat test` for `encryption_mode=none` test routes.
   - `Kör krypterat test` for `encryption_mode=smime` routes with a valid certificate.
   - Verify the created `ediel_test_runs` row stores `encryption_mode`, `route_profile_id`, `certificate_fingerprint_sha256`, `expected_flow`, `actual_flow`, `raw_edifact` when an outbound builder exists, and `encrypted_payload_ref` when S/MIME packaging was prepared.
6. Open `/admin/ediel/system-tests` for existing system tests and `/admin/ediel/agt` for AGT supplier regression.
7. Run supplier PRODAT cases L1, L2, L3, L4, L5 and L7 from the existing AGT workspace.
8. Run UTILTS regressions UL1, UL2, UL3, UL4 and UL6 from the existing UTILTS/system-test workspace.
9. For energy-service flows, create or select a tenant/customer/metering point, then use backend business actions:
   - `requestMeteringAccess` for Z13V.
   - `requestHistoricalMeteringAccess` for Z13VH period validation.
   - `terminateMeteringAccess` for Z18V.
10. Import inbound Z14/Z15/UTILTS E66 messages through the mailbox cron or inbound message tools.
11. Confirm:
   - syntax errors produce negative CONTRL only;
   - PRODAT business errors produce negative APERAK;
   - UTILTS functional/process errors produce UTILTS-ERR;
   - no APERAK is created for APERAK/CONTRL;
   - E66-KVART and E66-SCH have separate `utiltsSubtype`/`measurementResolution`;
   - tenant resolution works without subaddress when route does not require it;
   - missing subaddress blocks outbound only when `subaddress_required=true`;
   - production PRODAT cannot be sent unencrypted unless a superadmin override has reason and future expiry;
   - inbound S/MIME without decrypt credentials remains manual review and does not update business state;
   - unsafe tenant or object matches become unresolved items.

## Production readiness checklist

Before production:

1. Confirm `ediel@gridex.se` is registered as technical Ediel SMTP/IMAP address.
2. Confirm shared mailbox is accepted for multiple tenant Ediel IDs.
3. Confirm Gridex is transport provider only, not Ediel ombud.
4. Configure each tenant/company Ediel ID and actor role.
5. Confirm SPF, DKIM and DMARC status for `gridex.se`.
6. Confirm SMTP/TLS and IMAP polling are working.
7. Upload and validate Expisoft/Ediel `.p12` in `/admin/ediel/certificates`.
8. Link certificate to encrypted route profiles.
9. Confirm certificate status is active or renewal_available, not expired/validation_failed.
10. Confirm tenant resolution matches exactly from UNB/NAD/Application Reference/message family/business code/environment/route.
11. Confirm routes exist for PRODAT, UTILTS, APERAK, CONTRL and UTILTS-ERR where relevant.
12. Confirm subaddress is empty by default unless the receiver/route explicitly requires it.
13. Run L1-L7, UL1-UL6, E3-E8 and UE1-UE2 in both raw and S/MIME test mode where route/certificate policy allows.
14. Confirm production PRODAT is blocked without S/MIME unless the emergency override has reason and automatic expiry.
15. Confirm unresolved queue catches unknown Ediel IDs, missing route, missing certificate, unknown metering point and unsafe tenant matches.

## Test-center case families

Use the existing production builders/parsers for all test cases:

- Supplier PRODAT: L1, L2, L3, L4, L5, L7.
- Supplier UTILTS: UL1, UL2, UL3, UL4, UL6.
- Energy-service PRODAT: E3, E4, E5, E6, E7, E8.
- Energy-service UTILTS: UE1, UE2.

Do not add portal-specific Ediel IDs or hardcoded message references in test data. Test fixtures may provide expected outcomes, but production builders/parsers must be used.
