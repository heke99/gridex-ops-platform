# Batch O6.4 — Role-aware readiness and grid-owner cleanup

## Syfte

O6.4 gör aktörsreadiness rollbaserad. Leverantörsbyte ska bara blockeras av verkliga elnät i supplier-switch scope. Gasaktörer, test/dummy-aktörer, systemleverantörer, ASP/ESP, balansansvariga och övriga aktörer visas separat och ska inte försämra elhandelens readiness-siffror.

## Huvudregler

- `can_start_supplier_switch` kräver elnät/nätägare, inte gas, inte test/dummy och inte ren systemleverantör.
- Gasaktörer klassas som `excluded_from_electricity_scope` och blockerar inte elhandel.
- Saknad PRODAT-route blir `manual_review_required` med `manual_review_reason = missing_prodat_route`.
- Certifikat-refresh via O6.4A går bara mot blockerade elnät som redan har säker PRODAT-route, kontaktväg och säker subadress.
- Ingen missing route eller missing certificate får fejkas till grön readiness.

## Nya vyer

- `actor_electricity_scope_classification_v`
- `actor_readiness_by_role_v`
- `grid_owner_supplier_switch_readiness_v`
- `electricity_supplier_readiness_v`
- `system_supplier_readiness_v`
- `non_electricity_actor_readiness_v`
- `ediel_blocked_grid_owner_certificate_refresh_candidates_v`

## Viktiga regressioner att bevara

- O6.2/O6.3 certifikatflöden fortsätter använda befintlig certifikatcache/LDAP/Expisoft.
- Tom subadress är fortsatt bara tillåten när den är verifierad som `not_required_confirmed`.
- Auto-send ändras inte till att acceptera osäkra routes.
- `gridex_verified_grid_owners_v` behåller O2-kolumnordningen och lägger O6.4-fält sist.

## Kontroll

Kör `supabase/sql/checks/batch_o6_4_role_aware_readiness_checks.sql` efter migrationen. De viktigaste nollvärdena är:

- `gas_actor_wrongly_ready_count = 0`
- `test_actor_wrongly_ready_count = 0`
- `system_supplier_wrongly_ready_count = 0`
- `unsafe_non_electricity_candidate_count = 0`
- `excluded_candidate_count = 0`
