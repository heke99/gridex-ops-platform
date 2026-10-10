CREATE SCHEMA extensions;
CREATE TABLE public.legal_text_versions(id uuid primary key);
CREATE TABLE public.legal_bundle_versions(id uuid primary key, company_id uuid,status text,locked_at timestamptz,published_at timestamptz);
CREATE TABLE public.legal_bundle_version_documents(id uuid primary key,legal_bundle_version_id uuid references public.legal_bundle_versions(id),module_key text,legacy_legal_text_version_id uuid,template_version text,title text,rendered_body text,content_sha256 text,unresolved_variables text[]);
CREATE TABLE public.powers_of_attorney (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    customer_id uuid,
    site_id uuid,
    metering_point_id uuid,
    scope text DEFAULT 'supplier_switch'::text NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    signed_at timestamp with time zone,
    valid_from date,
    valid_to date,
    document_path text,
    document_hash text,
    reference text,
    notes text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid,
    scope_summary jsonb DEFAULT '{}'::jsonb NOT NULL,
    revoked_at timestamp with time zone,
    evidence_note text,
    customer_site_id uuid,
    contract_id uuid,
    accepted_at timestamp with time zone,
    valid_until date,
    legal_text_version_id uuid,
    fullmakt_snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    accepted_ip text,
    accepted_ip_hash text,
    accepted_user_agent text,
    accepted_source text DEFAULT 'admin_manual'::text,
    customer_number text,
    external_customer_id text,
    customer_contract_id uuid,
    signer_name text,
    signer_identity_number text,
    method text,
    evidence_payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    document_id uuid,
    source text,
    signed_scope_snapshot jsonb DEFAULT '[]'::jsonb NOT NULL,
    legal_snapshot_id uuid,
    power_of_attorney_reference text DEFAULT 'poa-synthetic' NOT NULL,
    legal_bundle_version_document_id uuid,
    expires_at timestamp with time zone
);
ALTER TABLE public.powers_of_attorney ADD FOREIGN KEY(legal_text_version_id) REFERENCES public.legal_text_versions(id);
ALTER TABLE public.powers_of_attorney ADD FOREIGN KEY(legal_bundle_version_document_id) REFERENCES public.legal_bundle_version_documents(id);
CREATE FUNCTION public.gridex_insert_jsonb_row(p_table regclass, p_payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $_$
declare
  v_columns text;
  v_select text;
  v_sql text;
  v_result jsonb;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'row payload must be a JSON object' using errcode = '22023';
  end if;

  select string_agg(format('%I', a.attname), ', ' order by a.attnum),
         string_agg(format('x.%I', a.attname), ', ' order by a.attnum)
    into v_columns, v_select
    from pg_attribute a
   where a.attrelid = p_table
     and a.attnum > 0
     and not a.attisdropped
     and a.attgenerated = ''
     and a.attidentity = ''
     and p_payload ? a.attname;

  if v_columns is null then
    raise exception 'payload has no writable columns for %', p_table using errcode = '22023';
  end if;

  v_sql := format(
    'insert into %s as target (%s) select %s from jsonb_populate_record(null::%s, $1) x returning to_jsonb(target)',
    p_table, v_columns, v_select, p_table
  );
  execute v_sql into v_result using p_payload;
  return v_result;
end;
$_$;
CREATE OR REPLACE FUNCTION public.gridex_normalize_power_of_attorney_legal_reference()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_candidate uuid;
  v_candidate_text text;
  v_document_company_id uuid;
  v_module_key text;
  v_locked_at timestamptz;
  v_linked_legacy_id uuid;
  v_legacy_exists boolean := false;
begin
  if new.legal_text_version_id is not null then
    select exists (
      select 1 from public.legal_text_versions legacy
      where legacy.id = new.legal_text_version_id
    ) into v_legacy_exists;
  end if;

  v_candidate := new.legal_bundle_version_document_id;

  -- Compatibility path for the website onboarding RPC that historically
  -- transported the canonical legal document id through legal_text_version_id.
  if v_candidate is null
     and new.legal_text_version_id is not null
     and not v_legacy_exists then
    v_candidate := new.legal_text_version_id;
    new.legal_text_version_id := null;
  end if;

  -- Other canonical writers already persist the immutable document id in their
  -- captured evidence/snapshot. Normalize those writes into the first-class
  -- column without changing their external behavior.
  if v_candidate is null then
    v_candidate_text := coalesce(
      nullif(new.evidence_payload->>'legal_bundle_version_document_id', ''),
      nullif(new.fullmakt_snapshot->>'legal_bundle_version_document_id', ''),
      nullif(new.metadata->>'legal_bundle_document_id', '')
    );
    if v_candidate_text is not null
       and v_candidate_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      v_candidate := v_candidate_text::uuid;
    end if;
  end if;

  if v_candidate is null then
    return new;
  end if;

  select lbv.company_id, d.module_key, lbv.locked_at, d.legacy_legal_text_version_id
    into v_document_company_id, v_module_key, v_locked_at, v_linked_legacy_id
    from public.legal_bundle_version_documents d
    join public.legal_bundle_versions lbv
      on lbv.id = d.legal_bundle_version_id
   where d.id = v_candidate;

  if not found then
    new.legal_bundle_version_document_id := v_candidate;
    return new; -- declarative FK returns the canonical 23503
  end if;

  if new.company_id is null or v_document_company_id is distinct from new.company_id then
    raise exception 'power_of_attorney_legal_document_tenant_mismatch' using errcode = '23514';
  end if;
  if v_module_key is distinct from 'power_of_attorney' then
    raise exception 'power_of_attorney_legal_document_type_mismatch' using errcode = '23514';
  end if;
  if v_locked_at is null then
    raise exception 'power_of_attorney_legal_document_not_locked' using errcode = '23514';
  end if;

  if new.legal_text_version_id is not null
     and v_linked_legacy_id is distinct from new.legal_text_version_id then
    raise exception 'power_of_attorney_legal_reference_mismatch' using errcode = '23514';
  end if;

  new.legal_bundle_version_document_id := v_candidate;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.gridex_materialize_signed_website_poa_snapshot()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_catalog', 'pg_temp'
AS $function$
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
$function$;

CREATE TRIGGER powers_of_attorney_legal_reference_normalize_tg BEFORE INSERT OR UPDATE ON public.powers_of_attorney FOR EACH ROW EXECUTE FUNCTION public.gridex_normalize_power_of_attorney_legal_reference();
CREATE TRIGGER powers_of_attorney_materialize_website_snapshot_tg BEFORE INSERT OR UPDATE ON public.powers_of_attorney FOR EACH ROW EXECUTE FUNCTION public.gridex_materialize_signed_website_poa_snapshot();
CREATE FUNCTION public.audit_native_poa_phase(p_command jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
 v_legal_payload jsonb := p_command->'legal';
 v_poa_payload jsonb := p_command->'power_of_attorney';
 v_signed_scopes jsonb;
 v_scope_values text[];
 v_row jsonb;
 v_company_id uuid := (p_command->>'company_id')::uuid;
 v_customer_id uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa11';
 v_site_id uuid := null;
 v_metering_point_id uuid := null;
 v_contract_id uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa22';
 v_channel text := 'website';
BEGIN
  if jsonb_typeof(v_legal_payload->'signed_scopes') = 'array' then
    v_signed_scopes := v_legal_payload->'signed_scopes';
  elsif jsonb_typeof(v_poa_payload->'signed_scopes') = 'array' then
    v_signed_scopes := v_poa_payload->'signed_scopes';
  else
    v_signed_scopes := '[]'::jsonb;
  end if;
  select coalesce(array_agg(value), '{}'::text[]) into v_scope_values
    from jsonb_array_elements_text(v_signed_scopes) value;

  if jsonb_typeof(v_poa_payload) = 'object' and v_poa_payload <> '{}'::jsonb then
    if coalesce(jsonb_array_length(v_signed_scopes), 0) = 0 then
      raise exception 'signed_power_of_attorney_scope_required' using errcode = '22023';
    end if;
    v_row := public.gridex_insert_jsonb_row(
      'public.powers_of_attorney'::regclass,
      (v_poa_payload - 'signed_scopes') || jsonb_build_object(
        'company_id', v_company_id,
        'customer_id', v_customer_id,
        'site_id', v_site_id,
        'customer_site_id', v_site_id,
        'metering_point_id', v_metering_point_id,
        'contract_id', v_contract_id,
        'customer_contract_id', v_contract_id,
        'signed_scope_snapshot', v_signed_scopes,
        'scope_summary', jsonb_build_object('scopes', v_signed_scopes, 'source', v_channel)
      )
    );
    return v_row;
  end if;
  return null;
END $$;
