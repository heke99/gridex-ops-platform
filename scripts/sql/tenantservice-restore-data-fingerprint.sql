\set ON_ERROR_STOP on
\set QUIET on
set time zone 'UTC';
-- Synthetic tenant rows plus their restored current authorization records.
-- A digest is retained only in RUNNER_TEMP, never raw Auth rows or fixture IDs.
\if :{?tenantservice_catalog_detail}
-- The optional diagnostic emits only the catalog payload below. Its private
-- output is never uploaded; the default two-digest acceptance gate is intact.
\set tenantservice_catalog_is_detail true
\else
\set tenantservice_catalog_is_detail false
with fixture as (
 select array['e4954930-0000-4000-8000-000000000001'::uuid,
              'e4954930-0000-4000-8000-000000000002'::uuid] companies,
        array['e4954930-0000-4000-8000-000000000011'::uuid,
              'e4954930-0000-4000-8000-000000000012'::uuid] users
), evidence as (
 select jsonb_build_object(
  'companies',(select jsonb_agg(to_jsonb(t) order by id) from public.companies t where id=any(f.companies)),
  'customers',(select jsonb_agg(to_jsonb(t) order by id) from public.customers t where company_id=any(f.companies)),
  'contacts',(select jsonb_agg(to_jsonb(t) order by id) from public.customer_contacts t where company_id=any(f.companies)),
  'addresses',(select jsonb_agg(to_jsonb(t) order by id) from public.customer_addresses t where company_id=any(f.companies)),
  'sites',(select jsonb_agg(to_jsonb(t) order by id) from public.customer_sites t where company_id=any(f.companies)),
  'contracts',(select jsonb_agg(to_jsonb(t) order by id) from public.customer_contracts t where company_id=any(f.companies)),
  'underlays',(select jsonb_agg(to_jsonb(t) order by id) from public.billing_underlays t where company_id=any(f.companies)),
  'invoices',(select jsonb_agg(to_jsonb(t) order by id) from public.customer_invoices t where company_id=any(f.companies)),
  'documents',(select jsonb_agg(to_jsonb(t) order by id) from public.customer_invoice_documents t where company_id=any(f.companies)),
  'authUsers',(select jsonb_agg(to_jsonb(t) order by id) from auth.users t where id=any(f.users)),
  'authSessions',(select jsonb_agg(to_jsonb(t) order by id) from auth.sessions t where user_id=any(f.users)),
  'profiles',(select jsonb_agg(to_jsonb(t) order by id) from public.user_profiles t where id=any(f.users)),
  'memberships',(select jsonb_agg(to_jsonb(t) order by id) from public.company_memberships t where company_id=any(f.companies)),
  'permissions',(select jsonb_agg(to_jsonb(t) order by id) from public.user_permissions t where company_id=any(f.companies)),
  'audit',(select jsonb_agg(to_jsonb(t) order by id) from public.canonical_audit_events t where company_id=any(f.companies)),
  'commandResults',(select jsonb_agg(to_jsonb(t) order by id) from public.canonical_command_results t where company_id=any(f.companies)),
  'domainEvents',(select jsonb_agg(to_jsonb(t) order by id) from public.canonical_domain_events t where company_id=any(f.companies)),
  'eventOutbox',(select jsonb_agg(to_jsonb(t) order by id) from public.canonical_event_outbox t where company_id=any(f.companies))) body
 from fixture f
)
select encode(extensions.digest(body::text,'sha256'),'hex') from evidence;
\endif

