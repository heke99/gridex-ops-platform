begin;
-- Authoritative field 511 masterdata from Svenska kraftnät Tidsserieprodukter_20250528 (3).xls.
-- Workbook SHA-256: 2317450436391e1422e176cf503352c96fc9c38040962e8668f036563784fa98. The workbook defines 91 unique PC/PT/OT/LOD/BAP tuples.
-- Three rows are retained for provenance but excluded from current resolution because the workbook itself marks them retired.
alter table public.ediel_timeseries_products
  add column if not exists description text,
  add column if not exists product_characteristic text,
  add column if not exists product_type text,
  add column if not exists identity_type text,
  add column if not exists level_of_details text,
  add column if not exists business_activity_phase text,
  add column if not exists resolution_number text,
  add column if not exists resolution_unit_code text,
  add column if not exists source_document text,
  add column if not exists source_row_numbers integer[] not null default '{}'::integer[],
  add column if not exists is_current boolean not null default true,
  add column if not exists source_metadata jsonb not null default '{}'::jsonb;

create unique index if not exists ediel_timeseries_products_511_tuple_version_uidx
  on public.ediel_timeseries_products(version,valid_from,product_characteristic,product_type,identity_type,level_of_details,business_activity_phase)
  where product_characteristic is not null and product_type is not null and identity_type is not null
    and level_of_details is not null and business_activity_phase is not null;

