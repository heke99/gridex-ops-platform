-- Canonical public-contract runtime/OpenAPI/legal parity release 2026-08-01.1.
-- Forward only: enriches immutable legal snapshots, preserves historical commercial values,
-- records every repair, and exposes the exact locked legal bundle on the API channel.

create or replace function public.gridex_publication_legal_snapshot_json_v1(
  p_company_id uuid, p_legal_bundle_version_id uuid
) returns jsonb
language sql
stable
security definer
set search_path=public,pg_catalog,pg_temp
as $$
  select jsonb_build_object(
    'legal_bundle_version_id',bundle.id,
    'status',bundle.status,
    'content_sha256',bundle.content_sha256,
    'immutable',bundle.locked_at is not null,
    'module_versions',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',document.id,
        'legal_bundle_version_id',document.legal_bundle_version_id,
        'module_key',document.module_key,
        'title',document.title,
        'version',coalesce(nullif(document.template_version,''),
          bundle.published_at::text,document.created_at::text,document.id::text),
        'published_at',coalesce(bundle.published_at,document.created_at),
        'content_sha256',document.content_sha256,
        'origin',coalesce(nullif(document.origin,''),'canonical_bundle_document')
      ) order by document.sort_order,document.module_key,document.id
      ) from public.legal_bundle_version_documents document
      where document.legal_bundle_version_id=bundle.id
    ),'[]'::jsonb),
    'documents',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',document.id,
        'legal_bundle_version_id',document.legal_bundle_version_id,
        'module_key',document.module_key,
        'title',document.title,
        'version',coalesce(nullif(document.template_version,''),
          bundle.published_at::text,document.created_at::text,document.id::text),
        'published_at',coalesce(bundle.published_at,document.created_at),
        'content_sha256',document.content_sha256,
        'origin',coalesce(nullif(document.origin,''),'canonical_bundle_document')
      ) order by document.sort_order,document.module_key,document.id
      ) from public.legal_bundle_version_documents document
      where document.legal_bundle_version_id=bundle.id
    ),'[]'::jsonb)
  )
  from public.legal_bundle_versions bundle
  where bundle.id=p_legal_bundle_version_id
    and bundle.company_id=p_company_id
    and bundle.locked_at is not null
    and bundle.status in ('published','replaced','archived')
$$;

create or replace function public.gridex_finalize_contract_publication_v1(
  p_publication_version_id uuid,
  p_actor_user_id uuid default null,
  p_allow_locked_metadata_repair boolean default false
) returns jsonb
language plpgsql
security definer
set search_path=public,extensions,pg_catalog,pg_temp
as $$
declare
  v public.contract_publication_versions%rowtype;
  v_company_id uuid;
  v_channel text;
  v_blockers text[];
  v_price_options jsonb;
  v_legal_snapshot jsonb;
  v_snapshot jsonb;
  v_hash text;
  v_before jsonb;
