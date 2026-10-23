# De 62 funktioner som skiljer sig mellan produktion och repo: granskning 2026-10-23

Produktionens kroppar hämtades 2026-10-23. Ögonblicksbilden är kontrollerad mot `pg_proc` samma dag: alla 63 signaturer har oförändrad sha256. Jämförelsen gjordes mot `supabase/schema.sql` på main `bd506233`.

Klassningen gjordes i två steg. Först rensades kommentarer bort och blanksteg normaliserades, sedan jämfördes kropparna token för token. Kolumnen "Prod-kroppen finns i" anger om produktionens exakta kropp förekommer i någon migrationsfil.

Grupp 4 och 5 är genomförda; se respektive avsnitt. Grupp 3 är spärrad.

## Sammanfattning

| Grupp | Antal | Förslag |
|---|---|---|
| 1. Bara kommentarer, blanksteg eller formatering | 41 | Ingen åtgärd. Logiken är identisk. |
| 2. Variant som bara finns i produktion | 1 | Låt vara. `gridex_validate_outbound_payload(text,text,jsonb,uuid)` finns inte i repot. Repots triggervariant `()` är identisk. |
| 3. Spärrade filer: behåll produktionens version | 4 | Rör inte. |
| 4. Repot är nyare: kandidater för installation | 10 | Installera repots version, en i taget och med kontrollblock. |
| 5. Produktionen avviker: beslut behövs | 7 | Avgör om produktionen eller repot är rätt. |

## 1. Endast kosmetiska skillnader (41)

Här skiljer sig bara kommentarer, radbrytningar, parenteser eller ett avslutande `;`. Bland dem finns `canonical_authenticated_tenant_context`, `gridex_close_customer_lifecycle_v1`, `gridex_create_supplier_switch_v1`, `gridex_transition_supplier_switch_v1`, `gridex_ops_health_checks_v4/v5`, `gridex_platform_dashboard_summary_v1`, `gridex_internal.actor_open_blocking_conflict_counts` och `gridex_bind_poa_authorization_document`.

Förslag: ingen åtgärd. Hela listan finns i `changed62.json`, kategorin `A_kosmetisk`.

## 3. Spärrade filer: behåll produktionens version (4)

| Funktion | Skillnad | Spärr |
|---|---|---|
| `gridex_create_customer_site_with_address` | Repot sätter inte `is_active=true`. | 20261012190000 får aldrig köras om. |
| `gridex_persist_utilts_consumption_v1` (6 argument) | Repot har en helt ny kropp med SC046-kontroller och kräver `service_role`. | 20261013141048 är spärrad. |
| `canonical_transition_ediel_production` | Repot lägger till en kontroll efter övergången till `live`. | 20261006235632 är spärrad. |
| `canonical_transition_ediel_production_v1_unchecked` | Repot skriver `lock_key`. | 20261006235632 är spärrad. |

## 4. Repot är nyare: kandidater för installation (10)

**Genomfört 2026-10-23:** alla 10 i tabellen och `gridex_enforce_supplier_utilts_outbound_v1` är installerade med repots kropp, som `drift_converge_01` till `_11`.

Varje steg kontrollerade först att produktionens kropp fortfarande hade den förväntade sha256, och avbröts annars. Funktionen installerades sedan med `CREATE OR REPLACE`. Till sist verifierades sha256 mot `schema.sql` och att ACL och ägare var oförändrade.

Före installationen kontrollerades två saker särskilt:

- `persist_series_v1`: produktionens spärrade anropare `gridex_persist_utilts_consumption_v1` skapar en receipt med `contract_version=1` och hamnar därför i `persist_series_legacy_v1`. Den skiljer sig från den tidigare kroppen bara genom tre kontroller som gör den strängare.
- `canonical_provision_company_v3_pre_invitation_intent`: idempotenshashen beräknas på samma sätt som förut, på `p_command - 'actor_user_id'`.

För var och en finns produktionens kropp ordagrant i en äldre migration, och repot har senare utökat den. Alla beroenden finns i produktion: retentionsfunktionerna, `customer_retention_tombstoned_v1`, `ediel_is_qualified_retention_transition_v1` och kolumnen `canonical_provisioning_requests.request_hash`.

| Funktion | Vad repot lägger till | Prod / repo-fil | Anropas från appen |
|---|---|---|---|
| `gridex_received_sources.observe_document_reference_v1` | Jämför starttiden mot `date_trunc('milliseconds', recorded_at)`. | 20260924013820 / 20260929082115 | nej |
| `gridex_refresh_customer_process_summary` | Returnerar `{}` för en kund med retention-tombstone. | 20260823185028 / 20261001142580 | ja |
| `gridex_materialize_supplier_switch_process_variant` | Variant H med Z25, i stället för alltid L/Z22. | 20260821140500 / 20261001142540 | nej |
| `gridex_bind_locked_portfolio_settlement_to_underlay` | Kontroll att finanskopior finns kvar (retention). | 20260718162000 / 20261001070000 | nej |
| `gridex_attach_portfolio_settlement_to_invoice` | Kontroll att finanskopior finns kvar (retention). | 20260803150723 / 20261001070000 | nej |
| `gridex_get_signature_before_record_retention_v1` | `clock_timestamp()`; namn och e-post tas från signatursnapshot. | 20260818165847 / 20261013093621 | nej |
| `gridex_finalize_signature_before_record_retention_v1` | `clock_timestamp()` och en ögonblicksbild av kundidentiteten vid signering. | 20261008051727 / 20261013093621 | nej |
| `gridex_correction_process.witness_v1` | Hanterar fakta med tombstone (retention). | 20260924080601 / 20261001015945 | nej |
| `canonical_provision_company_v3_pre_invitation_intent` | Hashen beräknas utan `actor_user_id` och sparas som `request_hash`. | 20260802170000 / 20260817210500 | nej |
| `gridex_utilts_binding.persist_series_v1` | En större omskrivning (UTILTS-lagring). | 20260927160000 / 20261001010230 | nej |

