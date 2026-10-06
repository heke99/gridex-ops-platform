/* eslint-disable @typescript-eslint/no-require-imports -- Actual SQL embedded fixture only. */
const fs = require('node:fs')
const path = require('node:path')
const { buildStaffIntegrationAuthFixture } = require('./staff-api-integration-auth-fixture.cjs')

function buildStaffExternalIdentityFixture(root) {
  const read = name => fs.readFileSync(path.join(root, name), 'utf8')
  const schema = read('supabase/schema.sql')
  const bootstrap = read('scripts/sql/gridex-supabase-compatible-bootstrap.sql')
  const table = name => {
    const start = schema.indexOf(`CREATE TABLE public.${name} (`)
    if (start < 0) throw new Error(`Missing actual table: ${name}`)
    return schema.slice(start, schema.indexOf('\n);', start) + 4)
  }
  const authTable = name => {
    const start = bootstrap.indexOf(`create table if not exists auth.${name} (`)
    if (start < 0) throw new Error(`Missing actual Auth table: ${name}`)
    return bootstrap.slice(start, bootstrap.indexOf('\n);', start) + 4)
  }
  const fn = name => {
    const start = schema.indexOf(`CREATE FUNCTION public.${name}(`)
    if (start < 0) throw new Error(`Missing actual function: ${name}`)
    return schema.slice(start, schema.indexOf('\n\n--\n-- Name:', start))
  }
  const provisioningConstraint = name => {
    const definition = schema.match(new RegExp(`ALTER TABLE ONLY public\\.company_provisioning_jobs\\s+ADD CONSTRAINT ${name}\\b[^;]*;`))
    if (!definition) throw new Error(`Missing actual provisioning constraint: ${name}`)
    return definition[0]
  }
  const enqueueTrigger = schema.match(/CREATE TRIGGER canonical_enqueue_invitation_delivery_job AFTER INSERT ON public\.company_invitations[^;]*;/)
  if (!enqueueTrigger) throw new Error('Missing actual invitation delivery enqueue trigger')
  const canonical = read('supabase/migrations/20260802203000_canonical_runtime_consistency_hardening.sql')
    .match(/create or replace function public\.canonical_accept_tenant_invitation\([\s\S]+?\n\$function\$;/)[0]
  const immutableFunction = (file, name) => {
    const match = [...read(`supabase/migrations/${file}`).matchAll(new RegExp(`CREATE(?: OR REPLACE)? FUNCTION public\\.${name}\\([\\s\\S]+?AS (\\$[a-zA-Z_]*\\$)[\\s\\S]+?\\1;`, 'gi'))].at(-1)
    if (!match) throw new Error(`Missing immutable function: ${name}`)
    return match[0]
  }
  return `${buildStaffIntegrationAuthFixture(root)}
CREATE SCHEMA auth; CREATE SCHEMA extensions;
CREATE FUNCTION extensions.digest(bytea,text) RETURNS bytea LANGUAGE sql IMMUTABLE STRICT AS $$SELECT sha256($1)$$;
CREATE FUNCTION extensions.digest(text,text) RETURNS bytea LANGUAGE sql IMMUTABLE STRICT AS $$SELECT sha256(convert_to($1,'UTF8'))$$;
${authTable('users')}
${authTable('sessions')}
${authTable('refresh_tokens')}
-- Optional managed GoTrue relation, intentionally present for anchor tests.
CREATE TABLE auth.identities(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES auth.users(id),provider text NOT NULL,identity_data jsonb);
${['tenant_customer_identity_providers','company_invitations','company_provisioning_jobs',
    'user_profiles','company_memberships','user_roles','roles','admin_users','permissions','user_permissions','user_permission_overrides','audit_logs',
    'canonical_command_results','canonical_tenant_access_role_mapping','canonical_audit_events','canonical_domain_events','canonical_event_outbox']
      .map(table).join('\n')}
ALTER TABLE tenant_customer_identity_providers ADD PRIMARY KEY(id);
ALTER TABLE company_invitations ADD PRIMARY KEY(id);
${provisioningConstraint('company_provisioning_jobs_pkey')}
${provisioningConstraint('company_provisioning_jobs_company_key')}
${provisioningConstraint('company_provisioning_jobs_company_id_fkey')}
ALTER TABLE user_profiles ADD PRIMARY KEY(id);
ALTER TABLE company_memberships ADD UNIQUE(company_id,user_id);
ALTER TABLE roles ADD PRIMARY KEY(id);
ALTER TABLE roles ADD UNIQUE(key);
ALTER TABLE canonical_command_results ADD UNIQUE(company_id,command_type,idempotency_key);
ALTER TABLE canonical_tenant_access_role_mapping ADD PRIMARY KEY(role_key);
${fn('canonical_json_sha256')}
${fn('canonical_command_request_hash_guard')}
CREATE TRIGGER canonical_command_results_request_hash_guard BEFORE INSERT OR UPDATE OF request_payload,request_hash ON canonical_command_results FOR EACH ROW EXECUTE FUNCTION canonical_command_request_hash_guard();
${fn('canonical_enqueue_invitation_delivery_job')}
${enqueueTrigger[0]}
${canonical}
${fn('canonical_create_tenant_invitation_pre_staff_v1')}
${fn('gridex_staff_active_membership_v1')}
${fn('gridex_staff_normalize_role_v1')}
${fn('gridex_normalize_platform_role')}
${fn('canonical_actor_is_platform_admin')}
${fn('gridex_staff_role_profile_v1')}
${fn('gridex_staff_actor_permissions_v1')}
${immutableFunction('20261004093111_staff_write_actor_guard.sql','gridex_staff_assert_write_actor_v1')}
REVOKE ALL ON FUNCTION gridex_staff_assert_write_actor_v1(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION gridex_staff_assert_write_actor_v1(uuid,uuid,uuid,text) TO service_role;
${immutableFunction('20261004095500_staff_user_actor_guard.sql','gridex_assert_staff_command_v1')}
${immutableFunction('20261004083640_staff_user_commands.sql','canonical_create_tenant_invitation')}
${immutableFunction('20261004083640_staff_user_commands.sql','canonical_change_tenant_user_access')}
${read('supabase/migrations/20261004100918_staff_user_lock_order.sql')}
${immutableFunction('20261005101527_staff_independent_onboarding_authority.sql','authenticate_integration_request_v1')}
REVOKE ALL ON FUNCTION canonical_accept_tenant_invitation(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION canonical_accept_tenant_invitation(jsonb) TO service_role;
${read('supabase/migrations/20260802203000_canonical_runtime_consistency_hardening.sql').match(/insert into public\.canonical_tenant_access_role_mapping\([\s\S]+?updated_at=now\(\);/)[0]}
INSERT INTO roles(key,name,scope,is_active) VALUES('customer_service_agent','customer_service_agent','company',true);
`
}
module.exports = { buildStaffExternalIdentityFixture }
