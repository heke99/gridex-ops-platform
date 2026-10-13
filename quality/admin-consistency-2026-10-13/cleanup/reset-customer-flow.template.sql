-- Explicit user-authorized customer-flow reset. Root alone executes this file.
-- Fingerprints pin the reviewed rowsets. No blanket trigger/FK bypass, TRUNCATE,
-- or deletion of companies/users/configuration/technical proof is permitted.
-- Apply before the DQI migration, which changes issue/alert row fingerprints.
begin isolation level repeatable read;
set local lock_timeout='10s';
set local statement_timeout='90s';

-- Prevent a new customer/application producer from entering while roots reset.
-- Technical market/geodata event producers remain able to append unrelated rows.
lock table public.customers,public.website_customer_applications,public.website_contract_quotes,
 public.customer_onboarding_operations,public.customer_site_resolution,
 public.data_quality_issues,public.dashboard_alerts,public.forecast_runs,
 public.customer_portfolio_forecast_snapshots,public.company_monthly_metrics,
 public.bidding_zone_monthly_metrics,public.manual_inbound_messages,public.inbound_operation_events
 in share row exclusive mode;

create temporary table reset_scopes(scope_name text primary key,table_name text,predicate text,expected_count bigint,expected_hash text,delete_order integer) on commit drop;
insert into reset_scopes values
__SCOPED_BASELINE__;
create temporary table reset_empty(table_name text primary key) on commit drop;
insert into reset_empty values __EMPTY_TABLES__;
create temporary table reset_preserve(table_name text primary key) on commit drop;
insert into reset_preserve values __PRESERVED_TABLES__;
create temporary table reset_ids(scope_name text,id uuid,primary key(scope_name,id)) on commit drop;
create temporary table reset_preserved_rows(table_name text,predicate text,expected_count bigint,expected_hash text) on commit drop;

do $reset$
declare r record;n bigint;h text;removed bigint;sql_text text;
begin
 if exists(select 1 from public.customers) then raise exception 'reset_refused_new_customer_rows';end if;
 if exists(select 1 from pg_constraint c where c.contype='f' and c.connamespace='public'::regnamespace and not c.convalidated) then raise exception 'reset_refused_unvalidated_fk';end if;

 -- Every reviewed empty graph table remains empty; new external producer rows
 -- abort the complete transaction instead of being discovered and deleted.
 for r in select table_name from reset_empty order by table_name loop
  if to_regclass('public.'||r.table_name) is null then raise exception 'reset_missing_reviewed_table:%',r.table_name;end if;
  execute format('select count(*) from public.%I',r.table_name) into n;
  if n<>0 then raise exception 'reset_refused_new_rows:%:%',r.table_name,n;end if;
 end loop;

 -- Lock only selected old rows of shared event tables, capture exact IDs, and
 -- verify the original approved rowset, never the changing whole event table.
 for r in select * from reset_scopes order by table_name,scope_name loop
  execute format('insert into pg_temp.reset_ids select %L,t.id from public.%I t where %s for update of t',r.scope_name,r.table_name,r.predicate);
  execute format('select count(*),md5(coalesce(string_agg(md5(to_jsonb(t)::text),'''' order by md5(to_jsonb(t)::text)),'''')) from public.%I t where %s',r.table_name,r.predicate) into n,h;
  if n<>r.expected_count or h<>r.expected_hash then raise exception 'reset_stale_baseline:%',r.scope_name;end if;

  -- Nonmatching technical/publication/actor-proof events must remain byte-for-byte
  -- unchanged by THIS reset. Repeatable read excludes unrelated concurrent work.
  execute format('select count(*),md5(coalesce(string_agg(md5(to_jsonb(t)::text),'''' order by md5(to_jsonb(t)::text)),'''')) from public.%I t where not coalesce((%s),false)',r.table_name,r.predicate) into n,h;
  insert into reset_preserved_rows values(r.table_name,'not coalesce(('||r.predicate||'),false)',n,h);
 end loop;
 for r in select table_name from reset_preserve order by table_name loop
  if to_regclass('public.'||r.table_name) is not null then
   execute format('select count(*),md5(coalesce(string_agg(md5(to_jsonb(t)::text),'''' order by md5(to_jsonb(t)::text)),'''')) from public.%I t',r.table_name) into n,h;
   insert into reset_preserved_rows values(r.table_name,'true',n,h);
  end if;
 end loop;

 -- Child-first, pinned-ID deletes. Existing FK and lifecycle triggers stay active.
 for r in select * from reset_scopes order by delete_order loop
  execute format('delete from public.%I t using pg_temp.reset_ids i where i.scope_name=%L and t.id=i.id',r.table_name,r.scope_name);
  get diagnostics removed=row_count;
  if removed<>r.expected_count then raise exception 'reset_row_count_mismatch:%',r.scope_name;end if;
 end loop;

 -- Neither a scoped row nor an exact captured ID may remain.
 for r in select * from reset_scopes order by delete_order loop
  execute format('select count(*) from public.%I t where %s',r.table_name,r.predicate) into n;
  if n<>0 then raise exception 'reset_scoped_residual:%:%',r.scope_name,n;end if;
  execute format('select count(*) from public.%I t join pg_temp.reset_ids i on i.id=t.id where i.scope_name=%L',r.table_name,r.scope_name) into n;
  if n<>0 then raise exception 'reset_captured_id_residual:%',r.scope_name;end if;
 end loop;
 for r in select table_name from reset_empty order by table_name loop
  execute format('select count(*) from public.%I',r.table_name) into n;
  if n<>0 then raise exception 'reset_graph_residual:%:%',r.table_name,n;end if;
 end loop;
 for r in select * from reset_preserved_rows loop
  execute format('select count(*),md5(coalesce(string_agg(md5(to_jsonb(t)::text),'''' order by md5(to_jsonb(t)::text)),'''')) from public.%I t where %s',r.table_name,r.predicate) into n,h;
  if n<>r.expected_count or h<>r.expected_hash then raise exception 'reset_changed_preserved_rows:%',r.table_name;end if;
 end loop;
 if exists(select 1 from public.customers) then raise exception 'reset_customer_residual';end if;
end
$reset$;

select 'customer_flow_reset_verified' as result,
 (select count(*) from reset_scopes) as reviewed_rowsets,
 (select count(*) from reset_empty) as empty_graph_tables,
 (select count(*) from reset_preserved_rows) as preserved_rowsets;
commit;
select 'customer_flow_reset_committed' as result,
 (select count(*) from public.customers) as customers,
 (select count(*) from public.website_customer_applications) as applications,
 (select count(*) from public.data_quality_issues) as issues,
 (select count(*) from public.dashboard_alerts) as alerts;
