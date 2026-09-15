-- Candidate only: not selected, applied or accepted as a migration.
-- 20260904120000 defines these three parser tables as service-role only.
-- 20260915132224 closes inherited authenticated grants, leaving exactly these
-- 24 client policies inert. Preserve every ACL, other policy and table row.
-- Preserve and require the six exact May28 PUBLIC platform policies as well.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
set local search_path = pg_catalog, public;

lock table public.inbound_ediel_match_attempts, public.inbound_ediel_parse_results,
  public.inbound_email_attachments in access exclusive mode;

do $inert_inbound$
declare
  item record;
  relation_name text;
  role_name text;
  relation_oid oid;
  found_count integer := 0;
  actual_hash text;
begin
  foreach relation_name in array array[
    'inbound_ediel_match_attempts', 'inbound_ediel_parse_results', 'inbound_email_attachments'
  ] loop
    select c.oid into relation_oid from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname=relation_name and c.relkind='r' and c.relrowsecurity;
    if relation_oid is null then
      raise exception using errcode='55000', message='INERT_INBOUND_RELATION_REQUIRED';
    end if;
    foreach role_name in array array['anon','authenticated'] loop
      if has_table_privilege(role_name, relation_oid, 'SELECT,INSERT,UPDATE,DELETE')
         or has_any_column_privilege(role_name, relation_oid, 'SELECT,INSERT,UPDATE') then
        raise exception using errcode='55000', message='INERT_INBOUND_CLIENT_MUST_BE_CLOSED';
      end if;
    end loop;
  end loop;

  for item in select * from (values
    ('inbound_ediel_match_attempts', 'gridex_mp_3301efeef4cd0d084cdd', '061b393d72fa7bc6d011b0978814d1c5fe9f62455f77dc5279cd451c8a284cad'),
    ('inbound_ediel_match_attempts', 'gridex_mp_9802ed3e38447ba834ce', 'c701386168892f2593f0a6af159c38d188a46d2df8392ea4e987c8023c262d00'),
    ('inbound_ediel_match_attempts', 'gridex_mp_e8ea9a7093dcf8ddc6a0', '39f0361efc9d400db3cdb2f6608f002397ac188e5c55cea1fe843cf274b58b9b'),
    ('inbound_ediel_match_attempts', 'gridex_mp_fb247ef9f51878aee4ed', '804b2cf7f93deec6d69e6a4e2c550cc569c59b57e476d1abc5f86c2d30ad4457'),
    ('inbound_ediel_match_attempts', 'tenant_lifecycle_delete_guard', 'b66c07df6d70c60c949558de5bfc5054a08933d7e0deeba9c31cf72d9c325702'),
    ('inbound_ediel_match_attempts', 'tenant_lifecycle_insert_guard', 'd8e5065cf6147400a47c7b9107fb8fca0b52d13cdad6301c422b33f0670d1eec'),
    ('inbound_ediel_match_attempts', 'tenant_lifecycle_select_guard', 'cbc266371fd3116c7b9a333da726cbbd7b4ca98bc795e2cb630ad93c497666b9'),
    ('inbound_ediel_match_attempts', 'tenant_lifecycle_update_guard', 'd0eab374a33202561b689ceaf1ae95773b540a004620ea685d6c7f28def4e676'),
    ('inbound_ediel_parse_results', 'gridex_mp_47529f480871943c554b', '804b2cf7f93deec6d69e6a4e2c550cc569c59b57e476d1abc5f86c2d30ad4457'),
    ('inbound_ediel_parse_results', 'gridex_mp_53c367782f747fb5b538', 'c701386168892f2593f0a6af159c38d188a46d2df8392ea4e987c8023c262d00'),
    ('inbound_ediel_parse_results', 'gridex_mp_5ddce368309b6e713323', '39f0361efc9d400db3cdb2f6608f002397ac188e5c55cea1fe843cf274b58b9b'),
    ('inbound_ediel_parse_results', 'gridex_mp_c82ecc87ed234cc4ccf6', '061b393d72fa7bc6d011b0978814d1c5fe9f62455f77dc5279cd451c8a284cad'),
    ('inbound_ediel_parse_results', 'tenant_lifecycle_delete_guard', 'b66c07df6d70c60c949558de5bfc5054a08933d7e0deeba9c31cf72d9c325702'),
    ('inbound_ediel_parse_results', 'tenant_lifecycle_insert_guard', 'd8e5065cf6147400a47c7b9107fb8fca0b52d13cdad6301c422b33f0670d1eec'),
    ('inbound_ediel_parse_results', 'tenant_lifecycle_select_guard', 'cbc266371fd3116c7b9a333da726cbbd7b4ca98bc795e2cb630ad93c497666b9'),
    ('inbound_ediel_parse_results', 'tenant_lifecycle_update_guard', 'd0eab374a33202561b689ceaf1ae95773b540a004620ea685d6c7f28def4e676'),
    ('inbound_email_attachments', 'gridex_mp_0e54002bbe484cfdc875', '39f0361efc9d400db3cdb2f6608f002397ac188e5c55cea1fe843cf274b58b9b'),
    ('inbound_email_attachments', 'gridex_mp_ae96166528e4ca2afc20', '061b393d72fa7bc6d011b0978814d1c5fe9f62455f77dc5279cd451c8a284cad'),
    ('inbound_email_attachments', 'gridex_mp_aed40f0ee5d28cdcfb88', 'c701386168892f2593f0a6af159c38d188a46d2df8392ea4e987c8023c262d00'),
    ('inbound_email_attachments', 'gridex_mp_f7281fbf78fc174ca42c', '804b2cf7f93deec6d69e6a4e2c550cc569c59b57e476d1abc5f86c2d30ad4457'),
    ('inbound_email_attachments', 'tenant_lifecycle_delete_guard', 'b66c07df6d70c60c949558de5bfc5054a08933d7e0deeba9c31cf72d9c325702'),
    ('inbound_email_attachments', 'tenant_lifecycle_insert_guard', 'd8e5065cf6147400a47c7b9107fb8fca0b52d13cdad6301c422b33f0670d1eec'),
    ('inbound_email_attachments', 'tenant_lifecycle_select_guard', 'cbc266371fd3116c7b9a333da726cbbd7b4ca98bc795e2cb630ad93c497666b9'),
    ('inbound_email_attachments', 'tenant_lifecycle_update_guard', 'd0eab374a33202561b689ceaf1ae95773b540a004620ea685d6c7f28def4e676')
  ) expected(table_name, policy_name, definition_hash)
  loop
    select encode(sha256(convert_to(
      p.polcmd::text || chr(31) || p.polpermissive::text || chr(31) ||
      coalesce(pg_get_expr(p.polqual,p.polrelid,true),'') || chr(31) ||
      coalesce(pg_get_expr(p.polwithcheck,p.polrelid,true),'') || chr(31) ||
      array_to_string(array(select case when r=0 then 'PUBLIC' else pg_get_userbyid(r) end
                           from unnest(p.polroles) r order by 1), ','), 'UTF8')), 'hex')
    into actual_hash
    from pg_policy p
    where p.polrelid=to_regclass('public.'||item.table_name) and p.polname=item.policy_name;
    if actual_hash is not null then
      if actual_hash <> item.definition_hash then
        raise exception using errcode='55000', message='INERT_INBOUND_EXACT_POLICY_REQUIRED';
      end if;
      found_count := found_count + 1;
    end if;
  end loop;
  if found_count not in (0,24) then
    raise exception using errcode='55000', message='INERT_INBOUND_COMPLETE_POLICY_SET_REQUIRED';
  end if;

  -- These six PUBLIC policies are authored by the May28 platform-policy DO
  -- block and retained by September4 convergence. They are not F14 inert
  -- policies: PUBLIC is excluded by that exact rule. Require their complete
  -- definitions, preserve them, and keep all client ACLs closed above.
  for item in select * from (values
    ('inbound_ediel_match_attempts', 'inbound_ediel_match_attempts_platform_select', '1458fdbc0891f395594e27293225f2ad81476c30a962a4b0002d67dd9965273e'),
    ('inbound_ediel_match_attempts', 'inbound_ediel_match_attempts_platform_write', '3f49d6b6fafba1c4a3fd39288e310fe9680f3b750b3785a1e78c7abfdac24d96'),
    ('inbound_ediel_parse_results', 'inbound_ediel_parse_results_platform_select', '1458fdbc0891f395594e27293225f2ad81476c30a962a4b0002d67dd9965273e'),
    ('inbound_ediel_parse_results', 'inbound_ediel_parse_results_platform_write', '3f49d6b6fafba1c4a3fd39288e310fe9680f3b750b3785a1e78c7abfdac24d96'),
    ('inbound_email_attachments', 'inbound_email_attachments_platform_select', '1458fdbc0891f395594e27293225f2ad81476c30a962a4b0002d67dd9965273e'),
    ('inbound_email_attachments', 'inbound_email_attachments_platform_write', '3f49d6b6fafba1c4a3fd39288e310fe9680f3b750b3785a1e78c7abfdac24d96')
  ) expected(table_name, policy_name, definition_hash)
  loop
    select encode(sha256(convert_to(
      p.polcmd::text || chr(31) || p.polpermissive::text || chr(31) ||
      coalesce(pg_get_expr(p.polqual,p.polrelid,true),'') || chr(31) ||
      coalesce(pg_get_expr(p.polwithcheck,p.polrelid,true),'') || chr(31) ||
      array_to_string(array(select case when r=0 then 'PUBLIC' else pg_get_userbyid(r) end
                           from unnest(p.polroles) r order by 1), ','), 'UTF8')), 'hex')
    into actual_hash
    from pg_policy p
    where p.polrelid=to_regclass('public.'||item.table_name) and p.polname=item.policy_name;
    if actual_hash is distinct from item.definition_hash then
      raise exception using errcode='55000', message='INERT_INBOUND_RETAINED_PLATFORM_POLICY_REQUIRED';
    end if;
  end loop;

  -- No other client/PUBLIC policy may be silently accepted or removed.
  if exists(
    select 1 from pg_policy p join pg_class c on c.oid=p.polrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname in (
      'inbound_ediel_match_attempts','inbound_ediel_parse_results','inbound_email_attachments')
    and (0=any(p.polroles) or 'anon'::regrole::oid=any(p.polroles)
         or 'authenticated'::regrole::oid=any(p.polroles))
    and not exists(select 1 from (values
    ('inbound_ediel_match_attempts', 'gridex_mp_3301efeef4cd0d084cdd', '061b393d72fa7bc6d011b0978814d1c5fe9f62455f77dc5279cd451c8a284cad'),
    ('inbound_ediel_match_attempts', 'gridex_mp_9802ed3e38447ba834ce', 'c701386168892f2593f0a6af159c38d188a46d2df8392ea4e987c8023c262d00'),
    ('inbound_ediel_match_attempts', 'gridex_mp_e8ea9a7093dcf8ddc6a0', '39f0361efc9d400db3cdb2f6608f002397ac188e5c55cea1fe843cf274b58b9b'),
    ('inbound_ediel_match_attempts', 'gridex_mp_fb247ef9f51878aee4ed', '804b2cf7f93deec6d69e6a4e2c550cc569c59b57e476d1abc5f86c2d30ad4457'),
    ('inbound_ediel_match_attempts', 'tenant_lifecycle_delete_guard', 'b66c07df6d70c60c949558de5bfc5054a08933d7e0deeba9c31cf72d9c325702'),
    ('inbound_ediel_match_attempts', 'tenant_lifecycle_insert_guard', 'd8e5065cf6147400a47c7b9107fb8fca0b52d13cdad6301c422b33f0670d1eec'),
    ('inbound_ediel_match_attempts', 'tenant_lifecycle_select_guard', 'cbc266371fd3116c7b9a333da726cbbd7b4ca98bc795e2cb630ad93c497666b9'),
    ('inbound_ediel_match_attempts', 'tenant_lifecycle_update_guard', 'd0eab374a33202561b689ceaf1ae95773b540a004620ea685d6c7f28def4e676'),
    ('inbound_ediel_parse_results', 'gridex_mp_47529f480871943c554b', '804b2cf7f93deec6d69e6a4e2c550cc569c59b57e476d1abc5f86c2d30ad4457'),
    ('inbound_ediel_parse_results', 'gridex_mp_53c367782f747fb5b538', 'c701386168892f2593f0a6af159c38d188a46d2df8392ea4e987c8023c262d00'),
    ('inbound_ediel_parse_results', 'gridex_mp_5ddce368309b6e713323', '39f0361efc9d400db3cdb2f6608f002397ac188e5c55cea1fe843cf274b58b9b'),
    ('inbound_ediel_parse_results', 'gridex_mp_c82ecc87ed234cc4ccf6', '061b393d72fa7bc6d011b0978814d1c5fe9f62455f77dc5279cd451c8a284cad'),
    ('inbound_ediel_parse_results', 'tenant_lifecycle_delete_guard', 'b66c07df6d70c60c949558de5bfc5054a08933d7e0deeba9c31cf72d9c325702'),
    ('inbound_ediel_parse_results', 'tenant_lifecycle_insert_guard', 'd8e5065cf6147400a47c7b9107fb8fca0b52d13cdad6301c422b33f0670d1eec'),
    ('inbound_ediel_parse_results', 'tenant_lifecycle_select_guard', 'cbc266371fd3116c7b9a333da726cbbd7b4ca98bc795e2cb630ad93c497666b9'),
    ('inbound_ediel_parse_results', 'tenant_lifecycle_update_guard', 'd0eab374a33202561b689ceaf1ae95773b540a004620ea685d6c7f28def4e676'),
    ('inbound_email_attachments', 'gridex_mp_0e54002bbe484cfdc875', '39f0361efc9d400db3cdb2f6608f002397ac188e5c55cea1fe843cf274b58b9b'),
    ('inbound_email_attachments', 'gridex_mp_ae96166528e4ca2afc20', '061b393d72fa7bc6d011b0978814d1c5fe9f62455f77dc5279cd451c8a284cad'),
    ('inbound_email_attachments', 'gridex_mp_aed40f0ee5d28cdcfb88', 'c701386168892f2593f0a6af159c38d188a46d2df8392ea4e987c8023c262d00'),
    ('inbound_email_attachments', 'gridex_mp_f7281fbf78fc174ca42c', '804b2cf7f93deec6d69e6a4e2c550cc569c59b57e476d1abc5f86c2d30ad4457'),
    ('inbound_email_attachments', 'tenant_lifecycle_delete_guard', 'b66c07df6d70c60c949558de5bfc5054a08933d7e0deeba9c31cf72d9c325702'),
    ('inbound_email_attachments', 'tenant_lifecycle_insert_guard', 'd8e5065cf6147400a47c7b9107fb8fca0b52d13cdad6301c422b33f0670d1eec'),
    ('inbound_email_attachments', 'tenant_lifecycle_select_guard', 'cbc266371fd3116c7b9a333da726cbbd7b4ca98bc795e2cb630ad93c497666b9'),
    ('inbound_email_attachments', 'tenant_lifecycle_update_guard', 'd0eab374a33202561b689ceaf1ae95773b540a004620ea685d6c7f28def4e676')
,
    ('inbound_ediel_match_attempts', 'inbound_ediel_match_attempts_platform_select', '1458fdbc0891f395594e27293225f2ad81476c30a962a4b0002d67dd9965273e'),
    ('inbound_ediel_match_attempts', 'inbound_ediel_match_attempts_platform_write', '3f49d6b6fafba1c4a3fd39288e310fe9680f3b750b3785a1e78c7abfdac24d96'),
    ('inbound_ediel_parse_results', 'inbound_ediel_parse_results_platform_select', '1458fdbc0891f395594e27293225f2ad81476c30a962a4b0002d67dd9965273e'),
    ('inbound_ediel_parse_results', 'inbound_ediel_parse_results_platform_write', '3f49d6b6fafba1c4a3fd39288e310fe9680f3b750b3785a1e78c7abfdac24d96'),
    ('inbound_email_attachments', 'inbound_email_attachments_platform_select', '1458fdbc0891f395594e27293225f2ad81476c30a962a4b0002d67dd9965273e'),
    ('inbound_email_attachments', 'inbound_email_attachments_platform_write', '3f49d6b6fafba1c4a3fd39288e310fe9680f3b750b3785a1e78c7abfdac24d96')
    ) expected(table_name,policy_name,definition_hash)
    where expected.table_name=c.relname and expected.policy_name=p.polname)
  ) then
    raise exception using errcode='55000', message='INERT_INBOUND_UNEXPECTED_CLIENT_POLICY';
  end if;

  for item in select * from (values
    ('inbound_ediel_match_attempts', 'gridex_mp_3301efeef4cd0d084cdd', '061b393d72fa7bc6d011b0978814d1c5fe9f62455f77dc5279cd451c8a284cad'),
    ('inbound_ediel_match_attempts', 'gridex_mp_9802ed3e38447ba834ce', 'c701386168892f2593f0a6af159c38d188a46d2df8392ea4e987c8023c262d00'),
    ('inbound_ediel_match_attempts', 'gridex_mp_e8ea9a7093dcf8ddc6a0', '39f0361efc9d400db3cdb2f6608f002397ac188e5c55cea1fe843cf274b58b9b'),
    ('inbound_ediel_match_attempts', 'gridex_mp_fb247ef9f51878aee4ed', '804b2cf7f93deec6d69e6a4e2c550cc569c59b57e476d1abc5f86c2d30ad4457'),
    ('inbound_ediel_match_attempts', 'tenant_lifecycle_delete_guard', 'b66c07df6d70c60c949558de5bfc5054a08933d7e0deeba9c31cf72d9c325702'),
    ('inbound_ediel_match_attempts', 'tenant_lifecycle_insert_guard', 'd8e5065cf6147400a47c7b9107fb8fca0b52d13cdad6301c422b33f0670d1eec'),
    ('inbound_ediel_match_attempts', 'tenant_lifecycle_select_guard', 'cbc266371fd3116c7b9a333da726cbbd7b4ca98bc795e2cb630ad93c497666b9'),
    ('inbound_ediel_match_attempts', 'tenant_lifecycle_update_guard', 'd0eab374a33202561b689ceaf1ae95773b540a004620ea685d6c7f28def4e676'),
    ('inbound_ediel_parse_results', 'gridex_mp_47529f480871943c554b', '804b2cf7f93deec6d69e6a4e2c550cc569c59b57e476d1abc5f86c2d30ad4457'),
    ('inbound_ediel_parse_results', 'gridex_mp_53c367782f747fb5b538', 'c701386168892f2593f0a6af159c38d188a46d2df8392ea4e987c8023c262d00'),
    ('inbound_ediel_parse_results', 'gridex_mp_5ddce368309b6e713323', '39f0361efc9d400db3cdb2f6608f002397ac188e5c55cea1fe843cf274b58b9b'),
    ('inbound_ediel_parse_results', 'gridex_mp_c82ecc87ed234cc4ccf6', '061b393d72fa7bc6d011b0978814d1c5fe9f62455f77dc5279cd451c8a284cad'),
    ('inbound_ediel_parse_results', 'tenant_lifecycle_delete_guard', 'b66c07df6d70c60c949558de5bfc5054a08933d7e0deeba9c31cf72d9c325702'),
    ('inbound_ediel_parse_results', 'tenant_lifecycle_insert_guard', 'd8e5065cf6147400a47c7b9107fb8fca0b52d13cdad6301c422b33f0670d1eec'),
    ('inbound_ediel_parse_results', 'tenant_lifecycle_select_guard', 'cbc266371fd3116c7b9a333da726cbbd7b4ca98bc795e2cb630ad93c497666b9'),
    ('inbound_ediel_parse_results', 'tenant_lifecycle_update_guard', 'd0eab374a33202561b689ceaf1ae95773b540a004620ea685d6c7f28def4e676'),
    ('inbound_email_attachments', 'gridex_mp_0e54002bbe484cfdc875', '39f0361efc9d400db3cdb2f6608f002397ac188e5c55cea1fe843cf274b58b9b'),
    ('inbound_email_attachments', 'gridex_mp_ae96166528e4ca2afc20', '061b393d72fa7bc6d011b0978814d1c5fe9f62455f77dc5279cd451c8a284cad'),
    ('inbound_email_attachments', 'gridex_mp_aed40f0ee5d28cdcfb88', 'c701386168892f2593f0a6af159c38d188a46d2df8392ea4e987c8023c262d00'),
    ('inbound_email_attachments', 'gridex_mp_f7281fbf78fc174ca42c', '804b2cf7f93deec6d69e6a4e2c550cc569c59b57e476d1abc5f86c2d30ad4457'),
    ('inbound_email_attachments', 'tenant_lifecycle_delete_guard', 'b66c07df6d70c60c949558de5bfc5054a08933d7e0deeba9c31cf72d9c325702'),
    ('inbound_email_attachments', 'tenant_lifecycle_insert_guard', 'd8e5065cf6147400a47c7b9107fb8fca0b52d13cdad6301c422b33f0670d1eec'),
    ('inbound_email_attachments', 'tenant_lifecycle_select_guard', 'cbc266371fd3116c7b9a333da726cbbd7b4ca98bc795e2cb630ad93c497666b9'),
    ('inbound_email_attachments', 'tenant_lifecycle_update_guard', 'd0eab374a33202561b689ceaf1ae95773b540a004620ea685d6c7f28def4e676')
  ) expected(table_name,policy_name,definition_hash)
  loop
    execute format('drop policy if exists %I on public.%I',item.policy_name,item.table_name);
  end loop;
end $inert_inbound$;
commit;
