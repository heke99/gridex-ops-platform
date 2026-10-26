-- FINDINGS K-W1b / owner decision 31 (quality/audits/live-chain-20261015/OWNER-DECISIONS.md): a spelling or company-name
-- difference alone never changes a grid area's grid-owner binding.
--
-- Before: public.gridex_import_grid_area_master_row (SVK ArcGIS import via the geometry upsert, and lib/energy/resolver.ts)
-- matched the imported owner only by gridex_grid_owner_name_key. With no unique mapped match it created a new platform
-- owner (on conflict (lower(name))) and the area upsert rebound platform_grid_areas.grid_owner_id to it, so an area bound
-- to a mapped owner (ops_grid_owner_id set) lost its grid owner for every exact address (K-W1).
--
-- 1. public.platform_grid_area_owner_conflicts: durable review log of a refused rebind: source, the existing binding
--    (platform owner, its name and ops owner) and the imported data (owner name, its name key, the name-matched candidate
--    if any, the import metadata). One open row per area/existing owner/imported name key; a repeat bumps occurrences.
--    Platform-level data (no tenant rows): RLS on, no anon/authenticated access, service_role reads.
-- 2. public.platform_grid_area_owner_changes: history of every verified owner change.
-- 3. gridex_import_grid_area_master_row (exact pre-image 1770c744..., same as supabase/schema.sql; refused otherwise with
--    k_w1b_import_pre_image_changed; metadata checked): when the area is already bound to an active mapped owner and the
--    import resolves a different one, the existing binding (owner id and owner name) is kept and no owner is created.
--    A name-matched candidate with the same ops_grid_owner_id (a documented mapping of the same owner) is kept silently;
--    anything else is logged as a conflict. Unbound areas and areas bound to unmapped owners behave as before.
-- 4. public.gridex_change_platform_grid_area_owner_v1(area, to owner, reason, evidence, conflict, actor): the separate,
--    verified owner change. service_role only (the platform-admin surface guards the caller). The target must be active,
--    carry an Ediel id and be mapped to an OPS owner; reason and evidence are required; the area row is locked; a history
--    row is written in the same transaction; a named conflict must be open for the same area and is resolved by it.
begin;

create table public.platform_grid_area_owner_conflicts (
  id uuid primary key default gen_random_uuid(),
  grid_area_code text not null,
  platform_grid_area_id uuid not null references public.platform_grid_areas(id),
  existing_platform_grid_owner_id uuid not null references public.platform_grid_owners(id),
  existing_owner_name text,
  existing_ops_grid_owner_id uuid,
  imported_owner_name text,
  imported_owner_key text not null,
  candidate_platform_grid_owner_id uuid references public.platform_grid_owners(id),
  source text,
  imported_metadata jsonb not null default '{}'::jsonb,
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  occurrences integer not null default 1 check (occurrences >= 1),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid,
  resolution jsonb
);
create unique index platform_grid_area_owner_conflicts_open_uidx
  on public.platform_grid_area_owner_conflicts (grid_area_code, existing_platform_grid_owner_id, imported_owner_key)
  where status = 'open';
alter table public.platform_grid_area_owner_conflicts enable row level security;
revoke all on table public.platform_grid_area_owner_conflicts from public, anon, authenticated, service_role;
grant select on table public.platform_grid_area_owner_conflicts to service_role;

create table public.platform_grid_area_owner_changes (
  id uuid primary key default gen_random_uuid(),
  grid_area_code text not null,
  platform_grid_area_id uuid not null references public.platform_grid_areas(id),
  from_platform_grid_owner_id uuid references public.platform_grid_owners(id),
  to_platform_grid_owner_id uuid not null references public.platform_grid_owners(id),
  reason text not null check (btrim(reason) <> ''),
  evidence jsonb not null check (jsonb_typeof(evidence) = 'object' and evidence <> '{}'::jsonb),
  conflict_id uuid references public.platform_grid_area_owner_conflicts(id),
  changed_by uuid not null,
  changed_at timestamptz not null default now()
);
alter table public.platform_grid_area_owner_changes enable row level security;
revoke all on table public.platform_grid_area_owner_changes from public, anon, authenticated, service_role;
grant select on table public.platform_grid_area_owner_changes to service_role;

