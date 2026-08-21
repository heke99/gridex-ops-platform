create or replace function public.gridex_set_grid_owner_request_idempotency_key()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  if new.customer_site_id is not null and new.customer_id is not null and new.company_id is not null then
    new.idempotency_key := encode(
      digest(
        concat_ws(':',new.company_id::text,new.customer_id::text,new.customer_site_id::text,coalesce(new.request_type,'unknown'),coalesce(new.grid_owner_id::text,'unresolved')),
        'sha256'
      ),
      'hex'
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_grid_owner_information_requests_idempotency on public.grid_owner_information_requests;
create trigger trg_grid_owner_information_requests_idempotency
before insert or update of company_id,customer_id,customer_site_id,request_type,grid_owner_id
on public.grid_owner_information_requests
for each row execute function public.gridex_set_grid_owner_request_idempotency_key();

update public.grid_owner_information_requests
set idempotency_key=encode(
  digest(
    concat_ws(':',company_id::text,customer_id::text,customer_site_id::text,coalesce(request_type,'unknown'),coalesce(grid_owner_id::text,'unresolved')),
    'sha256'
  ),
  'hex'
)
where customer_site_id is not null and customer_id is not null and company_id is not null;

create or replace function public.gridex_refresh_customer_summary_from_site_trigger()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  perform public.gridex_refresh_customer_process_summary(
    coalesce(new.company_id,old.company_id),
    coalesce(new.customer_id,old.customer_id),
    case when tg_op='DELETE' then 'site_deleted' else concat_ws(':',new.id::text,coalesce(new.onboarding_status,''),coalesce(new.next_action,'')) end
  );
  return coalesce(new,old);
end;
$$;

drop trigger if exists trg_customer_sites_refresh_process_summary on public.customer_sites;
create trigger trg_customer_sites_refresh_process_summary
after insert or delete or update of onboarding_status,next_action,is_active,status
on public.customer_sites
for each row execute function public.gridex_refresh_customer_summary_from_site_trigger();

create or replace function public.gridex_reaggregate_customer_after_legacy_state_write()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  if pg_trigger_depth() < 2 then
    perform public.gridex_refresh_customer_process_summary(new.company_id,new.id,new.latest_customer_action);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_customers_reaggregate_legacy_process_state on public.customers;
create trigger trg_customers_reaggregate_legacy_process_state
after update of intake_status,next_action
on public.customers
for each row execute function public.gridex_reaggregate_customer_after_legacy_state_write();