-- Supabase advisor hardening A: deterministic search_path on public functions.
--
-- Advisor: function_search_path_mutable (WARN).
-- Fix: ALTER FUNCTION ... SET search_path with EXACT identity signatures taken
-- from the live database. Function bodies, owners, SECURITY DEFINER/INVOKER
-- modes and grants are untouched (ALTER ... SET only changes proconfig).
--
-- search_path choices:
--   - public, pg_temp                => default for Gridex public-schema
--     functions (all object references are public or pg_catalog).
--   - public, extensions, pg_temp    => gridex_lonlat_to_grid_area only
--     (PostGIS: schema-qualified extensions.ST_* calls plus geometry type/
--     operator resolution).
--
-- Every ALTER is guarded with to_regprocedure so the migration replays safely
-- on environments where an object does not exist (yet).
--
-- See docs/security/supabase-advisors-hardening.md for the full inventory.

set lock_timeout = '5s';
set statement_timeout = '120s';

do $$
declare
  entry record;
begin
  for entry in
    select * from (values
      ('public.gridex_normalize_customer_number_prefix(text, text)',                                          'public, pg_temp'),
      ('public.gridex_legal_text_versions_set_updated_at()',                                                  'public, pg_temp'),
      ('public.gridex_prevent_published_legal_text_mutation()',                                               'public, pg_temp'),
      ('public.gridex_customer_legal_acceptances_immutable()',                                                'public, pg_temp'),
      ('public.gridex_assert_same_company(uuid, uuid, text, text)',                                           'public, pg_temp'),
      ('public.gridex_customer_sites_company_guard()',                                                        'public, pg_temp'),
      ('public.gridex_metering_points_company_guard()',                                                       'public, pg_temp'),
      ('public.gridex_customer_contracts_company_guard()',                                                    'public, pg_temp'),
      ('public.gridex_contract_price_snapshots_company_guard()',                                              'public, pg_temp'),
      ('public.gridex_customer_legal_acceptances_company_guard()',                                            'public, pg_temp'),
      ('public.gridex_powers_of_attorney_company_guard()',                                                    'public, pg_temp'),
      ('public.gridex_billing_underlays_company_guard()',                                                     'public, pg_temp'),
      ('public.claim_inbound_processing_jobs(text, integer, text, interval)',                                 'public, pg_temp'),
      ('public.claim_ediel_outbox_items(text, uuid, integer, text, interval)',                                'public, pg_temp'),
      ('public.gridex_normalize_actor_text(text)',                                                            'public, pg_temp'),
      ('public.gridex_normalize_actor_identifier(text, text)',                                                'public, pg_temp'),
      ('public.gridex_normalize_public_offer_code(text)',                                                     'public, pg_temp'),
      ('public.gridex_assign_public_offer_code()',                                                            'public, pg_temp'),
      ('public.gridex_lonlat_to_grid_area(numeric, numeric)',                                                 'public, extensions, pg_temp'),
      ('public.gridex_customer_operation_jobs_run_after_guard()',                                             'public, pg_temp'),
      ('public.gridex_platform_default_legal_templates_set_updated_at()',                                     'public, pg_temp'),
      ('public.gridex_block_contract_price_snapshot_mutation()',                                              'public, pg_temp'),
      ('public.gridex_protect_locked_pricing_runs()',                                                         'public, pg_temp'),
      ('public.gridex_protect_sent_invoice_export_items()',                                                   'public, pg_temp'),
      -- Trigger overload; the 4-arg overload already pins search_path.
      ('public.gridex_validate_outbound_payload()',                                                           'public, pg_temp')
    ) as t(signature, path)
  loop
    if to_regprocedure(entry.signature) is not null then
      execute format('alter function %s set search_path = %s', entry.signature, entry.path);
    else
      raise notice 'gridex advisor hardening: function % not found, skipping search_path pin', entry.signature;
    end if;
  end loop;
end $$;
