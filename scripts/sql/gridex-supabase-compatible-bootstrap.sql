-- GRIDEX OPS master remediation plan, Fas 2 (§5.1) — Supabase-compatible empty database.
--
-- Clean replay requires "a new empty Supabase-compatible DB" carrying the
-- Supabase roles, the auth and storage schemas and the extensions Gridex uses.
-- The Supabase CLI normally provides those by starting a local stack in Docker.
-- Where Docker is unavailable this script provisions the same surface on a
-- plain PostgreSQL database, so the migration chain can be replayed anywhere.
--
-- It creates ONLY the platform surface the migration chain depends on. It
-- creates no Gridex object: everything in public still comes from the
-- versioned migrations, which remain the schema authority (plan §1.3).
--
-- Run against a freshly created, empty database.

-- Supabase roles. service_role bypasses RLS exactly as it does on Supabase, so
-- policies replay with the same semantics.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator noinherit login password 'postgres';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_admin') then
    create role supabase_admin nologin noinherit createrole createdb replication bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    create role supabase_auth_admin nologin noinherit createrole;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_storage_admin') then
    create role supabase_storage_admin nologin noinherit createrole;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'dashboard_user') then
    create role dashboard_user nologin noinherit createrole createdb replication;
  end if;
end
$$;

grant anon, authenticated, service_role to authenticator;
grant anon, authenticated, service_role to postgres;

create schema if not exists auth authorization supabase_auth_admin;
create schema if not exists storage authorization supabase_storage_admin;
create schema if not exists extensions;
create schema if not exists graphql_public;
create schema if not exists realtime;
create schema if not exists vault;
create schema if not exists supabase_migrations;

-- Gridex migrations call extensions.digest, extensions.gen_random_uuid and
-- PostGIS geometry, so the extensions live in the extensions schema as on
-- Supabase rather than in public.
create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- Supabase puts the extensions schema on the search path, so migrations call
-- digest(), gen_random_uuid() and PostGIS unqualified. Without this the chain
-- fails on the first helper that hashes a payload.
do $$
begin
  execute format(
    'alter database %I set search_path to "$user", public, extensions',
    current_database()
  );
end
$$;

alter role anon set search_path to "$user", public, extensions;
alter role authenticated set search_path to "$user", public, extensions;
alter role service_role set search_path to "$user", public, extensions;

grant usage on schema extensions to anon, authenticated, service_role, postgres;
grant usage on schema auth to anon, authenticated, service_role, postgres;
grant usage on schema storage to anon, authenticated, service_role, postgres;
grant usage on schema public to anon, authenticated, service_role;

-- Supabase grants EXECUTE on newly created functions to the client roles
-- through default privileges. Without this the harness sees a NULL ACL where
-- the real stack has an explicit anon grant, so a migration that revokes only
-- from PUBLIC looks sufficient here and is not. Functions only: table default
-- privileges are deliberately NOT replicated, because a table's reachability
-- is what the tenant invariant gate measures and inventing grants here would
-- manufacture findings.
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

-- GoTrue's auth.users. Only the columns the Gridex migration chain reads or
-- references are guaranteed here; the shape and nullability follow Supabase.
create table if not exists auth.users (
  instance_id uuid,
  id uuid not null primary key,
  aud varchar(255),
  role varchar(255),
  email varchar(255),
  encrypted_password varchar(255),
  email_confirmed_at timestamptz,
  invited_at timestamptz,
  confirmation_token varchar(255),
  confirmation_sent_at timestamptz,
  recovery_token varchar(255),
  recovery_sent_at timestamptz,
  last_sign_in_at timestamptz,
  raw_app_meta_data jsonb,
  raw_user_meta_data jsonb,
  is_super_admin boolean,
  created_at timestamptz,
  updated_at timestamptz,
  phone text default null unique,
  phone_confirmed_at timestamptz,
  banned_until timestamptz,
  deleted_at timestamptz,
  is_anonymous boolean not null default false
);
create index if not exists users_instance_id_email_idx on auth.users (instance_id, lower(email::text));

create table if not exists auth.sessions (
  id uuid not null primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz,
  updated_at timestamptz,
  not_after timestamptz
);

create table if not exists auth.refresh_tokens (
  id bigserial primary key,
  instance_id uuid,
  token varchar(255) unique,
  user_id varchar(255),
  revoked boolean,
  created_at timestamptz,
  updated_at timestamptz,
  session_id uuid references auth.sessions (id) on delete cascade
);

-- The request-scoped helpers RLS policies are written against. Identical
-- semantics to Supabase: they read the JWT claims GUC set per request.
create or replace function auth.jwt() returns jsonb
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;

create or replace function auth.uid() returns uuid
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

create or replace function auth.role() returns text
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;

create or replace function auth.email() returns text
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.email', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')
  )::text
$$;

create table if not exists storage.buckets (
  id text not null primary key,
  name text not null,
  owner uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  public boolean default false,
  avif_autodetection boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);

create table if not exists storage.objects (
  id uuid not null primary key default extensions.gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text,
  owner uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  last_accessed_at timestamptz default now(),
  metadata jsonb,
  path_tokens text[] generated always as (string_to_array(name, '/')) stored,
  version text,
  owner_id text
);
create unique index if not exists bucketid_objname on storage.objects (bucket_id, name);

alter table storage.buckets enable row level security;
alter table storage.objects enable row level security;

-- Supabase Vault. Migrations read secrets through these, so the surface must
-- exist; values are supplied by the environment, never by replay.
create table if not exists vault.secrets (
  id uuid primary key default extensions.gen_random_uuid(),
  name text unique,
  description text not null default '',
  secret text not null,
  key_id uuid,
  nonce bytea,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace view vault.decrypted_secrets as
  select id, name, description, secret, secret as decrypted_secret,
         key_id, nonce, created_at, updated_at
  from vault.secrets;

create or replace function vault.create_secret(
  new_secret text,
  new_name text default null,
  new_description text default '',
  new_key_id uuid default null
) returns uuid
language plpgsql security definer as $$
declare inserted uuid;
begin
  insert into vault.secrets (secret, name, description, key_id)
  values (new_secret, new_name, new_description, new_key_id)
  returning id into inserted;
  return inserted;
end
$$;

-- The Supabase CLI owns this ledger. Clean replay recreates the observed rows
-- through it, so the table must exist before any migration runs.
create table if not exists supabase_migrations.schema_migrations (
  version text not null primary key,
  statements text[],
  name text
);