with source(code,description,message_code,phase,pc,pt,ot,lod,bap,resolution_number,resolution_unit,unit_summary,source_rows,is_current) as (
  values
    ('5031','Balansgrundpris','S01','settlement','Z58','Z51','Z88','Z55','Z01','60','806','Z81','{2}'::int[],true),
    ('5032','Uppregleringspris','S01','settlement','Z58','Z01','Z88','Z55','Z03','60','806','Z81','{3,4}'::int[],true),
    ('5033','Nedregleringspris','S01','settlement','Z58','Z02','Z88','Z55','Z03','60','806','Z81','{5,6}'::int[],true),
    ('K120Q','Uppmätt utbyte mellan NA och utländskt nätområde, 15 min','E31','settlement','Z02','U70','X07','Z54','Z04','15','806','MULTI','{7,8}'::int[],true),
    ('L120Q','Uppmätt utbyte mellan NA, 15 min','E31','settlement','Z02','U70','Z07','Z54','Z04','15','806','MULTI','{9,10}'::int[],true),
    ('L131','Prel. andelstal för förbr. per BR och NA, (Total), återrapportering','S04','planning','Z04','U82','Z04','Z58','Z05','1','802','Z52','{11}'::int[],true),
    ('L132','Prel. andelstal för förluster per BR och NA, (total), återrapportering','S04','planning','Z04','Z83','Z04','Z58','Z05','1','802','Z52','{12}'::int[],true),
    ('L208','Kvarkraft förluster per BR och NA','S01','settlement','Z61','Z87','Z04','Z58','Z05','1','802','Z52','{13}'::int[],true),
    ('L209','Köpt kvarkraft per BR och NA','S01','settlement','Z61','Z90','Z64','Z58','Z05','1','802','MULTI','{14,15}'::int[],true),
    ('L210','Såld kvarkraft per BR och NA','S01','settlement','Z61','Z91','Z64','Z58','Z05','1','802','MULTI','{16,17}'::int[],true),
    ('L336Q','Total uppmätt förbr. per CO och BR, exkl. nätförluster, 15 min','S01','settlement','Z04','U05','Z59','Z54','Z05','15','806','Z52','{18}'::int[],false),
    ('L349','Summa prel. andelstal per NA','S04','planning','Z04','Z84','Z02','Z58','Z05','1','802','Z52','{19}'::int[],true),
    ('L354','Slutliga andelstal förbr. per BR och NA, totalt, återrapportering','S01','settlement','Z04','U85','Z04','Z58','Z05','1','802','Z52','{20}'::int[],true),
    ('L355','Slutliga andelstal för förluster per BR och NA, totalt, återrapportering','S01','settlement','Z04','Z86','Z04','Z58','Z05','1','802','Z52','{21}'::int[],true),
    ('L359','Andelstalsbalans per NA','S01','settlement','Z04','U46','Z02','Z58','Z05','1','802','Z52','{22}'::int[],true),
    ('L363','Kvarkraft förbr. per BR och NA','S01','settlement','Z61','Z89','Z04','Z58','Z05','1','802','Z52','{23}'::int[],true),
    ('L420Q','Prel. schablonleverans per kvart per CA och BR','S01','settlement','Z04','X90','Z14','Z54','Z05','15','806','Z52','{24}'::int[],true),
    ('L427','Schablonavräkningspris per CA och månad','S01','settlement','Z58','Z75','Z77','Z58','Z05','1','802','Z81','{25}'::int[],true),
    ('L479','Prel. schablonleverans per månad per NA och BR, förbr.del','S01','settlement','Z04','U90','Z04','Z58','Z05','1','802','Z52','{26}'::int[],true),
    ('L480','Prel. schablonleverans per månad per NA och BR, förlustdel','S01','settlement','Z04','Z91','Z04','Z58','Z05','1','802','Z52','{27}'::int[],true),
    ('L517','Köpt kvarkraft (UTILTS)','S01','settlement','Z61','Z90','Z09','Z58','Z05','1','802','MULTI','{28,29}'::int[],true),
    ('L518','Såld kvarkraft (UTILTS)','S01','settlement','Z61','Z91','Z09','Z58','Z05','1','802','MULTI','{30,31}'::int[],true),
    ('L562Q','Prel. schablonleverans per kvart per NA och BR, förbr.del','S01','settlement','Z04','U90','Z04','Z54','Z05','15','806','Z52','{32}'::int[],true),
    ('L563Q','Prel. schablonleverans per kvart per NA och BR, förlustdel','S01','settlement','Z04','U91','Z04','Z54','Z05','15','806','Z52','{33}'::int[],true),
    ('L633Q','Uppmätt ospec. prod. per NA, BR och SU, 15 min','E31','settlement','Z01','U65','Z06','Z54','Z04','15','806','Z52','{34}'::int[],true),
    ('L634Q','Vattenkraft prod. per NA, BR och SU, 15 min','E31','settlement','Z01','U04','Z06','Z54','Z04','15','806','Z52','{35}'::int[],true),
    ('L635Q','Vindkraftprod. per NA, BR och SU, 15 min','E31','settlement','Z01','U02','Z06','Z54','Z04','15','806','Z52','{36}'::int[],true),
    ('L636Q','Kärnkraft prod. per NA, BR och SU, 15 min','E31','settlement','Z01','U03','Z06','Z54','Z04','15','806','Z52','{37}'::int[],true),
    ('L637Q','Övr. värmekraft prod. per NA, BR och SU, 15 min','E31','settlement','Z01','U72','Z06','Z54','Z04','15','806','Z52','{38}'::int[],true),
    ('L638Q','Gasturbin/diesel prod. per NA, BR och SU, 15 min','E31','settlement','Z01','U73','Z06','Z54','Z04','15','806','Z52','{39}'::int[],true),
    ('L639Q','Uppmätt förbr. per NA, BR och SU, 15 min','E31','settlement','Z04','U65','Z06','Z54','Z04','15','806','Z52','{40}'::int[],true),
    ('L640Q','Uppmätt avkopplingsbar last per NA, BR och SU, 15 min','E31','settlement','Z04','U78','Z06','Z54','Z04','15','806','Z52','{41}'::int[],true),
    ('L641Q','Solkraft produktion per NA, BR och SU, 15 min','E31','settlement','Z01','U84','Z06','Z54','Z04','15','806','Z52','{42}'::int[],true),
    ('L642Q','Vågkraft produktion per NA, BR och SU, 15 min','E31','settlement','Z01','U05','Z06','Z54','Z04','15','806','Z52','{43}'::int[],true),
    ('L651Q','Havsbaserad vindkraftprod. per NA, BR och SU, 15 min','E31','settlement','Z01','Z87','Z06','Z54','Z04','15','806','Z52','{44}'::int[],true),
    ('L652Q','Energilager produktion per NA, BR och SU, 15 min','E31','settlement','Z01','X91','Z06','Z54','Z04','15','806','Z52','{45}'::int[],true),
    ('L653Q','	Energilager förbrukning per NA, BR och SU, 15 min','E31','settlement','Z04','X91','Z06','Z54','Z04','15','806','Z52','{46}'::int[],true),
    ('L768','Summa Köpt Bilateral Handel per CA, BR och timme','S01','settlement','Z03','Z92','Z14','Z55','Z05','60','806','Z52','{47}'::int[],true),
    ('L915','Preliminära andelstal per BR, SU och NA','S03','planning','Z04','U82','Z06','Z58','Z01','1','802','MULTI','{48,49,50}'::int[],true),
    ('L916','Preliminära andelstal förluster per SU och NA','S03','planning','Z04','Z83','Z05','Z58','Z01','1','802','Z52','{51}'::int[],true),
    ('L917','Slutliga andelstal per BR, SU och NA','E31','settlement','Z04','U85','Z06','Z58','Z04','1','802','MULTI','{52,53,54}'::int[],true),
    ('L918','Slutliga andelstal förluster per SU och NA','E31','settlement','Z04','Z86','Z05','Z58','Z04','1','802','Z52','{55}'::int[],true),
    ('L919Q','Uppmätta förluster per SU och NA, 15 min','E31','settlement','Z04','Z76','Z05','Z54','Z04','15','806','Z52','{56}'::int[],true),
    ('L920Q','Schablonleverans förluster per SU och NA, 15 min','E31','settlement','Z04','Z91','Z05','Z54','Z04','15','806','Z52','{57}'::int[],true),
    ('M346Q','Förbr.profil per kvart, återrapportering','S01','settlement','Z04','Z51','Z02','Z54','Z05','15','806','Z52','{58}'::int[],true),
    ('M350','Summa preliminära andelstal per NA','S03','planning','Z04','Z84','Z02','Z58','Z01','1','802','Z52','{59}'::int[],true),
    ('M904Q','Förbr.profil per kvart, rapportering','E31','settlement','Z04','Z51','Z02','Z54','Z04','15','806','Z52','{60}'::int[],true),
    ('M908','Uppmätt ospec. förbr. per BR och NA, rapportering','E31','settlement','Z04','Z79','Z04','Z55','Z04','60','806','Z52','{61}'::int[],true),
    ('S1027_5','Återrapportering day ahead handel per BR (spot)','S01','settlement','Z03','Z45','Z15','Z55','Z01','60','806','Z52','{62}'::int[],true),
    ('S1027_6','Återrapportering intra day handel per BR (elbas)','S01','settlement','Z03','Z46','Z15','Z55','Z01','60','806','Z52','{63}'::int[],true),
    ('S195','Bindande planerad FCR-N, produktion, återrapportering','S01','settlement','Z51','Z24','Z14','Z55','Z05','60','806','Z51','{64}'::int[],false),
    ('S196','FNR uppmätt, återrapportering','S01','settlement','Z51','Z25','Z14','Z55','Z05','60','806','Z51','{65}'::int[],false),
    ('S197','Bindande planerad FCR-D, produktion, återrapportering','S01','settlement','Z51','Z31','Z14','Z55','Z05','60','806','Z51','{66}'::int[],true),
    ('S307','Medelfrekvens per kvart','S01','settlement','Z57','Z59','Z60','Z54','Z03','15','806','Z57','{67}'::int[],true),
    ('S337_1','Bil. handel BR,UB per elområde, återrapportering','S01','settlement','Z03','Z55','Z17','Z55','Z05','60','806','Z52','{68}'::int[],true),
    ('S338_1','Diff. handel BR, UB per elområde','S01','settlement','Z03','Z76','Z17','Z55','Z05','60','806','Z52','{69}'::int[],true),
    ('S342_2','Handelssaldo per BR och elområde','S01','settlement','Z03','Z51','X17','Z55','Z05','60','806','Z52','{70}'::int[],true),
    ('S398','aFRR, aktiverad uppreglerad energi per elområde, aktör och timme','S01','settlement','Z54','Z69','X17','Z55','Z05','60','806','MULTI','{71,72}'::int[],true),
    ('S399','aFRR, aktiverad nedreglerad energi per elområde, aktör och timme','S01','settlement','Z54','Z70','X17','Z55','Z05','60','806','MULTI','{73,74}'::int[],true),
    ('S402','FCR-N aktiverad energi, produktion, per elområde, aktör och timme','S01','settlement','Z51','Z88','X17','Z55','Z05','60','806','MULTI','{75,76}'::int[],true),
    ('S403','FCR-D aktiverad energi, produktion, per elområde, aktör och timme','S01','settlement','Z51','Z89','X17','Z55','Z05','60','806','MULTI','{77,78}'::int[],true),
    ('S419','FCR-N accepterat bud i D-2, produktion, per elområde, aktör och timme','S08','settlement','Z51','Z40','X05','Z55','Z03','60','806','MULTI','{79,80}'::int[],true),
    ('S420','FCR-N accepterat bud i D-1, produktion, per elområde, aktör och timme','S08','settlement','Z51','Z42','X05','Z55','Z03','60','806','MULTI','{81,82}'::int[],true),
    ('S423','FCR-D accepterat bud i D-2, produktion, per elområde, aktör och timme','S08','settlement','Z51','Z41','X05','Z55','Z03','60','806','MULTI','{83,84}'::int[],true),
    ('S424','FCR-D accepterat bud i D-1, produktion, per elområde, aktör och timme','S08','settlement','Z51','Z43','X05','Z55','Z03','60','806','MULTI','{85,86}'::int[],true),
    ('S427','Efterregistrering aFRR köpt uppreglering per elområde, aktör och timme','S01','settlement','Z54','Z57','X05','Z55','Z05','60','806','MULTI','{87,88}'::int[],true),
    ('S428','Efterregistrering aFRR såld uppreglering per elområde, aktör och timme','S01','settlement','Z54','Z58','X05','Z55','Z05','60','806','MULTI','{89,90}'::int[],true),
    ('S429','Efterregistrering aFRR köpt nedreglering per elområde, aktör och timme','S01','settlement','Z54','Z59','X05','Z55','Z05','60','806','MULTI','{91,92}'::int[],true),
    ('S430','Efterregistrering aFRR såld nedreglering per elområde, aktör och timme','S01','settlement','Z54','Z60','X05','Z55','Z05','60','806','MULTI','{93,94}'::int[],true),
    ('S431','FCR-D Ned accepterat bud, D-2 produktion per elområde och aktör','S08','settlement','Z51','Z01','X05','Z55','Z03','60','806','MULTI','{95,96}'::int[],true),
    ('S432','FCR-D Ned accepterat bud, D-1 produktion per elområde och aktör','S08','settlement','Z51','Z02','X05','Z55','Z03','60','806','MULTI','{97,98}'::int[],true),
    ('S437','Bindande planerad FCR-D ned, produktion, återrapportering','S01','settlement','Z51','Z07','Z14','Z55','Z05','60','806','Z51','{99}'::int[],true),
    ('S444','mFRR kapacitet köpt uppreglering per elområde, aktör och timme','S01','settlement','Z63','Z94','X05','Z55','Z05','60','806','MULTI','{100,101}'::int[],true),
    ('S445','mFRR kapacitet såld uppreglering per elområde, aktör och timme','S01','settlement','Z63','Z95','X05','Z55','Z05','60','806','MULTI','{102,103}'::int[],true),
    ('S446','mFRR kapacitet köpt nedreglering per elområde, aktör och timme','S01','settlement','Z63','Z96','X05','Z55','Z05','60','806','MULTI','{104,105}'::int[],true),
    ('S447','mFRR kapacitet såld nedreglering per elområde, aktör och timme','S01','settlement','Z63','Z97','X05','Z55','Z05','60','806','MULTI','{106,107}'::int[],true),
    ('U1009Q','Mätvärden per produktionsanläggning och NA, UTILTS, 15 min','E66','metering','Z01','U01','X55','Z54','Z04','15','806','MULTI','{108,109}'::int[],true),
    ('U1010Q','Mätvärden per förbrukningsanläggning och NA, UTILTS, 15 min','E66','metering','Z04','U01','X55','Z54','Z04','15','806','MULTI','{110,111}'::int[],true),
    ('U1011Q','Rapporterat utbyte mellan NA och NS/NE (UTILTS), 15 min','E66','metering','Z02','V70','X03','Z54','Z04','15','806','MULTI','{112,113}'::int[],true),
    ('U108Q','Bindande plan produktion per CA o BR, 15 min','E66','metering','Z01','Z60','Z14','Z54','Z04','15','806','Z52','{114}'::int[],true),
    ('U915','Prel. andelstal för förbr. per BR och NA','S03','planning','Z04','U82','Z04','Z58','Z01','1','802','MULTI','{115,116,117}'::int[],true),
    ('U916','Prel. andelstal för förluster per BR och NA','S03','planning','Z04','Z83','Z04','Z58','Z01','1','802','Z52','{118}'::int[],true),
    ('U917','Slutliga andelstal för förbr. per BR och NA','E31','settlement','Z04','U85','Z04','Z58','Z04','1','802','MULTI','{119,120,121}'::int[],true),
    ('U918','Slutliga andelstal för förluster per BR och NA','E31','settlement','Z04','Z86','Z04','Z58','Z04','1','802','Z52','{122}'::int[],true),
    ('UT304Q','Uppmätt inmatning per mätpunkt och NA, UTILTS, 15 min','E66','metering','Z01','U65','X28','Z54','Z04','15','806','MULTI','{123,124}'::int[],true),
    ('UT305Q','Uppmätt utmatning per mätpunkt och NA, UTILTS, 15 min','E66','metering','Z04','U65','X28','Z54','Z04','15','806','MULTI','{125,126}'::int[],true),
    ('UT306Q','Uppmätt utbyte mellan NA och område, UTILTS, 15 min','E66','metering','Z02','Z65','Z12','Z54','Z04','15','806','MULTI','{127,128}'::int[],true),
    ('UT307Q','Uppmätt inmatning per mätpunkt (kontrollmätare) och NA, UTILTS, 15 min','E66','metering','Z02','Z80','Z12','Z54','Z04','15','806','Z52','{129}'::int[],true),
    ('UT308Q','Uppmätt utmatning per mätpunkt (kontrollmätare) och NA, UTILTS, 15 min','E66','metering','Z02','Z83','Z12','Z54','Z04','15','806','Z52','{130}'::int[],true),
    ('V1009Q','Mätvärden (effektreserv) per produktionsanläggning och NA, UTILTS, 15 min','E66','metering','Z01','U08','X55','Z54','Z04','15','806','MULTI','{131,132}'::int[],true),
    ('V1010Q','Mätvärden (effektreserv) per förbrukningsanläggning och NA, UTILTS, 15 min','E66','metering','Z04','U08','X55','Z54','Z04','15','806','MULTI','{133,134}'::int[],true)
)
insert into public.ediel_timeseries_products(
  code,version,family,message_codes,phase,unit,sign_rule,resolution,required_dimensions,
  allowed_sender_roles,allowed_receiver_roles,valid_from,valid_to,source_hash,
  description,product_characteristic,product_type,identity_type,level_of_details,business_activity_phase,
  resolution_number,resolution_unit_code,source_document,source_row_numbers,is_current,source_metadata
)
select code,'25-A-3','UTILTS',array[message_code],phase,coalesce(nullif(unit_summary,''),'UNSPECIFIED'),'source-defined',
  concat_ws(':',nullif(resolution_number,''),nullif(resolution_unit,'')),
  jsonb_build_object('product_characteristic',pc,'product_type',pt,'identity_type',ot,'level_of_details',lod,'business_activity_phase',bap),
  array[]::text[],array[]::text[],date '2025-06-01',date '2026-09-30','2317450436391e1422e176cf503352c96fc9c38040962e8668f036563784fa98',
  description,pc,pt,ot,lod,bap,resolution_number,resolution_unit,'Tidsserieprodukter_20250528 (3).xls',source_rows,is_current,
  jsonb_build_object('authority','Svenska kraftnät','field','511','tupleOrder',jsonb_build_array('PC','PT','OT','LOD','BAP'),'primaryMessageCode',message_code)