do $kw1b$
declare
  fn constant regprocedure := 'public.gridex_import_grid_area_master_row(text,text,text,text,text,jsonb)'::regprocedure;
  pre_image constant text := '1770c7442eede40fd89375832788b0999c7bc456336522f074213a2ce219eecb';
  old_declare constant text := $o1$  v_canonical_count integer := 0;
begin
$o1$;
  new_declare constant text := $n1$  v_canonical_count integer := 0;
  -- K-W1b (20261026100000): the existing binding, and whether it is kept.
  v_existing public.platform_grid_areas%rowtype;
  v_existing_owner public.platform_grid_owners%rowtype;
  v_candidate_ops uuid;
  v_keep boolean := false;
begin
$n1$;
  old_guard constant text := $o2$  if v_owner_id is null then
    insert into public.platform_grid_owners$o2$;
  new_guard constant text := $n2$  -- K-W1b (20261026100000): a name difference alone never rebinds an area bound to an active mapped owner.
  select * into v_existing from public.platform_grid_areas where grid_area_code = v_code for update;
  if v_existing.id is not null and v_existing.grid_owner_id is not null then
    select * into v_existing_owner from public.platform_grid_owners where id = v_existing.grid_owner_id;
    if v_existing_owner.id is not null and v_existing_owner.ops_grid_owner_id is not null
       and coalesce(v_existing_owner.is_active, true) and v_owner_id is distinct from v_existing_owner.id then
      v_keep := true;
      select pgo.ops_grid_owner_id into v_candidate_ops from public.platform_grid_owners pgo where pgo.id = v_owner_id;
      if v_candidate_ops is distinct from v_existing_owner.ops_grid_owner_id then
        insert into public.platform_grid_area_owner_conflicts(grid_area_code, platform_grid_area_id, existing_platform_grid_owner_id,
          existing_owner_name, existing_ops_grid_owner_id, imported_owner_name, imported_owner_key, candidate_platform_grid_owner_id,
          source, imported_metadata)
        values (v_code, v_existing.id, v_existing_owner.id, v_existing_owner.name, v_existing_owner.ops_grid_owner_id,
          nullif(trim(p_grid_owner_name), ''), coalesce(v_owner_key, ''), v_owner_id, p_source, coalesce(p_metadata, '{}'::jsonb))
        on conflict (grid_area_code, existing_platform_grid_owner_id, imported_owner_key) where status = 'open'
        do update set occurrences = public.platform_grid_area_owner_conflicts.occurrences + 1, last_seen_at = now(),
          imported_owner_name = excluded.imported_owner_name, candidate_platform_grid_owner_id = excluded.candidate_platform_grid_owner_id,
          source = excluded.source, imported_metadata = excluded.imported_metadata;
      end if;
      v_owner_id := v_existing_owner.id;
    end if;
  end if;

  if v_owner_id is null then
    insert into public.platform_grid_owners$n2$;
  old_name constant text := $o3$    v_owner_id,
    nullif(trim(p_grid_owner_name), ''),
$o3$;
  new_name constant text := $n3$    v_owner_id,
    case when v_keep then v_existing.grid_owner_name else nullif(trim(p_grid_owner_name), '') end,
$n3$;
  f record;
  body text;
begin
  select p.oid, to_jsonb(p) - 'prosrc' as metadata, p.prosrc, pg_get_functiondef(p.oid) as definition into strict f
  from pg_proc p where p.oid = fn;
  if encode(sha256(convert_to(f.prosrc, 'UTF8')), 'hex') is distinct from pre_image
    or (length(f.prosrc) - length(replace(f.prosrc, old_declare, ''))) / length(old_declare) <> 1
    or (length(f.prosrc) - length(replace(f.prosrc, old_guard, ''))) / length(old_guard) <> 1
    or (length(f.prosrc) - length(replace(f.prosrc, old_name, ''))) / length(old_name) <> 1
    or (length(f.definition) - length(replace(f.definition, f.prosrc, ''))) / length(f.prosrc) <> 1 then
    raise exception 'k_w1b_import_pre_image_changed' using errcode = 'P0U01';
  end if;
  body := replace(replace(replace(f.prosrc, old_declare, new_declare), old_guard, new_guard), old_name, new_name);
  execute replace(f.definition, f.prosrc, body);
  if (select to_jsonb(p) - 'prosrc' from pg_proc p where p.oid = f.oid) is distinct from f.metadata
    or (select p.prosrc from pg_proc p where p.oid = f.oid) is distinct from body then
    raise exception 'k_w1b_import_metadata_changed' using errcode = 'P0U01';
  end if;