begin
  select pv.* into v
  from public.contract_publication_versions pv
  where pv.id=p_publication_version_id
  for update;
  select a.company_id,p.channel into v_company_id,v_channel
  from public.contract_publications p
  join public.tenant_contract_assignments a on a.id=p.assignment_id
  where p.id=v.contract_publication_id;
  if not found then
    raise exception using errcode='P0002',
      message='PUBLICATION_VERSION_NOT_FOUND';
  end if;
  if v.locked_at is not null and not p_allow_locked_metadata_repair then
    raise exception using errcode='55000',
      message='PUBLICATION_VERSION_NOT_LOCKED_FOR_REPAIR';
  end if;
  v_before:=to_jsonb(v);

  perform public.gridex_materialize_publication_price_options_v1(
    v.id,p_actor_user_id
  );
  v_blockers:=public.gridex_validate_publication_graph_v1(v.id);
  if cardinality(v_blockers)>0 then
    raise exception using errcode='23514',
      message=coalesce(v_blockers[1],'PUBLICATION_SNAPSHOT_INVALID'),
      detail=to_jsonb(v_blockers)::text;
  end if;

  v_price_options:=public.gridex_publication_price_options_json_v1(v.id);
  v_legal_snapshot:=public.gridex_publication_legal_snapshot_json_v1(
    v_company_id,v.legal_bundle_version_id
  );

  v_snapshot:=coalesce(v.publication_snapshot,'{}'::jsonb)
    ||jsonb_build_object(
      'schema','gridex_contract_publication_v6',
      'channel',v_channel,
      'offer_reference',v.offer_reference,
      'price_options',v_price_options,
      'supported_price_areas',to_jsonb(
        public.gridex_supported_price_areas_v1(
          v.contract_product_version_id
        )
      ),
      'legal_snapshot',coalesce(v_legal_snapshot,'{}'::jsonb)
    );
  v_hash:=encode(extensions.digest(v_snapshot::text,'sha256'),'hex');

  perform set_config('gridex.version_transition','on',true);
  if v.locked_at is not null then
    perform set_config('gridex.publication_graph_repair','on',true);
  end if;
  update public.contract_publication_versions
  set publication_snapshot=v_snapshot,content_sha256=v_hash,
      status='published',published_at=coalesce(published_at,now()),
      locked_at=coalesce(locked_at,now())
  where id=v.id;
  if v.locked_at is not null then
    perform set_config('gridex.publication_graph_repair','off',true);
  end if;
  update public.contract_publications
  set status='published',updated_at=now()
  where id=v.contract_publication_id;

  insert into public.audit_logs(
    company_id,actor_user_id,entity_type,entity_id,action,
    old_values,new_values,metadata
  ) values(
    v_company_id,p_actor_user_id,'contract_publication_version',v.id::text,
    case when v.locked_at is null then 'contract_publication_finalized'
      else 'contract_publication_graph_repaired' end,
    v_before,(select to_jsonb(current_row)
      from public.contract_publication_versions current_row
      where current_row.id=v.id),
    jsonb_build_object('channel',v_channel,'commercial_values_changed',false)
  );

  return jsonb_build_object('ok',true,'publication_version_id',v.id,
    'channel',v_channel,'content_sha256',v_hash,
    'price_options',v_price_options,'blockers','[]'::jsonb);
end $$;

create or replace function public.gridex_list_external_api_contracts(
  p_company_id uuid,p_customer_type text default null
) returns table(data jsonb)
language sql
stable
security definer
set search_path=public,extensions,pg_catalog,pg_temp
as $$
  select jsonb_build_object(
    'offer_reference',pv.offer_reference,
    'name',coalesce(pv.publication_snapshot->'commercial_snapshot'->>'name',
      pv.publication_snapshot->'commercial_snapshot'->>'public_name','Elavtal'),
    'description',coalesce(
      pv.publication_snapshot->'commercial_snapshot'->>'description',
      pv.publication_snapshot->'commercial_snapshot'->>'public_description'),
    'contract_type',coalesce(
      pv.publication_snapshot->'commercial_snapshot'->>'contract_type',
      product_version.contract_type),
    'energy_direction',coalesce(nullif(pv.energy_direction,''),
      nullif(product_version.energy_direction,''),'consumption'),
    'customer_type',pv.customer_type,
    'price_options',coalesce(pv.publication_snapshot->'price_options','[]'::jsonb),
    'pricing',coalesce(
      pv.publication_snapshot->'commercial_snapshot'->'pricing',
      pv.publication_snapshot->'commercial_snapshot','{}'::jsonb),
    'legal',public.gridex_publication_legal_snapshot_json_v1(
      assignment.company_id,pv.legal_bundle_version_id
    ),
    'valid_from',pv.valid_from,'valid_to',pv.valid_to,'channel','api'
  )
  from public.contract_publication_versions pv
  join public.contract_publications publication
    on publication.id=pv.contract_publication_id
  join public.tenant_contract_assignments assignment
    on assignment.id=publication.assignment_id
  join public.tenant_contract_channels channel_row
    on channel_row.assignment_id=assignment.id and channel_row.channel='api'
  join public.contract_product_versions product_version
    on product_version.id=pv.contract_product_version_id
  join public.companies company on company.id=assignment.company_id
  where assignment.company_id=p_company_id and company.status='active'
    and nullif(btrim(company.external_tenant_reference),'') is not null
    and assignment.status='active' and assignment.api_publication_allowed
    and publication.channel='api' and publication.status='published'
    and pv.channel='api' and pv.status='published' and pv.locked_at is not null
    and pv.legal_bundle_version_id is not null
    and public.gridex_publication_legal_snapshot_json_v1(
      assignment.company_id,pv.legal_bundle_version_id
    ) is not null
    and pv.content_sha256=encode(
      extensions.digest(pv.publication_snapshot::text,'sha256'),'hex')
    and jsonb_array_length(coalesce(
      pv.publication_snapshot->'price_options','[]'::jsonb))>0
    and channel_row.status='active'
    and (assignment.valid_from is null or assignment.valid_from<=
      (now() at time zone 'Europe/Stockholm')::date)
    and (assignment.valid_to is null or assignment.valid_to>=
      (now() at time zone 'Europe/Stockholm')::date)
    and (channel_row.valid_from is null or channel_row.valid_from<=now())
    and (channel_row.valid_to is null or channel_row.valid_to>now())
    and (pv.valid_from is null or pv.valid_from<=now())
    and (pv.valid_to is null or pv.valid_to>now())
    and (p_customer_type is null or pv.customer_type='both'
      or pv.customer_type=p_customer_type)
    and exists(
      select 1 from public.canonical_public_contract_diagnostics_v diagnostic
      where diagnostic.publication_version_id=pv.id
        and diagnostic.channel='api' and diagnostic.visible
        and diagnostic.snapshot_source_contract_offer_id=
          diagnostic.source_contract_offer_id::text
    )
  order by pv.published_at desc nulls last,pv.created_at desc
