import fs from 'node:fs'
import { PGlite } from '/workspace/gridex-ops-platform/node_modules/@electric-sql/pglite/dist/index.js'
const root='/workspace/gridex-ops-platform/'
const read=(p)=>fs.readFileSync(root+p,'utf8')
const extract=(source,name)=>{const a=source.indexOf('create or replace function public.'+name+'(');return source.slice(a,source.indexOf('$$;',a)+3)}
const db=new PGlite()
try {
 await db.exec(read('scripts/sql/customer-portfolio/00_stub.sql').replace('create extension if not exists pgcrypto;','').replace('valid_from date, valid_to date, created_at','valid_from timestamptz, valid_to timestamptz, created_at'))
 for(const file of ['20261003130000_customer_portfolio_analytics_whitelabel.sql','20261003131000_customer_portfolio_phase2.sql','20261003150000_portfolio_analytics_rollups_performance.sql','20261013094448_customer_portfolio_consistency_repair.sql'])await db.exec(read('supabase/migrations/'+file))
 await db.exec(`ALTER TABLE customers ADD COLUMN source text;
 CREATE UNIQUE INDEX customers_ci ON customers(company_id,id);CREATE UNIQUE INDEX sites_ci ON customer_sites(company_id,id);CREATE UNIQUE INDEX meters_ci ON metering_points(company_id,id);CREATE UNIQUE INDEX contracts_ci ON customer_contracts(company_id,id);
 CREATE TABLE external_contract_intakes(id uuid primary key,company_id uuid,created_customer_id uuid,created_site_id uuid,created_metering_point_id uuid,created_contract_id uuid);
 ALTER TABLE data_quality_issues ADD COLUMN entity_type text,ADD COLUMN entity_id uuid,ADD COLUMN period_month date;
 CREATE TABLE ediel_messages(id uuid,company_id uuid);
 SET test.role='service_role';
 INSERT INTO companies(id,name) VALUES('00000000-0000-0000-0000-00000000000a','A'),('00000000-0000-0000-0000-00000000000b','B');`)
 const quality=read('supabase/migrations/20261013094514_data_quality_lifecycle_consistency.sql')
 await db.exec(extract(quality,'gridex_data_quality_active_status_v1'))
 const viewStart=quality.indexOf('create or replace view public.gridex_data_quality_rule_catalog_v')
 await db.exec(quality.slice(viewStart,quality.indexOf(';',viewStart)+1))
 await db.exec(extract(quality,'gridex_data_quality_source_exists_v1'))
 await db.exec(read('supabase/migrations/20261013100622_customer_flow_integrity_and_empty_statistics.sql'))
 const empty=await db.query("select gridex_rebuild_company_analytics_month('00000000-0000-0000-0000-00000000000a','2026-09-01') result")
 const emptyRows=await db.query('select count(*) as rows from company_monthly_metrics')
 await db.exec(`INSERT INTO customers(id,company_id,full_name,status) VALUES('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-00000000000a','C','active');
 INSERT INTO grid_owners(id,company_id) VALUES('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-00000000000a');
 INSERT INTO metering_points(id,company_id,customer_id,grid_owner_id,status) VALUES
 ('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000e1','active'),
 ('00000000-0000-0000-0000-0000000000d2','00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000e1','archived');
 INSERT INTO data_quality_issues(company_id,entity_type,entity_id,issue_type,status,period_month) VALUES
 ('00000000-0000-0000-0000-00000000000a','metering_point','00000000-0000-0000-0000-0000000000d1','missing_metering_values','open','2026-09-01'),
 ('00000000-0000-0000-0000-00000000000a','metering_point','00000000-0000-0000-0000-0000000000d1','missing_metering_values','open','2026-08-01'),
 ('00000000-0000-0000-0000-00000000000a','metering_point','00000000-0000-0000-0000-0000000000d1','missing_metering_values','open',NULL),
 ('00000000-0000-0000-0000-00000000000a','metering_point','00000000-0000-0000-0000-0000000000d9','missing_metering_values','open','2026-09-01'),
 ('00000000-0000-0000-0000-00000000000a','metering_point','00000000-0000-0000-0000-0000000000d2','missing_metering_values','open','2026-09-01');
 SELECT gridex_rebuild_company_analytics_month('00000000-0000-0000-0000-00000000000a','2026-09-01');`)
 const result=await db.query("select metering_values_missing from company_monthly_metrics where company_id='00000000-0000-0000-0000-00000000000a' and month='2026-09-01'")
 const expected=await db.query(`SELECT count(*) AS expected FROM data_quality_issues q
 WHERE q.company_id='00000000-0000-0000-0000-00000000000a' AND q.status='open' AND q.issue_type='missing_metering_values'
 AND (q.period_month IS NULL OR q.period_month='2026-09-01')
 AND coalesce(gridex_data_quality_source_exists_v1(q.company_id,q.entity_type,q.entity_id,coalesce((select r.requires_active from gridex_data_quality_rule_catalog_v r where r.issue_type=q.issue_type and r.entity_type=q.entity_type),false)),true)`)
 console.log(JSON.stringify({emptyBuilder:empty.rows,emptyMonthlyRows:emptyRows.rows,matureBuilder:result.rows,sourceValidSelectedMonth:expected.rows},null,2))
} finally {await db.close()}
