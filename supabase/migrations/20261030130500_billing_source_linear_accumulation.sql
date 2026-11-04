-- Simulation T1 finding 20261029-3f1a8ab1/claude-track1/010 (and 007): after 20261030120200 (G-6 port) the two
-- accumulators that collect one large jsonb per value use `jsonb[] || jsonb`; here they use array_append, which
-- PL/pgSQL appends in place. Result elements, order, serialization (to_jsonb once), errors, locks, signature,
-- SECURITY DEFINER, search_path, owner and ACL are unchanged. Version 20261030130500 is provisional (GEN assigns).
-- Guards: exact pre-image = post-image of 20261030120200, each fragment exactly once, exact post-image, unchanged
-- pg_proc metadata. g1/g2 functions (wire_tokens_v1, wire_tokens_bounded_v1, envelope, validate_decimal_source_v2)
-- are not touched.
--   gridex_billing_source.bases_v1                 fe9b0b98bb2c66aa6ef60adc31aa45198aefa4cef74944024b3f7fbf542365f2 -> de8da5591fead1ff5ba0d63ed07579f0a10434ac3b3829cb3d820e65202b578e
--   public.gridex_read_billing_source_values_v1    f7cdbd917f7c956e7acd168576e98671afc91456d29e02f0c550b1fc84df5be5 -> f4ebfdf958b4023cc44bc2c8f5894e6efbe877926dee24f689afaf5ca8585a19
begin;

create function pg_temp.linear_rewrite(p_target regprocedure, p_pre text, p_post text, p_old text[], p_new text[]) returns void
language plpgsql as $rewrite$
declare
  f record;
  body text;
  i integer;
begin
  select p.oid, to_jsonb(p) - 'prosrc' as metadata, p.prosrc, pg_get_functiondef(p.oid) as definition into strict f
  from pg_proc p where p.oid = p_target;
  if encode(sha256(convert_to(f.prosrc, 'UTF8')), 'hex') is distinct from p_pre
    or cardinality(p_old) <> cardinality(p_new)
    or (length(f.definition) - length(replace(f.definition, f.prosrc, ''))) / length(f.prosrc) <> 1 then
    raise exception 'billing_source_linear_accumulation_source_changed:%', p_target using errcode = 'P0U01';
  end if;
  body := f.prosrc;
  for i in 1 .. cardinality(p_old) loop
    if (length(body) - length(replace(body, p_old[i], ''))) / length(p_old[i]) <> 1 then
      raise exception 'billing_source_linear_accumulation_source_changed:%:%', p_target, i using errcode = 'P0U01';
    end if;
    body := replace(body, p_old[i], p_new[i]);
  end loop;
  if encode(sha256(convert_to(body, 'UTF8')), 'hex') is distinct from p_post then
    raise exception 'billing_source_linear_accumulation_source_changed:%:post', p_target using errcode = 'P0U01';
  end if;
  execute replace(f.definition, f.prosrc, body);
  if (select to_jsonb(p) - 'prosrc' from pg_proc p where p.oid = f.oid) is distinct from f.metadata
    or (select p.prosrc from pg_proc p where p.oid = f.oid) is distinct from body then
    raise exception 'billing_source_linear_accumulation_metadata_changed:%', p_target using errcode = 'P0U01';
  end if;
end
$rewrite$;

select pg_temp.linear_rewrite(
  'gridex_billing_source.bases_v1(uuid,uuid[],boolean,boolean)'::regprocedure,
  'fe9b0b98bb2c66aa6ef60adc31aa45198aefa4cef74944024b3f7fbf542365f2',
  'de8da5591fead1ff5ba0d63ed07579f0a10434ac3b3829cb3d820e65202b578e',
  array[
    $old$result:=result||CASE WHEN basis IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('b',basis) END;$old$,
    $old$result:=result||jsonb_build_object('e',jsonb_build_object('state',e_state,'message',e_message,'detail',nullif(e_detail,''),'hint',nullif(e_hint,'')));$old$
  ],
  array[
    $new$result:=array_append(result,CASE WHEN basis IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('b',basis) END);$new$,
    $new$result:=array_append(result,jsonb_build_object('e',jsonb_build_object('state',e_state,'message',e_message,'detail',nullif(e_detail,''),'hint',nullif(e_hint,''))));$new$
  ]
);

select pg_temp.linear_rewrite(
  'public.gridex_read_billing_source_values_v1(uuid,uuid[])'::regprocedure,
  'f7cdbd917f7c956e7acd168576e98671afc91456d29e02f0c550b1fc84df5be5',
  'f4ebfdf958b4023cc44bc2c8f5894e6efbe877926dee24f689afaf5ca8585a19',
  array[
    $old$  result:=result||(to_jsonb(n)||$old$
  ],
  array[
    $new$  result:=array_append(result,to_jsonb(n)||$new$
  ]
);

commit;
