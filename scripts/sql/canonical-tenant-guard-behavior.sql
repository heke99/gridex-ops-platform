-- Run only after canonical-tenant-guard-fixture.sql and the real migrations in
-- an isolated database. Every guarded reference must reject cross-company
-- INSERT and UPDATE while accepting same-company writes as real caller roles.
begin;
set local role authenticated;
do $$
declare
  test_case record;
  child_id uuid := '00000000-0000-0000-0000-000000000099';
  tenant_a uuid := '10000000-0000-0000-0000-000000000001';
  parent_a uuid := '00000000-0000-0000-0000-000000000001';
  parent_b uuid := '00000000-0000-0000-0000-000000000002';
begin
  for test_case in select * from (values
    ('customer_sites','customer_id'),
    ('metering_points','customer_id'), ('metering_points','site_id'),
    ('customer_contracts','customer_id'), ('customer_contracts','site_id'),
    ('customer_contracts','customer_site_id'), ('customer_contracts','metering_point_id'),
    ('customer_legal_acceptances','customer_id'), ('customer_legal_acceptances','contract_id'),
    ('powers_of_attorney','customer_id'), ('powers_of_attorney','site_id'),
    ('powers_of_attorney','metering_point_id'),
    ('billing_underlays','customer_id'), ('billing_underlays','customer_contract_id'),
    ('billing_underlays','contract_id'), ('billing_underlays','site_id'),
    ('billing_underlays','metering_point_id'), ('contract_price_snapshots','contract_id')
  ) as cases(table_name, reference_column) loop
    begin
      execute format('insert into public.%I(id,company_id,%I) values($1,$2,$3)',
        test_case.table_name,test_case.reference_column) using child_id,tenant_a,parent_b;
      raise exception 'Cross-company INSERT accepted: %.%',test_case.table_name,test_case.reference_column;
    exception when check_violation then null;
    end;
    execute format('insert into public.%I(id,company_id,%I) values($1,$2,$3)',
      test_case.table_name,test_case.reference_column) using child_id,tenant_a,parent_a;
    execute format('update public.%I set %I=$1 where id=$2',
      test_case.table_name,test_case.reference_column) using parent_a,child_id;
    begin
      execute format('update public.%I set %I=$1 where id=$2',
        test_case.table_name,test_case.reference_column) using parent_b,child_id;
      raise exception 'Cross-company UPDATE accepted: %.%',test_case.table_name,test_case.reference_column;
    exception when check_violation then null;
    end;
    begin
      execute format('update public.%I set company_id=$1 where id=$2',
        test_case.table_name) using '10000000-0000-0000-0000-000000000002'::uuid,child_id;
      raise exception 'Cross-company reassignment accepted: %.%',test_case.table_name,test_case.reference_column;
    exception when check_violation then null;
    end;
    execute format('delete from public.%I where id=$1',test_case.table_name) using child_id;
  end loop;
  -- Preserve the current snapshot guard's required/not-found distinctions.
  begin
    insert into public.contract_price_snapshots(id,company_id) values(child_id,tenant_a);
    raise exception 'Snapshot accepted missing contract';
  exception when not_null_violation then null;
  end;
  begin
    insert into public.contract_price_snapshots(id,company_id,contract_id) values(child_id,tenant_a,child_id);
    raise exception 'Snapshot accepted unknown contract';
  exception when foreign_key_violation then null;
  end;
end;
$$;
rollback;
