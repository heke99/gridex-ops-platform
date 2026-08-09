-- Runtime remediation: prevent PL/pgSQL output variable `status` from colliding
-- with table columns in gridex_ops_health_checks().
--
-- Production evidence on 2026-08-09 reproduced SQLSTATE 42702 at
-- tenant_email_outbox.status. Patch only the ambiguous references in the
-- installed canonical function and fail closed if its expected shape drifts.

begin;

set local search_path = public, pg_catalog;

do $migration$
declare
  v_definition text;
  v_patched text;
  v_replacements integer := 0;
begin
  if to_regprocedure('public.gridex_ops_health_checks()') is null then
    raise exception 'gridex_ops_health_checks() is missing; cannot apply status qualification';
  end if;

  select pg_get_functiondef('public.gridex_ops_health_checks()'::regprocedure)
    into v_definition;
  v_patched := v_definition;

  if position(E'from public.tenant_email_outbox\n  where status =' in v_patched) > 0 then
    v_patched := replace(
      v_patched,
      E'from public.tenant_email_outbox\n  where status =',
      E'from public.tenant_email_outbox email_outbox\n  where email_outbox.status ='
    );
    v_replacements := v_replacements + 1;
  end if;

  if position(E'from public.webhook_deliveries\n  where status =' in v_patched) > 0 then
    v_patched := replace(
      v_patched,
      E'from public.webhook_deliveries\n  where status =',
      E'from public.webhook_deliveries webhook\n  where webhook.status ='
    );
    v_replacements := v_replacements + 1;
  end if;

  if position(E'from public.ediel_outbox\n  where status =' in v_patched) > 0 then
    v_patched := replace(
      v_patched,
      E'from public.ediel_outbox\n  where status =',
      E'from public.ediel_outbox ediel\n  where ediel.status ='
    );
    v_replacements := v_replacements + 1;
  end if;

  if position(E'from public.customer_site_address_conflicts\n    where status =' in v_patched) > 0 then
    v_patched := replace(
      v_patched,
      E'from public.customer_site_address_conflicts\n    where status =',
      E'from public.customer_site_address_conflicts conflict_row\n    where conflict_row.status ='
    );
    v_replacements := v_replacements + 1;
  end if;

  if position(E'from public.customer_sites\n  where status =' in v_patched) > 0 then
    v_patched := replace(
      v_patched,
      E'from public.customer_sites\n  where status =',
      E'from public.customer_sites site\n  where site.status ='
    );
    v_replacements := v_replacements + 1;
  end if;

  if v_replacements = 0 then
    if v_definition like '%email_outbox.status =%'
       and v_definition like '%webhook.status =%'
       and v_definition like '%ediel.status =%'
       and v_definition like '%conflict_row.status =%'
       and v_definition like '%site.status =%' then
      return;
    end if;
    raise exception 'gridex_ops_health_checks() canonical status references did not match expected shape';
  end if;

  if v_replacements <> 5 then
    raise exception 'gridex_ops_health_checks() expected 5 ambiguous status references, patched %', v_replacements;
  end if;

  execute v_patched;
end;
$migration$;

commit;
