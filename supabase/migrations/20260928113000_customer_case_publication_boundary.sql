-- A customer link is not permission to disclose the staff case row. Public
-- snapshots are separately authored and revised; old cases start unpublished.
begin;
set local lock_timeout = '10s';

create table public.customer_case_publications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  customer_id uuid not null,
  customer_case_id uuid not null,
  revision bigint not null check (revision > 0),
  public_title text not null check (length(btrim(public_title)) between 1 and 180),
  public_body text not null check (length(btrim(public_body)) between 1 and 8000),
  public_status text not null check (public_status in ('open', 'waiting_for_customer', 'resolved', 'closed')),
  author_user_id uuid not null references auth.users(id) on delete restrict,
  channel text not null check (channel in ('ops', 'phone')),
  published_at timestamptz not null default clock_timestamp(),
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete restrict,
  constraint customer_case_publications_case_owner_fk
    foreign key (customer_case_id, company_id, customer_id)
    references public.customer_cases(id, company_id, customer_id) on delete cascade,
  constraint customer_case_publications_customer_owner_fk
    foreign key (customer_id, company_id)
    references public.customers(id, company_id) on delete cascade,
  constraint customer_case_publications_revoked_actor_check
    check ((revoked_at is null) = (revoked_by is null)),
  constraint customer_case_publications_revision_key
    unique (customer_case_id, revision)
);

create unique index customer_case_publications_current_key
  on public.customer_case_publications(customer_case_id) where revoked_at is null;
create index customer_case_publications_portal_idx
  on public.customer_case_publications(company_id, customer_id, published_at desc, id desc)
  where revoked_at is null;

alter table public.customer_case_publications enable row level security;
revoke all on table public.customer_case_publications from public, anon, authenticated;
grant select, insert, update on table public.customer_case_publications to service_role;

-- Once written, publication text and attribution never change. A withdrawal
-- is a one-way transition; a new publication creates the next revision.
create function private.gridex_guard_case_publication_revision_v1()
returns trigger language plpgsql security invoker
set search_path = pg_catalog, pg_temp
as $function$
begin
  if old.revoked_at is not null or new.revoked_at is null
     or new.revoked_by is null
     or to_jsonb(old) - 'revoked_at' - 'revoked_by'
        is distinct from to_jsonb(new) - 'revoked_at' - 'revoked_by' then
    raise exception using errcode='23514', message='case_publication_immutable';
  end if;
  return new;
end
$function$;
revoke all on function private.gridex_guard_case_publication_revision_v1()
  from public, anon, authenticated;
create trigger customer_case_publication_immutable
  before update on public.customer_case_publications
  for each row execute function private.gridex_guard_case_publication_revision_v1();

-- The case row lock serializes publish/revoke and allocates revisions. The
-- explicit actor and company permission are checked again inside the local
-- transaction, even though the Server Action has its own permission guard.
create function public.gridex_publish_customer_case_v1(
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
    where customer_case_id=p_case_id and revoked_at is null;
  if p_expected_revision is distinct from v_current_revision then
    raise exception using errcode='40001', message='case_publication_revision_conflict';
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

create function public.gridex_revoke_customer_case_publication_v1(
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
  if p_expected_revision is distinct from v_current_revision then
    raise exception using errcode='40001', message='case_publication_revision_conflict';
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

revoke all on function public.gridex_publish_customer_case_v1(uuid,uuid,uuid,text,text,text,bigint,text)
  from public, anon, authenticated;
grant execute on function public.gridex_publish_customer_case_v1(uuid,uuid,uuid,text,text,text,bigint,text)
  to service_role;
revoke all on function public.gridex_revoke_customer_case_publication_v1(uuid,uuid,uuid,bigint)
  from public, anon, authenticated;
grant execute on function public.gridex_revoke_customer_case_publication_v1(uuid,uuid,uuid,bigint)
  to service_role;

commit;
