-- Anonymous reset admission is owned by the server, before Auth lookup or SMTP.
-- Only keyed, domain-separated HMAC digests are stored; never raw email/IP data.
create schema if not exists gridex_private;

create table gridex_private.public_password_reset_budget (
  scope text not null check (scope in ('email', 'client', 'global')),
  bucket_key text not null,
  window_started_at timestamptz not null,
  request_count integer not null check (request_count >= 0),
  next_allowed_at timestamptz not null default '-infinity',
  expires_at timestamptz not null,
  primary key (scope, bucket_key),
  check ((scope = 'global' and bucket_key = 'global') or
         (scope in ('email', 'client') and bucket_key ~ '^[0-9a-f]{64}$'))
);
create index public_password_reset_budget_expiry_idx
  on gridex_private.public_password_reset_budget (expires_at)
  where scope <> 'global';
alter table gridex_private.public_password_reset_budget enable row level security;
revoke all on table gridex_private.public_password_reset_budget from public, anon, authenticated, service_role;

-- A stable row serializes this small admission transaction across all instances.
-- It also lets the global cap reject new keys before per-address/client inserts.
insert into gridex_private.public_password_reset_budget
  (scope, bucket_key, window_started_at, request_count, expires_at)
values ('global', 'global', clock_timestamp(), 0, 'infinity');

create function public.gridex_consume_public_password_reset_budget_v1(
  p_email_key text,
  p_client_key text
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog
set lock_timeout = '2s'
set statement_timeout = '3s'
as $$
declare
  v_now timestamptz;
  v_global gridex_private.public_password_reset_budget%rowtype;
  v_email gridex_private.public_password_reset_budget%rowtype;
  v_client gridex_private.public_password_reset_budget%rowtype;
begin
  if p_email_key is null or p_email_key !~ '^[0-9a-f]{64}$'
     or p_client_key is null or p_client_key !~ '^[0-9a-f]{64}$' then
    return false;
  end if;

  select * into v_global from gridex_private.public_password_reset_budget
    where scope = 'global' and bucket_key = 'global' for update;
  if not found then return false; end if;
  -- Use server time after acquiring the lock, never a client-supplied timestamp.
  v_now := clock_timestamp();
  if v_now >= v_global.window_started_at + interval '1 minute' then
    v_global.window_started_at := v_now;
    v_global.request_count := 0;
  end if;
  if v_global.request_count >= 120 then return false; end if;

  select * into v_email from gridex_private.public_password_reset_budget
    where scope = 'email' and bucket_key = p_email_key;
  if found then
    if v_now < v_email.next_allowed_at then return false; end if;
    if v_now >= v_email.window_started_at + interval '1 hour' then
      v_email.window_started_at := v_now;
      v_email.request_count := 0;
    end if;
    if v_email.request_count >= 5 then return false; end if;
  else
    v_email.window_started_at := v_now;
    v_email.request_count := 0;
  end if;

  select * into v_client from gridex_private.public_password_reset_budget
    where scope = 'client' and bucket_key = p_client_key;
  if found then
    if v_now >= v_client.window_started_at + interval '10 minutes' then
      v_client.window_started_at := v_now;
      v_client.request_count := 0;
    end if;
    if v_client.request_count >= 10 then return false; end if;
  else
    v_client.window_started_at := v_now;
    v_client.request_count := 0;
  end if;

  -- Charge all tiers together only after every tier admits the request.
  insert into gridex_private.public_password_reset_budget
    (scope, bucket_key, window_started_at, request_count, next_allowed_at, expires_at)
  values ('email', p_email_key, v_email.window_started_at, v_email.request_count + 1,
          v_now + interval '60 seconds',
          greatest(v_email.window_started_at + interval '1 hour', v_now + interval '60 seconds'))
  on conflict (scope, bucket_key) do update set
    window_started_at = excluded.window_started_at,
    request_count = excluded.request_count,
    next_allowed_at = excluded.next_allowed_at,
    expires_at = excluded.expires_at;

  insert into gridex_private.public_password_reset_budget
    (scope, bucket_key, window_started_at, request_count, expires_at)
  values ('client', p_client_key, v_client.window_started_at, v_client.request_count + 1,
          v_client.window_started_at + interval '10 minutes')
  on conflict (scope, bucket_key) do update set
    window_started_at = excluded.window_started_at,
    request_count = excluded.request_count,
    expires_at = excluded.expires_at;

  update gridex_private.public_password_reset_budget
    set window_started_at = v_global.window_started_at,
        request_count = v_global.request_count + 1
    where scope = 'global' and bucket_key = 'global';

  -- Work is bounded even when old keys accumulate; active cooldowns survive.
  delete from gridex_private.public_password_reset_budget
    where (scope, bucket_key) in (
      select scope, bucket_key from gridex_private.public_password_reset_budget
        where scope <> 'global' and expires_at <= v_now
        order by expires_at limit 100
    );
  return true;
end;
$$;
revoke all on function public.gridex_consume_public_password_reset_budget_v1(text, text) from public, anon, authenticated;
grant execute on function public.gridex_consume_public_password_reset_budget_v1(text, text) to service_role;
