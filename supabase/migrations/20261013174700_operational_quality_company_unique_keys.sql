-- Explicit tenant keys satisfy the isolation invariant as well as the encoded
-- identity. One atomic statement locks both read models while changing all five
-- authoritative conflict targets and rebuilding their existing index names.
-- Legacy five-column UNIQUE constraints belong to the separate deploy cutover.
do $migration$
declare
 r record;v_oid oid;v_index oid;v_columns text[];v_definition text;v_expected text;
 v_before record;v_after record;v_old integer;v_new integer;
 old_target constant text:='on conflict(open_key)';
 new_target constant text:='on conflict(company_id,open_key)';
begin
 lock table public.data_quality_issues,public.dashboard_alerts in access exclusive mode;
 for r in select * from(values
  ('data_quality_issues_open_key_uidx','data_quality_issues'),
  ('dashboard_alerts_open_key_uidx','dashboard_alerts')
 ) x(index_name,table_name) loop
  v_index:=to_regclass('public.'||r.index_name);
  if v_index is null or not exists(select 1 from pg_index i
   where i.indexrelid=v_index and i.indrelid=to_regclass('public.'||r.table_name)
    and i.indisunique and i.indisvalid and not i.indisprimary and i.indpred is null and i.indexprs is null)
   or exists(select 1 from pg_constraint c where c.conindid=v_index) then
   raise exception 'quality_company_unique_index_predecessor_changed:%',r.index_name;end if;
  select array_agg(a.attname::text order by k.ord) into v_columns
   from pg_index i cross join lateral unnest(i.indkey) with ordinality k(attnum,ord)
   left join pg_attribute a on a.attrelid=i.indrelid and a.attnum=k.attnum
   where i.indexrelid=v_index and k.ord<=i.indnkeyatts;
  if v_columns is distinct from array['open_key']::text[]
   and v_columns is distinct from array['company_id','open_key']::text[] then
   raise exception 'quality_company_unique_index_columns_changed:%',r.index_name;end if;
 end loop;

 -- Read the installed definitions, including source7's scanner eligibility.
 -- Never restore a historical function body or alter an unknown writer.
 for r in select * from(values
  ('public.gridex_upsert_data_quality_issue_v1(uuid,uuid,text,text,text,date)',1),
  ('public.gridex_upsert_dashboard_alert_v1(uuid,text,text,text,text,text,uuid,text)',1),
  ('public.gridex_reconcile_dashboard_alerts_internal_v1(uuid)',2),
  ('public.gridex_scan_data_quality_v1(uuid,date,uuid)',1)
 ) x(signature,clause_count) loop
  v_oid:=to_regprocedure(r.signature);
  if v_oid is null then raise exception 'quality_company_unique_writer_missing:%',r.signature;end if;
  select p.proowner,p.proacl,p.prosecdef,p.proconfig,p.provolatile into v_before from pg_proc p where p.oid=v_oid;
  v_definition:=pg_get_functiondef(v_oid);
  v_old:=(length(v_definition)-length(replace(v_definition,old_target,'')))/length(old_target);
  v_new:=(length(v_definition)-length(replace(v_definition,new_target,'')))/length(new_target);
  if v_old=r.clause_count and v_new=0 then
   v_expected:=replace(v_definition,old_target,new_target);
   execute v_expected;
  elsif v_old=0 and v_new=r.clause_count then v_expected:=v_definition;
  else raise exception 'quality_company_unique_writer_predecessor_changed:%',r.signature;end if;
  select p.proowner,p.proacl,p.prosecdef,p.proconfig,p.provolatile into v_after from pg_proc p where p.oid=v_oid;
  if v_after is distinct from v_before or pg_get_functiondef(v_oid) is distinct from v_expected then
   raise exception 'quality_company_unique_writer_metadata_changed:%',r.signature;end if;
 end loop;

 drop index public.data_quality_issues_open_key_uidx;
 create unique index data_quality_issues_open_key_uidx on public.data_quality_issues(company_id,open_key);
 drop index public.dashboard_alerts_open_key_uidx;
 create unique index dashboard_alerts_open_key_uidx on public.dashboard_alerts(company_id,open_key);
end $migration$;
