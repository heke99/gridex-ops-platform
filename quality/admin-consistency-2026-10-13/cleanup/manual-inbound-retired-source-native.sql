-- Synthetic fixture ONLY in an empty isolated local PostgreSQL database.
-- Existing standard Supabase cluster roles are prerequisites. Never production.
\set ON_ERROR_STOP on
create schema auth;
create function auth.role() returns text language sql stable as
 $$select current_setting('request.jwt.claim.role',true)$$;
set request.jwt.claim.role='service_role';
CREATE TABLE public.manual_inbound_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    request_id uuid,
    mailbox text,
    from_email text,
    from_name text,
    to_email text,
    subject text,
    body_text text,
    body_html text,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    provider_message_id text,
    thread_id text,
    attachments jsonb DEFAULT '[]'::jsonb NOT NULL,
    resolution_status text DEFAULT 'unmatched'::text NOT NULL,
    extracted_payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    confidence_score numeric(5,4),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    in_reply_to text,
    reference_message_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    mailbox_company_id uuid,
    grid_owner_id uuid,
    customer_id uuid,
    customer_site_id uuid,
    metering_point_id uuid,
    tenant_resolution_method text,
    entity_resolution_method text,
    correlation_evidence jsonb DEFAULT '{}'::jsonb NOT NULL,
    normalized_text text,
    business_process text,
    intent text,
    processing_state text DEFAULT 'received'::text NOT NULL,
    CONSTRAINT manual_inbound_customer_requires_company_ck CHECK (((customer_id IS NULL) OR (company_id IS NOT NULL))),
    CONSTRAINT manual_inbound_messages_resolution_status_check CHECK ((resolution_status = ANY (ARRAY['matched'::text, 'ambiguous'::text, 'unmatched'::text, 'ignored'::text]))),
    CONSTRAINT manual_inbound_meter_requires_site_ck CHECK (((metering_point_id IS NULL) OR ((company_id IS NOT NULL) AND (customer_id IS NOT NULL) AND (customer_site_id IS NOT NULL)))),
    CONSTRAINT manual_inbound_site_requires_customer_ck CHECK (((customer_site_id IS NULL) OR ((company_id IS NOT NULL) AND (customer_id IS NOT NULL))))
);
alter table public.manual_inbound_messages add primary key(id);
create unique index manual_provider_fixture_key on public.manual_inbound_messages(mailbox,provider_message_id);
alter table public.manual_inbound_messages enable row level security;
grant select,insert,delete on public.manual_inbound_messages to authenticated,service_role;
create policy owned_source on public.manual_inbound_messages to authenticated
 using(company_id='11111111-1111-4111-8111-111111111111'::uuid);
insert into public.manual_inbound_messages(mailbox,provider_message_id,company_id)
 values('fixture@example.invalid','Existing-Provider','11111111-1111-4111-8111-111111111111');
create temp table original_source_permissions as
 select relacl,relrowsecurity from pg_class where oid='public.manual_inbound_messages'::regclass;
\ir ../../../supabase/migrations/20261013140502_manual_inbound_retired_source_consistency.sql
\ir ../../../supabase/migrations/20261013140502_manual_inbound_retired_source_consistency.sql
begin;
do $$begin
 if (select count(*) from public.manual_inbound_messages)<>1
 or exists(select 1 from gridex_manual_inbound.retired_source_keys) then raise exception 'migration_retired_or_changed_existing_source';end if;
 if not exists(select 1 from original_source_permissions b join pg_class p
 on p.oid='public.manual_inbound_messages'::regclass and p.relacl is not distinct from b.relacl
 and p.relrowsecurity=b.relrowsecurity) then raise exception 'raw_source_permission_changed';end if;
end$$;
insert into public.manual_inbound_messages(mailbox,provider_message_id,company_id)
 values('fixture@example.invalid','Foreign-Provider','22222222-2222-4222-8222-222222222222');
set local role authenticated;set local request.jwt.claim.role='authenticated';
do $$declare n int;begin
 delete from public.manual_inbound_messages where provider_message_id='Foreign-Provider';
 get diagnostics n=row_count;if n<>0 then raise exception 'foreign_delete_rls_bypass';end if;
 delete from public.manual_inbound_messages where provider_message_id='Existing-Provider';
 get diagnostics n=row_count;if n<>1 then raise exception 'authorized_delete_lost';end if;
 begin perform public.gridex_manual_inbound_source_retired_v1('fixture@example.invalid','Existing-Provider');
  raise exception 'authenticated_rpc_exposed';exception when insufficient_privilege then null;end;
end$$;
reset role;set local request.jwt.claim.role='service_role';
do $$begin
 if not public.gridex_manual_inbound_source_retired_v1(' FIXTURE@EXAMPLE.INVALID ',' Existing-Provider ')
 or public.gridex_manual_inbound_source_retired_v1('fixture@example.invalid','Foreign-Provider')
 then raise exception 'retirement_not_exact_authorized_source';end if;
 begin insert into public.manual_inbound_messages(mailbox,provider_message_id) values('fixture@example.invalid','Existing-Provider');
  raise exception 'late_source_recreated';exception when check_violation then
  if sqlerrm<>'manual_inbound_source_retired' then raise;end if;end;
 insert into public.manual_inbound_messages(mailbox,provider_message_id) values('fresh@example.invalid','Existing-Provider');
 insert into public.manual_inbound_messages(mailbox,provider_message_id) values('fixture@example.invalid','Fresh-Provider');
 if has_function_privilege('authenticated','public.gridex_manual_inbound_source_retired_v1(text,text)','EXECUTE')
 or has_function_privilege('anon','public.gridex_manual_inbound_source_retired_v1(text,text)','EXECUTE')
 or has_schema_privilege('authenticated','gridex_manual_inbound','USAGE')
 or has_table_privilege('service_role','gridex_manual_inbound.retired_source_keys','INSERT')
 or has_table_privilege('service_role','gridex_manual_inbound.retired_source_keys','TRUNCATE')
 or has_function_privilege('service_role','gridex_manual_inbound.retire_deleted_source_v1()','EXECUTE')
 then raise exception 'private_retirement_acl_exposed';end if;
 begin delete from gridex_manual_inbound.retired_source_keys;raise exception 'owner_mutated_immutable_keys';
 exception when object_not_in_prerequisite_state then null;end;
end$$;
select 'native_retired_source_rls_and_replay_passed' result;
rollback;
