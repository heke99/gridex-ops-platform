-- Deterministic null -> agreed parent tenant repairs only. No non-null move.
\set ON_ERROR_STOP on
\pset pager off

begin;

drop table if exists pg_temp.canonical_multitenant_relations;
drop table if exists pg_temp.canonical_multitenant_parent_evidence;
drop table if exists pg_temp.canonical_multitenant_repair_candidates;
create temporary table canonical_multitenant_relations (
 child_table text, child_column text, parent_table text
) on commit drop;
insert into canonical_multitenant_relations values
      ('customer_sites', 'customer_id', 'customers'),
      ('metering_points', 'customer_id', 'customers'),
      ('metering_points', 'site_id', 'customer_sites'),
      ('customer_contracts', 'customer_id', 'customers'),
      ('customer_contracts', 'site_id', 'customer_sites'),
      ('powers_of_attorney', 'customer_id', 'customers'),
      ('customer_authorization_documents', 'customer_id', 'customers'),
      ('customer_authorization_documents', 'power_of_attorney_id', 'powers_of_attorney'),
      ('customer_legal_acceptances', 'customer_id', 'customers'),
      ('customer_info_requests', 'customer_id', 'customers'),
      ('supplier_switch_requests', 'customer_id', 'customers'),
      ('customer_invoices', 'customer_id', 'customers'),
      ('customer_onboarding_applications', 'onboarding_operation_id', 'customer_onboarding_operations'),
      ('customer_onboarding_applications', 'customer_id', 'customers'),
      ('customer_onboarding_legal_snapshots', 'customer_id', 'customers'),
      ('customer_match_review_cases', 'onboarding_operation_id', 'customer_onboarding_operations'),
      ('domain_events', 'subject_customer_id', 'customers'),
      ('event_outbox', 'domain_event_id', 'domain_events');
-- Ignore absent historical surfaces, but never pretend an existing linked
-- parent row with missing/unknown tenant is safe evidence.
delete from canonical_multitenant_relations r
where to_regclass(format('public.%I',r.child_table)) is null
 or not exists(select 1 from pg_attribute where attrelid=to_regclass(format('public.%I',r.child_table)) and attname=r.child_column and not attisdropped)
 or not exists(select 1 from pg_attribute where attrelid=to_regclass(format('public.%I',r.child_table)) and attname='company_id' and not attisdropped)
;
-- One ordered transaction holds every inspected parent/child against writes.
-- Ordinary table privileges/RLS still apply: no role switch or bypass grant.
do $locks$
declare r record;
begin
 for r in select table_name from (
  select child_table table_name from canonical_multitenant_relations
  union select parent_table from canonical_multitenant_relations
 ) tables where to_regclass(format('public.%I',table_name)) is not null order by table_name loop
  execute format('lock table public.%I in share row exclusive mode',r.table_name);
 end loop;
end;
$locks$;

create temporary table canonical_multitenant_parent_evidence (
 table_name text,relation_name text,row_id text,current_company_id uuid,
 inferred_company_id uuid,parent_missing boolean
) on commit drop;
do $evidence$
declare r record;
begin
 for r in select * from canonical_multitenant_relations order by child_table,child_column,parent_table loop
  if to_regclass(format('public.%I',r.parent_table)) is null
   or not exists(select 1 from pg_attribute where attrelid=to_regclass(format('public.%I',r.parent_table)) and attname='company_id' and not attisdropped) then
   execute format($q$
    insert into canonical_multitenant_parent_evidence
    select %L,%L,child.id::text,child.company_id,null,true from public.%I child where child.%I is not null
   $q$,r.child_table,r.child_column||' -> '||r.parent_table,r.child_table,r.child_column);
   continue;
  end if;
  execute format($q$
   insert into canonical_multitenant_parent_evidence
   select %L,%L,child.id::text,child.company_id,parent.company_id,parent.id is null
   from public.%I child left join public.%I parent on parent.id=child.%I
   where child.%I is not null
  $q$,r.child_table,r.child_column||' -> '||r.parent_table,r.child_table,r.parent_table,r.child_column,r.child_column);
 end loop;
