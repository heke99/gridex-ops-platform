import {readFileSync} from 'node:fs'
import {PGlite} from '@electric-sql/pglite'
const db=new PGlite()
await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create role supabase_admin; create role authenticator;
 create schema if not exists auth; create table auth.users(id uuid primary key, email text); create table auth.sessions(id uuid primary key default gen_random_uuid(), user_id uuid);
 create schema if not exists extensions; create schema if not exists storage;
 create or replace function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create or replace function auth.role() returns text language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),current_user)$$;`)
for(const e of ['pgcrypto','btree_gist','citext','pg_trgm','uuid-ossp']){try{await db.exec(`create extension if not exists "${e}"`)}catch{}}
await db.exec(`create or replace function extensions.gen_random_uuid() returns uuid language sql as 'select pg_catalog.gen_random_uuid()';
 create or replace function extensions.digest(bytea,text) returns bytea language sql immutable as 'select pg_catalog.sha256($1)';
 create or replace function extensions.digest(text,text) returns bytea language sql immutable as 'select pg_catalog.sha256(convert_to($1,''UTF8''))';`)
const src=readFileSync('supabase/schema.sql','utf8').replace(/^\\(un)?restrict.*$/gm,'').replace(/^CREATE SCHEMA public;$/m,'').replace(/extensions\.geometry\([^)]*\)/g,'bytea')
const fails=[]
for(const c of src.split(/\n(?=--\n-- Name: )/)){try{await db.exec(c)}catch(e){const m=c.match(/-- Name: ([^;]*); Type: ([A-Z ]+);/);if(m&&/lifecycle|compan|integration_api|webhook|portal_ident|membership|command_results|audit_events/.test(m[1]))fails.push(m[1]+': '+e.message.slice(0,90))}}
console.log('relevant load failures',fails.slice(0,15))
const C='11111111-1111-1111-1111-111111111111',U='99999999-9999-9999-9999-999999999999'
await db.exec(`insert into auth.users(id) values ('${U}')`)
try{await db.exec(`insert into public.companies(id,name,status) values ('${C}','Synthetic','active')`);console.log('company insert ok with triggers')}catch(e){console.log('company insert:',e.message.slice(0,200))}
