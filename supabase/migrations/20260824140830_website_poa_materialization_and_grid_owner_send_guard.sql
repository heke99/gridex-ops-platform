begin;

-- A signed website POA must leave canonical onboarding with an immutable legal
-- snapshot. The snapshot is derived only from the exact locked/published POA
-- document that the acceptance already references; signed scope is never widened.
create or replace function public.gridex_materialize_signed_website_poa_snapshot()
returns trigger
language plpgsql
set search_path = public, extensions, pg_catalog, pg_temp
as $$
declare
  v_document_id uuid;
  v_document record;
  v_has_external_capture boolean;
begin
  if lower(coalesce(new.source, '')) <> 'website_api'
     or lower(coalesce(new.status, '')) <> 'signed' then
    return new;
  end if;

  if jsonb_typeof(new.fullmakt_snapshot) = 'object'
     and new.fullmakt_snapshot <> '{}'::jsonb then
    return new;
  end if;

  if coalesce(jsonb_array_length(new.signed_scope_snapshot), 0) = 0
     or nullif(btrim(new.signer_name), '') is null
     or nullif(btrim(new.signer_identity_number), '') is null
     or nullif(btrim(new.method), '') is null
     or coalesce(new.accepted_at, new.signed_at) is null then
    return new;
  end if;

  v_has_external_capture :=
    lower(coalesce(new.evidence_payload->>'externally_sendable_at_capture', '')) in ('true','1','yes')
    or lower(coalesce(new.evidence_payload->>'capture_type', '')) = 'structured_complete'
    or lower(coalesce(new.metadata->>'poa_capture_type', '')) = 'structured_complete'
    or lower(coalesce(new.metadata->>'externally_sendable', '')) in ('true','1','yes');

  if not v_has_external_capture then
    return new;
  end if;

  v_document_id := coalesce(new.legal_bundle_version_document_id, new.legal_text_version_id);
  if v_document_id is null then
    return new;
  end if;

  select d.id,
         d.legal_bundle_version_id,
         d.template_version,
         d.title,
         d.rendered_body,
         d.content_sha256,
         b.published_at as bundle_published_at,
         b.locked_at as bundle_locked_at
    into v_document
    from public.legal_bundle_version_documents d
    join public.legal_bundle_versions b on b.id = d.legal_bundle_version_id
   where d.id = v_document_id
     and b.company_id = new.company_id
     and d.module_key = 'power_of_attorney'
     and b.status = 'published'
     and b.locked_at is not null
     and coalesce(cardinality(d.unresolved_variables), 0) = 0
     and nullif(btrim(d.title), '') is not null
     and nullif(btrim(d.rendered_body), '') is not null
   limit 1;

  if v_document.id is null then
    return new;
  end if;

  new.fullmakt_snapshot := jsonb_build_object(
    'snapshot_version', 'website_poa_v1',
    'source', 'locked_legal_bundle_document',
    'application_id', new.metadata->>'application_id',
    'accepted_at', coalesce(new.accepted_at, new.signed_at),
    'scopes', new.signed_scope_snapshot,
    'legal_text_version_id', v_document.id,
    'legal_bundle_version_id', v_document.legal_bundle_version_id,
    'legal_text', jsonb_build_object(
      'id', v_document.id,
      'type', 'power_of_attorney',
      'version', v_document.template_version,
      'title', v_document.title,
      'body', v_document.rendered_body,
      'content_sha256', v_document.content_sha256,
      'published_at', v_document.bundle_published_at,
      'locked_at', v_document.bundle_locked_at
    )
  );

  new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object(
    'poa_snapshot_materialized', true,
    'poa_snapshot_materialization_version', 'website_poa_v1'
  );

  return new;
end;
$$;

drop trigger if exists powers_of_attorney_materialize_website_snapshot_tg
  on public.powers_of_attorney;
create trigger powers_of_attorney_materialize_website_snapshot_tg
before insert or update on public.powers_of_attorney
for each row execute function public.gridex_materialize_signed_website_poa_snapshot();

