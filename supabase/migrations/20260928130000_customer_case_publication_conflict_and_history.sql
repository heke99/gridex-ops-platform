-- Do not use serialization_failure (40001) for an expected user revision
-- conflict: PostgREST 14 retries that transaction until the gateway times out.
-- Revision allocation retains history across withdrawal and republication.
begin;
set local lock_timeout = '10s';

create or replace function public.gridex_publish_customer_case_v1(
  p_company_id uuid, p_case_id uuid, p_actor_user_id uuid,
  p_title text, p_body text, p_status text, p_expected_revision bigint,
  p_channel text default 'ops'
) returns public.customer_case_publications
language plpgsql security invoker set search_path = ''
as $function$
declare
  v_case public.customer_cases%rowtype;
  v_result public.customer_case_publications%rowtype;
  v_revision bigint;
  v_current_revision bigint;
begin
  select * into v_case from public.customer_cases
    where id=p_case_id and company_id=p_company_id for update;
  if not found then
    raise exception using errcode='P0002', message='case_not_found_in_tenant';
  end if;
  if not exists (
    select 1 from public.user_profiles up
    join public.company_memberships cm on cm.user_id=up.id and cm.company_id=v_case.company_id
    join public.companies c on c.id=cm.company_id
    where up.id=p_actor_user_id and up.user_status='active'
      and cm.status='active' and coalesce(cm.is_active,true)
      and c.status in ('active','onboarding') and coalesce(c.is_active,true)
  ) or not coalesce(public.gridex_actor_has_company_permission(
      p_actor_user_id,v_case.company_id,'cases.write'),false) then
    raise exception using errcode='42501', message='case_publication_actor_not_authorized';
  end if;
  if p_title is null or length(btrim(p_title)) not between 1 and 180
     or p_body is null or length(btrim(p_body)) not between 1 and 8000
     or p_status is null or p_status not in ('open','waiting_for_customer','resolved','closed')
     or p_channel is null or p_channel not in ('ops','phone') then
    raise exception using errcode='22023', message='invalid_case_publication';
  end if;

  select coalesce(max(revision),0) into v_current_revision
    from public.customer_case_publications
    where customer_case_id=p_case_id;
  if p_expected_revision is distinct from v_current_revision then
    raise exception using errcode='PT409', message='case_publication_revision_conflict';
  end if;

  select coalesce(max(revision),0)+1 into v_revision
    from public.customer_case_publications where customer_case_id=p_case_id;
  update public.customer_case_publications
    set revoked_at=clock_timestamp(), revoked_by=p_actor_user_id
    where customer_case_id=p_case_id and revoked_at is null;
  insert into public.customer_case_publications (
    company_id,customer_id,customer_case_id,revision,public_title,public_body,
    public_status,author_user_id,channel
  ) values (
    v_case.company_id,v_case.customer_id,v_case.id,v_revision,btrim(p_title),btrim(p_body),
    p_status,p_actor_user_id,p_channel
  ) returning * into v_result;
  insert into public.customer_case_events (
    company_id,customer_id,customer_case_id,event_type,event_status,message,payload,created_by
  ) values (
    v_case.company_id,v_case.customer_id,v_case.id,'customer_publication','info',
    'Kundsynlig ärendeversion publicerad.',
    jsonb_build_object('publication_id',v_result.id,'revision',v_revision,'channel',p_channel),
    p_actor_user_id
  );
  return v_result;
end
$function$;

create or replace function public.gridex_revoke_customer_case_publication_v1(
  p_company_id uuid, p_case_id uuid, p_actor_user_id uuid,
  p_expected_revision bigint
) returns boolean language plpgsql security invoker set search_path = ''
as $function$
declare
  v_case public.customer_cases%rowtype;
  v_publication_id uuid;
  v_current_revision bigint;
begin
  select * into v_case from public.customer_cases
    where id=p_case_id and company_id=p_company_id for update;
  if not found then
    raise exception using errcode='P0002', message='case_not_found_in_tenant';
  end if;
  if not exists (
    select 1 from public.user_profiles up
    join public.company_memberships cm on cm.user_id=up.id and cm.company_id=v_case.company_id
    join public.companies c on c.id=cm.company_id
    where up.id=p_actor_user_id and up.user_status='active'
      and cm.status='active' and coalesce(cm.is_active,true)
      and c.status in ('active','onboarding') and coalesce(c.is_active,true)
  ) or not coalesce(public.gridex_actor_has_company_permission(
      p_actor_user_id,v_case.company_id,'cases.write'),false) then
    raise exception using errcode='42501', message='case_publication_actor_not_authorized';
  end if;
  select revision into v_current_revision from public.customer_case_publications
    where customer_case_id=p_case_id and revoked_at is null;
  if v_current_revision is null or p_expected_revision is distinct from v_current_revision then
    raise exception using errcode='PT409', message='case_publication_revision_conflict';
  end if;
  update public.customer_case_publications
    set revoked_at=clock_timestamp(), revoked_by=p_actor_user_id
    where customer_case_id=p_case_id and revoked_at is null
    returning id into v_publication_id;
  if v_publication_id is null then return false; end if;
  insert into public.customer_case_events (
    company_id,customer_id,customer_case_id,event_type,event_status,message,payload,created_by
  ) values (
    v_case.company_id,v_case.customer_id,v_case.id,'customer_publication_revoked','info',
    'Kundsynlig ärendeversion drogs tillbaka.',
    jsonb_build_object('publication_id',v_publication_id),p_actor_user_id
  );
  return true;
end
$function$;

-- The OPS page needs the latest revision even when no snapshot is active.
-- It passes only IDs from its tenant-scoped support page; the RPC itself also
-- binds every aggregate to that tenant and remains service-role only.
create function public.gridex_case_publication_heads_v1(
  p_company_id uuid, p_case_ids uuid[]
) returns table(customer_case_id uuid, revision bigint)
language sql stable security invoker set search_path = ''
as $function$
  select cp.customer_case_id, max(cp.revision) as revision
    from public.customer_case_publications cp
    join public.customer_cases cc on cc.id=cp.customer_case_id
      and cc.company_id=cp.company_id and cc.customer_id=cp.customer_id
    where cc.company_id=p_company_id and cp.customer_case_id=any(p_case_ids)
    group by cp.customer_case_id
$function$;
revoke all on function public.gridex_case_publication_heads_v1(uuid,uuid[])
  from public, anon, authenticated;
grant execute on function public.gridex_case_publication_heads_v1(uuid,uuid[])
  to service_role;

commit;