$$;

create or replace function public.gridex_preview_public_contract_legal_backfill_v1(
  p_company_id uuid default null
) returns table(
  publication_version_id uuid,company_id uuid,category text,safe_to_apply boolean,
  legal_bundle_version_id uuid,module_count bigint,derivation_method text
)
language sql
stable
security definer
set search_path=public,pg_catalog,pg_temp
as $$
  select pv.id,assignment.company_id,
    case
      when pv.legal_bundle_version_id is null then 'missing_source'
      when bundle.id is null then 'missing_source'
      when count(document.id)=0 then 'blocked'
      when pv.publication_snapshot->'legal_snapshot'->>'legal_bundle_version_id'=
          pv.legal_bundle_version_id::text
        and pv.publication_snapshot->'legal_snapshot'->>'immutable'='true'
        and jsonb_typeof(
          pv.publication_snapshot->'legal_snapshot'->'module_versions'
        )='array'
        and jsonb_array_length(case
          when jsonb_typeof(
            pv.publication_snapshot->'legal_snapshot'->'module_versions'
          )='array' then
            pv.publication_snapshot->'legal_snapshot'->'module_versions'
          else '[]'::jsonb end
        )=count(document.id)
        and not exists(
          select 1
          from jsonb_array_elements(case
            when jsonb_typeof(
              pv.publication_snapshot->'legal_snapshot'->'module_versions'
            )='array' then
              pv.publication_snapshot->'legal_snapshot'->'module_versions'
            else '[]'::jsonb end
          ) module
          where module->>'legal_bundle_version_id' is distinct from
            pv.legal_bundle_version_id::text
        ) then 'already_valid'
      else 'backfillable'
    end,
    pv.legal_bundle_version_id is not null and bundle.id is not null
      and count(document.id)>0,
    pv.legal_bundle_version_id,count(document.id),
    case when pv.legal_bundle_version_id is not null then
      'exact_locked_bundle_relation' else null end
  from public.contract_publication_versions pv
  join public.contract_publications publication
    on publication.id=pv.contract_publication_id
  join public.tenant_contract_assignments assignment
    on assignment.id=publication.assignment_id
  left join public.legal_bundle_versions bundle
    on bundle.id=pv.legal_bundle_version_id
   and bundle.company_id=assignment.company_id
   and bundle.locked_at is not null
  left join public.legal_bundle_version_documents document
    on document.legal_bundle_version_id=bundle.id
  where pv.status in ('published','paused','ended')
    and (p_company_id is null or assignment.company_id=p_company_id)
  group by pv.id,assignment.company_id,bundle.id
$$;