**Två saker att observera:**

- `gridex_enforce_supplier_utilts_outbound_v1` hör egentligen också hit. Repot lägger till ett undantag så att retention får tömma `raw_payload`. Men produktionens kropp finns inte i någon migration, och därför ligger den under 5.
- `canonical_provision_company_v3_pre_invitation_intent` ändrar hur idempotenshashen beräknas. Om det redan finns sparade förfrågningar kan en upprepning efter bytet ge en annan hash. Hur många rader det rör bör kontrolleras före installation.

## 5. Produktionen avviker: beslut behövs (7)

Produktionens kropp finns inte i någon migrationsfil. Den har alltså ändrats direkt i produktion.

| Funktion | Produktion | Repo | Förslag |
|---|---|---|---|
| `gridex_apply_exact_z02_core` | Har två extra kontroller (begäran/kund/anläggning och anläggning/kund) innan Z02 tillämpas. Formen finns bland bb0b-förslagen. | Saknar kontrollerna. | **Behåll produktionens version.** Repot bör följa efter via en migration. |
| `gridex_dependency_circuit_before_request_v1` | Har det extra villkoret `half_open_after IS NOT NULL`. | Saknar villkoret. | Behåll produktionens version; repot bör följa efter. |
| `gridex_stage_energy_geodata_features_v2` | Använder en materialiserad CTE (en prestandaform). | Använder `jsonb_array_elements` direkt. | Behåll produktionens version; repot bör följa efter. |
| `gridex_can` | Delegerar till `gridex_has_permission(auth.uid(), …)`. | Har en egen logik för overrides och roller. | Beslut behövs. Troligen är produktionens version den nyare. |
| `gridex_create_invoice_export_graph_v1_core` | Skriver `invoice_reference`, med fallback `draft:…`. | Skriver inte kolumnen. | Beslut behövs. Kontrollera vilken tabell och kolumn produktionen skriver till. |
| `run_tenant_integrity_audit` | Kontrollerar att switch- och kontraktsrader har samma `company_id`. | Kontrollerar i stället att mätpunktens kund stämmer. | Beslut behövs. Versionerna kontrollerar olika saker; den naturliga lösningen är att slå ihop dem. |
| `gridex_enforce_supplier_utilts_outbound_v1` | Saknar retention-undantaget. | Har undantaget. | Installera troligen repots version (se under 4). |

**Genomfört 2026-10-23 (grupp 5):**

- `gridex_can`: repot följer produktionen ([#907](https://github.com/heke99/gridex-ops-platform/pull/907), migration 20261023130000). Kroppen är byte-identisk, så produktionen ändrades inte.
- `gridex_apply_exact_z02_core`, `gridex_dependency_circuit_before_request_v1`, `gridex_stage_energy_geodata_features_v2` och `gridex_create_invoice_export_graph_v1_core`: repot följer produktionens kropp ([#908](https://github.com/heke99/gridex-ops-platform/pull/908), migration 20261023150000).
  - Z02-kärnan behåller repots `search_path 'pg_catalog'`. Produktionen ändrades från `'public'` till `'pg_catalog'`.
  - Fakturaexporten lämnar `partner_export_id` tom på utkastet tills leverantörshändelsen sätter den. Triggern ersätter `invoice_reference` vid insert.
- `run_tenant_integrity_audit`: båda kontrollerna i OUTBOUND-001 är sammanslagna, och den nya kroppen (sha `504ad4e0…`) är installerad i produktion.
  - Kolumnerna för byte och kontrakt läses via `to_jsonb(o)`, så funktionen fungerar även med repots schema, som saknar dem.
- Produktionsinstallationen `converge_prod_divergent_functions_908` verifierade sha, `search_path`, ACL och ägare.
- Testkörningen av revisionen rullades tillbaka och gav `ok`. Den hittade två ACCESS-002-fynd (medlemskapsrollen stämmer inte med rollmappningen). De gäller befintlig data och påverkas inte av ändringen.
- ACCESS-002 rättat samma dag via den kanoniska kommandovägen `canonical_change_tenant_user_access` (aktör plattformsadmin, idempotensnycklar `access002-repair-20261023-*`, med audit- och domänhändelser):
  - Test bolag: medlemskapet `c24b8f45` hade `membership_role` `admin`. Det ändrades till den kanoniska `company_admin`, och behörigheterna är oförändrade.
  - Gridex El AB: medlemskapet `5fdaa1b6` har bolagets enda ägare. Där fick `role_key` och RBAC-rollen värdet `owner`, så att de stämmer med ägarskapet. `owner` och `company_admin` har identiska behörigheter.
  - Efterkontroll: ACCESS-002 och ACCESS-003 har 0 fynd, och Gridex El AB har fortfarande exakt en ägare. En ny revision (återställd) gav 0 fynd.

## Hur en installation går till

Varje funktion installeras i en egen transaktion med `CREATE OR REPLACE`, eftersom argumenten inte ändras. Behörigheterna sätts till samma mottagare som i `schema.sql`. Ett avslutande block kontrollerar sha256 för `prosrc`, mottagarna och ägaren. Vid avvikelse rullas allt tillbaka. Produktionens tidigare kropp sparas i `prodsrc.json` (sessionens scratchpad) så att en ändring kan backas.
