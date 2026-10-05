-- CLI-created forward correction. Decode captured MIME locally, never caller
-- supplied replacement bytes. Correlation remains an immutable observation.
BEGIN;
CREATE FUNCTION gridex_ediel_transport.dsn_fields_v1(block text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE fields jsonb:='{}';line text;pair text[];key text;
BEGIN
 IF octet_length(block)>65536 THEN RAISE EXCEPTION 'dsn_field_limit';END IF;
 FOREACH line IN ARRAY string_to_array(regexp_replace(replace(block,E'\r\n',E'\n'),E'\n[ \t]+',' ','g'),E'\n') LOOP
  pair:=regexp_match(line,'^([!-9;-~]+):[ \t]*(.*)$');
  IF pair IS NULL THEN CONTINUE;END IF;
  key:=lower(pair[1]);
  fields:=jsonb_set(fields,ARRAY[key],coalesce(fields->key,'[]'::jsonb)||to_jsonb(btrim(pair[2],E' \t')));
 END LOOP;
 RETURN fields;
END $$;
CREATE FUNCTION gridex_ediel_transport.dsn_field_v1(fields jsonb,name text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
BEGIN
 IF jsonb_array_length(coalesce(fields->name,'[]'::jsonb))>1 THEN RAISE EXCEPTION 'dsn_field_ambiguous';END IF;
 RETURN nullif(fields->name->>0,'');
END $$;
CREATE FUNCTION gridex_ediel_transport.dsn_typed_field_v1(value text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE pair text[];
BEGIN
 IF value IS NULL THEN RETURN NULL;END IF;
 pair:=regexp_match(value,'^([A-Za-z0-9-]+);[ \t]*(.+)$');
 IF pair IS NULL THEN RAISE EXCEPTION 'dsn_typed_field_invalid';END IF;
 RETURN jsonb_build_object('type',lower(pair[1]),'address',pair[2]);
END $$;
CREATE FUNCTION gridex_ediel_transport.dsn_decode_body_v1(body text,encoding text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE compact text;hex text;
BEGIN
 IF encoding IN('7bit','8bit','binary') THEN RETURN body;END IF;
 IF encoding='base64' THEN
  compact:=regexp_replace(body,'[[:space:]]','','g');
  IF compact!~'^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$' THEN RAISE EXCEPTION 'dsn_encoding_invalid';END IF;
  RETURN convert_from(decode(compact,'base64'),'UTF8');
 ELSIF encoding='quoted-printable' THEN
  compact:=replace(body,E'=\n','');
  IF compact~'=(?![A-Fa-f0-9]{2})' THEN RAISE EXCEPTION 'dsn_encoding_invalid';END IF;
  SELECT string_agg(CASE WHEN left(token[1],1)='=' THEN substr(token[1],2) ELSE encode(convert_to(token[1],'UTF8'),'hex') END,'') INTO hex
   FROM regexp_matches(compact,'=[A-Fa-f0-9]{2}|[^=]','g') token;
  RETURN convert_from(decode(coalesce(hex,''),'hex'),'UTF8');
 END IF;
 RAISE EXCEPTION 'dsn_encoding_unsupported';
END $$;
CREATE FUNCTION gridex_ediel_transport.dsn_boundary_v1(content_type text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE pair text[];value text;hex text;
BEGIN
 pair:=regexp_match(content_type,';[ \t]*boundary[ \t]*=[ \t]*(?:"([^"\n]*)"|([^; \t\n]+))','i');
 IF pair IS NOT NULL THEN RETURN coalesce(pair[1],pair[2]);END IF;
 pair:=regexp_match(content_type,';[ \t]*boundary\*[ \t]*=[ \t]*(?:"([^"\n]*)"|([^; \t\n]+))','i');
 pair:=regexp_match(coalesce(pair[1],pair[2],''),'^(?:utf-8|us-ascii)''[^'']*''(.*)$','i');
 IF pair IS NULL THEN RETURN NULL;END IF;
 value:=pair[1];
 IF value~'%(?![A-Fa-f0-9]{2})' THEN RAISE EXCEPTION 'dsn_boundary_invalid';END IF;
 SELECT string_agg(CASE WHEN left(token[1],1)='%' THEN substr(token[1],2) ELSE encode(convert_to(token[1],'UTF8'),'hex') END,'') INTO hex
  FROM regexp_matches(value,'%[A-Fa-f0-9]{2}|[^%]','g') token;
 RETURN convert_from(decode(coalesce(hex,''),'hex'),'UTF8');
END $$;
CREATE FUNCTION gridex_ediel_transport.dsn_source_identity_matches_v1(raw text,report jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE pending jsonb:=jsonb_build_array(jsonb_build_object('raw',raw,'depth',0,'parent',NULL));next jsonb;
 statuses jsonb:='[]';returned jsonb:='[]';entity jsonb;fields jsonb;message_fields jsonb;recipient_fields jsonb;
 source text;body text;content_type text;media_type text;encoding text;boundary text;line text;marker text;
 parts text[];closed boolean;separator integer;n integer:=0;depth integer;blocks text[];
 original_ids jsonb:='[]';original_id text;diagnostic jsonb;recipient jsonb;derived jsonb;
BEGIN
 IF raw IS NULL OR octet_length(raw)>26214400 THEN RETURN false;END IF;
 WHILE jsonb_array_length(pending)>0 LOOP
  next:=pending->0;pending:=pending-0;depth:=(next->>'depth')::integer;
  source:=replace(next->>'raw',E'\r\n',E'\n');separator:=strpos(source,E'\n\n');
  IF depth>16 OR n>=256 OR octet_length(source)>26214400 THEN RETURN false;END IF;
  IF separator=0 THEN CONTINUE;END IF;
  IF separator>65536 THEN RETURN false;END IF;
  fields:=gridex_ediel_transport.dsn_fields_v1(left(source,separator-1));
  content_type:=coalesce(gridex_ediel_transport.dsn_field_v1(fields,'content-type'),'text/plain');
  media_type:=lower(btrim(split_part(content_type,';',1)));
  encoding:=lower(coalesce(gridex_ediel_transport.dsn_field_v1(fields,'content-transfer-encoding'),'7bit'));
  body:=replace(gridex_ediel_transport.dsn_decode_body_v1(substr(source,separator+2),encoding),E'\r\n',E'\n');n:=n+1;
  IF octet_length(body)>26214400 THEN RETURN false;END IF;
  entity:=jsonb_build_object('parent',next->'parent','body',body);
  IF media_type IN('message/delivery-status','message/global-delivery-status') THEN statuses:=statuses||entity;END IF;
  IF media_type IN('message/rfc822','message/global','text/rfc822-headers','message/global-headers') THEN returned:=returned||entity;END IF;
  IF media_type IN('message/rfc822','message/global') THEN
   pending:=pending||jsonb_build_object('raw',body,'depth',depth+1,'parent',n);CONTINUE;
  END IF;
  IF media_type NOT LIKE 'multipart/%' THEN CONTINUE;END IF;
  boundary:=gridex_ediel_transport.dsn_boundary_v1(content_type);
  IF boundary IS NULL OR length(boundary)=0 OR length(boundary)>70 OR boundary~E'[\r\n]' THEN RETURN false;END IF;
  parts:=NULL;closed:=false;
  FOREACH line IN ARRAY string_to_array(body,E'\n') LOOP
   marker:=rtrim(line,E' \t');
   IF marker='--'||boundary OR marker='--'||boundary||'--' THEN
    IF parts IS NOT NULL THEN
     pending:=pending||jsonb_build_object('raw',array_to_string(parts,E'\n'),'depth',depth+1,'parent',n);
     IF jsonb_array_length(pending)+n>256 THEN RETURN false;END IF;
    END IF;
    IF marker='--'||boundary||'--' THEN closed:=true;EXIT;END IF;
    parts:=ARRAY[]::text[];
   ELSIF parts IS NOT NULL THEN parts:=array_append(parts,line);END IF;
  END LOOP;
  IF NOT closed THEN RETURN false;END IF;
 END LOOP;
 IF jsonb_array_length(statuses)<>1 THEN RETURN false;END IF;
 blocks:=regexp_split_to_array(btrim(statuses->0->>'body',E' \t\r\n'),E'\n[ \t]*\n');
 -- The protected record owner qualifies exactly one recipient/attempt.
 IF array_length(blocks,1)<>2 THEN RETURN false;END IF;
 message_fields:=gridex_ediel_transport.dsn_fields_v1(blocks[1]);
 recipient_fields:=gridex_ediel_transport.dsn_fields_v1(blocks[2]);
 diagnostic:=gridex_ediel_transport.dsn_typed_field_v1(gridex_ediel_transport.dsn_field_v1(recipient_fields,'diagnostic-code'));
 recipient:=jsonb_build_object(
  'finalRecipient',gridex_ediel_transport.dsn_typed_field_v1(gridex_ediel_transport.dsn_field_v1(recipient_fields,'final-recipient')),
  'originalRecipient',gridex_ediel_transport.dsn_typed_field_v1(gridex_ediel_transport.dsn_field_v1(recipient_fields,'original-recipient')),
  'action',gridex_ediel_transport.dsn_field_v1(recipient_fields,'action'),'status',gridex_ediel_transport.dsn_field_v1(recipient_fields,'status'),
  'diagnosticCode',CASE WHEN diagnostic IS NOT NULL THEN jsonb_build_object('type',diagnostic->>'type','text',diagnostic->>'address') END,
  'remoteMta',gridex_ediel_transport.dsn_typed_field_v1(gridex_ediel_transport.dsn_field_v1(recipient_fields,'remote-mta')),
  'lastAttemptDate',gridex_ediel_transport.dsn_field_v1(recipient_fields,'last-attempt-date'),
  'willRetryUntil',gridex_ediel_transport.dsn_field_v1(recipient_fields,'will-retry-until'));
 FOR entity IN SELECT value FROM jsonb_array_elements(returned) LOOP
  IF entity->'parent' IS DISTINCT FROM statuses->0->'parent' THEN CONTINUE;END IF;
  fields:=gridex_ediel_transport.dsn_fields_v1(split_part(entity->>'body',E'\n\n',1));
  original_id:=gridex_ediel_transport.dsn_field_v1(fields,'message-id');
  IF original_id IS NULL OR original_id!~'^<[^<>[:space:]]+@[^<>[:space:]]+>$' THEN RETURN false;END IF;
  original_ids:=original_ids||to_jsonb(original_id);
 END LOOP;
 IF jsonb_array_length(original_ids)<>1 THEN RETURN false;END IF;
 derived:=jsonb_build_object('version',1,'transportCorrelation','unverified',
  'reportingMta',gridex_ediel_transport.dsn_typed_field_v1(gridex_ediel_transport.dsn_field_v1(message_fields,'reporting-mta')),
  'originalEnvelopeId',gridex_ediel_transport.dsn_field_v1(message_fields,'original-envelope-id'),
  'originalMessageIds',original_ids,'recipients',jsonb_build_array(recipient),'issues','[]'::jsonb);
 RETURN derived->'reportingMta'<>'null'::jsonb AND derived=report;
EXCEPTION WHEN invalid_text_representation OR character_not_in_repertoire OR untranslatable_character OR data_exception OR raise_exception THEN RETURN false;
END $$;
REVOKE ALL ON FUNCTION gridex_ediel_transport.dsn_fields_v1(text),gridex_ediel_transport.dsn_field_v1(jsonb,text),
 gridex_ediel_transport.dsn_typed_field_v1(text),gridex_ediel_transport.dsn_decode_body_v1(text,text),
 gridex_ediel_transport.dsn_boundary_v1(text),gridex_ediel_transport.dsn_source_identity_matches_v1(text,jsonb)
 FROM PUBLIC,anon,authenticated,service_role;
DO $rewrite$
DECLARE f record;
 needle CONSTANT text:=$needle$OR body!~* 'message/(global-)?delivery-status' OR strpos(body,report#>>'{originalMessageIds,0}')=0
  OR strpos(lower(body),lower(recipient#>>'{finalRecipient,address}'))=0$needle$;
 replacement CONSTANT text:='OR NOT gridex_ediel_transport.dsn_source_identity_matches_v1(body,report)';
BEGIN
 SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f
  FROM pg_proc p WHERE oid='gridex_ediel_transport.record_dsn_v1(jsonb)'::regprocedure;
 IF (length(f.prosrc)-length(replace(f.prosrc,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'dsn_source_predecessor_required';END IF;
 EXECUTE replace(f.definition,f.prosrc,replace(f.prosrc,needle,replacement));
 IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=f.oid) IS DISTINCT FROM f.metadata THEN RAISE EXCEPTION 'dsn_source_metadata_changed';END IF;
END $rewrite$;
COMMIT;
