-- Batch 7A.1 — Inbound/Ediel hardening, storage and diagnostics support
-- Idempotent, additive only. No destructive operations.

alter table if exists public.ediel_messages
  add column if not exists syntax_status text,
  add column if not exists application_status text;

alter table if exists public.inbound_processing_jobs
  add column if not exists max_attempts integer not null default 5;

create unique index if not exists ux_inbound_processing_jobs_one_open_per_email
  on public.inbound_processing_jobs(inbound_email_message_id)
  where inbound_email_message_id is not null and status in ('queued', 'retry', 'processing');

create index if not exists idx_inbound_processing_jobs_lock_status
  on public.inbound_processing_jobs(status, locked_at, attempts_count, created_at);

create index if not exists idx_customer_operation_tasks_batch7a_source
  on public.customer_operation_tasks(company_id, task_type, status)
  where status = 'open';

create index if not exists idx_outbound_requests_batch7a_overdue
  on public.outbound_requests(company_id, status, message_code, sent_at, acknowledged_at)
  where status in ('queued', 'prepared', 'sent', 'syntax_accepted', 'application_accepted', 'acknowledged');

create index if not exists idx_metering_values_batch7a_canonical
  on public.metering_values(company_id, canonical_dedupe_key)
  where canonical_dedupe_key is not null;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'grid-owner-agreements',
  'grid-owner-agreements',
  false,
  52428800,
  array['application/pdf', 'text/plain', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

do $$
begin
  if exists (select 1 from pg_tables where schemaname = 'storage' and tablename = 'objects') then
    drop policy if exists grid_owner_agreements_platform_read on storage.objects;
    create policy grid_owner_agreements_platform_read
      on storage.objects
      for select
      using (
        bucket_id = 'grid-owner-agreements'
        and exists (
          select 1
          from public.user_roles ur
          join public.roles r on r.id = ur.role_id
          where ur.user_id = auth.uid()
            and coalesce(ur.is_active, true) = true
            and lower(coalesce(r.key, r.name, '')) in ('super_admin','superadmin','platform_admin')
        )
      );

    drop policy if exists grid_owner_agreements_platform_write on storage.objects;
    create policy grid_owner_agreements_platform_write
      on storage.objects
      for insert
      with check (
        bucket_id = 'grid-owner-agreements'
        and exists (
          select 1
          from public.user_roles ur
          join public.roles r on r.id = ur.role_id
          where ur.user_id = auth.uid()
            and coalesce(ur.is_active, true) = true
            and lower(coalesce(r.key, r.name, '')) in ('super_admin','superadmin','platform_admin')
        )
      );
  end if;
end $$;
