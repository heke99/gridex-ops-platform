-- Preserve outbound business uniqueness and physical ACK scope together.
-- A source-bound ACK row has a closed point at its own immutable primary UUID;
-- an orphan ACK has an unbounded legacy range. GiST exclusion protects mixed
-- pairs in either order, including concurrent native INSERT/UPDATE. Distinct
-- bound rows remain governed by the existing ACK transaction/scope owners.
-- No raw/retention field, sender authority, function or API capability changes.
-- Mixed collisions are exclusion SQLSTATE 23P01; legacy btree collisions 23505.
BEGIN;
SET LOCAL search_path = pg_catalog, public, extensions;
-- One transaction and a writer fence cover predecessor validation and both DDLs.
LOCK TABLE public.ediel_messages IN ACCESS EXCLUSIVE MODE;
DO $ack_business_scope$
DECLARE
 pre CONSTANT text := $pre$CREATE UNIQUE INDEX ux_ediel_outbound_source ON public.ediel_messages USING btree (company_id, direction, outbound_request_id, message_family, COALESCE(message_code, ''::text), receiver_ediel_id, COALESCE(message_version, ''::text)) WHERE ((direction = 'outbound'::text) AND (outbound_request_id IS NOT NULL))$pre$;
 post CONSTANT text := $post$CREATE UNIQUE INDEX ux_ediel_outbound_source ON public.ediel_messages USING btree (company_id, direction, outbound_request_id, message_family, COALESCE(message_code, ''::text), receiver_ediel_id, COALESCE(message_version, ''::text)) WHERE ((direction = 'outbound'::text) AND (outbound_request_id IS NOT NULL) AND (NOT ((related_message_id IS NOT NULL) AND COALESCE((message_family = ANY (ARRAY['APERAK'::text, 'CONTRL'::text, 'UTILTS_ERR'::text])), false))))$post$;
 ack CONSTANT text := $ack$CREATE UNIQUE INDEX ux_ediel_ack_related ON public.ediel_messages USING btree (company_id, related_message_id, message_family, COALESCE(transaction_reference, ''::text)) WHERE ((related_message_id IS NOT NULL) AND (message_family = ANY (ARRAY['APERAK'::text, 'CONTRL'::text, 'UTILTS_ERR'::text])))$ack$;
 old_suffix CONSTANT text := $old$ WHERE ((direction = 'outbound'::text) AND (outbound_request_id IS NOT NULL))$old$;
 new_suffix CONSTANT text := $new$ WHERE ((direction = 'outbound'::text) AND (outbound_request_id IS NOT NULL) AND (NOT ((related_message_id IS NOT NULL) AND COALESCE((message_family = ANY (ARRAY['APERAK'::text, 'CONTRL'::text, 'UTILTS_ERR'::text])), false))))$new$;
 scope_ddl CONSTANT text := $ddl$ALTER TABLE public.ediel_messages ADD CONSTRAINT ediel_ack_business_legacy_scope_excl EXCLUDE USING gist (company_id extensions.gist_uuid_ops WITH =, direction extensions.gist_text_ops WITH =, outbound_request_id extensions.gist_uuid_ops WITH =, message_family extensions.gist_text_ops WITH =, (COALESCE(message_code,''::text)) extensions.gist_text_ops WITH =, receiver_ediel_id extensions.gist_text_ops WITH =, (COALESCE(message_version,''::text)) extensions.gist_text_ops WITH =, (CASE WHEN related_message_id IS NULL THEN numrange(NULL::numeric,NULL::numeric,'()'::text) ELSE numrange(((('x'::text || substr(replace(id::text,'-'::text,''::text),1,8))::bit(32)::bigint)::numeric*79228162514264337593543950336::numeric + (('x'::text || substr(replace(id::text,'-'::text,''::text),9,8))::bit(32)::bigint)::numeric*18446744073709551616::numeric + (('x'::text || substr(replace(id::text,'-'::text,''::text),17,8))::bit(32)::bigint)::numeric*4294967296::numeric + (('x'::text || substr(replace(id::text,'-'::text,''::text),25,8))::bit(32)::bigint)::numeric*1::numeric),((('x'::text || substr(replace(id::text,'-'::text,''::text),1,8))::bit(32)::bigint)::numeric*79228162514264337593543950336::numeric + (('x'::text || substr(replace(id::text,'-'::text,''::text),9,8))::bit(32)::bigint)::numeric*18446744073709551616::numeric + (('x'::text || substr(replace(id::text,'-'::text,''::text),17,8))::bit(32)::bigint)::numeric*4294967296::numeric + (('x'::text || substr(replace(id::text,'-'::text,''::text),25,8))::bit(32)::bigint)::numeric*1::numeric),'[]'::text) END) pg_catalog.range_ops WITH &&) WHERE (direction='outbound'::text AND outbound_request_id IS NOT NULL AND message_family=ANY(ARRAY['APERAK'::text,'CONTRL'::text,'UTILTS_ERR'::text]));$ddl$;
 scope_definition CONSTANT text := $scope$EXCLUDE USING gist (company_id WITH =, direction WITH =, outbound_request_id WITH =, message_family WITH =, COALESCE(message_code, ''::text) WITH =, receiver_ediel_id WITH =, COALESCE(message_version, ''::text) WITH =, (
CASE
    WHEN (related_message_id IS NULL) THEN numrange(NULL::numeric, NULL::numeric, '()'::text)
    ELSE numrange((((((((('x'::text || substr(replace((id)::text, '-'::text, ''::text), 1, 8)))::bit(32))::bigint)::numeric * '79228162514264337593543950336'::numeric) + ((((('x'::text || substr(replace((id)::text, '-'::text, ''::text), 9, 8)))::bit(32))::bigint)::numeric * '18446744073709551616'::numeric)) + ((((('x'::text || substr(replace((id)::text, '-'::text, ''::text), 17, 8)))::bit(32))::bigint)::numeric * ('4294967296'::bigint)::numeric)) + ((((('x'::text || substr(replace((id)::text, '-'::text, ''::text), 25, 8)))::bit(32))::bigint)::numeric * (1)::numeric)), (((((((('x'::text || substr(replace((id)::text, '-'::text, ''::text), 1, 8)))::bit(32))::bigint)::numeric * '79228162514264337593543950336'::numeric) + ((((('x'::text || substr(replace((id)::text, '-'::text, ''::text), 9, 8)))::bit(32))::bigint)::numeric * '18446744073709551616'::numeric)) + ((((('x'::text || substr(replace((id)::text, '-'::text, ''::text), 17, 8)))::bit(32))::bigint)::numeric * ('4294967296'::bigint)::numeric)) + ((((('x'::text || substr(replace((id)::text, '-'::text, ''::text), 25, 8)))::bit(32))::bigint)::numeric * (1)::numeric)), '[]'::text)
END) WITH &&) WHERE (((direction = 'outbound'::text) AND (outbound_request_id IS NOT NULL) AND (message_family = ANY (ARRAY['APERAK'::text, 'CONTRL'::text, 'UTILTS_ERR'::text]))))$scope$;
 scope_index_definition CONSTANT text := $gist$CREATE INDEX ediel_ack_business_legacy_scope_excl ON public.ediel_messages USING gist (company_id, direction, outbound_request_id, message_family, COALESCE(message_code, ''::text), receiver_ediel_id, COALESCE(message_version, ''::text), (
CASE
    WHEN (related_message_id IS NULL) THEN numrange(NULL::numeric, NULL::numeric, '()'::text)
    ELSE numrange((((((((('x'::text || substr(replace((id)::text, '-'::text, ''::text), 1, 8)))::bit(32))::bigint)::numeric * '79228162514264337593543950336'::numeric) + ((((('x'::text || substr(replace((id)::text, '-'::text, ''::text), 9, 8)))::bit(32))::bigint)::numeric * '18446744073709551616'::numeric)) + ((((('x'::text || substr(replace((id)::text, '-'::text, ''::text), 17, 8)))::bit(32))::bigint)::numeric * ('4294967296'::bigint)::numeric)) + ((((('x'::text || substr(replace((id)::text, '-'::text, ''::text), 25, 8)))::bit(32))::bigint)::numeric * (1)::numeric)), (((((((('x'::text || substr(replace((id)::text, '-'::text, ''::text), 1, 8)))::bit(32))::bigint)::numeric * '79228162514264337593543950336'::numeric) + ((((('x'::text || substr(replace((id)::text, '-'::text, ''::text), 9, 8)))::bit(32))::bigint)::numeric * '18446744073709551616'::numeric)) + ((((('x'::text || substr(replace((id)::text, '-'::text, ''::text), 17, 8)))::bit(32))::bigint)::numeric * ('4294967296'::bigint)::numeric)) + ((((('x'::text || substr(replace((id)::text, '-'::text, ''::text), 25, 8)))::bit(32))::bigint)::numeric * (1)::numeric)), '[]'::text)
END)) WHERE ((direction = 'outbound'::text) AND (outbound_request_id IS NOT NULL) AND (message_family = ANY (ARRAY['APERAK'::text, 'CONTRL'::text, 'UTILTS_ERR'::text])))$gist$;
 table_oid oid := 'public.ediel_messages'::regclass;
 source_oid oid; ack_oid oid; scope_oid oid; scope_index_oid oid; extension_oid oid;
 uuid_class oid; text_class oid; range_class oid; uuid_eq oid; text_eq oid; range_overlap oid;
 id_attribute smallint; definition text; original_owner text; original_comment text;
 original_metadata jsonb; final_metadata jsonb; ack_metadata jsonb; table_metadata jsonb; extension_metadata jsonb;
 source_collations oid[]; source_classes oid[]; expected_classes oid[]; expected_operators oid[];
