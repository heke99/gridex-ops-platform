# Produktion jämfört med repo: funktionsavvikelser 2026-10-23

Det här är en läsande inventering, gjord efter att 14 äldre main-migreringar och SC046-paret installerades 2026-10-23 (se `.agent-memory/handover.md` och #840). Ingenting ändrades i produktion i samband med själva inventeringen. De saknade objekten installerades därefter samma dag, se nästa avsnitt.

## Installation 2026-10-23 (genomförd)

Alla saknade objekt utom två funktioner är installerade. Varje steg var en egen transaktion med ett avslutande kontrollblock: sha256 av `prosrc` mot `schema.sql`, exakt lista över mottagare av behörigheter (ACL) och ägaren `postgres`. Vid avvikelse rullades hela steget tillbaka.

- **Funktioner:** 151 av 153 är installerade, i 16 omgångar (`drift_install_missing_functions_01` till `_16`, plus åtgärderna nedan). Varje funktion fick först `REVOKE ALL … FROM PUBLIC, anon, authenticated, service_role`, eftersom `postgres` har en standardbehörighet i `public` som annars ger `service_role` EXECUTE. Sedan fick den exakt de behörigheter som `schema.sql` anger.
- **Medvetet överhoppade (2):** `gridex_ediel_retention.finance_guard_v1_5deeea57…` och `…_7ddb1014…`. Schemat ägs av `gridex_ediel_retention_owner`, och `postgres` har bara USAGE där. Funktionerna skapas dynamiskt, och ingen trigger i `schema.sql` refererar till dem.
- **Installerade i efterhand 2026-10-23 (`drift_install_finance_guard_v1_remaining`):** båda funktionerna skapades med `SET LOCAL ROLE gridex_ediel_retention_owner`. Rollbytet använder det befintliga medlemskapet med SET-rätt, och inga rättigheter ändrades. Kontrollsumma, ägare och ACL verifierades i samma transaktion. Alla 8 `finance_guard_v1`-funktioner i produktion stämmer nu med `schema.sql`.
- **Tabeller (3):** `guide_extensions` (med den seedrad som migrationen 20261010102349 lägger in), `prodat_mixed_reply_consumptions` och `supply_end_followups`. Tabellerna installerades med PK, UNIQUE och FK, sina triggers, RLS (även FORCE där `schema.sql` har det) och utan behörigheter för andra roller (`drift_install_missing_tables`).
- **Trigger på befintlig tabell:** `outbound_dispatch_events_tenant` på `public.outbound_dispatch_events`, som var tom vid installationen. `gridex_billing_source.protect_underlay_v1` används inte av någon trigger i `schema.sql`, och därför har ingen trigger lagts till för den.
- **Inte ändrat:** de 62 funktioner som har en annan kropp, de spärrade filerna och objekt som finns bara i produktion. Avvikande funktioner kräver granskning en och en.

### Fel under installationen och hur de åtgärdades

1. **Behörigheter saknades i omgång 1–12.** Generatorn missade ACL-blocken i `schema.sql`, eftersom de skrivs med namngivna parametrar. De 75 funktionerna fick därför ingen behörighet alls, inte heller för `service_role`. Felet åtgärdades i `drift_install_function_grants_01_12`, som verifierade alla 75. Omgång 13–16 genererades om med rätt behörigheter.
2. **Omgång 16 installerade felaktig SQL.** Anropet skickades innan filen hade lästs, så det som installerades var påhittad SQL och inte filens innehåll. Kontrollblocket var tomt. Resultatet blev 7 funktioner som inte finns i `schema.sql` och 3 riktiga funktioner med fel kropp:
   - De 7 påhittade: `ediel_require_assigned_prodat_header_negative_v1`, `ediel_require_customer_masterdata_cancellation_current_v1`, `ediel_require_requested_change_current_v1`, `ediel_require_requested_change_current_before_scope_fence_v1`, `ediel_require_service_permission_current_v1`, `ediel_store_utilts_consumption_v1` och `ediel_submit_service_evidence_v1`.
   - De 3 med fel kropp: `ediel_review_service_evidence_v1`, `ediel_revoke_customer_event_certification_v1` och `ediel_revoke_transport_exception_v1`.

   Åtgärd:
   - `drift_fix16_part_a_remove_fabricated` tog bort alla 10 (inga beroenden, inga överlagringar), installerade de 3 korrekta kropparna och kontrollerade att de 7 inte längre finns.
   - `drift_fix16_part_b_install_remaining` installerade de övriga 28 funktionerna i omgång 16 och verifierade alla 31.

   Påverkan: inga data. `gridex_ediel_services.reviews` hade 0 rader, och den påhittade granskningskroppen anropade en funktion som inte finns, så ett anrop hade bara gett fel och rullats tillbaka. Appen anropar inte någon av de 7 påhittade funktionerna. Ledgern innehåller fortfarande raden `drift_install_missing_functions_16`, som avser den felaktiga körningen.
3. **Timeouts.** Flera skrivanrop via MCP avbröts efter 230 sekunder utan att någon session syntes i databasen, och ingenting committades. Ett senare försök med samma innehåll gick igenom.

## Metod

- **Referens:** `supabase/schema.sql` på main `bd506233`, som är schemat efter en ren omkörning av alla migreringar.
- **Produktion:** projekt `piidsfebjqjmnepdpnas`, tabellen `pg_proc`. Funktioner som tillhör tillägg (extensions) är exkluderade.
- **Jämförelse:** sha256 av funktionskroppen (`prosrc`), per schema och funktionsnamn.
- **Omfattning:** bara funktioner. Tabeller, kolumner, vyer, triggers, RLS-policyer och grants är inte jämförda.
- **Mappning till migrationer:** kolumnen "senaste fil" är den sista migrationsfilen vars text definierar eller refererar funktionen. Den visar var funktionen hör hemma och är ingen exakt härkomst. Några funktioner skapas via `RENAME` eller dynamisk SQL och saknar därför en fil.

## Resultat

| Schema | Bedömning |
|---|---|
| 38 av 63 scheman | Identiska mot repot (namn och kropp). |
| 23 `gridex_*`-scheman | 68 funktioner saknas, 4 har annan kropp. |
| `public` | 85 funktioner saknas, 58 har annan kropp. |
| `public` | 49 funktioner finns bara i produktion: äldre funktioner som inte ingår i den rena omkörningen. |
| `private` | Schemat finns bara i produktion (23 funktioner). |

**Totalt saknas 153 funktioner och 62 har annan kropp.** De kommer från ungefär 130 migrationsfiler och är koncentrerade till perioden 2026-09-30 till 2026-10-02. Där har ledgern i produktion inga rader för de flesta UTILTS-, ACK replay-, PRODAT recovery-, certifikat-, fixture- och transport exception-filerna.

Exempel på delar som saknas helt i produktion:

- UTILTS ESCO och storage: `require_current_esco_storage_v1`, `preserve_committed_projection_v1`, `persist_series_v2`, `require_execution_actor_v1`.
- ACK replay: `create_v1`, `create_scope_v2`, `read_exact_v2`, `positive_service_scope_projection_v1`.
- Certificate trust, negative/positive fixtures, transport exception: `publish_v1`, `read_v1`, `revoke_v1`.
- Publika ingångar: `ediel_create_outbound_ack_atomic_v1`, `ediel_read_outbound_ack_replay_v1`, `ediel_originate_requested_change_v1`, `ediel_publish_transport_exception_v1`, med flera.

## Konsekvens

- Kodvägar i appen som anropar en saknad funktion misslyckas i produktion med "function does not exist". Ändrade kroppar innebär att produktionen kör en äldre eller annan logik än den som är testad.
- Masterplanens godkännanden (121 VERIFIED och 231 PASSED) gäller koden och den rena omkörningen. De visar inte att produktionen innehåller samma logik.

## Rekommenderad åtgärd

Gör det i små, verifierade steg, på samma sätt som installationerna 2026-10-23:

1. **Ordna:** gruppera filerna nedan i beroendeordning. Ledgern i produktion kan inte användas för att avgöra vad som är installerat; använd hashar av funktionskroppar.
2. **Installera fil för fil:** kontrollera först förutsättningarna i produktion, installera filen ordagrant och kontrollera sedan att kropparnas hashar stämmer mot `schema.sql`. En fil som hänger sig via `apply_migration` kan köras via `execute_sql` med explicit `BEGIN`/`COMMIT`.
3. **Respektera de spärrade filerna:** 20261006235632 och 20261013141048 är spärrade, och 20261012190000 får aldrig köras om. De förekommer i tabellen nedan och kräver ett eget beslut.
4. **Funktioner som finns bara i produktion:** den äldre `public`-uppsättningen och schemat `private` ska inte tas bort utan en separat analys av vem som anropar dem.
5. **Komplettera inventeringen:** jämför också tabeller, vyer, triggers, RLS och grants innan produktionen förklaras lik repot.

## Tabeller, triggers och RLS (kompletterande kontroll)

Den här jämförelsen gjordes per schema på kolumnnamn, triggernamn, policynamn och RLS-flaggan:

- **Tabeller:** 3 saknas i produktion:
  - `gridex_ediel_header_negative_birth.guide_extensions` (20261010102349)
  - `gridex_received_sources.prodat_mixed_reply_consumptions` (20260930224726)
  - `gridex_received_sources.supply_end_followups` (20261001054018)

  Deras triggers saknas också (4 i `gridex_received_sources`). Övriga 850 tabeller har samma kolumnnamn. Avvikelsen i `gridex_requested_changes.events` är ett tolkningsfel i jämförelsen, som beror på en genererad kolumn.
- **Bara i produktion:** cirka 40 äldre tabeller i `public`, med triggers och policyer. Det förklarar att produktionen har fler objekt (522 tabeller, 911 triggers och 3099 policyer mot repots 483, 777 och 2548).

Slutsats: skillnaden mellan produktion och repo ligger nästan helt i funktionerna.

## Vad appen anropar

113 av funktionerna i `public` som skiljer sig refereras i appens kod eller i skript. Ungefär 45 saknade funktioner anropas från `lib/` eller `app/` och ger "function does not exist" i produktion om flödet körs. Exempel:

- ACK-persistens: `ediel_create_outbound_ack_atomic_v1` och `ediel_create_outbound_ack_scope_atomic_v2` (`lib/ediel/core/atomicAckPersistence.ts`)
- ACK replay-läsning: `ediel_read_outbound_ack_replay_v1` (`lib/ediel/core/ackPolicy.ts`)
- Inkommande behandling: `gridex_read_outbound_acks_for_source_v1` (`lib/ediel/flows/inboundProcessing.ts`)
- Requested change, customer masterdata, PRODAT recovery, supply rescission, service evidence, certificate trust, business expectations och metering method expectations.

De flesta av dessa är Ediel-marknadsflöden som inte är aktiverade mot marknaden ännu. De 62 ändrade funktionerna innehåller både äldre versioner och funktioner som produktionen medvetet har utvecklat på plats (bb0b-formerna). Enligt installationsplanen 2026-10-22 skulle en överskrivning av vissa av dem vara en regression, till exempel `gridex_create_customer_site_with_address` med 20261012190000. **Ändrade funktioner ska därför granskas en och en och får inte konvergeras rakt av.**

## Spärrade eller utelämnade filer som berörs

- `canonical_transition_ediel_production`, `canonical_transition_ediel_production_v1_unchecked`: 20261006235632, spärrad (produktionen har divergerat).
- `gridex_persist_utilts_consumption_v1`: 20261013141048, spärrad (målet med 7 argument saknas).
- `gridex_create_customer_site_with_address`: 20261012190000, får aldrig köras om.

## Avvikelser per migrationsfil

Kolumnerna "saknas" och "ändrad" anger antal funktioner. All rådata finns i `drift.json`.

| Senaste fil | Saknas | Ändrad | Funktioner |
|---|---:|---:|---|
| `20260523` | 0 | 1 | `public.gridex_can` |
| `20260709160000` | 0 | 1 | `public.gridex_validate_outbound_payload` |
| `20260728170000` | 0 | 2 | `public.gridex_create_invoice_export_graph_v1_core`, `public.gridex_transition_customer_application_workflow` |
| `20260809131500` | 0 | 1 | `gridex_internal.actor_open_blocking_conflict_counts` |
| `20260811080000` | 0 | 1 | `public.gridex_canonicalize_company_org_number` |
| `20260811155412` | 0 | 1 | `public.gridex_ops_health_checks_v4` |
| `20260811155851` | 0 | 1 | `public.canonical_run_architecture_reconciliation` |
| `20260812130500` | 0 | 1 | `public.gridex_ops_health_checks_v5` |
| `20260813230000` | 0 | 5 | `public.gridex_dependency_circuit_before_request_v1`, `public.gridex_dependency_circuit_record_v1`, `public.gridex_record_legacy_api_key_use_v1`, `public.gridex_refresh_platform_runtime_readiness_v1`, `public.gridex_stage_energy_geodata_features_v2` |
| `20260814230500` | 0 | 1 | `public.canonical_transition_tenant_lifecycle_v3_pre_offboarding` |
| `20260815210353` | 0 | 1 | `public.canonical_restore_pre_engine_live_ediel_approval` |
| `20260817210500` | 0 | 1 | `public.canonical_provision_company_v3_pre_invitation_intent` |
| `20260818121500` | 0 | 4 | `public.gridex_assign_customer_contract_identity_v1`, `public.gridex_public_catalog_dependency_revision_trigger_v1`, `public.gridex_suppress_retired_onboarding_outbox_v1`, `public.public_contract_feed_fingerprint_v1` |
| `20260818124500` | 0 | 1 | `public.gridex_normalize_signature_request_event_truth_v1` |
| `20260818170213` | 0 | 1 | `public.gridex_customer_contracts_auto_renew_guard` |
| `20260820213000` | 0 | 1 | `public.gridex_validate_website_application_portal_identity` |
| `20260822130000` | 0 | 1 | `public.gridex_enforce_supplier_utilts_outbound_v1` |
| `20260824132814` | 0 | 1 | `public.gridex_normalize_grid_owner_information_request` |
| `20260824140830` | 0 | 1 | `public.gridex_bind_poa_authorization_document` |
| `20260829140500` | 0 | 1 | `public.gridex_enqueue_signed_contract_operation_v1` |
| `20260830012500` | 0 | 1 | `public.run_tenant_integrity_audit` |
| `20260902100045` | 0 | 2 | `public.gridex_import_grid_area_master_row`, `public.gridex_materialize_poa_scopes` |
| `20260902221500` | 0 | 1 | `public.gridex_invalidate_site_operations_on_address_change` |
| `20260928201500` | 1 | 0 | `gridex_utilts_binding.unowned_regulating_object_v1` |
| `20260929082115` | 0 | 1 | `gridex_received_sources.observe_document_reference_v1` |
| `20260930145202` | 1 | 0 | `public.ediel_record_scoped_capability_evidence_v1` |
| `20260930145350` | 1 | 0 | `gridex_utilts_binding.legacy_retry_item_v1` |
| `20260930154712` | 1 | 0 | `public.gridex_ediel_business_expectations_v1` |
| `20260930161624` | 1 | 0 | `public.ediel_supply_start_is_cancelled_v1` |
| `20260930163734` | 4 | 0 | `gridex_certificate_trust.publish_v1`, `gridex_certificate_trust.read_v1`, `public.gridex_ediel_certificate_trust_publish_v1`, `public.gridex_ediel_certificate_trust_read_v1` |
| `20260930171839` | 4 | 0 | `gridex_negative_fixtures.decode_latin1_v1`, `gridex_negative_fixtures.publish_v1`, `public.gridex_ediel_negative_fixture_publish_v1`, `public.gridex_ediel_negative_fixture_read_v1` |
| `20260930175405` | 1 | 0 | `gridex_billing_source.protect_underlay_v1` |
| `20260930175554` | 0 | 1 | `public.gridex_outbound_dispatch_v1` |
| `20260930184410` | 3 | 0 | `public.ediel_capture_technical_syntax_ack_basis_v1`, `public.ediel_record_technical_syntax_facet_v1`, `public.ediel_require_technical_syntax_ack_basis_v1` |
| `20260930190015` | 4 | 0 | `gridex_ediel_source_rules.read_outbound_ack_v1`, `gridex_ediel_source_rules.read_source_v1`, `public.ediel_read_outbound_ack_source_rule_pack_basis_v1`, `public.ediel_read_source_rule_pack_basis_v1` |
| `20260930193740` | 1 | 0 | `public.gridex_record_utilts_source_validation_v1` |
| `20260930200005` | 1 | 0 | `public.ediel_read_persisted_technical_contrl_basis_v1` |
| `20260930203354` | 1 | 0 | `public.gridex_ai_export_decision_v1` |
| `20260930203615` | 1 | 0 | `public.gridex_read_committed_inbound_ack_v1` |
| `20260930205320` | 2 | 0 | `gridex_ediel_common_header.prepare_v1`, `public.ediel_prepare_common_header_negative_ack_v1` |
| `20260930211020` | 1 | 0 | `public.gridex_record_utilts_source_validation_v2` |
| `20260930212435` | 3 | 0 | `gridex_negative_fixtures.publish_positive_v1`, `public.gridex_ediel_negative_fixture_prepare_read_v1`, `public.gridex_ediel_positive_fixture_publish_v1` |
| `20260930212911` | 1 | 0 | `public.gridex_record_utilts_source_validation_v3` |
| `20260930215244` | 1 | 0 | `public.gridex_record_prodat_source_validation_v2` |
| `20260930220942` | 2 | 0 | `gridex_ai_processing.require_export_decision_for_phase_v1`, `gridex_ai_processing.require_export_decision_v1` |
| `20260930223930` | 1 | 0 | `public.gridex_read_outbound_acks_for_source_v1` |
| `20260930224443` | 1 | 0 | `public.ediel_read_outbound_ack_replay_v1` |
| `20260930224726` | 3 | 0 | `public.ediel_consume_prodat_mixed_reply_v1`, `public.ediel_process_prodat_mixed_z04_v1`, `public.ediel_read_prodat_mixed_reply_v1` |
| `20260930230944` | 1 | 0 | `public.gridex_ediel_metering_method_expectations_v1` |
| `20260930231447` | 1 | 0 | `gridex_received_sources.supply_period_source_before_internal_site_v1` |
| `20260930231633` | 1 | 0 | `gridex_service_permission.require_current_before_agreement_reference_v1` |
| `20260930231958` | 1 | 0 | `public.ediel_create_outbound_ack_atomic_v1` |
| `20260930235816` | 1 | 0 | `gridex_service_permission.require_current_before_requested_method_v1` |
| `20261001000147` | 1 | 0 | `public.gridex_record_prodat_response_source_validation_v3` |
| `20261001000148` | 1 | 0 | `public.gridex_record_prodat_source_validation_v3` |
| `20261001000609` | 5 | 0 | `gridex_transport_exception.publish_v1`, `gridex_transport_exception.revoke_v1`, `public.ediel_publish_transport_exception_v1`, `public.ediel_read_transport_exception_v1`, `public.ediel_revoke_transport_exception_v1` |
| `20261001000926` | 1 | 0 | `public.ediel_read_service_evidence_archive_v1` |
| `20261001003642` | 2 | 0 | `gridex_ai_processing.require_original_rows_before_customer_v1`, `gridex_ai_processing.row_epoch_before_customer_v1` |
| `20261001003657` | 2 | 0 | `gridex_received_err_response.require_positive_before_received_err_v1`, `public.ediel_read_received_err_application_response_authority_v1` |
| `20261001010230` | 1 | 1 | `gridex_utilts_binding.persist_series_legacy_v1`, `gridex_utilts_binding.persist_series_v1` |
| `20261001010321` | 1 | 0 | `public.gridex_record_prodat_source_validation_v4` |
| `20261001010758` | 9 | 0 | `public.ediel_apply_reviewed_customer_source_v1`, `public.ediel_confirmed_customer_snapshot_before_scope_fence_v1`, `public.ediel_confirmed_customer_snapshot_v1`, `public.ediel_requested_change_message_basis_before_scope_fence_v1`, `public.ediel_requested_change_message_basis_v1`, `public.ediel_requested_change_source_before_scope_fence_v1`, `public.ediel_requested_change_source_v1`, `public.ediel_witness_confirmed_customer_source_before_scope_fence_v1`, `public.ediel_witness_confirmed_customer_source_v1` |
| `20261001011232` | 1 | 0 | `public.ediel_apply_reviewed_structure_v1` |
| `20261001012305` | 1 | 0 | `public.ediel_customer_record_retention_targets_v1` |
| `20261001013034` | 1 | 0 | `public.ediel_read_prodat_bilateral_source_capability_v1` |
| `20261001013836` | 1 | 0 | `public.ediel_apply_customer_before_bilateral_v1` |
| `20261001014735` | 2 | 0 | `public.ediel_create_outbound_ack_scope_atomic_v2`, `public.ediel_read_outbound_ack_scope_replay_v2` |
| `20261001015127` | 1 | 0 | `gridex_received_sources.require_utilts_transaction_before_issuer_v1` |
| `20261001015846` | 1 | 0 | `gridex_ediel_ack_replay.capture_positive_service_scope_v1` |
| `20261001015945` | 0 | 1 | `gridex_correction_process.witness_v1` |
| `20261001022917` | 0 | 1 | `public.gridex_apply_exact_z02_core` |
| `20261001023248` | 1 | 0 | `public.ediel_qualify_bilateral_prodat_outbound_draft_v1` |
| `20261001031053` | 1 | 0 | `public.ediel_qualify_bilateral_prodat_switch_preparation_v1` |
| `20261001032758` | 3 | 0 | `gridex_received_sources.append_prodat_response_validation_v3`, `gridex_received_sources.append_prodat_source_function_validation_v5`, `public.gridex_record_prodat_source_function_validation_v5` |
| `20261001032759` | 3 | 0 | `gridex_received_sources.append_prodat_validation_v4`, `gridex_received_sources.append_prodat_validation_v5`, `public.gridex_record_prodat_source_validation_v5` |
| `20261001032824` | 4 | 0 | `gridex_customer_life_events.publish_certification_v1`, `gridex_customer_life_events.revoke_certification_v1`, `public.ediel_publish_customer_event_certification_v1`, `public.ediel_revoke_customer_event_certification_v1` |
| `20261001041152` | 4 | 0 | `gridex_ediel_services.require_periodic_outcome_v1`, `gridex_ediel_services.require_periodic_reason_v1`, `gridex_received_sources.require_utilts_transaction_v1`, `gridex_utilts_binding.require_current_esco_storage_v1` |
| `20261001043917` | 4 | 0 | `gridex_ediel_ack_replay.positive_service_scope_projection_v1`, `gridex_ediel_services.review_before_source_timing_v1`, `public.ediel_archive_service_evidence_v1`, `public.ediel_review_service_evidence_v1` |
| `20261001044958` | 1 | 0 | `public.ediel_read_z06f_reading_followup_v1` |
| `20261001045349` | 1 | 0 | `gridex_ai_processing.customer_row_epoch_v1` |
| `20261001052735` | 2 | 0 | `gridex_bilateral_prodat.dispatch_mixed_start_v1`, `gridex_received_sources.normal_switch_confirm_mixed_v1` |
| `20261001053437` | 3 | 0 | `gridex_utilts_binding.persist_consumption_before_precision_v1`, `gridex_utilts_binding.valid_rejected_item_v3`, `gridex_utilts_binding.validate_rejected_contract_v3` |
| `20261001054018` | 1 | 0 | `public.ediel_project_supply_end_followup_v1` |
| `20261001062832` | 2 | 0 | `gridex_service_permission.context_before_agreement_reference_v1`, `gridex_service_permission.context_before_requested_method_v1` |
| `20261001065415` | 1 | 0 | `gridex_service_permission.require_original_current_v1` |
| `20261001070000` | 0 | 2 | `public.gridex_attach_portfolio_settlement_to_invoice`, `public.gridex_bind_locked_portfolio_settlement_to_underlay` |
| `20261001085523` | 1 | 0 | `public.ediel_require_prodat_bilateral_positive_source_v1` |
| `20261001110500` | 2 | 0 | `gridex_utilts_binding.persist_consumption_before_actor_v1`, `gridex_utilts_binding.require_execution_actor_v1` |
| `20261001115000` | 3 | 0 | `gridex_supply_rescission.require_recorded_outbound_v1`, `public.ediel_qualify_supply_rescission_draft_v1`, `public.ediel_read_supply_rescission_original_v1` |
| `20261001115200` | 2 | 0 | `public.ediel_qualify_persisted_prodat_outbound_source_v1`, `public.ediel_qualify_supply_rescission_prepared_original_v1` |
| `20261001121001` | 3 | 0 | `public.ediel_metering_method_change_message_basis_v1`, `public.ediel_metering_method_recovery_scope_v1`, `public.ediel_metering_method_recovery_source_v1` |
| `20261001124000` | 1 | 0 | `public.ediel_is_duplicate_protocol_ack_v1` |
| `20261001134500` | 1 | 0 | `gridex_ediel_ack_replay.read_v1` |
| `20261001134600` | 1 | 0 | `gridex_ediel_technical_ack.read_persisted_contrl_v1` |
| `20261001141000` | 3 | 0 | `gridex_received_sources.recovery_reference_wire_data_v1`, `gridex_received_sources.render_owned_li_repair_v1`, `public.ediel_prepare_prodat_recovery_references_v1` |
| `20261001141500` | 1 | 0 | `public.ediel_prodat_recovery_workspace_v1` |
| `20261001142520` | 1 | 0 | `public.ediel_read_technical_source_endpoint_v1` |
| `20261001142540` | 0 | 1 | `public.gridex_materialize_supplier_switch_process_variant` |
| `20261001142580` | 0 | 1 | `public.gridex_refresh_customer_process_summary` |
| `20261001142600` | 1 | 0 | `gridex_ai_processing.network_registry_basis_v1` |
| `20261001142620` | 1 | 0 | `gridex_negative_fixtures.read_v1` |
| `20261001230000` | 1 | 0 | `public.gridex_outbound_dispatch_event_company_v1` |
| `20261002140000` | 0 | 2 | `public.gridex_billing_profile_revisions_append_only`, `public.gridex_customer_billing_profile_bump` |
| `20261002212000` | 0 | 1 | `public.gridex_close_customer_lifecycle_v1` |
| `20261002213000` | 0 | 1 | `public.gridex_end_customer_supply_v1` |
| `20261002214000` | 0 | 1 | `public.gridex_customer_retention_until_v1` |
| `20261002215000` | 0 | 2 | `public.gridex_create_supplier_switch_v1`, `public.gridex_transition_supplier_switch_v1` |
| `20261002216000` | 0 | 1 | `public.gridex_register_customer_lifecycle_decision_v1` |
| `20261002218000` | 0 | 1 | `public.gridex_create_grid_owner_data_request_v1` |
| `20261002220000` | 0 | 1 | `public.gridex_import_billing_underlays_v1` |
| `20261002223000` | 0 | 1 | `public.gridex_approve_portal_claim_v1` |
| `20261002233100` | 1 | 0 | `gridex_ediel_ack_replay.create_v1` |
| `20261002233800` | 2 | 0 | `gridex_bilateral_prodat.source_capability_v1`, `gridex_regulated_supply.source_capability_v1` |
| `20261002235200` | 1 | 0 | `gridex_ediel_duplicate_responses.matches_business_sequence_v1` |
| `20261003100000` | 0 | 1 | `public.gridex_save_website_application_review_v1` |
| `20261003150200` | 1 | 0 | `gridex_utilts_binding.persist_series_v2` |
| `20261005124901` | 0 | 1 | `public.gridex_record_staff_identity_delivery_v1` |
| `20261006184000` | 1 | 0 | `public.ediel_requested_customer_change_selected_facts_v1` |
| `20261006221015` | 2 | 0 | `public.ediel_originate_requested_change_before_scope_fence_v1`, `public.ediel_originate_requested_change_v1` |
| `20261006235632` | 0 | 2 | `public.canonical_transition_ediel_production`, `public.canonical_transition_ediel_production_v1_unchecked` |
| `20261009082553` | 4 | 0 | `public.ediel_prepare_customer_masterdata_recovery_v1`, `public.ediel_prepare_switch_cancellation_customer_masterdata_v1`, `public.ediel_switch_cancellation_customer_masterdata_basis_v1`, `public.ediel_switch_cancellation_customer_masterdata_message_basis_v1` |
| `20261010102349` | 7 | 0 | `gridex_ediel_ack_replay.create_scope_v2`, `gridex_ediel_ack_replay.read_exact_v2`, `gridex_ediel_ack_replay.read_scope_v2`, `gridex_ediel_header_negative_birth.create_v1`, `gridex_ediel_header_negative_birth.family_basis_v1`, `gridex_ediel_header_negative_birth.immutable_guide_v1`, `public.ediel_create_assigned_prodat_header_negative_v1` |
| `20261010102455` | 2 | 0 | `public.ediel_read_prodat_customer_masterdata_original_v1`, `public.ediel_read_prodat_h_accepted_original_v1` |
| `20261012120000` | 1 | 0 | `gridex_utilts_binding.preserve_committed_projection_v1` |
| `20261012190000` | 0 | 1 | `public.gridex_create_customer_site_with_address` |
| `20261013093621` | 0 | 2 | `public.gridex_finalize_signature_before_record_retention_v1`, `public.gridex_get_signature_before_record_retention_v1` |
| `20261013094648` | 0 | 1 | `public.gridex_platform_dashboard_summary_v1` |
| `20261013141048` | 0 | 1 | `public.gridex_persist_utilts_consumption_v1` |
| `20261014004020` | 0 | 1 | `public.canonical_authenticated_tenant_context` |
| `okänd (skapad via RENAME/dynamisk SQL)` | 2 | 0 | `gridex_ediel_retention.finance_guard_v1_5deeea5777841dc25ff551d49db435fb`, `gridex_ediel_retention.finance_guard_v1_7ddb10144d6f8333b9c1b21ecec204e6` |