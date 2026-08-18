create or replace function public.gridex_require_signature_tenant_email_readiness_v1()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
begin
  if not exists (
    select 1
    from public.gridex_tenant_email_dispatch_readiness_v readiness
    where readiness.company_id = new.company_id
      and readiness.event_key = 'contract.confirmation_sent'
      and readiness.enabled
      and readiness.template_active
      and readiness.can_send
      and readiness.domain_status = 'verified'
      and nullif(btrim(coalesce(readiness.sender_email,'')),'') is not null
  ) then
    raise exception using
      errcode = '55000',
      message = 'online_signature_tenant_legal_email_not_ready';
  end if;
  return new;
end
$function$;

drop trigger if exists customer_contract_signature_requests_email_readiness_tg
  on public.customer_contract_signature_requests;
create trigger customer_contract_signature_requests_email_readiness_tg
before insert on public.customer_contract_signature_requests
for each row execute function public.gridex_require_signature_tenant_email_readiness_v1();

revoke all on function public.gridex_require_signature_tenant_email_readiness_v1()
  from public, anon, authenticated;
grant execute on function public.gridex_require_signature_tenant_email_readiness_v1()
  to service_role;