BEGIN
 -- Full captured predecessor and full inverse, including every original key.
 IF replace(pre,old_suffix,new_suffix) IS DISTINCT FROM post
  OR replace(post,new_suffix,old_suffix) IS DISTINCT FROM pre
  OR (length(pre)-length(replace(pre,old_suffix,'')))/length(old_suffix) <> 1
  OR (length(post)-length(replace(post,new_suffix,'')))/length(new_suffix) <> 1
  OR encode(sha256(convert_to(pre,'UTF8')),'hex') <> 'd11b3ae27566c19da1303493c2431858e76789d092a8242538f84dbfd16f2d30'
  OR encode(sha256(convert_to(post,'UTF8')),'hex') <> '06e4d7c441485da5a95014fdb7fa8994722ace870d6d87a56ec89b44226d6f46'
  OR encode(sha256(convert_to(ack,'UTF8')),'hex') <> 'dc3b57169e6649d5edd74cc88f6c3b4ea5cfb23f1014cbeed87af00d4b60a454'
  OR encode(sha256(convert_to(scope_definition,'UTF8')),'hex') <> '0561f90e145c7e469c2a2b3f4b123dfd5b934160363b4677bb876792a98718cb'
  OR encode(sha256(convert_to(scope_index_definition,'UTF8')),'hex') <> '07319b4c19722fa5189375cc9a85fb1383ce066b37c531b1d231db66e2f9c401'
 THEN RAISE EXCEPTION 'ediel_ack_business_scope_full_source_required'; END IF;
 source_oid := to_regclass('public.ux_ediel_outbound_source');
 ack_oid := to_regclass('public.ux_ediel_ack_related');
 IF source_oid IS NULL OR ack_oid IS NULL THEN RAISE EXCEPTION 'ediel_ack_business_scope_predecessor_required'; END IF;
 definition := pg_get_indexdef(source_oid);
 IF definition IS DISTINCT FROM pre AND definition IS DISTINCT FROM post THEN
  RAISE EXCEPTION 'ediel_ack_business_scope_unknown_predecessor'; END IF;
 IF pg_get_indexdef(ack_oid) IS DISTINCT FROM ack THEN RAISE EXCEPTION 'ediel_ack_business_scope_replay_index_changed'; END IF;
 SELECT oid,conindid INTO scope_oid,scope_index_oid FROM pg_constraint
  WHERE conrelid=table_oid AND conname='ediel_ack_business_legacy_scope_excl';
 -- Only captured original + absent bridge, or complete exact successor.
 -- The unpublished partial-only predecessor is deliberately not repaired.
 IF (definition=pre AND (scope_oid IS NOT NULL OR to_regclass('public.ediel_ack_business_legacy_scope_excl') IS NOT NULL))
  OR (definition=post AND (scope_oid IS NULL OR scope_index_oid IS DISTINCT FROM to_regclass('public.ediel_ack_business_legacy_scope_excl')))
 THEN RAISE EXCEPTION 'ediel_ack_business_scope_mixed_source_state'; END IF;
 SELECT jsonb_build_object('owner',relowner,'acl',relacl,'kind',relkind,'namespace',relnamespace,
  'rowsecurity',relrowsecurity,'forcerowsecurity',relforcerowsecurity) INTO STRICT table_metadata
 FROM pg_class WHERE oid=table_oid AND relkind='r' AND relnamespace='public'::regnamespace;
 SELECT attnum INTO id_attribute FROM pg_attribute WHERE attrelid=table_oid AND attname='id'
  AND atttypid='uuid'::regtype AND attnotnull AND NOT attisdropped;
 IF id_attribute IS NULL OR NOT EXISTS(SELECT FROM pg_constraint k JOIN pg_index i ON i.indexrelid=k.conindid
  WHERE k.conrelid=table_oid AND k.contype='p' AND k.conkey=ARRAY[id_attribute]
   AND NOT k.condeferrable AND NOT k.condeferred AND k.convalidated
   AND i.indisprimary AND i.indisunique AND i.indisvalid AND i.indisready AND i.indislive AND i.indimmediate
   AND i.indnatts=1 AND i.indnkeyatts=1 AND pg_get_constraintdef(k.oid)='PRIMARY KEY (id)')
 THEN RAISE EXCEPTION 'ediel_ack_business_scope_primary_uuid_required'; END IF;
 -- Existing genuine migration 20261004223219 provides this extension.
 -- Do not install or relocate it, and do not create helper functions/grants.
 SELECT e.oid,to_jsonb(e) INTO extension_oid,extension_metadata FROM pg_extension e
  WHERE e.extname='btree_gist' AND e.extversion='1.7' AND e.extnamespace='extensions'::regnamespace;
 IF extension_oid IS NULL THEN RAISE EXCEPTION 'ediel_ack_business_scope_extension_predecessor_required'; END IF;
 SELECT o.oid INTO uuid_class FROM pg_opclass o JOIN pg_am a ON a.oid=o.opcmethod
  WHERE o.opcnamespace='extensions'::regnamespace AND o.opcname='gist_uuid_ops'
   AND a.amname='gist' AND o.opcintype='uuid'::regtype AND o.opcdefault;
 SELECT o.oid INTO text_class FROM pg_opclass o JOIN pg_am a ON a.oid=o.opcmethod
  WHERE o.opcnamespace='extensions'::regnamespace AND o.opcname='gist_text_ops'
   AND a.amname='gist' AND o.opcintype='text'::regtype AND o.opcdefault;
 SELECT o.oid INTO range_class FROM pg_opclass o JOIN pg_am a ON a.oid=o.opcmethod
  WHERE o.opcnamespace='pg_catalog'::regnamespace AND o.opcname='range_ops'
   AND a.amname='gist' AND o.opcintype='anyrange'::regtype AND o.opcdefault;
 uuid_eq := 'pg_catalog.=(uuid,uuid)'::regoperator;
 text_eq := 'pg_catalog.=(text,text)'::regoperator;
 range_overlap := 'pg_catalog.&&(anyrange,anyrange)'::regoperator;
 IF uuid_class IS NULL OR text_class IS NULL OR range_class IS NULL
  OR (SELECT count(*) FROM pg_depend WHERE classid='pg_opclass'::regclass AND objid IN(uuid_class,text_class)
   AND objsubid=0 AND refclassid='pg_extension'::regclass AND refobjid=extension_oid AND deptype='e') <> 2
  OR (SELECT count(*) FROM pg_opclass c JOIN pg_amop a ON a.amopfamily=c.opcfamily
   WHERE (c.oid=uuid_class AND a.amoplefttype='uuid'::regtype AND a.amoprighttype='uuid'::regtype AND a.amopopr=uuid_eq
      OR c.oid=text_class AND a.amoplefttype='text'::regtype AND a.amoprighttype='text'::regtype AND a.amopopr=text_eq
      OR c.oid=range_class AND a.amoplefttype='anyrange'::regtype AND a.amoprighttype='anyrange'::regtype AND a.amopopr=range_overlap)
    AND a.amopstrategy=3 AND a.amoppurpose='s' AND a.amopmethod=c.opcmethod) <> 3
  OR (SELECT count(*) FROM pg_operator o JOIN pg_proc p ON p.oid=o.oprcode
   WHERE o.oid IN(uuid_eq,text_eq,range_overlap) AND o.oprnamespace='pg_catalog'::regnamespace
    AND o.oprcom=o.oid AND p.pronamespace='pg_catalog'::regnamespace AND p.provolatile='i' AND p.proisstrict) <> 3
 THEN RAISE EXCEPTION 'ediel_ack_business_scope_operator_predecessor_required'; END IF;
 -- Exact standalone btree shape; preserve all seven original expressions,
 -- opclasses, NULLS DISTINCT, ordering and collations. Unknown variants stop.
 IF (SELECT count(*) FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_am a ON a.oid=c.relam
  WHERE i.indexrelid IN(source_oid,ack_oid) AND i.indrelid=table_oid
   AND c.relnamespace='public'::regnamespace AND c.relkind='i' AND a.amname='btree'
   AND i.indisunique AND i.indisvalid AND i.indisready AND i.indislive AND i.indimmediate
   AND NOT i.indnullsnotdistinct AND NOT i.indisprimary AND NOT i.indisexclusion
   AND NOT i.indisclustered AND NOT i.indisreplident AND NOT i.indcheckxmin
   AND c.reltablespace=0 AND c.reloptions IS NULL AND c.relacl IS NULL
   AND NOT EXISTS(SELECT FROM pg_constraint k WHERE k.conindid=i.indexrelid)) <> 2
 THEN RAISE EXCEPTION 'ediel_ack_business_scope_index_metadata_required'; END IF;
 SELECT array_agg(v ORDER BY n) INTO source_collations FROM pg_index i,
  unnest(i.indcollation::oid[]) WITH ORDINALITY a(v,n) WHERE i.indexrelid=source_oid;
 SELECT array_agg(v ORDER BY n) INTO source_classes FROM pg_index i,
  unnest(i.indclass::oid[]) WITH ORDINALITY a(v,n) WHERE i.indexrelid=source_oid;
 IF cardinality(source_collations) <> 7 OR cardinality(source_classes) <> 7
  OR EXISTS(SELECT FROM unnest(source_collations) v JOIN pg_collation c ON c.oid=v WHERE NOT c.collisdeterministic)
  OR (SELECT count(*) FROM unnest(source_classes) WITH ORDINALITY x(v,n) JOIN pg_opclass c ON c.oid=v JOIN pg_am a ON a.oid=c.opcmethod
   WHERE a.amname='btree' AND c.opcnamespace='pg_catalog'::regnamespace AND c.opcdefault
    AND ((n IN(1,3) AND c.opcintype='uuid'::regtype AND c.opcname='uuid_ops')
      OR (n IN(2,4,5,6,7) AND c.opcintype='text'::regtype AND c.opcname='text_ops'))) <> 7
 THEN RAISE EXCEPTION 'ediel_ack_business_scope_equality_collation_required'; END IF;
 expected_classes := ARRAY[uuid_class,text_class,uuid_class,text_class,text_class,text_class,text_class,range_class];
 expected_operators := ARRAY[uuid_eq,text_eq,uuid_eq,text_eq,text_eq,text_eq,text_eq,range_overlap];
 SELECT (to_jsonb(i)-ARRAY['indexrelid','indpred'])||jsonb_build_object('class',jsonb_build_object(
  'owner',c.relowner,'namespace',c.relnamespace,'kind',c.relkind,'am',c.relam,'tablespace',c.reltablespace,'options',c.reloptions,'acl',c.relacl)),
  r.rolname,obj_description(c.oid,'pg_class') INTO STRICT original_metadata,original_owner,original_comment
 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_roles r ON r.oid=c.relowner WHERE i.indexrelid=source_oid;
 SELECT to_jsonb(i)||jsonb_build_object('class',to_jsonb(c),'comment',obj_description(c.oid,'pg_class')) INTO STRICT ack_metadata
 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indexrelid=ack_oid;
 IF definition=pre THEN
  EXECUTE 'DROP INDEX public.ux_ediel_outbound_source';
  EXECUTE post;
  EXECUTE format('ALTER INDEX public.ux_ediel_outbound_source OWNER TO %I',original_owner);
  EXECUTE format('COMMENT ON INDEX public.ux_ediel_outbound_source IS %L',original_comment);
  -- Native exclusion builds and validates all retained rows atomically.
  -- A conflict aborts this entire transaction; no history is rewritten.
  EXECUTE scope_ddl;
 END IF;
 source_oid := 'public.ux_ediel_outbound_source'::regclass;
 SELECT oid,conindid INTO STRICT scope_oid,scope_index_oid FROM pg_constraint
  WHERE conrelid=table_oid AND conname='ediel_ack_business_legacy_scope_excl';
 SELECT (to_jsonb(i)-ARRAY['indexrelid','indpred'])||jsonb_build_object('class',jsonb_build_object(
  'owner',c.relowner,'namespace',c.relnamespace,'kind',c.relkind,'am',c.relam,'tablespace',c.reltablespace,'options',c.reloptions,'acl',c.relacl))
 INTO STRICT final_metadata FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indexrelid=source_oid;
 IF pg_get_indexdef(source_oid) IS DISTINCT FROM post OR final_metadata IS DISTINCT FROM original_metadata
  OR obj_description(source_oid,'pg_class') IS DISTINCT FROM original_comment
  OR pg_get_indexdef(ack_oid) IS DISTINCT FROM ack
  OR (SELECT to_jsonb(i)||jsonb_build_object('class',to_jsonb(c),'comment',obj_description(c.oid,'pg_class'))
   FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indexrelid=ack_oid) IS DISTINCT FROM ack_metadata
  OR (SELECT jsonb_build_object('owner',relowner,'acl',relacl,'kind',relkind,'namespace',relnamespace,
   'rowsecurity',relrowsecurity,'forcerowsecurity',relforcerowsecurity) FROM pg_class WHERE oid=table_oid) IS DISTINCT FROM table_metadata
  OR (SELECT to_jsonb(e) FROM pg_extension e WHERE e.oid=extension_oid) IS DISTINCT FROM extension_metadata
 THEN RAISE EXCEPTION 'ediel_ack_business_scope_preservation_required'; END IF;
 -- Complete successor requires both objects, their full deparse and genuine
 -- native exclusion metadata, including the exact operator/collation chain.
 IF pg_get_constraintdef(scope_oid) IS DISTINCT FROM scope_definition
  OR pg_get_indexdef(scope_index_oid) IS DISTINCT FROM scope_index_definition
  OR to_regclass('public.ediel_ack_business_legacy_scope_excl') IS DISTINCT FROM scope_index_oid
  OR NOT EXISTS(SELECT FROM pg_constraint k JOIN pg_index i ON i.indexrelid=k.conindid
   JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_class t ON t.oid=i.indrelid JOIN pg_am a ON a.oid=c.relam
   WHERE k.oid=scope_oid AND k.conrelid=table_oid AND k.contype='x' AND k.convalidated
    AND NOT k.condeferrable AND NOT k.condeferred AND k.conparentid=0 AND k.conislocal AND k.coninhcount=0
    AND k.conexclop=expected_operators AND i.indrelid=table_oid AND i.indisexclusion AND i.indimmediate
    AND i.indisvalid AND i.indisready AND i.indislive AND NOT i.indcheckxmin
    AND NOT i.indisunique AND NOT i.indisprimary AND NOT i.indnullsnotdistinct
    AND NOT i.indisclustered AND NOT i.indisreplident AND i.indnatts=8 AND i.indnkeyatts=8
    AND ARRAY(SELECT v FROM unnest(i.indclass::oid[]) WITH ORDINALITY x(v,n) ORDER BY n)=expected_classes
    AND ARRAY(SELECT v FROM unnest(i.indcollation::oid[]) WITH ORDINALITY x(v,n) ORDER BY n)=source_collations||ARRAY[0::oid]
    AND NOT EXISTS(SELECT FROM unnest(i.indoption::smallint[]) v WHERE v<>0)
    AND c.relkind='i' AND c.relnamespace='public'::regnamespace AND a.amname='gist'
    AND c.relowner=t.relowner AND c.reltablespace=0 AND c.reloptions IS NULL AND c.relacl IS NULL
    AND obj_description(c.oid,'pg_class') IS NULL AND obj_description(k.oid,'pg_constraint') IS NULL)
 THEN RAISE EXCEPTION 'ediel_ack_business_scope_complete_postimage_required'; END IF;
END $ack_business_scope$;
COMMIT;
