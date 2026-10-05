/* eslint-disable @typescript-eslint/no-require-imports -- Embedded SQL fixture only. */
const fs = require('node:fs')
const path = require('node:path')

function buildStaffOnboardingFixture(root) {
  const source = file => fs.readFileSync(path.join(root, file), 'utf8')
  const exact = (file, pattern) => {
    const matches = [...source(file).matchAll(pattern)]
    if (matches.length !== 1) throw new Error(`Expected one unchanged source function in ${file}`)
    return matches[0][0]
  }
  return `
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth; CREATE SCHEMA extensions;
-- PGlite lacks packaged pgcrypto. This compatibility primitive delegates to
-- PostgreSQL's real SHA256 implementation; the canonical hash function below
-- is imported unchanged from its source migration.
CREATE FUNCTION extensions.digest(bytea,text) RETURNS bytea LANGUAGE sql IMMUTABLE STRICT AS $$SELECT sha256($1)$$;
CREATE TABLE companies(id uuid primary key,name text,status text,is_active boolean default true);
CREATE TABLE auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,deleted_at timestamptz,banned_until timestamptz);
CREATE TABLE user_profiles(id uuid primary key,email text,user_status text);
CREATE TABLE integration_api_clients(id uuid primary key,company_id uuid,name text,key_prefix text,secret_hash text,scopes text[],status text,expires_at timestamptz,allowed_origins text[],metadata jsonb,deleted_at timestamptz,revoked_at timestamptz);
CREATE TABLE tenant_customer_identity_providers(id uuid primary key,company_id uuid,kind text,display_name text,issuer text,audience text,jwks_uri text,public_jwk jsonb,subject_claim text,enforcement text,purpose text,is_active boolean);
CREATE TABLE company_invitations(id uuid primary key,company_id uuid,email text,invited_email text,invited_user_id uuid,invited_by uuid,status text,expires_at timestamptz,created_at timestamptz default now(),accepted_at timestamptz,updated_at timestamptz,role_key text,membership_role text,metadata jsonb);
CREATE TABLE canonical_command_results(company_id uuid,command_type text,idempotency_key text,request_hash text,request_payload jsonb,result_payload jsonb,actor_user_id uuid,UNIQUE(company_id,command_type,idempotency_key));
CREATE TABLE canonical_tenant_access_role_mapping(role_key text primary key,membership_role text,is_assignable boolean);
CREATE TABLE roles(id uuid primary key default gen_random_uuid(),key text unique,name text,description text,scope text,is_active boolean,created_at timestamptz default now());
CREATE TABLE company_memberships(id uuid default gen_random_uuid(),company_id uuid,user_id uuid,membership_role text,role_key text,status text,is_active boolean,invited_email text,invited_by uuid,invited_at timestamptz,accepted_at timestamptz,disabled_at timestamptz,removed_at timestamptz,status_reason text,metadata jsonb,updated_at timestamptz,UNIQUE(company_id,user_id));
CREATE TABLE user_roles(id uuid default gen_random_uuid(),company_id uuid,user_id uuid,role text,role_id uuid,status text,is_active boolean,created_at timestamptz,updated_at timestamptz);
CREATE TABLE canonical_audit_events(id uuid default gen_random_uuid(),company_id uuid,event_type text,aggregate_type text,aggregate_id uuid,actor_user_id uuid,reason text,idempotency_key text,before_state jsonb,after_state jsonb);
CREATE TABLE canonical_domain_events(id uuid default gen_random_uuid(),company_id uuid,event_type text,aggregate_type text,aggregate_id uuid,idempotency_key text,payload jsonb,created_by uuid);
CREATE TABLE canonical_event_outbox(id uuid default gen_random_uuid(),company_id uuid,domain_event_id uuid,topic text,idempotency_key text,payload jsonb);
INSERT INTO canonical_tenant_access_role_mapping VALUES('customer_service_agent','support',true);
${exact('supabase/migrations/20260802170000_canonical_security_convergence.sql', /create or replace function public\.canonical_json_sha256\([\s\S]+?\n\$\$;/g)}
${exact('supabase/migrations/20260802203000_canonical_runtime_consistency_hardening.sql', /create or replace function public\.canonical_accept_tenant_invitation\([\s\S]+?\n\$function\$;/g)}
REVOKE ALL ON FUNCTION public.canonical_accept_tenant_invitation(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.canonical_accept_tenant_invitation(jsonb) TO service_role;
`
}
module.exports = { buildStaffOnboardingFixture }
