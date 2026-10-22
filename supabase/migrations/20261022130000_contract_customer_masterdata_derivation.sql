-- FINDINGS F51 (owner decisions 2026-10-22): a Z03 whose start day is not
-- today carries the end user's identity and registered address only from an
-- approved customer masterdata declaration (gridex_customer_masterdata.basis_v1,
-- 20261001014700/20261001025107, unchanged). Nothing in the product created
-- one. The declaration is now derived automatically from the signed contract,
-- like the requested method (F46, 20261020220000), bound to the contract hash
-- and valid from signing:
--  * Online/website signing: the signature snapshot carries a hash-bound
--    customer_masterdata section (full personnummer/org nr and the registered
--    address, built exactly like basis_v1). The customer sees the same values
--    in the signed agreement PDF. The derivation verifies the archived signed
--    PDF (sha256 = document_sha256, verified signed_contract_pdf) and that every
--    customer-details line of the section is in those bytes.
--  * Manual intake and imported external PDFs (no section): the staff member's
--    registered address entry (provenance staff_entry, actor, time) is the
--    declaration, bound to that contract, without a second reviewer.
--  * Address change: a later registered address (provenance website_declaration
--    or staff_entry, moved_in_at = change day) supersedes the current
--    declaration from the start of the change day (market day, UTC+1 as
--    basis_v1). Declarations are immutable (no valid_to update), so the old
--    open declaration is revoked and re-issued with valid_to = change day, and
--    the new one starts at the change day. Revoked rows stay as history. On any
--    date exactly one unrevoked declaration matches: [signing, change) the
--    re-issued old one, [change, open) the new one.
-- A reviewed (non-derived) declaration keeps precedence; nothing is derived
-- next to it. Token signing gets the same snapshot section (body rewritten in
-- place, OID and metadata preserved); without a qualified registered address
-- the snapshot stays exactly as before.
BEGIN;

CREATE FUNCTION gridex_customer_masterdata.market_day_start_v1(day date) RETURNS timestamptz LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT day::timestamp AT TIME ZONE 'Etc/GMT-1'
$$;

-- Exactly basis_v1's registered-address projection (identity, name split, street slots).
CREATE FUNCTION gridex_customer_masterdata.registered_masterdata_v1(person public.customers,address public.customer_addresses) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object(
  'customerIdentity',CASE WHEN nullif(person.org_number,'') IS NOT NULL THEN jsonb_build_object('id',person.org_number,'qualifier','SE1','agency','260') WHEN nullif(person.personal_number,'') IS NOT NULL THEN jsonb_build_object('id',person.personal_number,'qualifier','SE2','agency','260') END,
  'endUserMasterdata',jsonb_build_object('nameParts',CASE WHEN length(n.name)<=35 THEN jsonb_build_array(n.name) WHEN length(n.name)<=70 THEN jsonb_build_array(substr(n.name,1,35),substr(n.name,36)) ELSE '[]'::jsonb END,
   'streetParts',CASE WHEN nullif(address.street_2,'') IS NULL THEN jsonb_build_array(coalesce(address.street_1,'')) ELSE jsonb_build_array(coalesce(address.street_1,''),address.street_2) END,
   'postalCode',address.postal_code,'city',address.city,'country',address.country))
 FROM (SELECT coalesce(nullif(person.company_name,''),nullif(person.full_name,''),nullif(person.name,'')) AS name) n
$$;

