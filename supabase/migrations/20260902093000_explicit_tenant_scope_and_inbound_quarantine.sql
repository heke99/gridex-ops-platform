-- Explicit tenant scope and an owned queue for unattributed inbound mail.
--
-- F-3 was reported as "21736 of 21819 canonical energy-flow events carry no
-- tenant". Investigation before writing this migration showed that reading was
-- wrong: every untenanted row is a market_price.* or energy_geodata.* event --
-- Nord Pool spot imports and geodata verification, which are platform-wide by
-- nature -- while every tenant-scoped event type (energy_area.resolved, quote.*,
-- contract.created, billing_price_snapshot.created) is fully attributed.
--
-- The data was right. The schema could not express the difference, so platform
-- rows looked like drift and were invisible under the tenant guard, where
-- `company_id IN (...)` evaluates to NULL rather than TRUE. That ambiguity is the
-- root cause behind F-5 and F-6 as well.
--
-- F-4 is a genuine defect: inbound mail whose tenant could not be resolved was
-- left as a NULL row inside a tenant table, where no tenant user could see it and
-- no one owned it. The resolver in lib/ediel/tenant/resolveInboundTenant.ts
-- already exists; what was missing is somewhere for its failures to go.
--
-- Forward-only.

begin;

-- ---------------------------------------------------------------------------
-- F-3: make the scope explicit and couple it to company_id.
-- ---------------------------------------------------------------------------

alter table public.canonical_energy_flow_events
  add column if not exists event_scope text;

update public.canonical_energy_flow_events
set event_scope = case
  when company_id is not null then 'tenant'
  when event_type like 'market_price.%' or event_type like 'energy_geodata.%' then 'platform'
  else 'unattributed'
end
where event_scope is null;

alter table public.canonical_energy_flow_events
  alter column event_scope set default 'tenant';

alter table public.canonical_energy_flow_events
  alter column event_scope set not null;

alter table public.canonical_energy_flow_events
  drop constraint if exists canonical_energy_flow_events_scope_check;

alter table public.canonical_energy_flow_events
  add constraint canonical_energy_flow_events_scope_check
  check (
    (event_scope = 'tenant' and company_id is not null)
    or (event_scope = 'platform' and company_id is null)
    or (event_scope = 'unattributed' and company_id is null)
  );

comment on column public.canonical_energy_flow_events.event_scope is
  'F-3: tenant events carry a company; platform events (market price, geodata) never do. "unattributed" is a defect state the invariant gate reports.';

-- Platform market events are market data, not tenant data, and are readable by any
-- authenticated user. Tenant events stay behind the existing tenant guard.
drop policy if exists canonical_energy_flow_events_platform_scope_read on public.canonical_energy_flow_events;
create policy canonical_energy_flow_events_platform_scope_read
  on public.canonical_energy_flow_events
  for select to authenticated
  using (event_scope = 'platform');

-- ---------------------------------------------------------------------------
-- F-4: an owned queue for inbound mail that cannot be attributed.
-- ---------------------------------------------------------------------------

create table if not exists public.platform_inbound_quarantine (
  id uuid primary key default gen_random_uuid(),
  inbound_email_message_id uuid references public.inbound_email_messages(id) on delete cascade,
  inbound_processing_job_id uuid references public.inbound_processing_jobs(id) on delete cascade,
  mailbox_id uuid references public.ediel_mailboxes(id) on delete set null,
  receiver_ediel_id text,
  sender_ediel_id text,
  raw_message_sha256 text,
  resolution_status text not null default 'unresolved'
    check (resolution_status in ('unresolved', 'ambiguous', 'assigned', 'discarded')),
  candidate_company_ids uuid[] not null default '{}',
  resolution_evidence jsonb not null default '{}'::jsonb,
  assigned_company_id uuid references public.companies(id),
  assigned_by uuid references auth.users(id),
  assigned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists platform_inbound_quarantine_message_uk
  on public.platform_inbound_quarantine (inbound_email_message_id)
  where inbound_email_message_id is not null;

create index if not exists platform_inbound_quarantine_open_idx
  on public.platform_inbound_quarantine (resolution_status, created_at desc)
  where resolution_status in ('unresolved', 'ambiguous');

alter table public.platform_inbound_quarantine
  drop constraint if exists platform_inbound_quarantine_assignment_check;

alter table public.platform_inbound_quarantine
  add constraint platform_inbound_quarantine_assignment_check
  check (
    (resolution_status = 'assigned' and assigned_company_id is not null)
    or (resolution_status <> 'assigned' and assigned_company_id is null)
  );

alter table public.platform_inbound_quarantine enable row level security;

drop policy if exists platform_inbound_quarantine_service_all on public.platform_inbound_quarantine;
create policy platform_inbound_quarantine_service_all
  on public.platform_inbound_quarantine
  for all to service_role
  using (true) with check (true);

drop policy if exists platform_inbound_quarantine_platform_read on public.platform_inbound_quarantine;
create policy platform_inbound_quarantine_platform_read
  on public.platform_inbound_quarantine
  for select to authenticated
  using ((select public.gridex_user_is_platform_admin()));

comment on table public.platform_inbound_quarantine is
  'F-4: inbound mail whose tenant could not be resolved. An owned queue, so unattributed work is visible instead of hidden by the tenant guard.';

insert into public.platform_inbound_quarantine (
  inbound_email_message_id, mailbox_id, raw_message_sha256, resolution_status, resolution_evidence
)
select i.id, i.mailbox_id, i.raw_message_sha256, 'unresolved',
       jsonb_build_object(
         'enrolled_by', 'migration:explicit_tenant_scope_and_inbound_quarantine',
         'reason', 'company_id was null while the row sat in a tenant-scoped table',
         'processing_status', i.processing_status
       )
from public.inbound_email_messages i
where i.company_id is null
on conflict (inbound_email_message_id) where inbound_email_message_id is not null
do nothing;

-- ---------------------------------------------------------------------------
-- F-5: backfill what is unambiguous.
-- ---------------------------------------------------------------------------

update public.customer_operation_tasks t
set company_id = c.company_id,
    updated_at = now()
from public.customers c
where t.customer_id = c.id
  and t.company_id is null
  and c.company_id is not null;

commit;
