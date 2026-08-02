\set ON_ERROR_STOP on
\pset pager off

\if :{?run_a_id}
\else
  \echo 'run_a_id is required'
  \quit 2
\endif
\if :{?message_b_id}
\else
  \echo 'message_b_id is required'
  \quit 2
\endif
\if :{?production_message_a_id}
\else
  \echo 'production_message_a_id is required'
  \quit 2
\endif

begin;
select set_config('gridex.test.run_a_id', :'run_a_id', true);
select set_config('gridex.test.message_b_id', :'message_b_id', true);
select set_config('gridex.test.production_message_a_id', :'production_message_a_id', true);

-- Fixture preconditions: tenant A run, tenant B message, tenant A production message.
do $$
declare
  v_run_company uuid;
  v_other_company uuid;
  v_prod_company uuid;
  v_prod_environment text;
  v_prod_test_flag integer;
begin
  select company_id into strict v_run_company
  from public.ediel_test_runs
  where id=current_setting('gridex.test.run_a_id')::uuid;

  select company_id into strict v_other_company
  from public.ediel_messages
  where id=current_setting('gridex.test.message_b_id')::uuid;

  select company_id, environment, test_flag
  into strict v_prod_company, v_prod_environment, v_prod_test_flag
  from public.ediel_messages
  where id=current_setting('gridex.test.production_message_a_id')::uuid;

  if v_run_company=v_other_company then
    raise exception 'fixture_invalid_message_b_must_belong_to_another_tenant';
  end if;
  if v_run_company<>v_prod_company or lower(coalesce(v_prod_environment,''))<>'production' or coalesce(v_prod_test_flag,0)<>0 then
    raise exception 'fixture_invalid_production_message_a';
  end if;
end;
$$;

-- Composite tenant FKs must reject a service-role cross-tenant relation.
do $$
declare v_run_company uuid;
begin
  select company_id into strict v_run_company from public.ediel_test_runs
  where id=current_setting('gridex.test.run_a_id')::uuid;
  begin
    insert into public.ediel_test_run_messages(company_id,test_run_id,ediel_message_id,step_no)
    values(v_run_company,current_setting('gridex.test.run_a_id')::uuid,current_setting('gridex.test.message_b_id')::uuid,999999);
    raise exception 'cross_tenant_relation_was_accepted';
  exception
    when foreign_key_violation or raise_exception then
      if sqlerrm='cross_tenant_relation_was_accepted' then raise; end if;
  end;
end;
$$;

-- Production data must never attach as test evidence.
do $$
declare v_run_company uuid;
begin
  select company_id into strict v_run_company from public.ediel_test_runs
  where id=current_setting('gridex.test.run_a_id')::uuid;
  begin
    insert into public.ediel_test_run_messages(company_id,test_run_id,ediel_message_id,step_no)
    values(v_run_company,current_setting('gridex.test.run_a_id')::uuid,current_setting('gridex.test.production_message_a_id')::uuid,999998);
    raise exception 'production_message_was_accepted_as_test_evidence';
  exception
    when check_violation or foreign_key_violation or raise_exception then
      if sqlerrm in ('production_message_was_accepted_as_test_evidence') then raise; end if;
  end;
end;
$$;

-- A direct passed write must be impossible outside the machine evidence RPC.
do $$
declare
  v_result_id uuid;
begin
  select id into v_result_id
  from public.actor_test_results
  where ediel_test_run_id=current_setting('gridex.test.run_a_id')::uuid
  order by created_at desc nulls last
  limit 1;
  if v_result_id is null then
    raise exception 'fixture_missing_actor_test_result';
  end if;
  begin
    update public.actor_test_results set status='passed' where id=v_result_id;
    raise exception 'direct_passed_write_was_accepted';
  exception when raise_exception then
    if sqlerrm='direct_passed_write_was_accepted' then raise; end if;
  end;
end;
$$;

rollback;
\echo 'Canonical production DB regression passed.'
