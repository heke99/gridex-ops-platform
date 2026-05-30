-- Batch 5 final completion: handbook-aligned cancellation audit, tenant-safe quality logging.
-- Adds DB-level audit hooks for the most important customer, Ediel, billing and governance objects.
-- Does not delete customer/contract history; withdrawal/cancellation must be represented as state + audit.

create extension if not exists pgcrypto;

-- Keep status checks aligned with the cancellation lifecycle where the table exists and a named check is present.
do $$
declare
  c record;
begin
  if to_regclass('public.supplier_switch_requests') is not null then
    for c in
      select conname
      from pg_constraint
      where conrelid = 'public.supplier_switch_requests'::regclass
        and contype = 'c'
        and pg_get_constraintdef(oid) ilike '%status%'
    loop
      execute format('alter table public.supplier_switch_requests drop constraint if exists %I', c.conname);
    end loop;

    alter table public.supplier_switch_requests
      add constraint supplier_switch_requests_status_check
      check (status in (
        'draft',
        'queued',
        'submitted',
        'accepted',
        'rejected',
        'completed',
        'failed',
        'cancellation_requested',
        'cancellation_sent',
        'cancelled_before_start',
        'manual_followup_required'
      ));
  end if;
end $$;

-- Optional lifecycle columns used when cancellation acknowledgement arrives.
do $$
begin
  if to_regclass('public.customer_cases') is not null then
    alter table public.customer_cases add column if not exists cancellation_sent_at timestamptz null;
    alter table public.customer_cases add column if not exists cancellation_acknowledged_at timestamptz null;
    alter table public.customer_cases add column if not exists cancellation_failed_at timestamptz null;
    create index if not exists customer_cases_cancellation_followup_idx
      on public.customer_cases(company_id, cancellation_status, status, delivery_start_at);
  end if;

  if to_regclass('public.ediel_messages') is not null then
    create index if not exists ediel_messages_case_correlation_idx
      on public.ediel_messages(company_id, correlation_reference, message_family, message_code);
  end if;
end $$;

-- Generic audit trigger. It is intentionally conservative: it records inserts/updates/deletes
-- for critical tables and scopes company admins by company_id while allowing superadmin global audit.
do $$
begin
  if to_regclass('public.audit_logs') is not null then
    execute $fn$
      create or replace function public.gridex_audit_critical_row_change()
      returns trigger
      language plpgsql
      security definer
      set search_path = public
      as $body$
      declare
        v_old jsonb := case when TG_OP in ('UPDATE','DELETE') then to_jsonb(OLD) else null end;
        v_new jsonb := case when TG_OP in ('INSERT','UPDATE') then to_jsonb(NEW) else null end;
        v_company_id uuid := null;
        v_actor uuid := null;
        v_entity_id text := null;
      begin
        if TG_TABLE_NAME = 'audit_logs' then
          return coalesce(NEW, OLD);
        end if;

        v_company_id := nullif(coalesce(v_new ->> 'company_id', v_old ->> 'company_id'), '')::uuid;
        if v_company_id is null and TG_TABLE_NAME = 'companies' then
          v_company_id := nullif(coalesce(v_new ->> 'id', v_old ->> 'id'), '')::uuid;
        end if;

        v_actor := nullif(coalesce(
          v_new ->> 'updated_by',
          v_new ->> 'created_by',
          v_new ->> 'actor_user_id',
          v_new ->> 'invited_by',
          v_old ->> 'updated_by',
          v_old ->> 'created_by',
          v_old ->> 'actor_user_id',
          v_old ->> 'invited_by'
        ), '')::uuid;

        v_entity_id := coalesce(v_new ->> 'id', v_old ->> 'id');

        insert into public.audit_logs (
          company_id,
          actor_user_id,
          entity_type,
          entity_id,
          action,
          new_values,
          metadata
        ) values (
          v_company_id,
          v_actor,
          TG_TABLE_NAME,
          v_entity_id,
          lower(TG_TABLE_NAME || '_' || TG_OP),
          v_new,
          jsonb_build_object(
            'source', 'gridex_audit_critical_row_change',
            'operation', TG_OP,
            'table', TG_TABLE_NAME,
            'old_values', v_old
          )
        );

        return coalesce(NEW, OLD);
      end;
      $body$;
    $fn$;
  end if;
end $$;

do $$
declare
  t text;
begin
  if to_regclass('public.audit_logs') is null then
    return;
  end if;

  foreach t in array array[
    'companies',
    'company_memberships',
    'company_invitations',
    'user_roles',
    'customer_cases',
    'customer_case_events',
    'powers_of_attorney',
    'authorization_scopes',
    'customer_info_requests',
    'metering_permissions',
    'metering_values',
    'ediel_messages',
    'billing_underlays',
    'billing_export_runs',
    'billing_export_run_items',
    'partner_exports',
    'tenant_email_outbox'
  ] loop
    if to_regclass('public.' || t) is not null then
      if not exists (
        select 1 from pg_trigger
        where tgname = 'gridex_audit_' || t
          and tgrelid = ('public.' || t)::regclass
      ) then
        execute format(
          'create trigger %I after insert or update or delete on public.%I for each row execute function public.gridex_audit_critical_row_change()',
          'gridex_audit_' || t,
          t
        );
      end if;
    end if;
  end loop;
end $$;
