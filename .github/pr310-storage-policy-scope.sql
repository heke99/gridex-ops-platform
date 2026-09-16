-- Full-clone S21: the two retained agreement policies were implicitly PUBLIC.
-- Their invoker subqueries read role tables which anon must not read. Restrict
-- only policy applicability; preserve both predicates and every table grant.
-- The authenticated platform predicate remains the historical authority.
do $storage_policy_scope$
declare
  authenticated_oid oid := 'authenticated'::regrole::oid;
  before_state jsonb;
  after_state jsonb;
begin
  if (select count(*) from pg_policy
      where polrelid='storage.objects'::regclass
        and polname in ('grid_owner_agreements_platform_read','grid_owner_agreements_platform_write')
        and polpermissive
        and ((polname='grid_owner_agreements_platform_read' and polcmd='r' and polqual is not null and polwithcheck is null)
          or (polname='grid_owner_agreements_platform_write' and polcmd='a' and polqual is null and polwithcheck is not null))
        and polroles in (array[0::oid],array[authenticated_oid])) <> 2 then
    raise exception using errcode='55000',message='STORAGE_AGREEMENT_POLICY_PREIMAGE_REQUIRED';
  end if;
  select jsonb_object_agg(polname,to_jsonb(p)-'polroles') into before_state
    from pg_policy p where polrelid='storage.objects'::regclass
      and polname in ('grid_owner_agreements_platform_read','grid_owner_agreements_platform_write');
  alter policy grid_owner_agreements_platform_read on storage.objects to authenticated;
  alter policy grid_owner_agreements_platform_write on storage.objects to authenticated;
  select jsonb_object_agg(polname,to_jsonb(p)-'polroles') into after_state
    from pg_policy p where polrelid='storage.objects'::regclass
      and polname in ('grid_owner_agreements_platform_read','grid_owner_agreements_platform_write');
  if before_state is distinct from after_state or
      (select count(*) from pg_policy where polrelid='storage.objects'::regclass
        and polname in ('grid_owner_agreements_platform_read','grid_owner_agreements_platform_write')
        and polroles=array[authenticated_oid]) <> 2 then
    raise exception using errcode='23514',message='STORAGE_AGREEMENT_POLICY_PRESERVATION_REQUIRED';
  end if;
end
$storage_policy_scope$;

