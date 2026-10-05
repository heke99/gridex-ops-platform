alter table public.ediel_rule_pack_snapshots
  drop constraint if exists ediel_rule_pack_snapshots_rule_profile_version_id_fkey;

alter table public.ediel_rule_pack_snapshots
  add constraint ediel_rule_pack_snapshots_rule_profile_version_id_fkey
  foreign key (rule_profile_version_id)
  references public.ediel_message_profiles(id);

comment on column public.ediel_rule_pack_snapshots.rule_profile_version_id is
'Legacy column name. Stores the canonical ediel_message_profiles.id used by the active rule-pack registry.';

create or replace function public.gridex_capture_ediel_rule_pack_snapshot()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_profile_rule_pack_id uuid;
begin
  if new.direction='outbound' and new.message_family in ('PRODAT','UTILTS','CONTRL','APERAK','UTILTS_ERR') then
    if new.company_id is null then
      raise exception 'outbound_ediel_company_id_required' using errcode='23502';
    end if;

    if nullif(new.rule_profile_key,'') is null or new.rule_profile_version_id is null
       or nullif(new.rule_profile_version,'') is null or nullif(new.rule_pack_checksum,'') is null
       or coalesce(new.rule_pack_snapshot,'{}'::jsonb)='{}'::jsonb then
      raise exception 'outbound_ediel_rule_pack_snapshot_required' using errcode='23514';
    end if;

    select mp.rule_pack_id into v_profile_rule_pack_id
    from public.ediel_message_profiles mp
    where mp.id = new.rule_profile_version_id
      and mp.is_enabled = true;

    if v_profile_rule_pack_id is null then
      raise exception 'canonical_ediel_message_profile_required:%', new.rule_profile_version_id using errcode='23503';
    end if;

    if new.canonical_rule_pack_id is null or new.canonical_rule_pack_id <> v_profile_rule_pack_id then
      raise exception 'canonical_ediel_rule_pack_profile_mismatch:%:%', coalesce(new.canonical_rule_pack_id::text,'null'), v_profile_rule_pack_id::text using errcode='23514';
    end if;

    insert into public.ediel_rule_pack_snapshots(
      company_id,ediel_message_id,profile_key,rule_profile_version_id,profile_version,checksum,snapshot
    ) values (
      new.company_id,new.id,new.rule_profile_key,new.rule_profile_version_id,new.rule_profile_version,new.rule_pack_checksum,new.rule_pack_snapshot
    ) on conflict(ediel_message_id) do update set
      company_id=excluded.company_id,
      profile_key=excluded.profile_key,
      rule_profile_version_id=excluded.rule_profile_version_id,
      profile_version=excluded.profile_version,
      checksum=excluded.checksum,
      snapshot=excluded.snapshot;
  end if;
  return new;
end;
$function$;
