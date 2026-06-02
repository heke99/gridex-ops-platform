# Ediel operations test flow

## SQL order

Run migrations in timestamp order. For this branch, run the new patch after all existing `20260601*` migrations:

1. `supabase/migrations/20260601184500_ediel_runtime_hardening_rls_route_history.sql`
2. `supabase/migrations/20260602090000_ediel_operations_platform_core.sql`

The new migration is idempotent and only creates missing runtime tables/columns for payloads, queue, send locks, dedupe, energy-service permissions, metering batches/values, customer communications, certificates and IT-system profiles.

## Manual browser flow

1. Sign in as platform admin.
2. Open `/admin/ediel/control-tower` and verify actor settings, route profiles, mailbox status, outbound queue and unresolved counts.
3. Open `/admin/ediel/system-tests` for existing system tests and `/admin/ediel/agt` for AGT supplier regression.
4. Run supplier PRODAT cases L1, L2, L3, L4, L5 and L7 from the existing AGT workspace.
5. Run UTILTS regressions UL1, UL2, UL3, UL4 and UL6 from the existing UTILTS/system-test workspace.
6. For energy-service flows, create or select a tenant/customer/metering point, then use backend business actions:
   - `requestMeteringAccess` for Z13V.
   - `requestHistoricalMeteringAccess` for Z13VH period validation.
   - `terminateMeteringAccess` for Z18V.
7. Import inbound Z14/Z15/UTILTS E66 messages through the mailbox cron or inbound message tools.
8. Confirm:
   - syntax errors produce negative CONTRL only;
   - PRODAT business errors produce negative APERAK;
   - UTILTS functional/process errors produce UTILTS-ERR;
   - no APERAK is created for APERAK/CONTRL;
   - E66-KVART and E66-SCH have separate `utiltsSubtype`/`measurementResolution`;
   - unsafe tenant or object matches become unresolved items.

## Test-center case families

Use the existing production builders/parsers for all test cases:

- Supplier PRODAT: L1, L2, L3, L4, L5, L7.
- Supplier UTILTS: UL1, UL2, UL3, UL4, UL6.
- Energy-service PRODAT: E3, E4, E5, E6, E7, E8.
- Energy-service UTILTS: UE1, UE2.

Do not add portal-specific Ediel IDs or hardcoded message references in test data. Test fixtures may provide expected outcomes, but production builders/parsers must be used.
