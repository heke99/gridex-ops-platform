begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

set local gridex.allow_test_failpoints = 'on';

insert into public.companies(id, name, org_number, status, is_active)
values
  ('71000000-0000-4000-8000-000000000001', 'Canonical Test Tenant A', '5599990001', 'active', true),
  ('71000000-0000-4000-8000-000000000002', 'Canonical Test Tenant B', '5599990002', 'active', true);

create temporary table canonical_test_results(
  key text primary key,
  result jsonb,
  flag boolean not null default false
) on commit drop;

select has_function(
  'public',
  'gridex_onboard_customer_graph',
  array['jsonb'],
  'canonical onboarding RPC exists'
);

insert into canonical_test_results(key, result)
select 'success', public.gridex_onboard_customer_graph(jsonb_build_object(
  'company_id', '71000000-0000-4000-8000-000000000001',
  'channel', 'api',
  'idempotency_key', 'pgtap-success-1',
  'correlation_id', '71111111-1111-4111-8111-111111111111',
  'customer', jsonb_build_object(
    'customer_type', 'private',
    'status', 'active',
    'full_name', 'Atomisk Kund',
    'personal_number', '199001019999',
    'email', 'atomic@example.test',
    'source', 'pgtap'
  ),
  'contract', jsonb_build_object(
    'status', 'draft',
    'contract_name', 'Atomiskt testavtal',
    'contract_type', 'variable_monthly'
  ),
  'application', jsonb_build_object('source_record_type', 'pgtap', 'source_record_id', 'success-1')
));

select ok((select (result->>'ok')::boolean from canonical_test_results where key='success'), 'successful onboarding commits');
select isnt((select result->>'customer_number' from canonical_test_results where key='success'), null, 'customer number is assigned');
select is(
  (select customer_number from public.customers where id = ((select result->>'customer_id' from canonical_test_results where key='success'))::uuid),
  (select result->>'customer_number' from canonical_test_results where key='success'),
  'returned customer number equals persisted number'
);

select isnt((select result->>'contract_number' from canonical_test_results where key='success'), null, 'contract number is allocated inside the onboarding transaction');
select is(
  (select contract_number from public.customer_contracts where id = ((select result->>'contract_id' from canonical_test_results where key='success'))::uuid),
  (select result->>'contract_number' from canonical_test_results where key='success'),
  'returned contract number equals persisted contract number'
);

insert into canonical_test_results(key, result)
select 'poa', public.gridex_onboard_customer_graph(jsonb_build_object(
  'company_id', '71000000-0000-4000-8000-000000000001',
  'channel', 'api',
  'idempotency_key', 'pgtap-poa-1',
  'customer', jsonb_build_object(
    'customer_type', 'private',
    'status', 'active',
    'full_name', 'Begränsad Fullmakt',
    'personal_number', '199303039999',
    'source', 'pgtap'
  ),
  'legal', jsonb_build_object(
    'signed_scopes', jsonb_build_array('metering_data'),
    'accepted_at', now(),
    'acceptance_snapshot', jsonb_build_object('source', 'pgtap')
  ),
  'power_of_attorney', jsonb_build_object(
    'signed_scopes', jsonb_build_array('metering_data'),
    'scope', 'metering_data',
    'status', 'signed',
    'signed_at', now(),
    'accepted_at', now(),
    'valid_from', current_date
  ),
  'application', jsonb_build_object('source_record_type', 'pgtap', 'source_record_id', 'poa-1')
));
select isnt((select result->>'power_of_attorney_id' from canonical_test_results where key='poa'), null, 'canonical onboarding creates signed POA evidence');
select ok((
  select covers_metering_data
     and not covers_grid_owner_data
     and not covers_current_supplier_contract
     and signed_scope_snapshot = jsonb_build_array('metering_data')
    from public.authorization_scopes
   where id = ((select result->>'authorization_scope_id' from canonical_test_results where key='poa'))::uuid
), 'authorization coverage equals the exact signed scope');

insert into canonical_test_results(key, flag) values ('poa_widen', false);
do $$
begin
  update public.authorization_scopes
     set covers_grid_owner_data = true
   where id = ((select result->>'authorization_scope_id' from canonical_test_results where key='poa'))::uuid;
exception when sqlstate '55000' then
  update canonical_test_results set flag = true where key = 'poa_widen';
end $$;
select ok((select flag from canonical_test_results where key='poa_widen'), 'signed POA coverage cannot be widened after commit');

insert into canonical_test_results(key, result)
select 'retry', public.gridex_onboard_customer_graph(jsonb_build_object(
  'company_id', '71000000-0000-4000-8000-000000000001',
  'channel', 'api',
  'idempotency_key', 'pgtap-success-1',
  'correlation_id', '72222222-2222-4222-8222-222222222222',
  'customer', jsonb_build_object('full_name', 'Ignored Retry Payload')
));
select is(
  (select result->>'customer_id' from canonical_test_results where key='retry'),
  (select result->>'customer_id' from canonical_test_results where key='success'),
  'idempotent retry returns the same customer'
);

