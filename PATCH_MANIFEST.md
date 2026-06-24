# Address intake and grid-owner resolver hardening patch

Only changed or added files are included.

## Purpose

- Make `customer_sites` the only operational source for anläggningsadress.
- Treat tenant/manual/website/customer-portal data as candidates, never as verified grid-owner data.
- Prevent billing-address fallback, mixed facility/metering identifiers and direct grid-owner creation from the customer card.
- Add address provenance, history, conflict handling, resolver invalidation and automatic requeueing.

## gridex_automatic_facility_lookup_edifact_dispatch

Added/changed files in this patch:

- `supabase/migrations/20260624170000_gridex_automatic_facility_lookup_edifact_dispatch.sql`
- `lib/customer-operations/facilityLookupEdifactDispatch.ts`
- `lib/customer-operations/facilityLookupAutomation.ts`
- `lib/customer-operations/automation.ts`
- `lib/energy/gridOwnerRequests.ts`
- `lib/energy/types.ts`
- `app/api/internal/customer-operations/cron/route.ts`
- `scripts/gridex-automatic-facility-lookup-edifact-dispatch-regression.cjs`
- `docs/gridex_automatic_facility_lookup_edifact_dispatch.md`
- `package.json`

Purpose: automatically dispatch production-ready facility lookup requests through PRODAT Z01 / Ediel outbox, while preserving the strict supplier-switch Z01 preflight.

