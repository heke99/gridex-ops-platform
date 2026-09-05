-- GRIDEX OPS master remediation plan, Fas 4 (§7): canonical/live schema parity.
--
-- Emits one deterministic JSON document describing every schema object the
-- parity engine compares. Structure only: no table data is read.
--
-- Requires psql variable :schemas, a Postgres text[] literal, e.g. '{public}'.
with nsp as (
  select n.oid, n.nspname
  from pg_namespace n
  where n.nspname = any (:'schemas'::text[])
),
rels as (
  select n.nspname, c.relname, c.relkind::text as relkind, c.oid,
         c.relrowsecurity, c.relforcerowsecurity,
         array(select option from unnest(c.reloptions) as option order by option collate "C") as reloptions,
         case when c.relkind in ('v', 'm') then pg_get_viewdef(c.oid, true) end as view_definition,
         case when c.relkind = 'p' then pg_get_partkeydef(c.oid) end as partition_key
  from pg_class c
  join nsp n on n.oid = c.relnamespace
  where c.relkind in ('r', 'p', 'v', 'm', 'f')
),
cols as (
  select r.nspname, r.relname, a.attnum, a.attname,
         format_type(a.atttypid, a.atttypmod) as data_type,
         t.typname as udt_name,
         not a.attnotnull as is_nullable,
         coalesce(pg_get_expr(ad.adbin, ad.adrelid, true), '') as column_default,
         a.attidentity::text as identity,
         a.attgenerated::text as generated
  from pg_attribute a
  join rels r on r.oid = a.attrelid
  join pg_type t on t.oid = a.atttypid
  left join pg_attrdef ad on ad.adrelid = a.attrelid and ad.adnum = a.attnum
  where a.attnum > 0 and not a.attisdropped
),
enums as (
  select n.nspname, t.typname, e.enumlabel, e.enumsortorder
  from pg_type t
  join nsp n on n.oid = t.typnamespace
  join pg_enum e on e.enumtypid = t.oid
),
cons as (
  select r.nspname, r.relname, con.conname, con.contype::text as contype,
         pg_get_constraintdef(con.oid, true) as definition,
         con.convalidated
  from pg_constraint con
  join rels r on r.oid = con.conrelid
),
idx as (
  select r.nspname, r.relname, ic.relname as indexname,
         pg_get_indexdef(i.indexrelid) as definition,
         i.indisunique, i.indisprimary
  from pg_index i
  join rels r on r.oid = i.indrelid
  join pg_class ic on ic.oid = i.indexrelid
),
funcs as (
  select n.nspname, p.proname,
         pg_get_function_identity_arguments(p.oid) as identity_arguments,
         pg_get_function_arguments(p.oid) as arguments,
         pg_get_function_result(p.oid) as return_type,
         p.prosecdef as security_definer,
         p.provolatile::text as volatility,
         p.prokind::text as kind,
         case when p.prokind in ('f', 'p') then md5(pg_get_functiondef(p.oid)) end as body_md5
  from pg_proc p
  join nsp n on n.oid = p.pronamespace
),
trg as (
  select r.nspname, r.relname, t.tgname,
         pg_get_triggerdef(t.oid, true) as definition,
         t.tgenabled::text as enabled
  from pg_trigger t
  join rels r on r.oid = t.tgrelid
  where not t.tgisinternal
),
pol as (
  select r.nspname, r.relname, p.polname,
         p.polcmd::text as command,
         p.polpermissive as permissive,
         coalesce(pg_get_expr(p.polqual, p.polrelid, true), '') as using_expression,
         coalesce(pg_get_expr(p.polwithcheck, p.polrelid, true), '') as check_expression,
         coalesce((
           select array_agg(case when role_oid = 0 then 'PUBLIC'
                                 else pg_get_userbyid(role_oid) end
                            order by 1)
           from unnest(p.polroles) as role_oid
         ), '{}'::text[]) as roles
  from pg_policy p
  join rels r on r.oid = p.polrelid
),
relgrants as (
  select r.nspname, r.relname,
         case when acl.grantee = 0 then 'PUBLIC' else pg_get_userbyid(acl.grantee) end as grantee,
         acl.privilege_type, acl.is_grantable
  from rels r
  join pg_class c on c.oid = r.oid,
  lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) as acl
),
funcgrants as (
  select n.nspname, p.proname,
         pg_get_function_identity_arguments(p.oid) as identity_arguments,
         case when acl.grantee = 0 then 'PUBLIC' else pg_get_userbyid(acl.grantee) end as grantee,
         acl.privilege_type, acl.is_grantable
  from pg_proc p
  join nsp n on n.oid = p.pronamespace,
  lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) as acl
),
schemagrants as (
  select n.nspname,
         case when acl.grantee = 0 then 'PUBLIC' else pg_get_userbyid(acl.grantee) end as grantee,
         acl.privilege_type, acl.is_grantable
  from nsp n
  join pg_namespace pn on pn.oid = n.oid,
  lateral aclexplode(coalesce(pn.nspacl, acldefault('n', pn.nspowner))) as acl
),
ext as (
  select e.extname, e.extversion, n.nspname
  from pg_extension e
  join pg_namespace n on n.oid = e.extnamespace
)
select jsonb_pretty(jsonb_build_object(
  'schemas', (select coalesce(jsonb_agg(nspname order by nspname), '[]'::jsonb) from nsp),
  'relations', (select coalesce(jsonb_agg(to_jsonb(x) - 'oid' order by x.nspname, x.relname), '[]'::jsonb) from rels x),
  'columns', (select coalesce(jsonb_agg(to_jsonb(x) order by x.nspname, x.relname, x.attnum), '[]'::jsonb) from cols x),
  'enums', (select coalesce(jsonb_agg(to_jsonb(x) order by x.nspname, x.typname, x.enumsortorder), '[]'::jsonb) from enums x),
  'constraints', (select coalesce(jsonb_agg(to_jsonb(x) order by x.nspname, x.relname, x.conname), '[]'::jsonb) from cons x),
  'indexes', (select coalesce(jsonb_agg(to_jsonb(x) order by x.nspname, x.relname, x.indexname), '[]'::jsonb) from idx x),
  'functions', (select coalesce(jsonb_agg(to_jsonb(x) order by x.nspname, x.proname, x.identity_arguments), '[]'::jsonb) from funcs x),
  'triggers', (select coalesce(jsonb_agg(to_jsonb(x) order by x.nspname, x.relname, x.tgname), '[]'::jsonb) from trg x),
  'policies', (select coalesce(jsonb_agg(to_jsonb(x) order by x.nspname, x.relname, x.polname), '[]'::jsonb) from pol x),
  'relation_grants', (select coalesce(jsonb_agg(to_jsonb(x) order by x.nspname, x.relname, x.grantee, x.privilege_type), '[]'::jsonb) from relgrants x),
  'function_grants', (select coalesce(jsonb_agg(to_jsonb(x) order by x.nspname, x.proname, x.identity_arguments, x.grantee, x.privilege_type), '[]'::jsonb) from funcgrants x),
  'schema_grants', (select coalesce(jsonb_agg(to_jsonb(x) order by x.nspname, x.grantee, x.privilege_type), '[]'::jsonb) from schemagrants x),
  'extensions', (select coalesce(jsonb_agg(to_jsonb(x) order by x.extname), '[]'::jsonb) from ext x)
));