insert into canonical_test_results(key, flag) values ('failpoint', false);
do $$
begin
  perform public.gridex_onboard_customer_graph(jsonb_build_object(
    'company_id', '71000000-0000-4000-8000-000000000001',
    'channel', 'api',
    'idempotency_key', 'pgtap-failpoint-1',
    'correlation_id', '73333333-3333-4333-8333-333333333333',
    'customer', jsonb_build_object(
      'status', 'active',
      'full_name', 'Skall Rullas Tillbaka',
      'personal_number', '199202029999',
      'source', 'pgtap'
    ),
    'test_fail_after', 'customer'
  ));
exception when sqlstate 'P0001' then
  update canonical_test_results set flag = true where key = 'failpoint';
end $$;
select ok((select flag from canonical_test_results where key='failpoint'), 'simulated mid-transaction error is propagated');
select is(
  (select count(*)::integer from public.customers where normalized_personal_number = public.gridex_normalize_personal_number('199202029999')),
  0,
  'simulated error leaves no customer row'
);

insert into public.customers(company_id, customer_type, status, full_name, personal_number, source)
values
  ('71000000-0000-4000-8000-000000000001', 'private', 'active', 'Match Candidate A', '198001019999', 'pgtap'),
  ('71000000-0000-4000-8000-000000000001', 'private', 'active', 'Match Candidate B', null, 'pgtap');
insert into public.customer_sites(company_id, customer_id, facility_id, status)
select '71000000-0000-4000-8000-000000000001', id, '735999999999999999', 'active'
from public.customers where company_id='71000000-0000-4000-8000-000000000001' and full_name='Match Candidate B';

insert into canonical_test_results(key, result)
select 'ambiguous', public.gridex_onboard_customer_graph(jsonb_build_object(
  'company_id', '71000000-0000-4000-8000-000000000001',
  'channel', 'external_contract',
  'idempotency_key', 'pgtap-ambiguous-1',
  'customer', jsonb_build_object('full_name', 'Should Not Auto Link', 'personal_number', '198001019999'),
  'site', jsonb_build_object('facility_id', '735999999999999999')
));
select is((select result->>'code' from canonical_test_results where key='ambiguous'), 'ambiguous_customer_match', 'multiple deterministic matches are blocked');
select is(
  (select jsonb_array_length(result->'candidate_customer_ids') from canonical_test_results where key='ambiguous'),
  2,
  'ambiguity returns both candidates'
);
select is(
  (select count(*)::integer from public.customer_match_review_cases where onboarding_operation_id=((select result->>'operation_id' from canonical_test_results where key='ambiguous')::uuid)),
  1,
  'ambiguous match creates a manual review case'
);

insert into canonical_test_results(key, result)
select 'resolution', public.gridex_resolve_customer_match_review_case(
  (select id from public.customer_match_review_cases where onboarding_operation_id=((select result->>'operation_id' from canonical_test_results where key='ambiguous')::uuid)),
  'link_customer',
  (select id from public.customers where company_id='71000000-0000-4000-8000-000000000001' and full_name='Match Candidate B'),
  '74444444-4444-4444-8444-444444444444',
  'Verifierad mot anläggningsidentiteten.'
);
select is((select result->>'resolution_type' from canonical_test_results where key='resolution'), 'link_customer', 'authorized manual resolution is recorded');

insert into canonical_test_results(key, result)
select 'resolved_retry', public.gridex_onboard_customer_graph(jsonb_build_object(
  'company_id', '71000000-0000-4000-8000-000000000001',
  'channel', 'external_contract',
  'idempotency_key', 'pgtap-ambiguous-1',
  'customer', jsonb_build_object('full_name', 'Should Not Auto Link', 'personal_number', '198001019999'),
  'site', jsonb_build_object('facility_id', '735999999999999999')
));
select is(
  (select result->>'customer_id' from canonical_test_results where key='resolved_retry'),
  (select id::text from public.customers where company_id='71000000-0000-4000-8000-000000000001' and full_name='Match Candidate B'),
  'same idempotent operation continues only after the audited manual decision'
);

insert into public.customers(id, company_id, customer_type, status, full_name, source)
values ('71000000-0000-4000-8000-000000000099', '71000000-0000-4000-8000-000000000002', 'private', 'active', 'Other Tenant Customer', 'pgtap');
insert into canonical_test_results(key, flag) values ('cross_tenant', false);
do $$
begin
  perform public.gridex_onboard_customer_graph(jsonb_build_object(
    'company_id', '71000000-0000-4000-8000-000000000001',
    'channel', 'admin',
    'idempotency_key', 'pgtap-cross-tenant-1',
    'existing_customer_id', '71000000-0000-4000-8000-000000000099',
    'matching_policy', 'link_selected',
    'customer', jsonb_build_object('full_name', 'Cross Tenant Attempt')
  ));
exception when sqlstate 'P0002' then
  update canonical_test_results set flag = true where key = 'cross_tenant';
end $$;
select ok((select flag from canonical_test_results where key='cross_tenant'), 'cross-tenant selected customer is rejected');

select * from finish();
rollback;
