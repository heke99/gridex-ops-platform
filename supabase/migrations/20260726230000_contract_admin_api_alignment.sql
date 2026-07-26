-- Gridex OPS: final contract/admin/API alignment.
--
-- Forward-only repair:
--   1. repairs the final tenant lifecycle function definition that reintroduced
--      ambiguous valid_to references after an earlier hotfix;
--   2. closes direct authenticated access to the SECURITY DEFINER deletion
--      preview. Runtime callers use the tenant-checked server/service path;
--   3. documents the canonical permanent-deletion boundary.

begin;

do $repair_tenant_lifecycle$
declare
  v_before text;
  v_after text;
begin
  select pg_get_functiondef(
    'public.gridex_transition_tenant_lifecycle(uuid,text,uuid,text)'::regprocedure
  ) into v_before;

  v_after:=regexp_replace(
    v_before,
    'coalesce\(\s*valid_to\s*,\s*now\(\)\s*\)',
    'coalesce(ch.valid_to, now())',
    'g'
  );
  v_after:=regexp_replace(
    v_after,
    'else\s+valid_to\s+end',
    'else ch.valid_to end',
    'g'
  );
  v_after:=regexp_replace(
    v_after,
    'and\s+ch\.status\s*=\s*''active''',
    'and ((p_next_status = ''closed'' and ch.status in (''active'',''paused'')) or (p_next_status <> ''closed'' and ch.status = ''active''))',
    'g'
  );

  if v_after=v_before
     or position('coalesce(ch.valid_to, now())' in v_after)=0
     or position('else ch.valid_to end' in v_after)=0
     or position('ch.status in (''active'',''paused'')' in v_after)=0 then
    raise exception using
      errcode='55000',
      message='tenant_lifecycle_repair_definition_mismatch',
      detail='The expected final tenant lifecycle function shape was not found.',
      hint='Inspect gridex_transition_tenant_lifecycle before applying this migration.';
  end if;

  execute v_after;
end
$repair_tenant_lifecycle$;

-- The admin application resolves tenant scope before using the service client.
-- No browser/authenticated caller needs direct access to the SECURITY DEFINER
-- preview, and exposing it would reveal cross-tenant dependency counts to a
-- caller who knows company/offer UUIDs.
revoke all on function public.gridex_preview_delete_unused_contract(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.gridex_preview_delete_unused_contract(uuid,uuid)
  to service_role;

comment on function public.gridex_preview_delete_unused_contract(uuid,uuid) is
  'Service-only canonical deletion preview. The server must authorize the actor and tenant before invocation. Permanent deletion is limited to unused draft/ready offers.';

comment on function public.gridex_transition_tenant_lifecycle(uuid,text,uuid,text) is
  'Canonical tenant lifecycle transaction. valid_to is fully qualified; tenant closure ends both active and paused sales channels.';

commit;