-- The customer-details lines of the signed agreement PDF (lib/customer-contracts/agreementPdf.ts customerMasterdataPdfLines).
CREATE FUNCTION gridex_customer_masterdata.contract_pdf_lines_v1(identity jsonb,masterdata jsonb) RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT ARRAY['Namn: '||(SELECT string_agg(part,'' ORDER BY n) FROM jsonb_array_elements_text(masterdata->'nameParts') WITH ORDINALITY x(part,n)),
  CASE WHEN identity->>'qualifier'='SE1' THEN 'Organisationsnummer: ' ELSE 'Personnummer: ' END||(identity->>'id'),
  CASE WHEN identity->>'qualifier'='SE1' THEN 'Registrerad adress: ' ELSE 'Folkbokföringsadress: ' END||coalesce(masterdata#>>'{streetParts,0}','')]
  ||coalesce((SELECT array_agg('Adressrad '||n||': '||part ORDER BY n) FROM jsonb_array_elements_text(masterdata->'streetParts') WITH ORDINALITY x(part,n) WHERE n>1),'{}'::text[])
  ||ARRAY['Postnummer och ort: '||(masterdata->>'postalCode')||' '||(masterdata->>'city'),'Land: '||(masterdata->>'country')]
$$;

-- One rendered text line as the agreement PDF writes it: a WinAnsi literal
-- string (\ ( ) escaped, 0xA0-0xFF as octal) shown with Tj. Text the PDF cannot
-- show exactly (not NFC, outside Latin-1 printable) has no literal.
CREATE FUNCTION gridex_customer_masterdata.pdf_text_v1(t text) RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE result text:='';ch text;code integer;BEGIN
 IF t IS NULL OR t IS NOT NFC NORMALIZED THEN RETURN NULL;END IF;
 FOR i IN 1..length(t) LOOP
  ch:=substr(t,i,1);code:=ascii(ch);
  IF ch IN('(',')','\') THEN result:=result||'\'||ch;
  ELSIF code BETWEEN 32 AND 126 THEN result:=result||ch;
  ELSIF code BETWEEN 160 AND 255 THEN result:=result||'\'||(code>>6)::text||((code>>3)&7)::text||(code&7)::text;
  ELSE RETURN NULL;END IF;
 END LOOP;
 RETURN '('||result||') Tj';
END$$;

-- The signature snapshot section: the customer's one current registered
-- address with accepted provenance (Stockholm day, as the address writer).
CREATE FUNCTION gridex_customer_masterdata.contract_section_v1(c uuid,customer uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE person public.customers%rowtype;address public.customer_addresses%rowtype;md jsonb;day date:=(clock_timestamp() AT TIME ZONE 'Europe/Stockholm')::date;BEGIN
 SELECT * INTO person FROM public.customers WHERE id=customer AND company_id=c;
 IF person.id IS NULL THEN RETURN NULL;END IF;
 IF (SELECT count(*) FROM public.customer_addresses a WHERE a.company_id=c AND a.customer_id=customer AND a.type='registered' AND a.is_active IS TRUE AND (a.moved_in_at IS NULL OR a.moved_in_at<=day) AND (a.moved_out_at IS NULL OR day<a.moved_out_at))<>1 THEN RETURN NULL;END IF;
 SELECT * INTO address FROM public.customer_addresses a WHERE a.company_id=c AND a.customer_id=customer AND a.type='registered' AND a.is_active IS TRUE AND (a.moved_in_at IS NULL OR a.moved_in_at<=day) AND (a.moved_out_at IS NULL OR day<a.moved_out_at);
 IF (address.metadata->>'registered_address_source' IN('website_declaration','staff_entry')) IS NOT TRUE THEN RETURN NULL;END IF;
 md:=gridex_customer_masterdata.registered_masterdata_v1(person,address);
 IF gridex_customer_masterdata.identity_v1(md->'customerIdentity') IS NOT TRUE OR gridex_customer_masterdata.literal_masterdata_v1(md->'endUserMasterdata') IS NOT TRUE THEN RETURN NULL;END IF;
 RETURN jsonb_build_object('schema','gridex_contract_customer_masterdata_v1','customerId',customer,'registeredAddressId',address.id,
  'source',address.metadata->>'registered_address_source','declaredAt',address.metadata->>'declared_at',
  'customerIdentity',md->'customerIdentity','endUserMasterdata',md->'endUserMasterdata');
END$$;

CREATE FUNCTION gridex_customer_masterdata.insert_contract_declaration_v1(contract public.customer_contracts,env text,actor uuid,agreement bytea,from_at timestamptz,to_at timestamptz,identity jsonb,masterdata jsonb,provenance jsonb)
RETURNS gridex_customer_masterdata.signed_declarations LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE source jsonb;bytes bytea;d gridex_customer_masterdata.signed_declarations%rowtype;BEGIN
 source:=jsonb_build_object('format','gridex_contract_customer_masterdata_declaration_v1','contractId',contract.id,'contractRevision',contract.signed_version,
  'agreementSha256',contract.document_sha256,'validFrom',from_at,'validTo',to_at,'customerIdentity',identity,'endUserMasterdata',masterdata,'provenance',provenance);
 bytes:=convert_to(source::text,'UTF8');
 INSERT INTO gridex_customer_masterdata.signed_declarations(company_id,customer_id,environment,contract_id,contract_revision,contract_hash,agreement_original,agreement_sha256,
  valid_from,valid_to,customer_identity,end_user_masterdata,source_reference,source_version,source_original,source_sha256,approved_by,approved_at)
 VALUES(contract.company_id,contract.customer_id,env,contract.id,contract.signed_version,gridex_received_sources.production_contract_hash_v1(contract),agreement,contract.document_sha256,
  from_at,to_at,identity,masterdata,'contract_customer_masterdata:'||contract.id::text,
  (provenance->>'kind')||':'||coalesce(provenance->>'registeredAddressId','signed-snapshot')||':'||to_char(from_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
   ||'/'||coalesce(to_char(to_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'open'),
  bytes,encode(sha256(bytes),'hex'),actor,clock_timestamp())
 RETURNING * INTO d;
 RETURN d;
END$$;

CREATE FUNCTION public.ediel_derive_contract_customer_masterdata_v1(p_company_id uuid,p_contract_id uuid,p_actor_user_id uuid,p_environment text,p_agreement_original bytea) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE contract public.customer_contracts%rowtype;bound public.customer_contracts%rowtype;person public.customers%rowtype;address public.customer_addresses%rowtype;
 cur gridex_customer_masterdata.signed_declarations%rowtype;successor gridex_customer_masterdata.signed_declarations%rowtype;
 section jsonb;md jsonb;line text;lit text;from_at timestamptz;boundary timestamptz;derived boolean:=false;superseded integer:=0;n integer;
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'contract_customer_masterdata_service_required' USING ERRCODE='42501';END IF;
 IF (p_environment IN('test','production')) IS NOT TRUE THEN RAISE EXCEPTION 'contract_customer_masterdata_environment_required';END IF;
 PERFORM gridex_customer_life_events.require_actor_v1(p_company_id,p_actor_user_id,'prepare');
 SELECT * INTO contract FROM public.customer_contracts WHERE id=p_contract_id AND company_id=p_company_id;
 IF contract.id IS NULL OR contract.customer_id IS NULL THEN RETURN jsonb_build_object('status','held','missing',ARRAY['current_signed_customer_agreement']);END IF;
 -- The rule's own declaration lock (declaration_scope_v1, basis_v1) serializes derivations per customer.
 PERFORM pg_advisory_xact_lock(hashtextextended('customer-masterdata:'||p_company_id::text||':'||contract.customer_id::text,0));
 SELECT * INTO contract FROM public.customer_contracts WHERE id=p_contract_id AND company_id=p_company_id FOR SHARE;
 IF contract.signed_at IS NULL OR nullif(contract.signed_version,'') IS NULL OR (contract.status IN('signed','active')) IS NOT TRUE OR contract.document_sha256 IS NULL THEN
  RETURN jsonb_build_object('status','held','missing',ARRAY['current_signed_customer_agreement']);END IF;
 SELECT * INTO person FROM public.customers WHERE id=contract.customer_id AND company_id=p_company_id;
 IF person.id IS NULL THEN RETURN jsonb_build_object('status','held','missing',ARRAY['same_tenant_contract_customer']);END IF;
 IF p_agreement_original IS NULL OR encode(sha256(p_agreement_original),'hex') IS DISTINCT FROM contract.document_sha256
  OR NOT EXISTS(SELECT FROM public.customer_contract_documents d WHERE d.company_id=p_company_id AND d.customer_contract_id=contract.id AND d.document_type='signed_contract_pdf' AND d.document_sha256=contract.document_sha256 AND d.verified_at IS NOT NULL)
 THEN RETURN jsonb_build_object('status','held','missing',ARRAY['archived_verified_signed_agreement_original']);END IF;
 PERFORM d.id FROM gridex_customer_masterdata.signed_declarations d WHERE d.company_id=p_company_id AND d.customer_id=person.id AND d.environment=p_environment ORDER BY d.id FOR SHARE;
 -- A reviewed declaration (archive/review flow) keeps precedence.
 IF EXISTS(SELECT FROM gridex_customer_masterdata.signed_declarations d WHERE d.company_id=p_company_id AND d.customer_id=person.id AND d.environment=p_environment
  AND d.source_reference NOT LIKE 'contract_customer_masterdata:%' AND NOT EXISTS(SELECT FROM gridex_customer_masterdata.revocations r WHERE r.declaration_id=d.id)) THEN
  RETURN jsonb_build_object('status','unchanged','reason','reviewed_customer_masterdata_declaration_present');END IF;
 SELECT count(*) INTO n FROM gridex_customer_masterdata.signed_declarations d WHERE d.company_id=p_company_id AND d.customer_id=person.id AND d.environment=p_environment
  AND d.source_reference LIKE 'contract_customer_masterdata:%' AND d.valid_to IS NULL AND NOT EXISTS(SELECT FROM gridex_customer_masterdata.revocations r WHERE r.declaration_id=d.id);
 IF n>1 THEN RETURN jsonb_build_object('status','held','missing',ARRAY['unique_open_contract_customer_masterdata_declaration']);END IF;
 SELECT * INTO cur FROM gridex_customer_masterdata.signed_declarations d WHERE d.company_id=p_company_id AND d.customer_id=person.id AND d.environment=p_environment
  AND d.source_reference LIKE 'contract_customer_masterdata:%' AND d.valid_to IS NULL AND NOT EXISTS(SELECT FROM gridex_customer_masterdata.revocations r WHERE r.declaration_id=d.id);
 IF cur.id IS NOT NULL THEN
  -- The rule rejects a declaration whose contract is no longer the same signed one; it is retired, not re-issued.
  SELECT * INTO bound FROM public.customer_contracts WHERE id=cur.contract_id AND company_id=p_company_id FOR SHARE;
  IF bound.id IS NULL OR bound.customer_id IS DISTINCT FROM person.id OR (bound.status IN('signed','active')) IS NOT TRUE OR bound.signed_at IS NULL OR bound.signed_version IS DISTINCT FROM cur.contract_revision
   OR bound.document_sha256 IS DISTINCT FROM cur.agreement_sha256 OR gridex_received_sources.production_contract_hash_v1(bound) IS DISTINCT FROM cur.contract_hash THEN
   INSERT INTO gridex_customer_masterdata.revocations(declaration_id,source_reference,source_sha256,actor_user_id) VALUES(cur.id,'contract_customer_masterdata_contract_not_signed:'||cur.contract_id::text,cur.source_sha256,p_actor_user_id);
   cur:=NULL;
  END IF;
 END IF;
 IF cur.id IS NULL THEN
  section:=contract.signature_snapshot->'customer_masterdata';
  IF jsonb_typeof(section)='object' THEN
   -- The customer signed this section; its lines must be in the archived signed bytes.
   IF section->>'schema' IS DISTINCT FROM 'gridex_contract_customer_masterdata_v1' OR section->>'customerId' IS DISTINCT FROM person.id::text
    OR gridex_customer_masterdata.identity_v1(section->'customerIdentity') IS NOT TRUE OR gridex_customer_masterdata.literal_masterdata_v1(section->'endUserMasterdata') IS NOT TRUE THEN
    RETURN jsonb_build_object('status','held','missing',ARRAY['signed_agreement_customer_details']);END IF;
   FOREACH line IN ARRAY gridex_customer_masterdata.contract_pdf_lines_v1(section->'customerIdentity',section->'endUserMasterdata') LOOP
    lit:=gridex_customer_masterdata.pdf_text_v1(line);
    IF lit IS NULL OR position(convert_to('Td'||chr(10)||lit||chr(10),'UTF8') IN p_agreement_original)=0 THEN
     RETURN jsonb_build_object('status','held','missing',ARRAY['signed_agreement_customer_details_in_signed_original']);END IF;
   END LOOP;
   SELECT * INTO cur FROM gridex_customer_masterdata.insert_contract_declaration_v1(contract,p_environment,p_actor_user_id,p_agreement_original,contract.signed_at,NULL,
    section->'customerIdentity',section->'endUserMasterdata',jsonb_build_object('kind','signed_agreement','registeredAddressId',section->>'registeredAddressId',
    'registeredAddressSource',section->>'source','declaredAt',section->>'declaredAt','signatureSchema',contract.signature_snapshot->>'schema','signatureSnapshotSha256',contract.signature_snapshot_sha256));
  ELSE
   -- No signed section (manual intake, imported external PDF): the staff member's entry is the declaration.
   SELECT a.* INTO address FROM public.customer_addresses a WHERE a.company_id=p_company_id AND a.customer_id=person.id AND a.type='registered' AND a.is_active IS TRUE
    AND a.metadata->>'registered_address_source' IN('website_declaration','staff_entry') AND (a.moved_in_at IS NULL OR a.moved_out_at IS NULL OR a.moved_out_at>a.moved_in_at)
    AND (a.moved_out_at IS NULL OR gridex_customer_masterdata.market_day_start_v1(a.moved_out_at)>contract.signed_at)
    ORDER BY a.moved_in_at NULLS FIRST,a.created_at,a.id LIMIT 1;
   IF address.id IS NULL OR address.metadata->>'registered_address_source' IS DISTINCT FROM 'staff_entry' THEN
    RETURN jsonb_build_object('status','held','missing',ARRAY['staff_entry_registered_customer_address']);END IF;
   md:=gridex_customer_masterdata.registered_masterdata_v1(person,address);
   IF gridex_customer_masterdata.identity_v1(md->'customerIdentity') IS NOT TRUE OR gridex_customer_masterdata.literal_masterdata_v1(md->'endUserMasterdata') IS NOT TRUE THEN
    RETURN jsonb_build_object('status','held','missing',ARRAY['source_qualified_customer_identity_registered_address']);END IF;
   SELECT * INTO cur FROM gridex_customer_masterdata.insert_contract_declaration_v1(contract,p_environment,p_actor_user_id,p_agreement_original,
    greatest(contract.signed_at,coalesce(gridex_customer_masterdata.market_day_start_v1(address.moved_in_at),contract.signed_at)),NULL,md->'customerIdentity',md->'endUserMasterdata',
    jsonb_build_object('kind','staff_entry','registeredAddressId',address.id,'registeredAddressSource','staff_entry','declaredAt',address.metadata->>'declared_at',
     'declaredBy',address.metadata->>'declared_by','sourceReference',address.metadata->>'source_reference','enteredAt',address.created_at,'enteredBy',address.created_by));
  END IF;
  derived:=true;
 END IF;
 -- Address changes after the current declaration began supersede it from the change day.
 FOR address IN SELECT a.* FROM public.customer_addresses a WHERE a.company_id=p_company_id AND a.customer_id=person.id AND a.type='registered' AND a.is_active IS TRUE
  AND a.metadata->>'registered_address_source' IN('website_declaration','staff_entry') AND (a.moved_in_at IS NULL OR a.moved_out_at IS NULL OR a.moved_out_at>a.moved_in_at)
  ORDER BY a.moved_in_at NULLS FIRST,a.created_at,a.id LOOP
  IF address.moved_out_at IS NOT NULL AND gridex_customer_masterdata.market_day_start_v1(address.moved_out_at)<=cur.valid_from THEN CONTINUE;END IF;
  md:=gridex_customer_masterdata.registered_masterdata_v1(person,address);
  IF (md->'endUserMasterdata')-'nameParts' IS NOT DISTINCT FROM cur.end_user_masterdata-'nameParts' THEN CONTINUE;END IF;
  IF address.moved_in_at IS NULL THEN RETURN jsonb_build_object('status','held','missing',ARRAY['registered_address_change_date_required']);END IF;
  IF gridex_customer_masterdata.identity_v1(md->'customerIdentity') IS NOT TRUE OR gridex_customer_masterdata.literal_masterdata_v1(md->'endUserMasterdata') IS NOT TRUE THEN
   RETURN jsonb_build_object('status','held','missing',ARRAY['source_qualified_customer_identity_registered_address']);END IF;
  boundary:=gridex_customer_masterdata.market_day_start_v1(address.moved_in_at);
  IF boundary>cur.valid_from THEN
   SELECT * INTO bound FROM public.customer_contracts WHERE id=cur.contract_id AND company_id=p_company_id;
   PERFORM gridex_customer_masterdata.insert_contract_declaration_v1(bound,p_environment,p_actor_user_id,cur.agreement_original,cur.valid_from,boundary,cur.customer_identity,cur.end_user_masterdata,
    coalesce(convert_from(cur.source_original,'UTF8')::jsonb->'provenance','{}'::jsonb)||jsonb_build_object('reissueOf',cur.id));
   from_at:=boundary;
  ELSE from_at:=cur.valid_from;END IF;
  SELECT * INTO successor FROM gridex_customer_masterdata.insert_contract_declaration_v1(contract,p_environment,p_actor_user_id,p_agreement_original,from_at,NULL,md->'customerIdentity',md->'endUserMasterdata',
   jsonb_build_object('kind','registered_address_change','registeredAddressId',address.id,'registeredAddressSource',address.metadata->>'registered_address_source',
    'declaredAt',address.metadata->>'declared_at','declaredBy',address.metadata->>'declared_by','sourceReference',address.metadata->>'source_reference',
    'enteredAt',address.created_at,'enteredBy',address.created_by,'movedInAt',address.moved_in_at,'supersedes',cur.id));
  INSERT INTO gridex_customer_masterdata.revocations(declaration_id,source_reference,source_sha256,actor_user_id) VALUES(cur.id,'contract_customer_masterdata_superseded_by:'||successor.id::text,successor.source_sha256,p_actor_user_id);
  cur:=successor;superseded:=superseded+1;
 END LOOP;
 RETURN jsonb_build_object('status',CASE WHEN superseded>0 THEN 'superseded' WHEN derived THEN 'derived' ELSE 'unchanged' END,'declarationId',cur.id,'contractId',cur.contract_id,
  'validFrom',cur.valid_from,'sourceReference',cur.source_reference,'sourceVersion',cur.source_version);
END$$;

-- Website signing reads the same section before it signs (one builder for both signing paths).
CREATE FUNCTION public.gridex_contract_customer_masterdata_section_v1(p_company_id uuid,p_customer_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'contract_customer_masterdata_service_required' USING ERRCODE='42501';END IF;
 RETURN gridex_customer_masterdata.contract_section_v1(p_company_id,p_customer_id);
END$$;

-- Token signing: the signed snapshot gains the section (schema v2) when the
-- customer has a qualified registered address; otherwise it is unchanged.
DO $rewrite$DECLARE f record;
 needle CONSTANT text:=$n$  v_signature_hash:=encode(extensions.digest(convert_to(v_signature::text,'UTF8'),'sha256'),'hex');$n$;
 replacement CONSTANT text:=$r$  v_signature:=v_signature||coalesce((SELECT jsonb_build_object('schema','gridex_online_contract_signature_v2','customer_masterdata',s.section)
    FROM (SELECT gridex_customer_masterdata.contract_section_v1(v_contract.company_id,v_contract.customer_id) section) s WHERE s.section IS NOT NULL),'{}'::jsonb);
  v_signature_hash:=encode(extensions.digest(convert_to(v_signature::text,'UTF8'),'sha256'),'hex');$r$;
BEGIN
 SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f FROM pg_proc p WHERE oid='public.gridex_finalize_customer_contract_signature_v1(text,text,text)'::regprocedure;
 IF (length(f.prosrc)-length(replace(f.prosrc,needle,'')))/length(needle)<>1 OR position('customer_masterdata' IN f.prosrc)>0 THEN RAISE EXCEPTION 'token_signature_customer_masterdata_predecessor_required';END IF;
 EXECUTE replace(f.definition,f.prosrc,replace(f.prosrc,needle,replacement));
 IF(SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=f.oid) IS DISTINCT FROM f.metadata THEN RAISE EXCEPTION 'token_signature_customer_masterdata_metadata_changed';END IF;
END$rewrite$;

DO $$DECLARE f record;BEGIN FOR f IN SELECT p.oid::regprocedure sig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='gridex_customer_masterdata'
 AND p.proname IN('market_day_start_v1','registered_masterdata_v1','contract_pdf_lines_v1','pdf_text_v1','contract_section_v1','insert_contract_declaration_v1') LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.sig);END LOOP;END$$;
REVOKE ALL ON FUNCTION public.ediel_derive_contract_customer_masterdata_v1(uuid,uuid,uuid,text,bytea) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_derive_contract_customer_masterdata_v1(uuid,uuid,uuid,text,bytea) TO service_role;
REVOKE ALL ON FUNCTION public.gridex_contract_customer_masterdata_section_v1(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_contract_customer_masterdata_section_v1(uuid,uuid) TO service_role;

COMMIT;
