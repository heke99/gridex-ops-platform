-- Email's sole writer uses the UUID of its canonical manual source. Apply after
-- the reviewed inbound reset. Other transports keep their polymorphic IDs.
alter table public.inbound_operation_events
 add column if not exists manual_inbound_message_id uuid generated always as
 (case when source_transport='email' then source_id::uuid else null end) stored;

create unique index if not exists manual_inbound_messages_company_id_id_uidx
 on public.manual_inbound_messages(company_id,id);
create index if not exists inbound_operation_events_manual_source_idx
 on public.inbound_operation_events(manual_inbound_message_id)
 where manual_inbound_message_id is not null;

do $$begin
 if not exists(select 1 from pg_constraint where conrelid='public.inbound_operation_events'::regclass and conname='inbound_operation_events_manual_source_fk') then
  alter table public.inbound_operation_events add constraint inbound_operation_events_manual_source_fk
   foreign key(manual_inbound_message_id) references public.manual_inbound_messages(id) on delete cascade;
 end if;
 -- MATCH SIMPLE intentionally permits an unresolved NULL company. The plain
 -- anchor still requires a real source; any resolved owner must match it.
 if not exists(select 1 from pg_constraint where conrelid='public.inbound_operation_events'::regclass and conname='inbound_operation_events_manual_source_company_fk') then
  alter table public.inbound_operation_events add constraint inbound_operation_events_manual_source_company_fk
   foreign key(company_id,manual_inbound_message_id)
   references public.manual_inbound_messages(company_id,id) on delete cascade;
 end if;
end $$;

comment on column public.inbound_operation_events.manual_inbound_message_id is
 'Stored email-only manual source UUID: malformed email IDs fail, late orphan writes fail, and deleting the source removes only its derived email events.';