-- The authorization document is the canonical relational document for the POA.
-- Bind it back to the exact tenant/customer/site without replacing an existing
-- binding.
create or replace function public.gridex_bind_poa_authorization_document()
returns trigger
language plpgsql
set search_path = public, pg_catalog, pg_temp
as $$
begin
  if new.power_of_attorney_id is null
     or new.document_type <> 'power_of_attorney'
     or new.status not in ('active','signed','uploaded') then
    return new;
  end if;

  update public.powers_of_attorney p
     set document_id = new.id,
         metadata = coalesce(p.metadata, '{}'::jsonb) || jsonb_build_object(
           'authorization_document_id', new.id,
           'authorization_document_bound_at', now()
         ),
         updated_at = now()
   where p.id = new.power_of_attorney_id
     and p.company_id = new.company_id
     and p.customer_id = new.customer_id
     and p.document_id is null
     and coalesce(p.customer_site_id, p.site_id) is not distinct from new.site_id;

  return new;
end;
$$;

drop trigger if exists customer_authorization_documents_bind_poa_tg
  on public.customer_authorization_documents;
create trigger customer_authorization_documents_bind_poa_tg
after insert or update of power_of_attorney_id, site_id, status
on public.customer_authorization_documents
for each row execute function public.gridex_bind_poa_authorization_document();

-- Forward repair: only derive missing materialization from already immutable
-- evidence. No signer, accepted_at, legal version or signed scope is invented.
update public.powers_of_attorney p
   set fullmakt_snapshot = jsonb_build_object(
         'snapshot_version', 'website_poa_v1',
         'source', 'locked_legal_bundle_document',
         'application_id', p.metadata->>'application_id',
         'accepted_at', coalesce(p.accepted_at, p.signed_at),
         'scopes', p.signed_scope_snapshot,
         'legal_text_version_id', d.id,
         'legal_bundle_version_id', d.legal_bundle_version_id,
         'legal_text', jsonb_build_object(
           'id', d.id,
           'type', 'power_of_attorney',
           'version', d.template_version,
           'title', d.title,
           'body', d.rendered_body,
           'content_sha256', d.content_sha256,
           'published_at', b.published_at,
           'locked_at', b.locked_at
         )
       ),
       metadata = coalesce(p.metadata, '{}'::jsonb) || jsonb_build_object(
         'poa_snapshot_materialized', true,
         'poa_snapshot_materialization_version', 'website_poa_v1',
         'poa_snapshot_repaired_at', now()
       ),
       updated_at = now()
  from public.legal_bundle_version_documents d
  join public.legal_bundle_versions b on b.id = d.legal_bundle_version_id
 where p.source = 'website_api'
   and p.status = 'signed'
   and not (jsonb_typeof(p.fullmakt_snapshot) = 'object' and p.fullmakt_snapshot <> '{}'::jsonb)
   and coalesce(jsonb_array_length(p.signed_scope_snapshot), 0) > 0
   and nullif(btrim(p.signer_name), '') is not null
   and nullif(btrim(p.signer_identity_number), '') is not null
   and nullif(btrim(p.method), '') is not null
   and coalesce(p.accepted_at, p.signed_at) is not null
   and (
     lower(coalesce(p.evidence_payload->>'externally_sendable_at_capture', '')) in ('true','1','yes')
     or lower(coalesce(p.evidence_payload->>'capture_type', '')) = 'structured_complete'
     or lower(coalesce(p.metadata->>'poa_capture_type', '')) = 'structured_complete'
     or lower(coalesce(p.metadata->>'externally_sendable', '')) in ('true','1','yes')
   )
   and d.id = coalesce(p.legal_bundle_version_document_id, p.legal_text_version_id)
   and b.company_id = p.company_id
   and d.module_key = 'power_of_attorney'
   and b.status = 'published'
   and b.locked_at is not null
   and coalesce(cardinality(d.unresolved_variables), 0) = 0
   and nullif(btrim(d.title), '') is not null
   and nullif(btrim(d.rendered_body), '') is not null;

