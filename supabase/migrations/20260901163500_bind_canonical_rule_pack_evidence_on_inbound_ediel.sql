create or replace function public.gridex_bind_inbound_ediel_rule_pack_evidence()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_rule_pack_id uuid;
  v_profile_id uuid;
  v_profile_key text;
  v_guide_version text;
  v_guide_revision text;
  v_source_hash text;
  v_effective_date date;
  v_match_count integer;
begin
  if new.direction <> 'inbound' or new.company_id is null or new.message_family not in ('PRODAT','UTILTS') then
    return new;
  end if;

  if new.canonical_rule_pack_id is not null
     and nullif(new.rule_profile_key,'') is not null
     and new.rule_profile_version_id is not null
     and nullif(new.rule_profile_version,'') is not null
     and nullif(new.rule_pack_checksum,'') is not null
     and coalesce(new.rule_pack_snapshot,'{}'::jsonb) <> '{}'::jsonb then
    return new;
  end if;

  v_effective_date := coalesce(new.message_received_at::date, new.created_at::date, current_date);

  select count(*)
  into v_match_count
  from public.ediel_message_profiles mp
  join public.ediel_rule_packs rp on rp.id = mp.rule_pack_id
  where mp.is_enabled = true
    and mp.profile->>'family' = new.message_family
    and mp.message_code = new.message_code
    and mp.direction in ('inbound','both')
    and rp.status in ('active','future')
    and rp.valid_from <= v_effective_date
    and (rp.valid_to is null or rp.valid_to >= v_effective_date);

  if v_match_count <> 1 then
    raise exception 'canonical_inbound_rule_profile_resolution_failed:%:%:%:%',
      new.message_family, coalesce(new.message_code,''), v_effective_date, v_match_count
      using errcode='23514';
  end if;

  select mp.rule_pack_id, mp.id, mp.profile_key, rp.guide_version, rp.guide_revision, rp.source_hash
  into v_rule_pack_id, v_profile_id, v_profile_key, v_guide_version, v_guide_revision, v_source_hash
  from public.ediel_message_profiles mp
  join public.ediel_rule_packs rp on rp.id = mp.rule_pack_id
  where mp.is_enabled = true
    and mp.profile->>'family' = new.message_family
    and mp.message_code = new.message_code
    and mp.direction in ('inbound','both')
    and rp.status in ('active','future')
    and rp.valid_from <= v_effective_date
    and (rp.valid_to is null or rp.valid_to >= v_effective_date)
  limit 1;

  new.canonical_rule_pack_id := v_rule_pack_id;
  new.rule_profile_key := v_profile_key;
  new.rule_profile_version_id := v_profile_id;
  new.rule_profile_version := v_guide_version || ':r' || v_guide_revision;
  new.rule_pack_checksum := v_source_hash;
  new.rule_pack_snapshot := jsonb_build_object(
    'family', new.message_family,
    'code', new.message_code,
    'direction', 'inbound',
    'environment', new.environment,
    'profileKey', v_profile_key,
    'profileVersionId', v_profile_id,
    'version', v_guide_version || ':r' || v_guide_revision,
    'checksum', v_source_hash,
    'authority', 'gridex_bind_inbound_ediel_rule_pack_evidence',
    'databaseRole', 'evidence_only',
    'effectiveDate', v_effective_date
  );

  return new;
end;
$function$;

drop trigger if exists trg_gridex_bind_inbound_ediel_rule_pack_evidence on public.ediel_messages;
create trigger trg_gridex_bind_inbound_ediel_rule_pack_evidence
before insert or update of company_id,message_family,message_code,direction,message_received_at
on public.ediel_messages
for each row
execute function public.gridex_bind_inbound_ediel_rule_pack_evidence();

with candidates as (
  select m.id,
         mp.rule_pack_id,
         mp.id as profile_id,
         mp.profile_key,
         rp.guide_version || ':r' || rp.guide_revision as profile_version,
         rp.source_hash,
         coalesce(m.message_received_at::date,m.created_at::date,current_date) as effective_date,
         count(*) over (partition by m.id) as match_count
  from public.ediel_messages m
  join public.ediel_message_profiles mp
    on mp.is_enabled=true
   and mp.profile->>'family'=m.message_family
   and mp.message_code=m.message_code
   and mp.direction in ('inbound','both')
  join public.ediel_rule_packs rp
    on rp.id=mp.rule_pack_id
   and rp.status in ('active','future')
   and rp.valid_from <= coalesce(m.message_received_at::date,m.created_at::date,current_date)
   and (rp.valid_to is null or rp.valid_to >= coalesce(m.message_received_at::date,m.created_at::date,current_date))
  where m.direction='inbound'
    and m.company_id is not null
    and m.message_family in ('PRODAT','UTILTS')
    and (
      m.canonical_rule_pack_id is null or nullif(m.rule_profile_key,'') is null or
      m.rule_profile_version_id is null or nullif(m.rule_profile_version,'') is null or
      nullif(m.rule_pack_checksum,'') is null or coalesce(m.rule_pack_snapshot,'{}'::jsonb)='{}'::jsonb
    )
), unique_candidates as (
  select * from candidates where match_count=1
)
update public.ediel_messages m
set canonical_rule_pack_id=c.rule_pack_id,
    rule_profile_key=c.profile_key,
    rule_profile_version_id=c.profile_id,
    rule_profile_version=c.profile_version,
    rule_pack_checksum=c.source_hash,
    rule_pack_snapshot=jsonb_build_object(
      'family',m.message_family,
      'code',m.message_code,
      'direction','inbound',
      'environment',m.environment,
      'profileKey',c.profile_key,
      'profileVersionId',c.profile_id,
      'version',c.profile_version,
      'checksum',c.source_hash,
      'authority','gridex_bind_inbound_ediel_rule_pack_evidence',
      'databaseRole','evidence_only',
      'effectiveDate',c.effective_date,
      'backfilled',true
    )
from unique_candidates c
where m.id=c.id;
