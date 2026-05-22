-- Batch 4E: switch lifecycle blockers, PDF/OCR import metadata, audit coverage and merge completion.
-- Defensive migration: adds missing columns/triggers only; does not change Ediel test facit.

create extension if not exists pgcrypto;

do $$
declare
  c record;
begin
  if to_regclass('public.supplier_switch_requests') is not null then
    alter table public.supplier_switch_requests add column if not exists paused_at timestamptz null;
    alter table public.supplier_switch_requests add column if not exists paused_by uuid null;
    alter table public.supplier_switch_requests add column if not exists pause_reason text null;
    alter table public.supplier_switch_requests add column if not exists lifecycle_blocked boolean not null default false;
    alter table public.supplier_switch_requests add column if not exists lifecycle_block_source text null;
    alter table public.supplier_switch_requests add column if not exists lifecycle_block_id uuid null;

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

    create index if not exists supplier_switch_requests_lifecycle_block_idx
      on public.supplier_switch_requests(company_id, customer_id, lifecycle_blocked, status, created_at desc)
      where lifecycle_blocked = true;
    create index if not exists supplier_switch_requests_open_company_customer_idx
      on public.supplier_switch_requests(company_id, customer_id, site_id, status, created_at desc)
      where status in ('draft','queued','submitted','accepted','cancellation_requested','cancellation_sent','manual_followup_required');
  end if;
end $$;

do $$
begin
  if to_regclass('public.customer_lifecycle_decisions') is not null then
    alter table public.customer_lifecycle_decisions add column if not exists source_customer_case_id uuid null;
    alter table public.customer_lifecycle_decisions add column if not exists resolved_at timestamptz null;
    alter table public.customer_lifecycle_decisions add column if not exists resolved_by uuid null;
    alter table public.customer_lifecycle_decisions add column if not exists status text not null default 'active';
    create index if not exists customer_lifecycle_decisions_active_switch_idx
      on public.customer_lifecycle_decisions(company_id, customer_id, decision_type, scope_type, scope_id, created_at desc)
      where coalesce(status, 'active') = 'active';
  end if;
end $$;

do $$
begin
  if to_regclass('public.document_ai_extractions') is not null then
    alter table public.document_ai_extractions add column if not exists import_batch_id uuid null;
    alter table public.document_ai_extractions add column if not exists source_kind text null;
    alter table public.document_ai_extractions add column if not exists parser_version text null;
    alter table public.document_ai_extractions add column if not exists ocr_status text null;
    alter table public.document_ai_extractions add column if not exists normalized_rows jsonb not null default '[]'::jsonb;
    alter table public.document_ai_extractions add column if not exists parser_warnings jsonb not null default '[]'::jsonb;
    alter table public.document_ai_extractions add column if not exists metadata jsonb not null default '{}'::jsonb;
    create index if not exists document_ai_extractions_import_batch_idx
      on public.document_ai_extractions(company_id, import_batch_id, created_at desc)
      where import_batch_id is not null;
  end if;
end $$;

-- Audit trigger coverage for tables that were previously outside the critical audit list.
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
          v_new ->> 'paused_by',
          v_old ->> 'updated_by',
          v_old ->> 'created_by',
          v_old ->> 'actor_user_id',
          v_old ->> 'invited_by',
          v_old ->> 'paused_by'
        ), '')::uuid;

        v_entity_id := coalesce(v_new ->> 'id', v_old ->> 'id');

        insert into public.audit_logs (
          company_id,
          actor_user_id,
          entity_type,
          entity_id,
          action,
          old_values,
          new_values,
          metadata
        ) values (
          v_company_id,
          v_actor,
          TG_TABLE_NAME,
          v_entity_id,
          lower(TG_TABLE_NAME || '_' || TG_OP),
          v_old,
          v_new,
          jsonb_build_object(
            'source', 'gridex_audit_critical_row_change',
            'operation', TG_OP,
            'table', TG_TABLE_NAME
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
    'customers',
    'customer_sites',
    'metering_points',
    'customer_contacts',
    'customer_addresses',
    'customer_contracts',
    'customer_contract_events',
    'customer_cases',
    'customer_case_events',
    'customer_info_requests',
    'customer_info_request_events',
    'customer_lifecycle_decisions',
    'customer_lifecycle_events',
    'customer_merge_events',
    'customer_duplicate_resolution_events',
    'customer_import_batches',
    'customer_import_rows',
    'customer_readiness_snapshots',
    'document_ai_extractions',
    'powers_of_attorney',
    'power_of_attorney_scopes',
    'authorization_scopes',
    'customer_authorization_documents',
    'supplier_switch_requests',
    'supplier_switch_events',
    'grid_owner_data_requests',
    'outbound_requests',
    'outbound_dispatch_events',
    'billing_underlays',
    'billing_export_runs',
    'billing_export_run_items',
    'partner_exports',
    'tenant_email_outbox',
    'ediel_messages',
    'company_memberships',
    'company_invitations',
    'user_roles'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists %I on public.%I', 'gridex_audit_' || t, t);
      execute format(
        'create trigger %I after insert or update or delete on public.%I for each row execute function public.gridex_audit_critical_row_change()',
        'gridex_audit_' || t,
        t
      );
    end if;
  end loop;
end $$;

create or replace view public.gridex_sensitive_action_audit_coverage_v as
select * from (
  values
    ('customer_intake', 'customer_import_batches', true),
    ('customer_merge', 'customer_merge_events', true),
    ('customer_lifecycle_block', 'customer_lifecycle_decisions', true),
    ('supplier_switch_pause', 'supplier_switch_requests', true),
    ('supplier_switch_event', 'supplier_switch_events', true),
    ('pdf_ai_import', 'document_ai_extractions', true),
    ('billing_export', 'billing_export_runs', true),
    ('partner_export_stub', 'partner_exports', true),
    ('ediel_message', 'ediel_messages', true),
    ('tenant_membership', 'company_memberships', true)
) as t(action_area, audited_table, audit_required);