with unique_documents as (
  select p.id as power_of_attorney_id,
         (array_agg(d.id order by d.created_at desc))[1] as authorization_document_id
    from public.powers_of_attorney p
    join public.customer_authorization_documents d
      on d.company_id = p.company_id
     and d.customer_id = p.customer_id
     and d.power_of_attorney_id = p.id
     and d.document_type = 'power_of_attorney'
     and d.status in ('active','signed','uploaded')
     and d.site_id is not distinct from coalesce(p.customer_site_id, p.site_id)
   where p.document_id is null
   group by p.id
  having count(*) = 1
)
update public.powers_of_attorney p
   set document_id = u.authorization_document_id,
       metadata = coalesce(p.metadata, '{}'::jsonb) || jsonb_build_object(
         'authorization_document_id', u.authorization_document_id,
         'authorization_document_repaired_at', now()
       ),
       updated_at = now()
  from unique_documents u
 where p.id = u.power_of_attorney_id
   and p.document_id is null;

-- A provisional candidate is useful for review, never for external delivery.
-- Enforce the exact-site canonical owner again at the mail transport boundary.
create or replace function public.gridex_assert_verified_site_owner_for_manual_outbox()
returns trigger
language plpgsql
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_request_grid_owner_id uuid;
  v_site_grid_owner_id uuid;
  v_owner_verified boolean;
  v_owner_technical_only boolean;
  v_owner_verification_status text;
begin
  if coalesce(new.external_delivery, false) is not true
     or new.status not in ('queued','sending')
     or new.request_id is null then
    return new;
  end if;

  select r.grid_owner_id,
         s.grid_owner_id,
         g.verified_for_customer_flow,
         g.technical_owner_only,
         g.verification_status
    into v_request_grid_owner_id,
         v_site_grid_owner_id,
         v_owner_verified,
         v_owner_technical_only,
         v_owner_verification_status
    from public.grid_owner_information_requests r
    join public.customer_sites s
      on s.id = r.customer_site_id
     and s.company_id = r.company_id
     and s.customer_id = r.customer_id
    left join public.grid_owners g on g.id = r.grid_owner_id
   where r.id = new.request_id
     and r.company_id = new.company_id;

  if not found then
    return new;
  end if;

  if v_site_grid_owner_id is null
     or v_request_grid_owner_id is null
     or v_request_grid_owner_id is distinct from v_site_grid_owner_id
     or v_owner_verified is distinct from true
     or coalesce(v_owner_technical_only, false) is true
     or coalesce(v_owner_verification_status, '') <> 'verified' then
    raise exception using
      errcode = '23514',
      message = 'manual_grid_owner_outbox_requires_verified_site_owner',
      detail = 'External grid-owner mail requires the exact customer_site.grid_owner_id to match a verified customer-flow grid owner.';
  end if;

  return new;
end;
$$;

drop trigger if exists manual_email_outbox_verified_site_owner_tg
  on public.manual_email_outbox;
create trigger manual_email_outbox_verified_site_owner_tg
before insert or update of status, external_delivery, request_id
on public.manual_email_outbox
for each row execute function public.gridex_assert_verified_site_owner_for_manual_outbox();

-- Existing unsent rows are quarantined if they violate the new transport rule.
update public.manual_email_outbox m
   set status = 'blocked_tenant_state',
       delivery_status = 'blocked_tenant_state',
       external_delivery = false,
       last_error_code = 'grid_owner_verification_required',
       last_error = 'Verifiera nätägaren för exakt anläggning innan externt utskick.',
       blocked_reason = 'grid_owner_verification_required',
       blocked_at = now(),
       locked_at = null,
       locked_by = null,
       updated_at = now()
  from public.grid_owner_information_requests r
  join public.customer_sites s
    on s.id = r.customer_site_id
   and s.company_id = r.company_id
   and s.customer_id = r.customer_id
  left join public.grid_owners g on g.id = r.grid_owner_id
 where m.request_id = r.id
   and m.company_id = r.company_id
   and m.external_delivery = true
   and m.status in ('queued','sending')
   and (
     s.grid_owner_id is null
     or r.grid_owner_id is null
     or r.grid_owner_id is distinct from s.grid_owner_id
     or g.id is null
     or g.verified_for_customer_flow is distinct from true
     or coalesce(g.technical_owner_only, false) is true
     or coalesce(g.verification_status, '') <> 'verified'
   );

commit;