end;
$evidence$;
-- Decide once per child against ALL linked parent evidence before any write.
-- A non-null tenant is never moved. Unknown/missing or conflicting parents
-- remain manual review, even when a different parent individually looks safe.
create temporary table canonical_multitenant_repair_candidates as
with facts as (
 select table_name,row_id,current_company_id,count(distinct inferred_company_id) tenants,
  bool_or(parent_missing or inferred_company_id is null) unresolved,
  bool_or(inferred_company_id is distinct from current_company_id) mismatch
 from canonical_multitenant_parent_evidence group by table_name,row_id,current_company_id
), decisions as (
 select *,case
  when tenants>1 then 'ambiguous_cross_tenant_conflict'
  when unresolved then 'manual_review_unresolved_parent'
  when current_company_id is null and tenants=1 then 'safe_fill_from_parent'
  when current_company_id is not null and mismatch then 'ambiguous_cross_tenant_conflict'
  else 'already_consistent' end classification
 from facts
)
select e.table_name,e.relation_name,e.row_id,e.current_company_id,e.inferred_company_id,d.classification
from canonical_multitenant_parent_evidence e join decisions d
 on d.table_name=e.table_name and d.row_id=e.row_id
where d.classification<>'already_consistent';

do $repair$
declare r record; repaired bigint;
begin
 for r in select distinct table_name from canonical_multitenant_repair_candidates
  where classification='safe_fill_from_parent' order by table_name loop
  execute format($q$
   with agreed as (
    select row_id,inferred_company_id,string_agg(relation_name,', ' order by relation_name) source_relation,
     jsonb_agg(relation_name order by relation_name) parent_relations
    from canonical_multitenant_repair_candidates
    where table_name=%L and classification='safe_fill_from_parent'
    group by row_id,inferred_company_id
   ), repaired as (
    update public.%I child set company_id=agreed.inferred_company_id from agreed
    where child.id::text=agreed.row_id and child.company_id is null
    returning child.id::text entity_id,child.company_id,agreed.source_relation,agreed.parent_relations
   )
   insert into public.audit_logs(company_id,actor_user_id,entity_type,entity_id,action,old_values,new_values,metadata)
   select company_id,null,%L,entity_id,'canonical_multitenant_company_id_backfill',
    jsonb_build_object('company_id',null),jsonb_build_object('company_id',company_id),
    jsonb_build_object('source_relation',source_relation,'safe_derivation',true,'parent_relations',parent_relations)
   from repaired
  $q$,r.table_name,r.table_name,r.table_name);
  get diagnostics repaired=row_count;
  raise notice 'Audited deterministic repairs for %: %',r.table_name,repaired;
 end loop;
end;
$repair$;

-- Preserve UUID correlation repair for known tenants, but never mutate a child
-- classified for manual review, including an existing non-null mismatch.
do $correlation$
declare r record;
begin
 for r in
  select c.relname table_name from pg_class c join pg_namespace n on n.oid=c.relnamespace
  join pg_attribute company_col on company_col.attrelid=c.oid and company_col.attname='company_id' and not company_col.attisdropped
  join pg_attribute correlation_col on correlation_col.attrelid=c.oid and correlation_col.attname='correlation_id' and not correlation_col.attisdropped
  where n.nspname='public' and c.relkind='r' and correlation_col.atttypid='uuid'::regtype
  order by c.relname
 loop
  execute format($q$
   with repaired as (
    update public.%I child set correlation_id=gen_random_uuid()
    where child.company_id is not null and child.correlation_id is null
     and not exists(select 1 from canonical_multitenant_repair_candidates candidate
      where candidate.table_name=%L and candidate.row_id=child.id::text
       and candidate.classification<>'safe_fill_from_parent')
    returning child.id::text entity_id,child.company_id,child.correlation_id
   )
   insert into public.audit_logs(company_id,actor_user_id,entity_type,entity_id,action,old_values,new_values,metadata)
   select company_id,null,%L,entity_id,'canonical_multitenant_correlation_id_backfill',
    jsonb_build_object('correlation_id',null),jsonb_build_object('correlation_id',correlation_id),
    jsonb_build_object('safe_derivation',true) from repaired
  $q$,r.table_name,r.table_name,r.table_name);
 end loop;
end;
$correlation$;
commit;