-- Supplemental restore-specific catalog digest. Shared schema introspection
-- does not cover owners, column ACL or creator default ACL. Cover those here,
-- including grantor/grant-option semantics, without changing the clean gate.
-- All non-system schemas are included except the explicitly excluded cron.
with namespaces as (
 select oid,nspname,nspowner,nspacl from pg_namespace
 where nspname not like 'pg_%' and nspname not in ('information_schema','cron')
), relations as (
 select c.oid,n.nspname,c.relname,c.relkind,c.relowner,c.relacl
 from pg_class c join namespaces n on n.oid=c.relnamespace
), routines as (
 select p.oid,n.nspname,p.proname,p.proowner,p.proacl,
  pg_get_function_identity_arguments(p.oid) arguments
 from pg_proc p join namespaces n on n.oid=p.pronamespace
), types as (
 select t.oid,n.nspname,t.typname,t.typowner,t.typacl
 from pg_type t join namespaces n on n.oid=t.typnamespace
), owners as (
 select 'schema' kind,nspname schema_name,nspname object_name,'' arguments,
  pg_get_userbyid(nspowner) owner_name from namespaces
 union all select 'relation:'||relkind::text,nspname,relname,'',pg_get_userbyid(relowner) from relations
 union all select 'routine',nspname,proname,arguments,pg_get_userbyid(proowner) from routines
 union all select 'type',nspname,typname,'',pg_get_userbyid(typowner) from types
 union all select 'extension',n.nspname,e.extname,'',pg_get_userbyid(e.extowner)
  from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname<>'pg_cron'
), acl_entries as (
 select 'schema' kind,n.nspname schema_name,n.nspname object_name,'' arguments,'' column_name,
  a.grantee,a.grantor,a.privilege_type,a.is_grantable
 from namespaces n,lateral aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a
 union all select 'relation',r.nspname,r.relname,'','',a.grantee,a.grantor,a.privilege_type,a.is_grantable
  from relations r,lateral aclexplode(coalesce(r.relacl,
   acldefault(case when r.relkind='S' then 'S'::"char" else 'r'::"char" end,r.relowner))) a
  where r.relkind in ('r','p','v','m','f','S')
 union all select 'column',r.nspname,r.relname,'',c.attname,a.grantee,a.grantor,a.privilege_type,a.is_grantable
  from relations r join pg_attribute c on c.attrelid=r.oid,
  lateral aclexplode(c.attacl) a where c.attnum>0 and not c.attisdropped
 union all select 'routine',p.nspname,p.proname,p.arguments,'',a.grantee,a.grantor,a.privilege_type,a.is_grantable
  from routines p,lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
 union all select 'type',t.nspname,t.typname,'','',a.grantee,a.grantor,a.privilege_type,a.is_grantable
  from types t,lateral aclexplode(coalesce(t.typacl,acldefault('T',t.typowner))) a
), named_acl as (
 select kind,schema_name,object_name,arguments,column_name,
  case when grantee=0 then 'PUBLIC' else pg_get_userbyid(grantee) end grantee,
  pg_get_userbyid(grantor) grantor,privilege_type,is_grantable from acl_entries
), defaults as (
 select pg_get_userbyid(d.defaclrole) creator,
  case when d.defaclnamespace=0 then '*' else n.nspname end schema_name,
  d.defaclobjtype::text object_type,
  case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end grantee,
  pg_get_userbyid(a.grantor) grantor,a.privilege_type,a.is_grantable
 from pg_default_acl d left join namespaces n on n.oid=d.defaclnamespace,
 lateral aclexplode(d.defaclacl) a where d.defaclnamespace=0 or n.oid is not null
), payload as (
 select jsonb_build_object(
  'owners',(select coalesce(jsonb_agg(to_jsonb(o) order by kind,schema_name,object_name,arguments),'[]'::jsonb) from owners o),
  'acl',(select coalesce(jsonb_agg(to_jsonb(a) order by kind,schema_name,object_name,arguments,column_name,
    grantee,grantor,privilege_type,is_grantable),'[]'::jsonb) from named_acl a),
  'defaultAcl',(select coalesce(jsonb_agg(to_jsonb(d) order by creator,schema_name,object_type,
    grantee,grantor,privilege_type,is_grantable),'[]'::jsonb) from defaults d)) body
)
select case when :'tenantservice_catalog_is_detail'::boolean then body::text
 else encode(extensions.digest(body::text,'sha256'),'hex') end from payload;
