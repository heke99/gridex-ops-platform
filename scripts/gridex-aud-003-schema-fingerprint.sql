with target_tables(table_name) as (values
 ('companies'),('price_plans'),('price_plan_versions'),('contract_products'),('contract_product_versions'),
 ('contract_price_options'),('contract_price_option_area_prices'),('portfolios'),('portfolio_monthly_settlements'),
 ('canonical_migration_manifest'),('integration_api_clients'),('website_customer_applications'),('ediel_message_intents')
), cols as (
 select c.table_name,c.ordinal_position,c.column_name,c.data_type,c.udt_name,c.is_nullable,coalesce(c.column_default,'') as column_default
 from information_schema.columns c join target_tables t using(table_name)
 where c.table_schema='public'
 order by c.table_name,c.ordinal_position
), cons as (
 select cl.relname as table_name, con.conname, con.contype, pg_get_constraintdef(con.oid,true) as definition
 from pg_constraint con
 join pg_class cl on cl.oid=con.conrelid
 join pg_namespace n on n.oid=cl.relnamespace
 join target_tables t on t.table_name=cl.relname
 where n.nspname='public'
 order by cl.relname,con.conname
), funcs as (
 select p.proname, pg_get_function_identity_arguments(p.oid) as args, p.prosecdef, pg_get_functiondef(p.oid) as definition
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public'
   and p.proname in ('gridex_contract_platform_readiness','gridex_contract_platform_readiness_internal_v1')
 order by p.proname,args
), payload as (
 select jsonb_build_object(
   'columns',(select coalesce(jsonb_agg(to_jsonb(cols) order by table_name,ordinal_position),'[]'::jsonb) from cols),
   'constraints',(select coalesce(jsonb_agg(to_jsonb(cons) order by table_name,conname),'[]'::jsonb) from cons),
   'functions',(select coalesce(jsonb_agg(to_jsonb(funcs) order by proname,args),'[]'::jsonb) from funcs)
 )::text as body
)
select encode(extensions.digest(body,'sha256'),'hex') from payload;