from source
on conflict(code,version,valid_from) do update set
  family=excluded.family,message_codes=excluded.message_codes,phase=excluded.phase,unit=excluded.unit,sign_rule=excluded.sign_rule,
  resolution=excluded.resolution,required_dimensions=excluded.required_dimensions,valid_to=excluded.valid_to,source_hash=excluded.source_hash,
  description=excluded.description,product_characteristic=excluded.product_characteristic,product_type=excluded.product_type,
  identity_type=excluded.identity_type,level_of_details=excluded.level_of_details,business_activity_phase=excluded.business_activity_phase,
  resolution_number=excluded.resolution_number,resolution_unit_code=excluded.resolution_unit_code,source_document=excluded.source_document,
  source_row_numbers=excluded.source_row_numbers,is_current=excluded.is_current,source_metadata=excluded.source_metadata;

delete from public.ediel_rule_pack_sources s using public.ediel_rule_packs rp
where s.rule_pack_id=rp.id and rp.family='UTILTS' and rp.guide_version='25-A-3' and rp.guide_revision='3'
  and s.source_type='code_list' and s.title='Svenska kraftnät Tidsserieprodukter' and coalesce(s.revision,'')='2025-05-28';
insert into public.ediel_rule_pack_sources(rule_pack_id,source_type,priority,title,revision,valid_from,valid_to,source_hash,source_locator,metadata)
select id,'code_list',2,'Svenska kraftnät Tidsserieprodukter','2025-05-28',date '2025-06-01',date '2026-09-30','2317450436391e1422e176cf503352c96fc9c38040962e8668f036563784fa98',
  'Tidsserieprodukter_20250528 (3).xls',jsonb_build_object('field','511','tupleCount',91,'currentTupleCount',88,'tupleOrder',jsonb_build_array('PC','PT','OT','LOD','BAP'))
