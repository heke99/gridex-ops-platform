-- Forward-only hotfix for canonical invitation provider delivery.
-- The original migrations are immutable because they are already deployed.

begin;

set local lock_timeout = '10s';
set local statement_timeout = '60s';

-- pgcrypto is installed in the Supabase extensions schema. Pin that schema for
-- both security-definer functions that hash invitation tokens.
alter function public.canonical_create_tenant_invitation(jsonb)
  set search_path = public, auth, extensions, pg_temp;
alter function public.canonical_provision_company(jsonb)
  set search_path = public, auth, extensions, pg_temp;

commit;
