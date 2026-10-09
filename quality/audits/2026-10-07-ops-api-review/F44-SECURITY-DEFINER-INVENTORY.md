# F44 — exponerade SECURITY DEFINER-funktioner (riskklassad inventering)

Läsande katalogfråga mot live (`piidsfebjqjmnepdpnas`) 2026-10-09: alla `public`-funktioner med `prosecdef` och EXECUTE för `authenticated` (33 st). Ingen är körbar av `anon`. Kropparna jämfördes med `supabase/schema.sql`.

| Klass | Funktioner | Bedömning |
|---|---|---|
| Muterande, guard via helper | `gridex_create/finalize/transition_supplier_switch_v1` | Första satsen `perform gridex_assert_switch_writer_v1(p_company_id)`; tenant från parametern kontrolleras mot anroparens behörighet. OK. |
| Muterande, direkt `auth.uid()`-guard | `anonymize_user_account`, `gridex_assign_company_to_whitelabel` | OK. |
| Läsning, portfolio | `gridex_customer_portfolio_*` (9), `gridex_whitelabel_portfolio_overview` | Alla anropar `gridex_customer_portfolio_assert_read` / `gridex_user_can_read_whitelabel_platform`. OK. |
| RLS-/sessionhjälpare | `gridex_user_company_ids`, `gridex_is_current_session_allowed` (F30-fixad), `gridex_can_read/write_company`, `gridex_user_is_platform_admin`, `gridex_current_user_context`, m.fl. | Avsedda att köras av authenticated i policies. OK. |
| Delegering | `canonical_authenticated_tenant_context` | Delegerar till `_v1_scoped` som använder `auth.uid()`. OK. |
| Ren katalogdata | `gridex_required_legal_modules` (2 överlagringar) | Ingen tenant-/kunddata. OK. |
| **Behörighetsorakel (P3)** | `gridex_has_permission(p_user_id, …)`, `gridex_actor_has_company_permission(p_actor_user_id, p_company_id, …)` | Tar godtyckligt användar-id; en inloggad användare kan fråga om en annan användares behörighet (boolean). Ingen data-/skrivåtkomst. Används av policies/serverkod, så grants ändras inte blint. **Rekommendation:** separat PR som binder `p_user_id = auth.uid()` för authenticated-anrop (service_role oförändrad) efter genomgång av anropare. |

RLS-tabeller utan policy (advisor: 103) är default deny för authenticated/anon och används via service_role; de klassas som avsedd service-only och inte som sårbarheter. Status: **F44 QUALIFIED** — en kvarstående P3-rekommendation (behörighetsorakel), inga konstaterade tenantläckor.