end
$kw1b$;

create function public.gridex_change_platform_grid_area_owner_v1(p_grid_area_code text, p_to_platform_grid_owner_id uuid,
  p_reason text, p_evidence jsonb, p_conflict_id uuid, p_actor_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to public, extensions, pg_catalog, pg_temp
as $fn$
declare
  v_code text := upper(nullif(btrim(p_grid_area_code), ''));
  a public.platform_grid_areas%rowtype;
  t public.platform_grid_owners%rowtype;
  c public.platform_grid_area_owner_conflicts%rowtype;
  v_change uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'grid_area_owner_change_service_role_required';
  end if;
  if v_code is null or p_to_platform_grid_owner_id is null or p_actor_user_id is null then
    raise exception using errcode = '22023', message = 'grid_area_owner_change_input_required';
  end if;
  if nullif(btrim(p_reason), '') is null or jsonb_typeof(p_evidence) is distinct from 'object' or p_evidence = '{}'::jsonb then
    raise exception using errcode = '22023', message = 'grid_area_owner_change_reason_and_evidence_required';
  end if;
  select * into a from public.platform_grid_areas where grid_area_code = v_code for update;
  if a.id is null then
    raise exception using errcode = 'P0002', message = 'grid_area_not_found';
  end if;
  select * into t from public.platform_grid_owners where id = p_to_platform_grid_owner_id;
  if t.id is null or not coalesce(t.is_active, true) or nullif(btrim(t.ediel_id), '') is null or t.ops_grid_owner_id is null then
    raise exception using errcode = '23514', message = 'grid_area_owner_change_target_not_verified';
  end if;
  if a.grid_owner_id is not distinct from t.id then
    raise exception using errcode = '23514', message = 'grid_area_owner_change_no_change';
  end if;
  if p_conflict_id is not null then
    select * into c from public.platform_grid_area_owner_conflicts where id = p_conflict_id for update;
    if c.id is null or c.status <> 'open' or c.grid_area_code <> v_code then
      raise exception using errcode = '23514', message = 'grid_area_owner_conflict_not_open_for_area';
    end if;
  end if;
  insert into public.platform_grid_area_owner_changes(grid_area_code, platform_grid_area_id, from_platform_grid_owner_id,
    to_platform_grid_owner_id, reason, evidence, conflict_id, changed_by)
  values (v_code, a.id, a.grid_owner_id, t.id, btrim(p_reason), p_evidence, p_conflict_id, p_actor_user_id)
  returning id into v_change;
  update public.platform_grid_areas
     set grid_owner_id = t.id, grid_owner_name = t.name, updated_at = now(),
         metadata = metadata || jsonb_build_object('owner_change_id', v_change)
   where id = a.id;
  if p_conflict_id is not null then
    update public.platform_grid_area_owner_conflicts
       set status = 'resolved', resolved_at = now(), resolved_by = p_actor_user_id,
           resolution = jsonb_build_object('owner_change_id', v_change, 'to_platform_grid_owner_id', t.id)
     where id = p_conflict_id;
  end if;
  return jsonb_build_object('applied', true, 'changeId', v_change, 'from', a.grid_owner_id, 'to', t.id);
end
$fn$;
revoke all on function public.gridex_change_platform_grid_area_owner_v1(text, uuid, text, jsonb, uuid, uuid) from public, anon, authenticated;
grant execute on function public.gridex_change_platform_grid_area_owner_v1(text, uuid, text, jsonb, uuid, uuid) to service_role;

commit;