from public.ediel_rule_packs where family='UTILTS' and guide_version='25-A-3' and guide_revision='3' and valid_from=date '2025-06-01';

update public.ediel_rule_packs set
  code_list_versions=coalesce(code_list_versions,'{}'::jsonb)||jsonb_build_object('timeSeriesProducts',jsonb_build_object('version','2025-05-28','sourceHash','2317450436391e1422e176cf503352c96fc9c38040962e8668f036563784fa98','tupleCount',91,'currentTupleCount',88)),
  metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('field511TupleSourceStatus','authoritative_loaded'),updated_at=now()
where family='UTILTS' and guide_version='25-A-3' and guide_revision='3' and valid_from=date '2025-06-01';

create or replace function public.resolve_ediel_timeseries_product_511(
 p_product_characteristic text,p_product_type text,p_identity_type text,p_level_of_details text,p_business_activity_phase text,p_business_date date default current_date)
returns table(code text,description text,version text,message_codes text[],phase text,valid_from date,valid_to date,source_hash text)
language sql stable set search_path=public as $$
 select p.code,p.description,p.version,p.message_codes,p.phase,p.valid_from,p.valid_to,p.source_hash
 from public.ediel_timeseries_products p
 where p.family='UTILTS' and p.is_current
   and p.product_characteristic=upper(btrim(p_product_characteristic)) and p.product_type=upper(btrim(p_product_type))
   and p.identity_type=upper(btrim(p_identity_type)) and p.level_of_details=upper(btrim(p_level_of_details))
   and p.business_activity_phase=upper(btrim(p_business_activity_phase))
   and p.valid_from<=p_business_date and (p.valid_to is null or p.valid_to>=p_business_date)
 order by p.valid_from desc,p.version desc limit 1
