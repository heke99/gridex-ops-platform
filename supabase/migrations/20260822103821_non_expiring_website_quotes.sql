-- Website prices shown to customers do not expire because wall-clock time passes.
-- Keep valid_until as immutable V1 compatibility/audit metadata only.

begin;

-- Recover rows that were marked expired exclusively by the retired website quote TTL.
update public.website_contract_quotes
set status = 'active',
    updated_at = now()
where status = 'expired'
  and consumed_at is null
  and consumed_application_id is null;

-- The current atomic website onboarding function must keep all tenant, integrity,
-- publication and idempotency checks while removing only the elapsed-time rejection.
do $migration$
declare
  v_definition text;
  v_expiry_block text := $needle$  if v_quote.valid_until <= now() then
    raise exception using
      errcode = '23514',
      message = 'website_quote_expired';
  end if;
$needle$;
begin
  select pg_get_functiondef(
    'public.gridex_onboard_customer_graph_quote_commit_v2(jsonb)'::regprocedure
  ) into v_definition;

  if strpos(v_definition, v_expiry_block) = 0 then
    raise exception 'non_expiring_quote_patch_anchor_missing';
  end if;

  execute replace(v_definition, v_expiry_block, '');
end
$migration$;

comment on column public.website_contract_quotes.valid_until is
  'V1 compatibility and immutable audit metadata. Website customer quotes do not expire solely because this timestamp passes.';

commit;
