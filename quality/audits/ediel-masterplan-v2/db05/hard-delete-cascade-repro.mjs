import {readFileSync} from 'node:fs'
import {PGlite} from '@electric-sql/pglite'
const db=new PGlite()
await db.exec(`create role anon; create role authenticated; create role service_role; create role supabase_admin; create role authenticator;
 create schema if not exists auth; create table auth.users(id uuid primary key); create schema if not exists extensions; create schema if not exists storage;`)
for(const e of ['pgcrypto','btree_gist','citext','pg_trgm','uuid-ossp']){try{await db.exec(`create extension if not exists "${e}"`)}catch{}}
await db.exec(`create or replace function extensions.gen_random_uuid() returns uuid language sql as 'select pg_catalog.gen_random_uuid()';
 create or replace function extensions.digest(bytea,text) returns bytea language sql immutable as 'select pg_catalog.sha256($1)';
 create or replace function extensions.digest(text,text) returns bytea language sql immutable as 'select pg_catalog.sha256(convert_to($1,''UTF8''))';`)
const src=readFileSync('supabase/schema.sql','utf8').replace(/^\\(un)?restrict.*$/gm,'').replace(/^CREATE SCHEMA public;$/m,'').replace(/extensions\.geometry\([^)]*\)/g,'bytea')
const chunks=src.split(/\n(?=--\n-- Name: )/);let ok=0,bad=0
for(const c of chunks){try{await db.exec(c);ok++}catch{bad++}}
console.log({chunks:chunks.length,ok,bad})
const q=async s=>(await db.query(s)).rows
console.log(await q(`select count(*)::int n from pg_trigger where tgrelid='public.companies'::regclass and not tgisinternal and tgtype & 8 = 8`))
const C='11111111-1111-1111-1111-111111111111'
await db.exec(`alter table public.companies disable trigger user; alter table public.canonical_audit_events disable trigger user`)
await db.exec(`insert into public.companies(id,name) values ('${C}','Synthetic')`)
await db.exec(`insert into public.canonical_audit_events(company_id,event_type,aggregate_type,aggregate_id,idempotency_key) values ('${C}','x','y','${C}','k1')`)
console.log('before',await q(`select count(*)::int n from public.canonical_audit_events`))
let err=null
try{await db.exec(`delete from public.companies where id='${C}'`)}catch(e){err=e.message}
console.log('delete error:',err)
console.log('after',await q(`select count(*)::int n from public.canonical_audit_events`),await q(`select count(*)::int n from public.companies`))
