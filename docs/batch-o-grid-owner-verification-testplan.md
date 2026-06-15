# Batch O — Grid owner verification, actor registry, certificate coverage & resolver hardening

## Goal

Ensure that network owners used by customer intake, address/postal-code resolution, facility-data requests and supplier switch readiness are verified through platform actor registry data, route data, subaddress, contact path, certificate coverage and duplicate checks.

## SQL / migration checks

1. Run `select public.gridex_backfill_grid_owner_verification('manual_sql_test');`.
2. Confirm `grid_owners` contains rows backfilled from `platform_market_actors` where the actor has a grid-owner role.
3. Confirm `platform_grid_owners.ops_grid_owner_id` links resolver owners to OPS `grid_owners.id`.
4. Query `gridex_verified_grid_owners_v` and confirm every row has one of:
   - `verified`
   - `needs_route`
   - `needs_certificate`
   - `needs_ediel_id`
   - `needs_subaddress`
   - `needs_contact`
   - `unresolved_duplicate`
5. Confirm verified rows have:
   - EDIEL ID
   - verified route
   - subaddress
   - contact path
   - certificate status `finns` when certificate is required
   - `verified_for_customer_flow = true`
6. Confirm duplicate actors are shown in `gridex_grid_owner_duplicate_v` and create open rows in `grid_owner_verification_reviews`.
7. Confirm non-verified rows create open review items with blocking severity for route, EDIEL ID, subaddress, certificate or duplicate issues.

## UI checks

1. Open `/admin/network-owners` as platform admin.
2. Confirm the page shows total, active, verified and needs-action counters.
3. Click **Kontrollera nätägare** and confirm the backfill action completes without a crash.
4. Confirm the table displays:
   - verification status
   - route counts for PRODAT/UTILTS
   - certificate status
   - contact path
   - duplicate warning when relevant
5. Confirm a tenant/admin user without platform access cannot edit technical network-owner masterdata.

## Resolver checks

1. Resolve by full grid area code.
2. Confirm resolver returns OPS `grid_owners.id`, not only `platform_grid_owners.id`.
3. Resolve by address/postal code.
4. Confirm postal-code result is only a suggestion and does not make supplier switch ready by itself.
5. Confirm `energy_resolution.gridOwnerVerificationStatus` is `verified` only when network owner passes the canonical view.
6. Confirm unverified network owner produces warnings such as `grid_owner_needs_route`, `grid_owner_needs_certificate`, etc.

## Customer intake checks

1. Submit a website application where address/postal code suggests a network owner but the owner is not verified.
2. Confirm the application is created but supplier switch is blocked.
3. Confirm the response payload includes `grid_owner_verification_status` and `grid_owner_verification_issues`.
4. Confirm `can_start_switch = false` until facility/metering point and verified network owner data are present.
5. Submit a website application with verified grid area + verified network owner + full facility/metering-point data + legal/fullmakt.
6. Confirm the application can reach `ready_for_switch`.

## Admin intake checks

1. Try to select an unverified network owner in admin customer intake.
2. Confirm it is rejected or saved as missing/unverified, with a warning.
3. Confirm free-text network owners cannot be created from customer intake.
4. Confirm only verified grid owners appear when `customerFlowOnly` is used.

## EDIEL / route checks

1. For a verified network owner, confirm PRODAT/UTILTS route, subaddress and contact path are visible.
2. For production PRODAT where certificate is required, confirm missing/expired/mismatched certificate results in `needs_certificate`.
3. Confirm system does not auto-send switch/facility request where network-owner verification status is not `verified`.

## Regression reminders

- Do not break existing PRODAT/UTILTS/APERAK/CONTRL/UTILTS_ERR rules.
- Address/postal code is a suggestion; grid area + facility data + verified actor data are the operational truth.
- OCR/PDF can help collect evidence, but must not overwrite network-owner masterdata automatically.
