create or replace function public.canonical_ediel_production_evidence_readiness(p_company_id uuid)
returns jsonb
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
with pilot_required(required) as (
  select exists(
    select 1
    from public.ediel_messages m
    where m.company_id = p_company_id
      and m.environment = 'production'
      and m.direction = 'outbound'
      and m.status = 'sent'
  )
), required(evidence_type) as (
  values
    ('TGT'::text),
    ('AGT'),
    ('SHADOW_PRODUCTION'),
    ('LIVE_TENANT_INTEGRITY'),
    ('RESTORE_REPLAY')
  union all
  select 'LIMITED_PILOT'
  from pilot_required
  where required = true
), valid as (
  select distinct e.evidence_type
  from public.ediel_certification_evidence e
  where e.company_id = p_company_id
    and e.environment = 'production'
    and e.engine_schema_version = public.canonical_current_ediel_engine_schema_version()
    and e.status = 'passed'
    and nullif(btrim(e.external_reference), '') is not null
    and nullif(btrim(e.evidence_document_reference), '') is not null
    and e.tested_at is not null
    and e.tested_at <= now()
    and e.approved_by is not null
    and e.approved_at is not null
    and (e.valid_until is null or e.valid_until > now())
    and (e.valid_until is null or e.valid_until > e.tested_at)
), missing as (
  select r.evidence_type
  from required r
  left join valid v using (evidence_type)
  where v.evidence_type is null
), passed as (
  select r.evidence_type
  from required r
  join valid v using (evidence_type)
)
select jsonb_build_object(
  'ready', not exists(select 1 from missing),
  'engine_schema_version', public.canonical_current_ediel_engine_schema_version(),
  'pilot_required', (select required from pilot_required),
  'passed', coalesce((select jsonb_agg(evidence_type order by evidence_type) from passed), '[]'::jsonb),
  'missing', coalesce((select jsonb_agg(evidence_type order by evidence_type) from missing), '[]'::jsonb)
)
$function$;

revoke all on function public.canonical_ediel_production_evidence_readiness(uuid) from public,anon,authenticated;
grant execute on function public.canonical_ediel_production_evidence_readiness(uuid) to service_role;
