-- Dry-run only: repeatable evidence; all persistent tables remain unchanged.
\set ON_ERROR_STOP on
\pset pager off

begin;
set transaction isolation level repeatable read;
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

select coalesce(c.name,'<unresolved>') inferred_tenant,classification,table_name,relation_name,count(*) rows
from canonical_multitenant_repair_candidates r left join public.companies c on c.id=r.inferred_company_id
group by c.name,classification,table_name,relation_name order by classification,inferred_tenant,table_name;
select * from canonical_multitenant_repair_candidates
where classification<>'safe_fill_from_parent' order by table_name,row_id,relation_name;
commit;
