-- Simplified customer operations: customer-visible events, auth-mail audit and safe mail separation.

create table if not exists public.customer_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  customer_id uuid,
  event_type text not null,
  source text not null default 'application',
  payload jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table if exists public.customer_events
  add column if not exists company_id uuid,
  add column if not exists customer_id uuid,
  add column if not exists event_type text,
  add column if not exists source text default 'application',
  add column if not exists payload jsonb default '{}'::jsonb,
  add column if not exists metadata jsonb default '{}'::jsonb,
  add column if not exists occurred_at timestamptz default now(),
  add column if not exists created_at timestamptz default now();

create index if not exists customer_events_company_customer_time_idx
  on public.customer_events(company_id, customer_id, occurred_at desc);

create index if not exists customer_events_type_time_idx
  on public.customer_events(company_id, event_type, occurred_at desc);

create table if not exists public.customer_notifications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  customer_id uuid,
  type text not null,
  title text not null,
  message text not null,
  status text not null default 'unread',
  action_url text,
  metadata jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

alter table if exists public.customer_notifications
  add column if not exists company_id uuid,
  add column if not exists customer_id uuid,
  add column if not exists type text,
  add column if not exists title text,
  add column if not exists message text,
  add column if not exists status text default 'unread',
  add column if not exists action_url text,
  add column if not exists metadata jsonb default '{}'::jsonb,
  add column if not exists read_at timestamptz,
  add column if not exists created_at timestamptz default now();

create index if not exists customer_notifications_company_customer_time_idx
  on public.customer_notifications(company_id, customer_id, created_at desc);

-- Auth/account mail is intentionally SMTP-backed. Historical outbox rows remain audit only,
-- but terminal auth-mail payloads must not expose reset tokens or temporary passwords.
update public.tenant_email_outbox
set
  html_body = case
    when email_type in ('password_reset','company_invite') and status in ('failed','sent','cancelled','dead_letter')
      then '<p>Konto-mail har hanterats. Innehållet är maskerat av säkerhetsskäl.</p>'
    else html_body
  end,
  text_body = case
    when email_type in ('password_reset','company_invite') and status in ('failed','sent','cancelled','dead_letter')
      then 'Konto-mail har hanterats. Innehållet är maskerat av säkerhetsskäl.'
    else text_body
  end,
  redirect_url = case
    when email_type in ('password_reset','company_invite') and status in ('failed','sent','cancelled','dead_letter')
      then null
    else redirect_url
  end,
  updated_at = now()
where email_type in ('password_reset','company_invite')
  and status in ('failed','sent','cancelled','dead_letter');

create table if not exists public.auth_email_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  user_id uuid,
  actor_user_id uuid,
  email text,
  event_type text not null,
  status text not null,
  source text not null default 'application',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table if exists public.auth_email_events
  add column if not exists company_id uuid,
  add column if not exists user_id uuid,
  add column if not exists actor_user_id uuid,
  add column if not exists email text,
  add column if not exists event_type text,
  add column if not exists status text,
  add column if not exists source text default 'application',
  add column if not exists metadata jsonb default '{}'::jsonb,
  add column if not exists created_at timestamptz default now();

create index if not exists auth_email_events_company_created_idx
  on public.auth_email_events(company_id, created_at desc);