$$;
revoke all on function public.resolve_ediel_timeseries_product_511(text,text,text,text,text,date) from public,anon,authenticated;
grant execute on function public.resolve_ediel_timeseries_product_511(text,text,text,text,text,date) to service_role;

do $$ declare v_all int; v_current int; v_unique int; begin
 select count(*),count(*) filter(where is_current),count(distinct concat_ws('|',product_characteristic,product_type,identity_type,level_of_details,business_activity_phase))
 into v_all,v_current,v_unique from public.ediel_timeseries_products where version='25-A-3' and valid_from=date '2025-06-01' and source_hash='2317450436391e1422e176cf503352c96fc9c38040962e8668f036563784fa98';
 if v_all<>91 or v_current<>88 or v_unique<>91 then raise exception 'field_511_import_invalid all=% current=% unique=%',v_all,v_current,v_unique; end if;
 if not exists(select 1 from public.resolve_ediel_timeseries_product_511('Z02','U70','X07','Z54','Z04',date '2026-08-13') where code='K120Q') then raise exception 'field_511_known_tuple_missing'; end if;
 if exists(select 1 from public.resolve_ediel_timeseries_product_511('Z04','U05','Z59','Z54','Z05',date '2026-08-13') where code='L336Q') then raise exception 'field_511_retired_tuple_resolved'; end if;
end $$;
commit;