create or replace function public.gridex_apply_public_contract_legal_backfill_v1(
  p_company_id uuid default null,p_dry_run boolean default true,
  p_actor_user_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path=public,extensions,pg_catalog,pg_temp
as $$
declare
  candidate record;
  scanned_count bigint:=0;
  already_valid_count bigint:=0;
  backfilled_count bigint:=0;
  ambiguous_count bigint:=0;
  missing_source_count bigint:=0;
  blocked_count bigint:=0;
  failed_count bigint:=0;
  v_snapshot jsonb;
  v_before_snapshot jsonb;
  v_before_hash text;
  v_after_hash text;
  failure_details jsonb:='[]'::jsonb;
begin
  for candidate in
    select * from public.gridex_preview_public_contract_legal_backfill_v1(
      p_company_id
    )
  loop
    scanned_count:=scanned_count+1;
    if candidate.category='already_valid' then
      already_valid_count:=already_valid_count+1;
    elsif candidate.category='missing_source' then
      missing_source_count:=missing_source_count+1;
    elsif candidate.category='blocked' then
      blocked_count:=blocked_count+1;
    elsif candidate.category='backfillable' then
      if p_dry_run then
        backfilled_count:=backfilled_count+1;
      else
        begin
          v_snapshot:=public.gridex_publication_legal_snapshot_json_v1(
            candidate.company_id,candidate.legal_bundle_version_id
          );
          if v_snapshot is null then
            missing_source_count:=missing_source_count+1;
          else
            select pv.publication_snapshot,pv.content_sha256
              into v_before_snapshot,v_before_hash
            from public.contract_publication_versions pv
            where pv.id=candidate.publication_version_id
            for update;
            v_after_hash:=encode(extensions.digest(
              jsonb_set(coalesce(v_before_snapshot,'{}'::jsonb),
                '{legal_snapshot}',v_snapshot,true)::text,'sha256'
            ),'hex');
            perform set_config('gridex.version_transition','on',true);
            perform set_config('gridex.publication_graph_repair','on',true);
            update public.contract_publication_versions pv
            set publication_snapshot=jsonb_set(
                  coalesce(v_before_snapshot,'{}'::jsonb),
                  '{legal_snapshot}',v_snapshot,true
                ),
                content_sha256=v_after_hash
            where pv.id=candidate.publication_version_id;
            perform set_config('gridex.publication_graph_repair','off',true);
            insert into public.audit_logs(
              company_id,actor_user_id,entity_type,entity_id,action,
              old_values,new_values,metadata
            ) values(
              candidate.company_id,p_actor_user_id,
              'contract_publication_version',
              candidate.publication_version_id::text,
              'public_contract_legal_snapshot_backfilled',
              jsonb_build_object(
                'content_sha256',v_before_hash,
                'legal_snapshot',v_before_snapshot->'legal_snapshot'
              ),
              jsonb_build_object(
                'content_sha256',v_after_hash,
                'legal_snapshot',v_snapshot
              ),
              jsonb_build_object(
                'derivation_method',candidate.derivation_method,
                'commercial_values_changed',false,
                'contract_schema_version','2026-08-01.1'
              )
            );
            backfilled_count:=backfilled_count+1;
          end if;
        exception when others then
          perform set_config('gridex.publication_graph_repair','off',true);
          failed_count:=failed_count+1;
          failure_details:=failure_details||jsonb_build_array(jsonb_build_object(
            'publication_version_id',candidate.publication_version_id,
            'sqlstate',sqlstate,
            'message',sqlerrm
          ));
        end;
      end if;
    else
      ambiguous_count:=ambiguous_count+1;
    end if;
  end loop;
  return jsonb_build_object(
    'dry_run',p_dry_run,
    'scanned',scanned_count,
    'already_valid',already_valid_count,
    'backfilled',backfilled_count,
    'ambiguous',ambiguous_count,
    'missing_source',missing_source_count,
    'blocked',blocked_count,
    'failed',failed_count,
    'failure_details',failure_details
  );
end $$;

revoke all on function public.gridex_publication_legal_snapshot_json_v1(uuid,uuid) from public,anon,authenticated;
revoke all on function public.gridex_preview_public_contract_legal_backfill_v1(uuid) from public,anon,authenticated;
revoke all on function public.gridex_apply_public_contract_legal_backfill_v1(uuid,boolean,uuid) from public,anon,authenticated;
grant execute on function public.gridex_publication_legal_snapshot_json_v1(uuid,uuid) to service_role;
grant execute on function public.gridex_preview_public_contract_legal_backfill_v1(uuid) to service_role;
grant execute on function public.gridex_apply_public_contract_legal_backfill_v1(uuid,boolean,uuid) to service_role;

comment on function public.gridex_apply_public_contract_legal_backfill_v1(uuid,boolean,uuid) is
  'Idempotent exact-relation legal snapshot backfill. Never selects first/latest bundle version.';
