begin;

delete from public.ediel_field_matrix_rules
where source='user_supplied_utilts_25_a_3_exact_matrix_2026_08_13';

with selected as (
  select p.profile_key,p.message_code,v.id version_id
  from public.ediel_rule_profiles p
  join public.ediel_rule_profile_versions v
    on v.profile_key=p.profile_key and v.version=p.active_version and v.status='active'
  where p.is_active and upper(p.message_family)='UTILTS'
    and upper(p.message_code) in ('S02','S03','S04')
), header(field_no,field_key,field_label,segment_path,allowed_values) as (
  values
    ('311','application_reference','Application Reference','UNB/0026','[]'::jsonb),
    ('312','association_assigned_code','Association assigned code','UNH/S009/0057','["E5SE5A"]'::jsonb),
    ('202','message_code','Document name code','BGM/C002/1001','["E30","E31","E66","E72","E73","E74","S01","S02","S03","S04","S05","S06","S07","S08","ERR"]'::jsonb),
    ('203','document_identifier','Document identifier','BGM/C106/1004','[]'::jsonb),
    ('204','message_function','Message function','BGM/1225','["5","9"]'::jsonb),
    ('313','request_acknowledgement','Request for acknowledgement','BGM/4343','["AB","NA"]'::jsonb),
    ('205','document_date','Message date','DTM+137','[]'::jsonb),
    ('206','timezone','Time zone','DTM+735','[]'::jsonb),
    ('501','market','Market/Sector Area','MKS/7293','["23","27"]'::jsonb),
    ('502','phase_domain','Phase/Domain','MKS/C332/3496','["E02","E03","E04","E05"]'::jsonb),
    ('207','sender_party','Sender','NAD+MS/C082/3039','[]'::jsonb),
    ('208','receiver_party','Recipient','NAD+MR/C082/3039','[]'::jsonb),
    ('509','ancillary_role','Ancillary Role','NAD+DDQ|NAD+DGI|NAD+PQ','[]'::jsonb)
)
insert into public.ediel_field_matrix_rules(
  company_id,rule_profile_version_id,profile_key,message_family,message_code,
  segment,qualifier,rule_type,rule_payload,source,status,created_at
)
select null,s.version_id,s.profile_key,'UTILTS',s.message_code,h.segment_path,null,'R',
  jsonb_build_object(
    'field_key',h.field_key,'field_code',h.field_no,'field_number',h.field_no,
    'field_name',h.field_label,'field_label',h.field_label,'segment_path',h.segment_path,
    'requirement','R','allowed_values',h.allowed_values,'scope','header',
    'error_code_if_missing','UTILTS_FIELD_' || upper(h.field_no) || '_MISSING',
    'severity','error','direction','all','environment','all','version','25-A-3'
  ),
  'user_supplied_utilts_25_a_3_exact_matrix_2026_08_13','active',now()
from selected s cross join header h;

with selected as (
  select p.profile_key,p.message_code,v.id version_id,
    case upper(p.message_code) when 'S02' then 1 when 'S03' then 2 else 3 end idx
  from public.ediel_rule_profiles p
  join public.ediel_rule_profile_versions v
    on v.profile_key=p.profile_key and v.version=p.active_version and v.status='active'
  where p.is_active and upper(p.message_family)='UTILTS'
    and upper(p.message_code) in ('S02','S03','S04')
), matrix(field_no,field_key,field_label,segment_path,reqs) as (
  values
    ('505','transaction_identity','Transaction id','IDE+24',array['R','R','R']),
    ('209','metering_point','Metering point','LOC+172',array['R','X','X']),
    ('260a','net_area','Metering grid area','LOC+239',array['R','R','R']),
    ('262','balance_responsible','Balance responsible','NAD+DDK',array['X','D','D']),
    ('510','balance_supplier','Balance supplier','NAD+DDQ',array['X','D','X']),
    ('506','product_id','Product id','LIN/C212/7140',array['R','R','R']),
    ('511','time_series_product','Time-series product','PIA+1',array['X','R','R']),
    ('245','delivery_period','Delivery period','DTM+324',array['R','R','R']),
    ('532','latest_update_date','Latest update date','DTM+368',array['R','R','R']),
    ('508','resolution','Resolution','DTM+354',array['R','R','R']),
    ('223','reason_for_transaction','Reason for transaction','STS+7',array['R','R','R']),
    ('264','unit','Unit','MEA+AAZ',array['R','R','R']),
    ('226','prodat_transaction_reference','PRODAT transaction reference','RFF+LI',array['O','X','X']),
    ('254','settlement_method','Settlement method','CCI++E02/CAV',array['X','R','X']),
    ('513','metering_point_type','Metering point type','CCI++E12/CAV',array['X','R','X']),
    ('507a','default_metering_point_count','Default metering point count','CCI++Z01/CAV',array['X','D','X']),
    ('514','observation_id','Observation id','SEQ/C286/1050',array['R','R','R']),
    ('515','planned_periodic_quantity','Planned periodic quantity','QTY+135',array['R','R','R']),
    ('520','quantity_quality','Quantity quality','STS+8',array['D','X','X']),
    ('507b','diverging_metering_point_count','Diverging metering point count','CCI++Z01/CAV',array['X','D','X'])
)
insert into public.ediel_field_matrix_rules(
  company_id,rule_profile_version_id,profile_key,message_family,message_code,
  segment,qualifier,rule_type,rule_payload,source,status,created_at
)
select null,s.version_id,s.profile_key,'UTILTS',s.message_code,m.segment_path,null,m.reqs[s.idx],
  jsonb_build_object(
    'field_key',m.field_key,'field_code',m.field_no,'field_number',m.field_no,
    'field_name',m.field_label,'field_label',m.field_label,'segment_path',m.segment_path,
    'requirement',m.reqs[s.idx],'scope','transaction',
    'condition',case when m.reqs[s.idx]='D' then '25-A-3 product-, actor- och transaktionsberoende regel' end,
    'error_code_if_missing','UTILTS_FIELD_' || upper(m.field_no) || '_MISSING',
    'error_code_if_invalid',case when m.reqs[s.idx]='X' then 'UTILTS_FIELD_' || upper(m.field_no) || '_FORBIDDEN' end,
    'severity','error','direction','all','environment','all','version','25-A-3'
  ),
  'user_supplied_utilts_25_a_3_exact_matrix_2026_08_13','active',now()
from selected s cross join matrix m;

update public.ediel_rule_profile_versions v
set rules=jsonb_set(
      jsonb_set(coalesce(v.rules,'{}'::jsonb),'{fieldMatrixVersion}','"25-A-3"'::jsonb,true),
      '{fieldMatrixSource}','"user_supplied_utilts_25_a_3_exact_matrix_2026_08_13"'::jsonb,true
    )
from public.ediel_rule_profiles p
where p.profile_key=v.profile_key and v.version=p.active_version and v.status='active'
  and p.is_active and upper(p.message_family)='UTILTS'
  and upper(p.message_code) in ('S02','S03','S04');

update public.ediel_rule_profile_versions v
set checksum=encode(extensions.digest(convert_to(v.rules::text,'UTF8'),'sha256'),'hex')
from public.ediel_rule_profiles p
where p.profile_key=v.profile_key and v.version=p.active_version and v.status='active'
  and p.is_active and upper(p.message_family)='UTILTS'
  and upper(p.message_code) in ('S02','S03','S04');

commit;
