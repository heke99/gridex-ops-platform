-- FINDINGS J1-B6 (reality scenario J1), owner decisions 35-37. The owner-hold negative APERAK (J1-01 42/210,
-- J1-02 42/226 / 40/105 / 40/107, J1-03 40/104) was refused by the native ACK guide (ediel_native_ack_guide_invalid):
-- gridex_ediel_ack_guide.validate_response_for_message_v1 requires a PRODAT APERAK's responses to equal the planned
-- responses of gridex_ediel_ack_guide.bound_prodat_response_v1, and those come only from the canonical response facets
-- and committed effect receipts. A hold of gridex_received_sources.normal_switch_scope_effect_v1 wrote nothing, so the
-- database had no durable evidence for the prescribed negative, and the guide correctly refused an app-chosen one.
--
-- 1. gridex_received_sources.normal_z04_hold_receipts: an append-only, hashed receipt of each such own hold, written in
--    the scope owner's own transaction: source, payload hash, canonical assessment, object (first LIN segment index,
--    facility, agency, case reference), reason, ERC, national code (ERC 40) or field (ERC 42) and the field's own wire
--    value. It authorizes no business effect. A replay with the same canonical assessment must record identical facts.
-- 2. gridex_received_sources.normal_z04_hold_v1 writes (or re-qualifies) the receipt and returns the unchanged hold
--    result. The five J1 hold returns of normal_switch_scope_effect_v1 call it (exact needles; no other return changes).
-- 3. gridex_ediel_ack_guide.normal_z04_hold_overlay_v1: for a Z04 only, the planned response of an object with a valid
--    receipt for the facet's own canonical assessment becomes exactly that receipt's negative (text from the original's
--    own guide projection: applicationTexts for ERC 40, invalidPrefix||fieldLabel||' '||value for ERC 42). An object
--    without a receipt, an object the canonical owner already answered negatively, or any mismatch keeps its plan.
--    bound_prodat_response_v1 applies it to its before-domain-effects facet only (an all-held Z04 has no positive).
--    Every other negative, another object, another reason or another text is still refused by the unchanged guide.
--
-- Exact-needle rewrites of installed bodies; each needle must occur exactly once and each marker must be absent. Owner,
-- ACL, security mode and configuration (proconfig) are preserved and checked.
begin;

create table gridex_received_sources.normal_z04_hold_receipts (
  id uuid primary key default gen_random_uuid(),
  source_message_id uuid not null references public.ediel_messages(id),
  company_id uuid not null,
  environment text not null,
  source_payload_hash text not null check (source_payload_hash ~ '^[a-f0-9]{64}$'),
  canonical_assessment_id uuid not null references gridex_received_sources.validation_assessments(id),
  first_line_index integer not null check (first_line_index >= 0),
  object_id text,
  identity_agency text,
  line_item_reference text,
  reason text not null check (reason in ('normal_z04_start_date_conflict','normal_z04_own_z03_missing','normal_z04_object_not_identified','normal_z04_actor_not_related','normal_z04_case_duplicate')),
  erc_code text not null check (erc_code in ('40','42')),
  national_code text check (national_code in ('104','105','107')),
  field_code text check (field_code in ('210','226')),
  field_value text,
  receipt_text text not null,
  receipt_hash text not null,
  recorded_at timestamptz not null default now(),
  check (receipt_hash = encode(sha256(convert_to(receipt_text, 'UTF8')), 'hex')),
  check ((erc_code = '40' and national_code is not null and field_code is null and field_value is null)
      or (erc_code = '42' and national_code is null and field_code is not null and nullif(field_value, '') is not null)),
  unique (source_message_id, canonical_assessment_id, first_line_index)
);
alter table gridex_received_sources.normal_z04_hold_receipts enable row level security;
alter table gridex_received_sources.normal_z04_hold_receipts force row level security;
revoke all on gridex_received_sources.normal_z04_hold_receipts from public, anon, authenticated, service_role;
create trigger immutable_rows before update or delete on gridex_received_sources.normal_z04_hold_receipts
  for each row execute function gridex_received_sources.permission_transition_immutable_v1();
create trigger immutable_truncate before truncate on gridex_received_sources.normal_z04_hold_receipts
  for each statement execute function gridex_received_sources.permission_transition_immutable_v1();

create function gridex_received_sources.normal_z04_hold_v1(m public.ediel_messages, p_canonical_id uuid, p_scope jsonb, own jsonb, p_reason text)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare
  erc text; code text; field text; val text; facts jsonb; facts_text text; line integer; existing gridex_received_sources.normal_z04_hold_receipts%rowtype;
begin
  -- J1-B6 (20261028103000): the durable evidence of the prescribed negative for this own hold; no business effect.
  case p_reason
    when 'normal_z04_start_date_conflict' then erc:='42'; field:='210'; val:=own->>'start';
    when 'normal_z04_own_z03_missing' then erc:='42'; field:='226'; val:=own->>'li';
    when 'normal_z04_object_not_identified' then erc:='40'; code:='105';
    when 'normal_z04_actor_not_related' then erc:='40'; code:='107';
    when 'normal_z04_case_duplicate' then erc:='40'; code:='104';
    else raise exception 'normal_z04_hold_reason_unqualified';
  end case;
  line:=(p_scope#>>'{registers,0,segmentIndex}')::integer;
  if m.id is null or m.company_id is null or m.message_code is distinct from 'Z04' or m.direction is distinct from 'inbound' or p_canonical_id is null or line is null
    or p_scope->>'objectId' is distinct from own->>'point' or p_scope->>'identityAgency' is distinct from own->>'identityAgency' then
    raise exception 'normal_z04_hold_scope_unqualified';
  end if;
  facts:=jsonb_build_object('version',1,'owner','normal-z04-hold-v1','sourceMessageId',m.id,'companyId',m.company_id,'environment',m.environment,
    'sourcePayloadHash',encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex'),'canonicalAssessmentId',p_canonical_id,'firstLineIndex',line,
    'objectId',own->>'point','identityAgency',own->>'identityAgency','lineItemReference',own->>'li','reason',p_reason,
    'ercCode',erc,'nationalCode',code,'fieldCode',field,'fieldValue',val);
  facts_text:=facts::text;
  insert into gridex_received_sources.normal_z04_hold_receipts(source_message_id,company_id,environment,source_payload_hash,canonical_assessment_id,first_line_index,
    object_id,identity_agency,line_item_reference,reason,erc_code,national_code,field_code,field_value,receipt_text,receipt_hash)
  values(m.id,m.company_id,m.environment,facts->>'sourcePayloadHash',p_canonical_id,line,own->>'point',own->>'identityAgency',own->>'li',p_reason,erc,code,field,val,
    facts_text,encode(sha256(convert_to(facts_text,'UTF8')),'hex'))
  on conflict (source_message_id,canonical_assessment_id,first_line_index) do nothing;
  select * into existing from gridex_received_sources.normal_z04_hold_receipts
   where source_message_id=m.id and canonical_assessment_id=p_canonical_id and first_line_index=line;
  if existing.receipt_text::jsonb is distinct from facts or existing.company_id is distinct from m.company_id then
    raise exception 'normal_z04_hold_receipt_replay_conflict';
  end if;
  return jsonb_build_object('applied',false,'reason',p_reason);
end $$;
revoke all on function gridex_received_sources.normal_z04_hold_v1(public.ediel_messages,uuid,jsonb,jsonb,text) from public, anon, authenticated, service_role;

create function gridex_ediel_ack_guide.normal_z04_hold_overlay_v1(s public.ediel_messages, facet jsonb)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog as $$
declare
  r gridex_received_sources.normal_z04_hold_receipts%rowtype; b gridex_ediel_ack_guide.source_bindings%rowtype; projection jsonb; planned jsonb;
  n integer; text_value text; label text; result jsonb:=facet; changed jsonb;
begin
  -- J1-B6 (20261028103000): only a Z04's own durable hold receipt can prescribe its negative; nothing else changes.
  if s.id is null or s.message_code is distinct from 'Z04' or facet is null or jsonb_typeof(facet->'objects') is distinct from 'array'
    or nullif(facet->>'assessmentId','') is null then return facet; end if;
  if not exists(select from gridex_received_sources.normal_z04_hold_receipts x where x.source_message_id=s.id) then return facet; end if;
  select * into b from gridex_ediel_ack_guide.source_bindings where source_message_id=s.id and kind='national';
  if b.source_message_id is null or b.company_id is distinct from s.company_id or b.environment is distinct from s.environment
    or b.payload_sha256 is distinct from encode(sha256(convert_to(s.raw_payload,'UTF8')),'hex') then return facet; end if;
  projection:=gridex_ediel_ack_guide.projection_for_original_v1(b.source_version);
  for r in select * from gridex_received_sources.normal_z04_hold_receipts x
    where x.source_message_id=s.id and x.company_id=s.company_id and x.environment=s.environment
      and x.source_payload_hash=b.payload_sha256 and x.canonical_assessment_id=(facet->>'assessmentId')::uuid
      and x.receipt_hash=encode(sha256(convert_to(x.receipt_text,'UTF8')),'hex')
    order by x.first_line_index loop
    select count(*) into n from jsonb_array_elements(result->'objects') e where e->'lineIndex'=to_jsonb(r.first_line_index);
    select e into planned from jsonb_array_elements(result->'objects') e where e->'lineIndex'=to_jsonb(r.first_line_index);
    if n<>1 or planned->>'outcome'='negative' or planned->>'id' is distinct from r.object_id or planned->>'li' is distinct from r.line_item_reference then return facet; end if;
    if r.erc_code='40' then text_value:=projection#>>array['constraints','PRODAT','applicationTexts',r.national_code];
    else
      label:=projection#>>array['constraints','PRODAT','fieldLabels',r.field_code];
      text_value:=case when label is null then null else (projection#>>'{constraints,PRODAT,invalidPrefix}')||label||' '||r.field_value end;
    end if;
    if text_value is null or length(text_value)>(projection#>>'{constraints,PRODAT,textMax}')::integer then return facet; end if;
    select jsonb_agg(case when e->'lineIndex'=to_jsonb(r.first_line_index) then e||jsonb_build_object('outcome','negative') else e end order by ord)
      into changed from jsonb_array_elements(result->'objects') with ordinality v(e,ord);
    result:=jsonb_set(result,'{objects}',changed);
    select coalesce(jsonb_agg(e order by ord),'[]') into changed from jsonb_array_elements(result->'responses') with ordinality v(e,ord)
      where e->'lineIndex' is distinct from to_jsonb(r.first_line_index);
    result:=jsonb_set(result,'{responses}',changed||jsonb_build_array(jsonb_build_object('scope','object','lineIndex',r.first_line_index,'ercCode',r.erc_code,
      'fieldCode',coalesce(r.national_code,r.field_code),'text',text_value,'id',planned->'id','li',planned->'li')));
  end loop;
  return result;
end $$;
revoke all on function gridex_ediel_ack_guide.normal_z04_hold_overlay_v1(public.ediel_messages,jsonb) from public, anon, authenticated, service_role;

do $j1b6$
declare
  reasons constant text[] := array['normal_z04_start_date_conflict','normal_z04_own_z03_missing','normal_z04_object_not_identified','normal_z04_actor_not_related','normal_z04_case_duplicate'];
  reason text; needle text; f record; body text;
begin
  select p.oid, to_jsonb(p) - 'prosrc' as metadata, p.prosrc, pg_get_functiondef(p.oid) as definition into strict f
  from pg_proc p where p.oid = 'gridex_received_sources.normal_switch_scope_effect_v1(uuid,uuid,uuid,jsonb,uuid[],uuid)'::regprocedure;
  if position('J1-02 (20261028101000)' in f.prosrc) = 0 or position('J1-03 (20261028102000)' in f.prosrc) = 0
    or position('normal_z04_hold_v1' in f.prosrc) <> 0
    or (length(f.definition) - length(replace(f.definition, f.prosrc, ''))) / length(f.prosrc) <> 1 then
    raise exception 'normal_z04_j1_b6_predecessor_required' using errcode = 'P0U01';
  end if;
  body := f.prosrc;
  foreach reason in array reasons loop
    needle := format($n$RETURN jsonb_build_object('applied',false,'reason','%s');$n$, reason);
    if (length(body) - length(replace(body, needle, ''))) / length(needle) <> 1 then
      raise exception 'normal_z04_j1_b6_predecessor_required' using errcode = 'P0U01';
    end if;
    body := replace(body, needle, format($r$RETURN gridex_received_sources.normal_z04_hold_v1(m,p_canonical_id,p_scope,own,'%s');$r$, reason));
  end loop;
  execute replace(f.definition, f.prosrc, body);
  if (select to_jsonb(p) - 'prosrc' from pg_proc p where p.oid = f.oid) is distinct from f.metadata
    or (select p.prosrc from pg_proc p where p.oid = f.oid) is distinct from body then
    raise exception 'normal_z04_j1_b6_metadata_changed' using errcode = 'P0U01';
  end if;
end
$j1b6$;

do $j1b6g$
declare
  needle constant text := $n$ RETURN gridex_ediel_ack_guide.bound_prodat_response_before_domain_effects_v1(m,s);$n$;
  replacement constant text := $r$ -- J1-B6 (20261028103000): a Z04 object's own durable hold receipt prescribes its negative (owner decisions 35-37).
 RETURN gridex_ediel_ack_guide.normal_z04_hold_overlay_v1(s,gridex_ediel_ack_guide.bound_prodat_response_before_domain_effects_v1(m,s));$r$;
  f record; body text;
begin
  select p.oid, to_jsonb(p) - 'prosrc' as metadata, p.prosrc, pg_get_functiondef(p.oid) as definition into strict f
  from pg_proc p where p.oid = 'gridex_ediel_ack_guide.bound_prodat_response_v1(public.ediel_messages,public.ediel_messages)'::regprocedure;
  if (length(f.prosrc) - length(replace(f.prosrc, needle, ''))) / length(needle) <> 1
    or position('J1-B6 (20261028103000)' in f.prosrc) <> 0
    or (length(f.definition) - length(replace(f.definition, f.prosrc, ''))) / length(f.prosrc) <> 1 then
    raise exception 'bound_prodat_response_j1_b6_predecessor_required' using errcode = 'P0U01';
  end if;
  body := replace(f.prosrc, needle, replacement);
  execute replace(f.definition, f.prosrc, body);
  if (select to_jsonb(p) - 'prosrc' from pg_proc p where p.oid = f.oid) is distinct from f.metadata
    or (select p.prosrc from pg_proc p where p.oid = f.oid) is distinct from body
    or position(needle in body) <> 0 then
    raise exception 'bound_prodat_response_j1_b6_metadata_changed' using errcode = 'P0U01';
  end if;
end
$j1b6g$;

commit;
