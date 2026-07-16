-- Gridex canonical contract finalization.
-- Removes legacy legal documents as a publication source, guarantees exact
-- canonical bindings for operational contracts, and archives signed PDFs.

begin;
create extension if not exists pgcrypto;

-- Keep immutable version rows protected while allowing explicit lifecycle
-- transitions performed by canonical RPCs in the same transaction.
create or replace function public.gridex_reject_locked_row_mutation()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
begin
  if (
    nullif(to_jsonb(old)->>'locked_at','') is not null
    or nullif(to_jsonb(old)->>'published_at','') is not null
  ) and coalesce(current_setting('gridex.version_transition',true),'')<>'on' then
    raise exception using errcode='55000',message='immutable_version_locked';
  end if;
  return case when tg_op='DELETE' then old else new end;
end $$;

-- -----------------------------------------------------------------------------
-- Canonical legal templates: one independently versioned document per module.
-- These texts are platform defaults and must still be legally approved before
-- production use. Tenant replacements/addenda remain supported through
-- tenant_legal_overrides.
-- -----------------------------------------------------------------------------
with template_seed(module_key,name,description,title,body,mandatory) as (
  values
  ('general_consumer_terms','Allmänna konsumentvillkor','Grundvillkor för privatkund','Allmänna konsumentvillkor',
   E'Dessa villkor gäller mellan {{legal_name}}, organisationsnummer {{organization_number}}, och kunden. Avtalet omfattar elleverans enligt den publicerade produkt-, pris- och avtalsversion som anges i avtalsbekräftelsen. Kunden ska lämna korrekta uppgifter och meddela ändringar utan dröjsmål. {{legal_name}} ansvarar för leveransen enligt tvingande konsumenträtt och tillämplig energirätt. Kontakt: {{customer_service_email}}, {{phone}}, {{website}}.',true),
  ('general_business_terms','Allmänna företagsvillkor','Grundvillkor för företagskund','Allmänna företagsvillkor',
   E'Dessa villkor gäller mellan {{legal_name}}, organisationsnummer {{organization_number}}, och företagskunden. Avtalet omfattar den produkt, prisversion, leveransperiod och de särskilda villkor som anges i avtalsbekräftelsen. Parterna ska agera lojalt, lämna riktiga uppgifter och utan dröjsmål informera om förändringar som påverkar leveransen.',true),
  ('variable_price_terms','Särskilda villkor för månadspris','Prisförklaring för månadsrörligt avtal','Särskilda villkor för månadspris',
   E'Elpriset beräknas per kalendermånad utifrån spotmarknadens månadsmedel för kundens elområde, justerat med de påslag, avgifter, rabatter och skatter som anges i den låsta prisversionen. Prisområdet och tidpunkten för fastställande framgår av avtalsbekräftelsen.',false),
  ('hourly_price_terms','Särskilda villkor för timpris','Prisförklaring för timavräknat avtal','Särskilda villkor för timpris',
   E'Förbrukningen prissätts mot spotpriset för motsvarande timme i kundens elområde. Saknade eller korrigerade mätvärden hanteras enligt nätägarens validerade mätvärden. Övergång mellan sommar- och vintertid följer marknadens tidsserier och nätägarens mätvärdesrapportering.',false),
  ('quarterly_price_terms','Särskilda villkor för kvartspris','Prisförklaring för kvartsmätt avtal','Särskilda villkor för kvartspris',
   E'Förbrukningen prissätts mot spotpriset för motsvarande kvart i kundens elområde. Om kvartsvärden saknas, är försenade eller korrigeras används nätägarens senast validerade mätvärden och marknadens gällande upplösningsregler. Datakvalitet och senare rättelser kan medföra korrigerad faktura.',false),
  ('fixed_price_terms','Särskilda villkor för fastpris','Pris, bindning och giltighet för fastpris','Särskilda villkor för fastpris',
   E'Kunden betalar det fasta pris per kWh och de avgifter som anges i den låsta prisversionen under avtalets giltighets- och bindningstid. Eventuell brytavgift och vad som gäller efter bindningstidens slut framgår av avtalsbekräftelsen och prisversionen.',false),
  ('mixed_price_terms','Villkor för mixavtal','Prisvillkor för kombinerade prismodeller','Särskilda villkor för mixavtal',
   E'Priset består av de andelar och prismodeller som anges i den låsta prisversionen. Varje del beräknas separat och summeras tillsammans med påslag, fasta avgifter, skatter och eventuella rabatter. Andelarna ska tillsammans motsvara 100 procent.',false),
  ('portfolio_terms','Villkor för portföljavtal','Prisvillkor för spot- och portföljmix','Särskilda villkor för portföljavtal',
   E'Månadspriset beräknas som månadens spotmedel multiplicerat med spotandelen plus månadens portföljpris multiplicerat med portföljandelen. Spotandel, portföljandel, prisområde, metod för portföljpris samt påslag och avgifter framgår av den låsta prisversionen.',false),
  ('price_terms','Pris- och betalningsvillkor','Gemensamma kommersiella villkor','Pris- och betalningsvillkor',
   E'Alla priser, påslag, fasta avgifter, rabatter, skatter, moms och eventuella tillägg är de som finns i den versionslåsta prisversionen för kundavtalet. Ingen senare ändring av en prisplan påverkar redan ingångna avtal. Betalning ska ske enligt fakturans förfallodag.',true),
  ('billing_terms','Faktureringsvillkor','Fakturering, rättelser och betalning','Faktureringsvillkor',
   E'Fakturering sker enligt avtalad faktureringsperiod och baseras på validerade mätvärden samt kundens låsta prisversion. Preliminära värden kan korrigeras när slutliga mätvärden erhålls. Fakturafrågor hanteras via {{customer_service_email}}.',true),
  ('pre_contract_information','Förköpsinformation','Information innan privatkund ingår avtal','Förköpsinformation',
   E'Innan avtalet ingås får kunden information om avtalspart, produkt, pris, avgifter, avtalsperiod, uppsägning, ångerrätt, klagomål och kontaktvägar. Informationen ska sparas tillsammans med den version av avtalet som kunden accepterar.',false),
  ('distance_contract_information','Information om distansavtal','Information för avtal som ingås på distans','Information om distansavtal',
   E'Avtalet ingås på distans. Kunden får avtalsvillkor, prisinformation, ångerrätt och avtalsbekräftelse i varaktig form. Avtalet blir bindande när kundens accept har registrerats och bekräftats av {{legal_name}}.',false),
  ('withdrawal_right','Ångerrätt','Konsumentens ångerrätt','Information om ångerrätt',
   E'Privatkund har ångerrätt när tillämplig lag ger sådan rätt. Ångerfristen och sista dag anges i avtalsbekräftelsen. Meddelande om ånger kan skickas till {{customer_service_email}}. Om kunden uttryckligen begärt leverans under ångerfristen kan ersättning för redan utförd leverans tas ut enligt lag.',false),
  ('withdrawal_form','Ångerblankett','Mall för konsumentens ånger','Ångerblankett',
   E'Till {{legal_name}}, {{company_address}}, {{customer_service_email}}. Jag meddelar härmed att jag frånträder avtalet avseende elleverans. Kundens namn: __________. Anläggningsadress: __________. Avtalsnummer: __________. Datum och underskrift: __________.',false),
  ('privacy_policy','Integritetspolicy','Personuppgiftsbehandling','Integritetspolicy',
   E'{{legal_name}} behandlar personuppgifter för avtal, kundservice, leverantörsbyte, mätvärden, fakturering, rättsliga skyldigheter och berättigade intressen. Uppgifter delas endast med behöriga mottagare. Frågor och rättighetsbegäran skickas till {{data_protection_email}}.',true),
  ('power_of_attorney','Fullmakt','Fullmakt när leverantörsbyte kräver det','Fullmakt',
   E'Kunden ger {{legal_name}} rätt att inhämta nödvändiga uppgifter och genomföra leverantörsbyte för angiven anläggning. Fullmakten gäller endast för de syften, anläggningar och den giltighetstid som framgår av den signerade fullmaktssnapshoten. Fullmakten kan återkallas skriftligen.',false),
  ('supplier_switch_terms','Leveransstart och leverantörsbyte','Process och beroenden för leverantörsbyte','Leveransstart och leverantörsbyte',
   E'Önskat startdatum är preliminärt tills nätägare och marknadsprocesser har bekräftat bytet. Starten kan påverkas av uppsägningstid, befintligt avtal, korrekta anläggningsuppgifter och marknadens tidsfrister. Kunden informeras om bekräftat startdatum eller blockerande uppgifter.',true),
  ('automatic_renewal','Automatisk förlängning','Förlängning, uppsägning och information','Automatisk förlängning',
   E'Om avtalet har automatisk förlängning framgår förlängningsperiod, uppsägningstid och informationstidpunkt av avtalsbekräftelsen. Kunden informeras i enlighet med tillämpliga regler innan villkor eller pris för en ny period börjar gälla.',false),
  ('termination_and_breach','Uppsägning och avtalsbrott','Uppsägning, hävning och avtalsbrott','Uppsägning och avtalsbrott',
   E'Uppsägning ska ske enligt avtalad uppsägningstid. Vid väsentligt avtalsbrott, utebliven betalning eller felaktiga uppgifter får motparten vidta de åtgärder som följer av avtalet och lag. Redan uppkomna betalningsskyldigheter kvarstår efter avtalets slut.',true),
  ('complaints_and_disputes','Klagomål och tvistlösning','Klagomål, ARN och domstol','Klagomål och tvistlösning',
   E'Klagomål lämnas till {{complaints_email}}. {{legal_name}} utreder ärendet och återkommer skyndsamt. Privatkund kan, när reglerna medger det, vända sig till Allmänna reklamationsnämnden. Information om tvistlösning: {{dispute_resolution_information}}.',true),
  ('company_information','Bolags- och kontaktinformation','Avtalspart och kontaktvägar','Bolags- och kontaktinformation',
   E'Avtalspart är {{legal_name}}, organisationsnummer {{organization_number}}, med adress {{company_address}}. Kundservice: {{customer_service_email}}, telefon {{phone}}, webbplats {{website}}.',true),
  ('agreement_confirmation','Avtalsbekräftelse','Versionslåst bekräftelse efter avtal','Avtalsbekräftelse',
   E'När avtalet har accepterats skickar {{legal_name}} en avtalsbekräftelse i varaktig form. Bekräftelsen innehåller avtalsnummer, produkt, prisversion, juridikversion, startuppgifter, accepterade dokument, signeringstid och bevisreferens.',true),
  ('terms_change_notice','Ändring av villkor','Regler för ändringar och information','Ändring av villkor',
   E'Ändringar gäller endast enligt avtalet och tillämplig lag. Kunden informeras i varaktig form med angiven ikraftträdandetid och information om rättigheter. Redan låsta historiska avtals-, pris- och juridikversioner ändras inte.',true),
  ('authorized_signatory','Behörig firmatecknare','Behörighet för företagskund','Behörig firmatecknare',
   E'Den som accepterar avtalet för företagskunden intygar att personen är behörig att företräda företaget eller har giltig fullmakt. {{legal_name}} får begära underlag som styrker behörigheten.',false),
  ('credit_and_late_payment','Kredit-, dröjsmåls- och avstängningsvillkor','Kreditbedömning och betalningsdröjsmål','Kredit och dröjsmål',
   E'{{legal_name}} får genomföra proportionerlig kreditbedömning. Vid försenad betalning kan dröjsmålsränta, påminnelseavgift och inkassoåtgärder tas ut enligt lag och avtal. Leveransåtgärder får endast ske enligt tillämpliga regler och föregås av erforderlig information.',false),
  ('liability_limitation','Ansvar och ansvarsbegränsning','Ansvarsregler för företagsavtal','Ansvar och ansvarsbegränsning',
   E'Parterna ansvarar för direkt skada som orsakats genom avtalsbrott, med de begränsningar som anges i avtalet och tillämplig lag. Indirekt skada ersätts endast vid uppsåt, grov vårdslöshet eller när tvingande rätt kräver det.',false),
  ('volume_forecast_responsibility','Volym- och prognosansvar','Prognosansvar för portföljkund','Volym- och prognosansvar',
   E'Företagskunden ska lämna rimliga förbrukningsprognoser och informera om väsentliga förändringar. Avvikelser hanteras enligt den kommersiella modellen och får inte beräknas från andra uppgifter än kundens låsta pris- och avtalsversion.',false),
  ('production_terms','Villkor för mikroproduktion','Ersättning och avräkning för produktion','Villkor för mikroproduktion',
   E'När produktion ingår regleras ersättningsmodell, spotkoppling eller fast ersättning, prisjustering, eventuell prisbotten, moms, kreditfaktura eller självfakturering, mätvärdeshantering och negativa priser i den låsta prisversionen. Endast validerade produktionsvärden ligger till grund för avräkning.',false)
), upsert_templates as (
  insert into public.legal_templates(module_key,name,description,mandatory,status)
  select module_key,name,description,mandatory,'active' from template_seed
  on conflict(module_key) do update
    set name=excluded.name,description=excluded.description,mandatory=excluded.mandatory,status='active',updated_at=now()
  returning id,module_key
)
insert into public.legal_template_versions(
  legal_template_id,version_number,title,body,variables,content_sha256,status,
  reviewed_at,published_at,locked_at,created_at
)
select
  t.id,
  coalesce((select max(v.version_number)+1 from public.legal_template_versions v where v.legal_template_id=t.id),1),
  s.title,
  s.body,
  coalesce((select array_agg(distinct m[1] order by m[1]) from regexp_matches(s.title||E'\n'||s.body,'\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}','g') m),'{}'::text[]),
  encode(digest(s.module_key||E'\n'||s.title||E'\n'||s.body,'sha256'),'hex'),
  'published',now(),now(),now(),now()
from template_seed s
join public.legal_templates t using(module_key)
where not exists(
  select 1 from public.legal_template_versions v
  where v.legal_template_id=t.id and v.status='published'
);

create or replace function public.gridex_render_legal_document(p_body text,p_profile jsonb,p_company jsonb)
returns text
language plpgsql
immutable
set search_path=public,pg_temp
as $$
declare
  v text:=coalesce(p_body,'');
  v_address text:=coalesce(
    p_profile#>>'{postal_address,text}',
    p_profile#>>'{postal_address,address}',
    concat_ws(', ',nullif(p_profile#>>'{postal_address,address_line_1}',''),nullif(p_profile#>>'{postal_address,postal_code}','')||' '||nullif(p_profile#>>'{postal_address,city}','')),
    ''
  );
begin
  v:=replace(v,'{{company_name}}',coalesce(p_profile->>'legal_name',p_company->>'name',''));
  v:=replace(v,'{{legal_name}}',coalesce(p_profile->>'legal_name',p_company->>'name',''));
  v:=replace(v,'{{brand_name}}',coalesce(p_company#>>'{branding,brand_name}',p_company#>>'{branding,display_name}',p_company->>'name',''));
  v:=replace(v,'{{organization_number}}',coalesce(p_profile->>'organization_number',p_company->>'org_number',''));
  v:=replace(v,'{{org_number}}',coalesce(p_profile->>'organization_number',p_company->>'org_number',''));
  v:=replace(v,'{{company_address}}',v_address);
  v:=replace(v,'{{customer_service_email}}',coalesce(p_profile->>'customer_service_email',p_company->>'support_email',p_company->>'primary_contact_email',''));
  v:=replace(v,'{{support_email}}',coalesce(p_profile->>'customer_service_email',p_company->>'support_email',p_company->>'primary_contact_email',''));
  v:=replace(v,'{{phone}}',coalesce(p_profile->>'phone',p_company->>'phone',''));
  v:=replace(v,'{{website}}',coalesce(p_profile->>'website',p_company->>'website',''));
  v:=replace(v,'{{complaints_email}}',coalesce(p_profile#>>'{complaints_contact,email}',p_profile#>>'{complaints_contact,text}',p_profile->>'customer_service_email',''));
  v:=replace(v,'{{data_protection_email}}',coalesce(p_profile#>>'{data_protection_contact,email}',p_profile#>>'{data_protection_contact,text}',p_profile->>'customer_service_email',''));
  v:=replace(v,'{{billing_information}}',coalesce(p_profile#>>'{billing_information,text}',(p_profile->'billing_information')::text,''));
  v:=replace(v,'{{dispute_resolution_information}}',coalesce(p_profile#>>'{dispute_resolution_information,text}',(p_profile->'dispute_resolution_information')::text,''));
  return v;
end $$;

-- Build legal evidence directly from canonical template versions and approved
-- tenant overrides. The legacy bundle id is accepted only for signature
-- compatibility and is never read as legal content.
create or replace function public.gridex_materialize_legal_bundle_version(
  p_company_id uuid,p_contract_product_version_id uuid,p_legacy_legal_bundle_id uuid,p_actor_user_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_required text[];
  v_module text;
  v_profile public.tenant_legal_profiles%rowtype;
  v_company jsonb;
  v_profile_snapshot jsonb;
  v_profile_hash text;
  v_template_version_id uuid;
  v_template_version_number integer;
  v_template_title text;
  v_template_body text;
  v_override_id uuid;
  v_override_mode text;
  v_override_title text;
  v_override_body text;
  v_title text;
  v_source_body text;
  v_rendered text;
  v_doc_unresolved text[];
  v_unresolved text[] := '{}';
  v_docs jsonb := '[]'::jsonb;
  v_bundle_id uuid;
  v_number integer;
  v_hash text;
  v_mode text := 'ops_standard';
  v_origin text;
  v_template_version text;
  v_doc jsonb;
begin
  select required_legal_modules
    into v_required
  from public.contract_product_versions
  where id = p_contract_product_version_id;
  if not found then
    raise exception using errcode='P0002', message='contract_product_version_not_found';
  end if;

  select *
    into v_profile
  from public.tenant_legal_profiles
  where company_id = p_company_id;
  if not found then
    raise exception using errcode='23514', message='tenant_legal_profile_missing';
  end if;

  select to_jsonb(c)
    into v_company
  from public.companies c
  where c.id = p_company_id;
  if v_company is null then
    raise exception using errcode='P0002', message='company_not_found';
  end if;

  v_profile_snapshot := to_jsonb(v_profile) - 'verified_by';
  v_profile_hash := encode(digest(v_profile_snapshot::text,'sha256'),'hex');

  foreach v_module in array coalesce(v_required,'{}'::text[]) loop
    v_template_version_id := null;
    v_template_version_number := null;
    v_template_title := null;
    v_template_body := null;
    v_override_id := null;
    v_override_mode := null;
    v_override_title := null;
    v_override_body := null;
    v_title := null;
    v_source_body := null;
    v_origin := null;
    v_template_version := null;

    select ltv.id, ltv.version_number, ltv.title, ltv.body
      into v_template_version_id, v_template_version_number, v_template_title, v_template_body
    from public.legal_templates lt
    join public.legal_template_versions ltv on ltv.legal_template_id = lt.id
    where lt.module_key = v_module
      and lt.status = 'active'
      and ltv.status = 'published'
      and ltv.locked_at is not null
    order by ltv.version_number desc, ltv.published_at desc nulls last
    limit 1;

    select o.id, o.legal_mode, o.title, o.body
      into v_override_id, v_override_mode, v_override_title, v_override_body
    from public.tenant_legal_overrides o
    where o.company_id = p_company_id
      and o.module_key = v_module
      and o.status in ('approved','published')
      and o.locked_at is not null
    order by o.reviewed_at desc nulls last, o.created_at desc
    limit 1;

    if v_override_id is not null and v_override_mode = 'replacement' then
      v_title := v_override_title;
      v_source_body := v_override_body;
      v_origin := 'tenant_replacement';
      v_template_version := 'tenant:' || v_override_id::text;
      v_mode := 'tenant_legal';
      v_template_version_id := null;
    elsif v_template_version_id is not null then
      v_title := v_template_title;
      v_source_body := v_template_body;
      v_origin := 'platform_template';
      v_template_version := v_template_version_number::text;
      if v_override_id is not null and v_override_mode = 'addendum' then
        v_title := v_title || ' – tenanttillägg';
        v_source_body := v_source_body || E'\n\nTenanttillägg\n' || v_override_body;
        v_origin := 'platform_template_with_tenant_addendum';
        if v_mode <> 'tenant_legal' then
          v_mode := 'ops_standard_with_addendum';
        end if;
      else
        v_override_id := null;
      end if;
    else
      v_unresolved := array_append(v_unresolved,'missing_document:' || v_module);
      continue;
    end if;

    v_title := public.gridex_render_legal_document(v_title,v_profile_snapshot,v_company);
    v_rendered := public.gridex_render_legal_document(v_source_body,v_profile_snapshot,v_company);

    select coalesce(array_agg(distinct match[1] order by match[1]),'{}'::text[])
      into v_doc_unresolved
    from regexp_matches(
      v_title || E'\n' || v_rendered,
      '\{\{[[:space:]]*([a-zA-Z0-9_.-]+)[[:space:]]*\}\}',
      'g'
    ) as match;

    if cardinality(v_doc_unresolved) > 0 then
      v_unresolved := v_unresolved || array(
        select 'unresolved_placeholder:' || v_module || ':' || placeholder
        from unnest(v_doc_unresolved) as placeholder
      );
    end if;

    v_docs := v_docs || jsonb_build_array(jsonb_build_object(
      'module_key',v_module,
      'title',v_title,
      'rendered_body',v_rendered,
      'origin',v_origin,
      'legal_template_version_id',v_template_version_id,
      'tenant_legal_override_id',v_override_id,
      'template_version',v_template_version,
      'tenant_customized',v_override_id is not null,
      'unresolved_variables',to_jsonb(v_doc_unresolved),
      'rendered_sha256',encode(digest(v_title || E'\n' || v_rendered,'sha256'),'hex'),
      'sort_order',coalesce(array_position(v_required,v_module),100) * 10
    ));
  end loop;

  select coalesce(array_agg(distinct item order by item),'{}'::text[])
    into v_unresolved
  from unnest(v_unresolved) as item;

  v_hash := encode(digest(jsonb_build_object(
    'schema','gridex_legal_bundle_v5',
    'company_id',p_company_id,
    'contract_product_version_id',p_contract_product_version_id,
    'profile_sha256',v_profile_hash,
    'required_modules',v_required,
    'documents',v_docs
  )::text,'sha256'),'hex');

  select id
    into v_bundle_id
  from public.legal_bundle_versions
  where company_id = p_company_id
    and contract_product_version_id = p_contract_product_version_id
    and content_sha256 = v_hash
  limit 1;
  if v_bundle_id is not null then
    return v_bundle_id;
  end if;

  select coalesce(max(version_number),0) + 1
    into v_number
  from public.legal_bundle_versions
  where company_id = p_company_id
    and contract_product_version_id = p_contract_product_version_id;

  insert into public.legal_bundle_versions(
    company_id,contract_product_version_id,legacy_legal_bundle_id,version_number,legal_mode,
    rendered_snapshot,unresolved_variables,content_sha256,status,created_by,
    tenant_legal_profile_snapshot,tenant_legal_profile_sha256
  ) values(
    p_company_id,p_contract_product_version_id,null,v_number,v_mode,
    jsonb_build_object(
      'schema','gridex_legal_bundle_v5',
      'required_modules',v_required,
      'tenant_legal_profile',v_profile_snapshot,
      'tenant_legal_profile_sha256',v_profile_hash,
      'documents',v_docs
    ),v_unresolved,v_hash,'draft',p_actor_user_id,v_profile_snapshot,v_profile_hash
  ) returning id into v_bundle_id;

  for v_doc in select value from jsonb_array_elements(v_docs) loop
    insert into public.legal_bundle_version_documents(
      legal_bundle_version_id,module_key,legal_template_version_id,tenant_legal_override_id,
      legacy_legal_text_version_id,title,rendered_body,content_sha256,sort_order,
      origin,template_key,template_version,tenant_customized,unresolved_variables
    ) values(
      v_bundle_id,
      v_doc->>'module_key',
      nullif(v_doc->>'legal_template_version_id','')::uuid,
      nullif(v_doc->>'tenant_legal_override_id','')::uuid,
      null,
      v_doc->>'title',
      v_doc->>'rendered_body',
      v_doc->>'rendered_sha256',
      coalesce((v_doc->>'sort_order')::integer,100),
      v_doc->>'origin',
      v_doc->>'module_key',
      v_doc->>'template_version',
      coalesce((v_doc->>'tenant_customized')::boolean,false),
      coalesce(array(select jsonb_array_elements_text(v_doc->'unresolved_variables')),'{}'::text[])
    );
  end loop;

  return v_bundle_id;
end $$;


create or replace function public.gridex_resolve_or_create_legal_source_bundle(
  p_company_id uuid,p_payload jsonb,p_pricing_snapshot jsonb,p_actor_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_required text[]; v_missing text[]; v_production boolean:=false;
begin
  if p_company_id is null then raise exception using errcode='22023',message='company_id_required'; end if;
  v_production:=lower(coalesce(p_pricing_snapshot#>>'{production,enabled}',p_pricing_snapshot->>'production_enabled','false'))='true';
  v_required:=public.gridex_required_legal_modules(
    coalesce(nullif(p_payload->>'customer_type',''),'private'),
    coalesce(nullif(p_payload->>'contract_type',''),'variable_monthly'),
    'website',
    lower(coalesce(p_payload->>'automatic_renewal','false'))='true',
    lower(coalesce(p_payload->>'power_of_attorney_required','true'))='true',
    v_production
  );
  select coalesce(array_agg(module_key order by module_key),'{}') into v_missing
  from unnest(v_required) as required_module(module_key)
  where not exists(
    select 1
    from public.legal_templates t
    join public.legal_template_versions tv on tv.legal_template_id=t.id
    where t.module_key=required_module.module_key and t.status='active' and tv.status='published' and tv.locked_at is not null
  ) and not exists(
    select 1 from public.tenant_legal_overrides o
    where o.company_id=p_company_id and o.module_key=required_module.module_key
      and o.legal_mode='replacement' and o.status in('approved','published') and o.locked_at is not null
  );
  if coalesce(array_length(v_missing,1),0)>0 then
    raise exception using errcode='23514',message='canonical_legal_template_missing:'||array_to_string(v_missing,',');
  end if;
  return jsonb_build_object(
    'canonical',true,
    'legal_bundle_id',null,
    'required_modules',v_required,
    'actor_user_id',p_actor_user_id
  );
end $$;


-- Canonical legal administration. Platform and tenant editors write only the
-- canonical version tables; published rows are immutable and a later version
-- supersedes them by ordering, never by mutation.
alter table public.legal_template_versions
  add column if not exists version_label text;

alter table public.tenant_legal_overrides
  add column if not exists version_label text;

-- Only mutable drafts are backfilled. Published/locked history is never
-- rewritten; the canonical read views already derive a stable fallback label.
update public.legal_template_versions
set version_label=version_number::text
where version_label is null
  and locked_at is null
  and published_at is null;

update public.tenant_legal_overrides
set version_label=to_char(created_at at time zone 'UTC','YYYY-MM-DD-HH24MISS')
where version_label is null
  and locked_at is null;

create or replace function public.gridex_create_legal_template_version(
  p_module_key text,p_version_label text,p_title text,p_body text,
  p_publish boolean default false,p_actor_user_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_template_id uuid; v_version_id uuid; v_number integer; v_hash text;
  v_variables text[];
begin
  if nullif(btrim(p_module_key),'') is null or nullif(btrim(p_title),'') is null or nullif(btrim(p_body),'') is null then
    raise exception using errcode='22023',message='module_title_body_required';
  end if;
  select id into v_template_id from public.legal_templates
  where module_key=p_module_key and status='active';
  if v_template_id is null then
    raise exception using errcode='P0002',message='canonical_legal_module_not_found';
  end if;

  v_hash:=encode(digest(btrim(p_title)||E'\n'||p_body,'sha256'),'hex');
  select id into v_version_id from public.legal_template_versions
  where legal_template_id=v_template_id and content_sha256=v_hash limit 1;
  if v_version_id is not null then return v_version_id; end if;

  select coalesce(max(version_number),0)+1 into v_number
  from public.legal_template_versions where legal_template_id=v_template_id;
  select coalesce(array_agg(distinct m[1] order by m[1]),'{}'::text[]) into v_variables
  from regexp_matches(p_title||E'\n'||p_body,'\{\{[[:space:]]*([a-zA-Z0-9_.-]+)[[:space:]]*\}\}','g') as m;

  insert into public.legal_template_versions(
    legal_template_id,version_number,version_label,title,body,variables,content_sha256,status,
    reviewed_by,reviewed_at,published_at,locked_at,created_by
  ) values(
    v_template_id,v_number,coalesce(nullif(btrim(p_version_label),''),v_number::text),btrim(p_title),p_body,
    v_variables,v_hash,case when p_publish then 'published' else 'draft' end,
    case when p_publish then p_actor_user_id end,case when p_publish then now() end,
    case when p_publish then now() end,case when p_publish then now() end,p_actor_user_id
  ) returning id into v_version_id;
  return v_version_id;
end $$;

create or replace function public.gridex_update_draft_legal_template_version(
  p_version_id uuid,p_title text,p_body text,p_actor_user_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare v_hash text; v_variables text[];
begin
  if nullif(btrim(p_title),'') is null or nullif(btrim(p_body),'') is null then
    raise exception using errcode='22023',message='title_body_required';
  end if;
  v_hash:=encode(digest(btrim(p_title)||E'\n'||p_body,'sha256'),'hex');
  select coalesce(array_agg(distinct m[1] order by m[1]),'{}'::text[]) into v_variables
  from regexp_matches(p_title||E'\n'||p_body,'\{\{[[:space:]]*([a-zA-Z0-9_.-]+)[[:space:]]*\}\}','g') as m;
  update public.legal_template_versions
  set title=btrim(p_title),body=p_body,variables=v_variables,content_sha256=v_hash,reviewed_by=null,
      reviewed_at=null
  where id=p_version_id and status='draft' and locked_at is null;
  if not found then raise exception using errcode='55000',message='only_unlocked_draft_template_can_be_updated'; end if;
  return p_version_id;
end $$;

create or replace function public.gridex_publish_legal_template_version(
  p_version_id uuid,p_actor_user_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  update public.legal_template_versions
  set status='published',reviewed_by=p_actor_user_id,reviewed_at=now(),published_at=now(),locked_at=now()
  where id=p_version_id and status in('draft','review') and locked_at is null;
  if not found then
    if exists(select 1 from public.legal_template_versions where id=p_version_id and status='published' and locked_at is not null) then
      return p_version_id;
    end if;
    raise exception using errcode='55000',message='legal_template_version_not_publishable';
  end if;
  return p_version_id;
end $$;

create or replace function public.gridex_archive_draft_legal_template_version(p_version_id uuid)
returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  update public.legal_template_versions set status='archived'
  where id=p_version_id and status in('draft','review') and locked_at is null;
  if not found then raise exception using errcode='55000',message='published_legal_template_is_immutable'; end if;
  return p_version_id;
end $$;

create or replace function public.gridex_create_tenant_legal_override(
  p_company_id uuid,p_module_key text,p_legal_mode text,p_version_label text,p_title text,p_body text,
  p_publish boolean default false,p_actor_user_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare v_id uuid; v_hash text;
begin
  if p_company_id is null or nullif(btrim(p_module_key),'') is null or nullif(btrim(p_title),'') is null or nullif(btrim(p_body),'') is null then
    raise exception using errcode='22023',message='company_module_title_body_required';
  end if;
  if p_legal_mode not in('addendum','replacement') then
    raise exception using errcode='22023',message='invalid_tenant_legal_mode';
  end if;
  if not exists(select 1 from public.companies where id=p_company_id) then
    raise exception using errcode='P0002',message='company_not_found';
  end if;
  if not exists(select 1 from public.legal_templates where module_key=p_module_key and status='active') then
    raise exception using errcode='P0002',message='canonical_legal_module_not_found';
  end if;
  v_hash:=encode(digest(btrim(p_title)||E'\n'||p_body,'sha256'),'hex');
  select id into v_id from public.tenant_legal_overrides
  where company_id=p_company_id and module_key=p_module_key and content_sha256=v_hash limit 1;
  if v_id is not null then return v_id; end if;
  insert into public.tenant_legal_overrides(
    company_id,module_key,legal_mode,version_label,title,body,content_sha256,status,submitted_at,
    reviewed_at,reviewed_by,locked_at,created_by
  ) values(
    p_company_id,p_module_key,p_legal_mode,
    coalesce(nullif(btrim(p_version_label),''),to_char(now() at time zone 'UTC','YYYY-MM-DD-HH24MISS')),
    btrim(p_title),p_body,v_hash,
    case when p_publish then 'published' else 'draft' end,
    case when p_publish then now() end,case when p_publish then now() end,
    case when p_publish then p_actor_user_id end,case when p_publish then now() end,p_actor_user_id
  ) returning id into v_id;
  return v_id;
end $$;

create or replace function public.gridex_publish_tenant_legal_override(
  p_company_id uuid,p_override_id uuid,p_actor_user_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  update public.tenant_legal_overrides
  set status='published',submitted_at=coalesce(submitted_at,now()),reviewed_at=now(),reviewed_by=p_actor_user_id,locked_at=now()
  where id=p_override_id and company_id=p_company_id and status in('draft','submitted','approved') and locked_at is null;
  if not found then
    if exists(select 1 from public.tenant_legal_overrides where id=p_override_id and company_id=p_company_id and status='published' and locked_at is not null) then
      return p_override_id;
    end if;
    raise exception using errcode='55000',message='tenant_legal_override_not_publishable';
  end if;
  return p_override_id;
end $$;

create or replace function public.gridex_archive_draft_tenant_legal_override(
  p_company_id uuid,p_override_id uuid
) returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  update public.tenant_legal_overrides set status='archived'
  where id=p_override_id and company_id=p_company_id and status in('draft','submitted','approved','rejected') and locked_at is null;
  if not found then raise exception using errcode='55000',message='published_tenant_legal_override_is_immutable'; end if;
  return p_override_id;
end $$;

create or replace view public.canonical_legal_template_versions_v
with (security_invoker=true)
as
select
  v.id,t.module_key as type,coalesce(v.version_label,v.version_number::text) as version,
  v.title,v.body,v.status,v.published_at,v.created_at,
  coalesce(v.reviewed_at,v.created_at) as updated_at,
  jsonb_build_object('origin','platform_template','template_key',t.module_key,'template_version',v.version_number,'content_sha256',v.content_sha256) as metadata
from public.legal_template_versions v
join public.legal_templates t on t.id=v.legal_template_id;

create or replace view public.canonical_tenant_legal_overrides_v
with (security_invoker=true)
as
select
  o.id,o.company_id,o.module_key as type,
  coalesce(o.version_label,to_char(o.created_at at time zone 'UTC','YYYY-MM-DD-HH24MISS'),left(o.content_sha256,12)) as version,
  o.title,o.body,
  case when o.status in('published','approved') then 'published'
       when o.status in('archived','replaced','rejected') then 'archived' else 'draft' end as status,
  case when o.status in('published','approved') then coalesce(o.reviewed_at,o.created_at) end as published_at,
  o.created_at,coalesce(o.reviewed_at,o.created_at) as updated_at,
  jsonb_build_object('origin','tenant_override','legal_mode',o.legal_mode,'content_sha256',o.content_sha256,'canonical_status',o.status) as metadata
from public.tenant_legal_overrides o;

-- Canonical publisher: legacy legal_bundle_id is no longer written or selected.
create or replace function public.gridex_publish_contract_version(
  p_company_id uuid,p_draft_contract_id uuid,p_offer_code text,p_payload jsonb,p_pricing_snapshot jsonb,p_actor_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_result jsonb; v_publication_id uuid; v_readiness jsonb; v_message text; v_codes text[];
  v_payload jsonb:=coalesce(p_payload,'{}'::jsonb); v_legal_result jsonb:='{}'::jsonb;
  v_publish boolean; v_correlation_id text; v_audit_metadata jsonb;
  v_profile_status text; v_profile_missing_fields text[]; v_profile_review_required boolean;
  v_error_code text; v_user_message text;
begin
  begin
    if p_company_id is null or p_actor_user_id is null then raise exception using errcode='22023',message='company_and_actor_required'; end if;
    v_publish:=coalesce(v_payload->>'publication_status','draft')='published';
    v_correlation_id:=coalesce(nullif(v_payload#>>'{metadata,correlation_id}',''),gen_random_uuid()::text);

    if v_publish then
      select completeness_status,missing_fields,coalesce(review_required,false)
      into v_profile_status,v_profile_missing_fields,v_profile_review_required
      from public.tenant_legal_profiles where company_id=p_company_id;
      if not found then raise exception using errcode='23514',message='publication_not_ready:tenant_legal_profile_missing'; end if;
      if v_profile_status not in('complete','verified') or v_profile_review_required then
        v_codes:=array_remove(array[
          case when v_profile_status not in('complete','verified') then 'tenant_legal_profile_incomplete' end,
          case when v_profile_review_required then 'tenant_legal_profile_review_required' end
        ],null);
        select v_codes||coalesce(array_agg('missing_legal_profile_field:'||field order by field),'{}')
        into v_codes from unnest(coalesce(v_profile_missing_fields,'{}')) field;
        raise exception using errcode='23514',message='publication_not_ready:'||array_to_string(v_codes,',');
      end if;
    end if;

    v_payload:=jsonb_set(
      v_payload,'{metadata}',coalesce(v_payload->'metadata','{}'::jsonb)||jsonb_build_object(
        'correlation_id',v_correlation_id,
        'publication_command','gridex_publish_contract_version',
        'publication_command_version','2026-07-16.2',
        'legal_source','legal_template_versions'
      ),true
    )-'legal_bundle_id';

    if v_publish then
      v_legal_result:=public.gridex_resolve_or_create_legal_source_bundle(
        p_company_id,v_payload,coalesce(p_pricing_snapshot,'{}'::jsonb),p_actor_user_id
      );
    end if;

    v_result:=public.gridex_upsert_public_contract_offer(
      p_company_id,p_draft_contract_id,p_offer_code,v_payload,coalesce(p_pricing_snapshot,'{}'::jsonb),p_actor_user_id
    );
    v_publication_id:=nullif(v_result->>'contract_publication_version_id','')::uuid;

    if v_publication_id is not null then
      select jsonb_build_object(
        'status',readiness_status,'can_display',can_display,'can_accept_applications',can_accept_applications,
        'blockers',blockers,'display_blockers',display_blockers,'application_blockers',application_blockers,
        'legal_profile_missing_fields',legal_profile_missing_fields,'required_legal_modules',required_legal_modules,
        'included_legal_modules',included_legal_modules
      ) into v_readiness
      from public.contract_publication_readiness_v
      where contract_publication_version_id=v_publication_id;
    end if;

    v_audit_metadata:=jsonb_strip_nulls(jsonb_build_object(
      'correlation_id',v_correlation_id,
      'offer_reference',v_result->>'offer_reference',
      'contract_publication_version_id',v_publication_id,
      'price_plan_id',v_result#>>'{pricing,price_plan_id}',
      'price_plan_version_id',v_result#>>'{pricing,price_plan_version_id}',
      'price_book_id',v_result#>>'{pricing,price_book_id}',
      'pricing_snapshot_sha256',v_result#>>'{pricing,content_sha256}',
      'legal_bundle_version_id',v_result#>>'{offer,legal_bundle_version_id}',
      'legal_source','legal_template_versions',
      'readiness',coalesce(v_readiness,'{}'::jsonb)
    ));

    insert into public.audit_logs(company_id,actor_user_id,entity_type,entity_id,action,old_values,new_values,metadata)
    values(
      p_company_id,p_actor_user_id,'contract_publication_version',
      coalesce(v_publication_id::text,v_result#>>'{offer,id}',coalesce(p_draft_contract_id::text,'unknown')),
      case when v_publish then 'contract.publication.atomic_published' else 'contract.publication.atomic_draft_saved' end,
      null,v_result,v_audit_metadata
    );

    return coalesce(v_result,'{}'::jsonb)||jsonb_build_object(
      'ok',true,'readiness',coalesce(v_readiness,'{}'::jsonb),
      'correlation_id',v_correlation_id,'legal_source','legal_template_versions'
    );
  exception when others then
    v_message:=sqlerrm;
    v_correlation_id:=coalesce(v_correlation_id,gen_random_uuid()::text);
    if v_message like 'publication_not_ready:%' then
      v_error_code:='publication_not_ready'; v_user_message:='Avtalet kan inte publiceras ännu.';
      v_codes:=string_to_array(substring(v_message from length('publication_not_ready:')+1),',');
    elsif v_message like 'legal_requirement_rule_missing:%' then
      v_error_code:='legal_requirement_rule_missing'; v_user_message:='Juridikregler saknas för vald kund- eller avtalstyp.'; v_codes:=array[v_message];
    elsif v_message like 'canonical_legal_template_missing:%' then
      v_error_code:='canonical_legal_template_missing'; v_user_message:='Publicerade juridikmoduler saknas.';
      select coalesce(array_agg('missing_legal_module:'||module_key order by module_key),'{}') into v_codes
      from unnest(string_to_array(substring(v_message from length('canonical_legal_template_missing:')+1),',')) module_key;
    else
      raise;
    end if;

    insert into public.audit_logs(company_id,actor_user_id,entity_type,entity_id,action,old_values,new_values,metadata)
    values(
      p_company_id,p_actor_user_id,'contract_publication_version',coalesce(p_draft_contract_id::text,'blocked'),
      'contract.publication.atomic_blocked',null,null,
      jsonb_build_object('correlation_id',v_correlation_id,'error_code',v_error_code,'blockers',v_codes,'database_message',v_message)
    );
    return jsonb_build_object('ok',false,'error_code',v_error_code,'message',v_user_message,'blockers',v_codes,'correlation_id',v_correlation_id);
  end;
end $$;

-- Canonicalize internal offers without reading or creating legacy legal bundles.
create or replace function public.gridex_sync_internal_offer_to_canonical(p_offer_id uuid)
returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  o public.contract_offers%rowtype;
  v_product_id uuid;
  v_version_id uuid;
  v_assignment_id uuid;
  v_snapshot jsonb;
  v_hash text;
  v_number integer;
  v_required text[];
  v_legal_version_id uuid;
  v_production_enabled boolean := false;
begin
  select * into o
  from public.contract_offers
  where id = p_offer_id
  for update;
  if not found or o.company_id is null then
    return null;
  end if;

  insert into public.contract_products(company_id,product_code,name,product_category,description,status,created_by)
  values(
    o.company_id,
    'internal:' || o.id::text,
    o.name,
    coalesce(o.contract_type,'electricity'),
    o.description,
    case when coalesce(o.is_active,false) and o.status='active' then 'active' else 'paused' end,
    o.created_by
  )
  on conflict(company_id,product_code) where company_id is not null do update
    set name=excluded.name,
        description=excluded.description,
        status=excluded.status,
        updated_at=now()
  returning id into v_product_id;

  v_production_enabled := coalesce((o.commercial_snapshot#>>'{production,enabled}')::boolean,false)
    or coalesce((o.commercial_snapshot->>'production_enabled')::boolean,false);
  v_required := public.gridex_required_legal_modules(
    o.customer_type,
    o.contract_type,
    'internal',
    coalesce(o.automatic_renewal,false),
    coalesce(o.power_of_attorney_required,true),
    v_production_enabled
  );

  v_snapshot := coalesce(o.commercial_snapshot,'{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
    'schema','gridex_internal_contract_v4',
    'legacy_contract_offer_id',o.id,
    'company_id',o.company_id,
    'name',o.name,
    'customer_type',o.customer_type,
    'contract_type',o.contract_type,
    'price_plan_id',o.price_plan_id,
    'price_plan_version_id',o.price_plan_version_id,
    'price_book_id',o.price_book_id,
    'price_version',o.price_version,
    'terms_version',o.terms_version,
    'valid_from',o.valid_from,
    'valid_to',o.valid_to,
    'automatic_renewal',o.automatic_renewal,
    'power_of_attorney_required',o.power_of_attorney_required,
    'required_legal_modules',v_required,
    'legal_source','legal_template_versions'
  ));
  v_hash := encode(digest(v_snapshot::text,'sha256'),'hex');

  select id into v_version_id
  from public.contract_product_versions
  where contract_product_id = v_product_id
    and content_sha256 = v_hash
  limit 1;

  if v_version_id is null then
    select coalesce(max(version_number),0)+1 into v_number
    from public.contract_product_versions
    where contract_product_id = v_product_id;

    insert into public.contract_product_versions(
      contract_product_id,version_number,customer_type,contract_type,pricing_model,
      price_plan_id,price_plan_version_id,binding_months,notice_months,price_areas,
      automatic_renewal,power_of_attorney_required,required_legal_modules,
      commercial_snapshot,content_sha256,status,approved_at,approved_by,locked_at,created_by
    ) values(
      v_product_id,
      v_number,
      o.customer_type,
      o.contract_type,
      coalesce(v_snapshot->>'pricing_model',o.contract_type),
      o.price_plan_id,
      o.price_plan_version_id,
      o.default_binding_months,
      o.default_notice_months,
      coalesce(array(select jsonb_array_elements_text(coalesce(v_snapshot->'price_areas','[]'::jsonb))),'{}'::text[]),
      coalesce(o.automatic_renewal,false),
      coalesce(o.power_of_attorney_required,true),
      v_required,
      v_snapshot,
      v_hash,
      case when o.is_active and o.status='active' then 'approved' else 'draft' end,
      case when o.is_active and o.status='active' then now() end,
      case when o.is_active and o.status='active' then o.updated_by end,
      case when o.is_active and o.status='active' then now() end,
      o.created_by
    ) returning id into v_version_id;
  end if;

  if o.is_active and o.status='active' then
    perform set_config('gridex.version_transition','on',true);
    update public.contract_product_versions
    set status='approved',
        approved_at=coalesce(approved_at,now()),
        approved_by=coalesce(approved_by,o.updated_by),
        locked_at=coalesce(locked_at,now())
    where id=v_version_id
      and (status<>'approved' or locked_at is null);

    update public.tenant_contract_assignments ta
    set status='ended',valid_to=coalesce(valid_to,current_date),updated_at=now()
    from public.contract_product_versions pv
    where pv.id=ta.contract_product_version_id
      and ta.company_id=o.company_id
      and pv.contract_product_id=v_product_id
      and ta.contract_product_version_id<>v_version_id
      and ta.status='active';

    v_legal_version_id := public.gridex_materialize_legal_bundle_version(
      o.company_id,v_version_id,null,o.updated_by
    );
    if exists(
      select 1 from public.legal_bundle_versions
      where id=v_legal_version_id and cardinality(unresolved_variables)>0
    ) then
      raise exception using errcode='23514',message='internal_offer_legal_documents_not_ready';
    end if;
    perform set_config('gridex.version_transition','on',true);
    update public.legal_bundle_versions
    set status='published',published_at=coalesce(published_at,now()),locked_at=coalesce(locked_at,now())
    where id=v_legal_version_id and locked_at is null;
  else
    v_legal_version_id := o.legal_bundle_version_id;
  end if;

  insert into public.tenant_contract_assignments(
    company_id,contract_product_version_id,internal_sales_allowed,website_publication_allowed,
    status,legal_mode,valid_from,valid_to,assigned_by
  ) values(
    o.company_id,v_version_id,true,false,
    case when o.is_active and o.status='active' then 'active' else 'paused' end,
    coalesce((select legal_mode from public.legal_bundle_versions where id=v_legal_version_id),'ops_standard'),
    o.valid_from,o.valid_to,o.updated_by
  )
  on conflict(company_id,contract_product_version_id) do update
    set internal_sales_allowed=true,
        status=excluded.status,
        legal_mode=excluded.legal_mode,
        valid_from=excluded.valid_from,
        valid_to=excluded.valid_to,
        updated_at=now()
  returning id into v_assignment_id;

  insert into public.tenant_contract_channels(
    assignment_id,channel,status,valid_from,valid_to,marketing_content,updated_by
  ) values(
    v_assignment_id,'internal',
    case when o.is_active and o.status='active' then 'active' else 'paused' end,
    o.valid_from::timestamptz,o.valid_to::timestamptz,
    jsonb_build_object('name',o.name,'source_of_truth','contract_product_versions'),
    o.updated_by
  )
  on conflict(assignment_id,channel) do update
    set status=excluded.status,
        valid_from=excluded.valid_from,
        valid_to=excluded.valid_to,
        marketing_content=excluded.marketing_content,
        updated_by=excluded.updated_by,
        updated_at=now();

  update public.contract_offers
  set contract_product_id=v_product_id,
      contract_product_version_id=v_version_id,
      legal_bundle_version_id=v_legal_version_id,
      legal_bundle_id=null,
      updated_at=now()
  where id=o.id;

  return v_version_id;
end $$;

create or replace function public.gridex_upsert_internal_contract_offer(
  p_company_id uuid,p_offer_id uuid,p_payload jsonb,p_pricing_snapshot jsonb,p_actor_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_old public.contract_offers%rowtype;
  v_saved public.contract_offers%rowtype;
  v_pricing jsonb;
  v_new_id uuid;
  v_active boolean;
  v_status text;
  v_customer_type text;
  v_slug text;
  v_version integer;
  v_canonical uuid;
  v_identity uuid;
begin
  if p_company_id is null then
    raise exception using errcode='22023',message='company_required';
  end if;
  if p_offer_id is not null then
    select * into v_old
    from public.contract_offers
    where id=p_offer_id and company_id=p_company_id
    for update;
    if not found then
      raise exception using errcode='P0002',message='internal_contract_offer_not_found';
    end if;
  end if;

  v_status := coalesce(nullif(p_payload->>'status',''),'draft');
  v_active := coalesce((p_payload->>'is_active')::boolean,false) and v_status='active';
  v_customer_type := coalesce(nullif(p_payload->>'customer_type',''),'both');
  if v_status not in ('draft','active','inactive') then
    raise exception using errcode='22023',message='invalid_internal_contract_status';
  end if;
  if v_customer_type not in ('private','business','both') then
    raise exception using errcode='22023',message='invalid_customer_type';
  end if;

  v_identity := coalesce(v_old.id,gen_random_uuid());
  p_pricing_snapshot := coalesce(p_pricing_snapshot,'{}'::jsonb) || jsonb_build_object(
    'plan_code','internal-'||v_identity::text,
    'product_key','internal-'||v_identity::text
  );
  v_pricing := public.gridex_create_or_version_contract_pricing(
    p_company_id,
    p_payload->>'name',
    p_payload->>'contract_type',
    coalesce(p_payload->>'pricing_model','spot'),
    v_customer_type,
    p_pricing_snapshot,
    nullif(p_payload->>'valid_from','')::date,
    nullif(p_payload->>'valid_to','')::date,
    v_active,
    p_actor_user_id
  );
  v_slug := coalesce(
    nullif(p_payload->>'slug',''),
    lower(trim(both '-' from regexp_replace(p_payload->>'name','[^a-zA-Z0-9]+','-','g')))
  );

  if v_old.id is not null and (
    v_old.status='active'
    or exists(select 1 from public.customer_contracts where company_id=p_company_id and contract_offer_id=v_old.id)
  ) then
    update public.contract_offers
    set status='inactive',is_active=false,archived_at=coalesce(archived_at,now()),updated_by=p_actor_user_id,updated_at=now()
    where id=v_old.id;
    v_new_id:=gen_random_uuid();
    v_version:=coalesce(v_old.version_number,1)+1;
    v_slug:=left(v_slug,105)||'-v'||v_version;
  else
    v_new_id:=coalesce(v_old.id,gen_random_uuid());
    v_version:=coalesce(v_old.version_number,1);
  end if;

  insert into public.contract_offers(
    id,company_id,name,slug,status,contract_type,customer_type,campaign_name,campaign_code,campaign_version,
    price_version,terms_version,offer_version,version_number,version_snapshot,max_customers,discount_value,
    discount_unit,start_fee_sek,admin_fee_sek,break_fee_sek,vat_rate,description,fixed_price_ore_per_kwh,
    spot_markup_ore_per_kwh,variable_fee_ore_per_kwh,monthly_fee_sek,green_fee_mode,green_fee_value,
    default_binding_months,default_notice_months,optional_fee_lines,is_active,valid_from,valid_to,
    price_plan_id,price_plan_version_id,price_book_id,commercial_snapshot,automatic_renewal,
    power_of_attorney_required,legal_bundle_id,last_price_change_at,created_by,updated_by
  ) values(
    v_new_id,p_company_id,p_payload->>'name',v_slug,v_status,p_payload->>'contract_type',v_customer_type,
    nullif(p_payload->>'campaign_name',''),nullif(p_payload->>'campaign_code',''),nullif(p_payload->>'campaign_version',''),
    v_pricing->>'version_label',nullif(p_payload->>'terms_version',''),
    coalesce(nullif(p_payload->>'terms_version',''),v_pricing->>'version_label','v1'),v_version,
    jsonb_build_object(
      'model','canonical_price_plan_version',
      'price_plan_id',v_pricing->>'price_plan_id',
      'price_plan_version_id',v_pricing->>'price_plan_version_id',
      'price_book_id',v_pricing->>'price_book_id',
      'pricing_snapshot',p_pricing_snapshot,
      'legal_source','legal_template_versions'
    ),
    nullif(p_payload->>'max_customers','')::integer,
    nullif(p_payload->>'discount_value','')::numeric,
    nullif(p_payload->>'discount_unit',''),
    nullif(p_payload->>'start_fee_sek','')::numeric,
    nullif(p_payload->>'admin_fee_sek','')::numeric,
    nullif(p_payload->>'break_fee_sek','')::numeric,
    coalesce(nullif(p_payload->>'vat_rate','')::numeric,25),
    nullif(p_payload->>'description',''),
    nullif(p_payload->>'fixed_price_ore_per_kwh','')::numeric,
    nullif(p_payload->>'spot_markup_ore_per_kwh','')::numeric,
    nullif(p_payload->>'variable_fee_ore_per_kwh','')::numeric,
    nullif(p_payload->>'monthly_fee_sek','')::numeric,
    coalesce(nullif(p_payload->>'green_fee_mode',''),'none'),
    nullif(p_payload->>'green_fee_value','')::numeric,
    nullif(p_payload->>'default_binding_months','')::integer,
    nullif(p_payload->>'default_notice_months','')::integer,
    coalesce(p_payload->'optional_fee_lines','[]'::jsonb),
    v_active,
    nullif(p_payload->>'valid_from','')::date,
    nullif(p_payload->>'valid_to','')::date,
    (v_pricing->>'price_plan_id')::uuid,
    (v_pricing->>'price_plan_version_id')::uuid,
    nullif(v_pricing->>'price_book_id','')::uuid,
    p_pricing_snapshot,
    coalesce((p_payload->>'automatic_renewal')::boolean,false),
    coalesce((p_payload->>'power_of_attorney_required')::boolean,true),
    null,
    case when coalesce((v_pricing->>'reused')::boolean,false)
      then coalesce(v_old.last_price_change_at,now()) else now() end,
    p_actor_user_id,p_actor_user_id
  )
  on conflict(id) do update set
    name=excluded.name,slug=excluded.slug,status=excluded.status,contract_type=excluded.contract_type,
    customer_type=excluded.customer_type,campaign_name=excluded.campaign_name,campaign_code=excluded.campaign_code,
    campaign_version=excluded.campaign_version,price_version=excluded.price_version,terms_version=excluded.terms_version,
    offer_version=excluded.offer_version,version_snapshot=excluded.version_snapshot,max_customers=excluded.max_customers,
    discount_value=excluded.discount_value,discount_unit=excluded.discount_unit,start_fee_sek=excluded.start_fee_sek,
    admin_fee_sek=excluded.admin_fee_sek,break_fee_sek=excluded.break_fee_sek,vat_rate=excluded.vat_rate,
    description=excluded.description,fixed_price_ore_per_kwh=excluded.fixed_price_ore_per_kwh,
    spot_markup_ore_per_kwh=excluded.spot_markup_ore_per_kwh,variable_fee_ore_per_kwh=excluded.variable_fee_ore_per_kwh,
    monthly_fee_sek=excluded.monthly_fee_sek,green_fee_mode=excluded.green_fee_mode,green_fee_value=excluded.green_fee_value,
    default_binding_months=excluded.default_binding_months,default_notice_months=excluded.default_notice_months,
    optional_fee_lines=excluded.optional_fee_lines,is_active=excluded.is_active,valid_from=excluded.valid_from,
    valid_to=excluded.valid_to,price_plan_id=excluded.price_plan_id,price_plan_version_id=excluded.price_plan_version_id,
    price_book_id=excluded.price_book_id,commercial_snapshot=excluded.commercial_snapshot,
    automatic_renewal=excluded.automatic_renewal,power_of_attorney_required=excluded.power_of_attorney_required,
    legal_bundle_id=null,last_price_change_at=excluded.last_price_change_at,updated_by=excluded.updated_by,updated_at=now()
  returning * into v_saved;

  v_canonical := public.gridex_sync_internal_offer_to_canonical(v_saved.id);
  select * into v_saved from public.contract_offers where id=v_saved.id;
  return jsonb_build_object(
    'offer',to_jsonb(v_saved),
    'pricing',v_pricing,
    'contract_product_version_id',v_canonical,
    'created_new_version',v_old.id is not null and v_saved.id<>v_old.id,
    'legal_source','legal_template_versions'
  );
end $$;


-- Prepare an immutable one-off publication for manual/API/import contracts.
-- The compatibility offer is archived immediately and is never shown as an
-- active reusable sales template; the returned canonical versions remain locked.
create or replace function public.gridex_prepare_manual_contract_binding(
  p_company_id uuid,
  p_payload jsonb,
  p_pricing_snapshot jsonb,
  p_actor_user_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_identity uuid := gen_random_uuid();
  v_saved jsonb;
  v_offer_id uuid;
  v_publication_id uuid;
  v_publication public.contract_publication_versions%rowtype;
  v_product public.contract_product_versions%rowtype;
  v_legal public.legal_bundle_versions%rowtype;
begin
  if p_company_id is null then
    raise exception using errcode='22023',message='company_required';
  end if;

  p_payload := coalesce(p_payload,'{}'::jsonb) || jsonb_build_object(
    'name',coalesce(nullif(p_payload->>'name',''),'Kundspecifikt avtal'),
    'slug','one-off-' || replace(v_identity::text,'-',''),
    'status','active',
    'is_active',true,
    'customer_type',coalesce(nullif(p_payload->>'customer_type',''),'both'),
    'contract_type',coalesce(nullif(p_payload->>'contract_type',''),'variable_hourly'),
    'campaign_code',coalesce(nullif(p_payload->>'campaign_code',''),'ONE_OFF'),
    'campaign_version',coalesce(nullif(p_payload->>'campaign_version',''),'v1'),
    'terms_version',coalesce(nullif(p_payload->>'terms_version',''),'canonical')
  );
  p_pricing_snapshot := coalesce(p_pricing_snapshot,'{}'::jsonb) || jsonb_build_object(
    'one_off',true,
    'one_off_identity',v_identity,
    'source_of_truth','price_plan_versions'
  );

  v_saved := public.gridex_upsert_internal_contract_offer(
    p_company_id,null,p_payload,p_pricing_snapshot,p_actor_user_id
  );
  v_offer_id := nullif(v_saved#>>'{offer,id}','')::uuid;
  if v_offer_id is null then
    raise exception using errcode='P0001',message='one_off_offer_creation_failed';
  end if;

  v_publication_id := public.gridex_ensure_internal_contract_publication(
    p_company_id,v_offer_id,p_actor_user_id
  );
  select * into v_publication
  from public.contract_publication_versions
  where id=v_publication_id and status='published' and locked_at is not null;
  if not found then
    raise exception using errcode='23514',message='one_off_publication_not_locked';
  end if;

  select * into v_product
  from public.contract_product_versions
  where id=v_publication.contract_product_version_id and status='approved' and locked_at is not null;
  if not found then
    raise exception using errcode='23514',message='one_off_product_version_not_locked';
  end if;
  select * into v_legal
  from public.legal_bundle_versions
  where id=v_publication.legal_bundle_version_id and status='published' and locked_at is not null;
  if not found or cardinality(v_legal.unresolved_variables)>0 then
    raise exception using errcode='23514',message='one_off_legal_version_not_ready';
  end if;

  update public.contract_offers
  set status='inactive',is_active=false,archived_at=coalesce(archived_at,now()),updated_at=now(),updated_by=p_actor_user_id
  where id=v_offer_id;

  return jsonb_build_object(
    'contract_offer_id',v_offer_id,
    'contract_product_id',v_product.contract_product_id,
    'contract_product_version_id',v_product.id,
    'contract_publication_version_id',v_publication.id,
    'price_plan_id',v_publication.price_plan_id,
    'price_plan_version_id',v_publication.price_plan_version_id,
    'price_book_id',v_publication.price_book_id,
    'legal_bundle_version_id',v_publication.legal_bundle_version_id,
    'offer_reference',v_publication.offer_reference,
    'commercial_snapshot',v_product.commercial_snapshot,
    'legal_snapshot',v_legal.rendered_snapshot,
    'source_of_truth','contract_publication_versions'
  );
end $$;


-- -----------------------------------------------------------------------------
-- Internal contract compatibility becomes read-only. All app reads can use this
-- canonical view while writes continue through gridex_upsert_internal_contract_offer.
-- -----------------------------------------------------------------------------
create or replace view public.canonical_internal_contract_offers_v
with (security_invoker=true)
as
select
  o.*,
  pv.required_legal_modules,
  pv.commercial_snapshot as canonical_commercial_snapshot,
  pv.status as canonical_version_status,
  pv.locked_at as canonical_version_locked_at,
  lbv.status as canonical_legal_status,
  lbv.locked_at as canonical_legal_locked_at
from public.contract_offers o
left join public.contract_product_versions pv on pv.id=o.contract_product_version_id
left join public.legal_bundle_versions lbv on lbv.id=o.legal_bundle_version_id;

-- Materialize an internal publication version so customer contracts created in
-- OPS also carry an exact immutable publication reference.
create or replace function public.gridex_ensure_internal_contract_publication(
  p_company_id uuid,p_contract_offer_id uuid,p_actor_user_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  o public.contract_offers%rowtype; v_assignment_id uuid; v_publication_id uuid; v_version_id uuid;
  v_snapshot jsonb; v_hash text; v_number integer; v_status text; v_offer_reference text;
begin
  select * into o from public.contract_offers
  where id=p_contract_offer_id and company_id=p_company_id for update;
  if not found then raise exception using errcode='P0002',message='internal_contract_offer_not_found'; end if;

  if o.contract_product_version_id is null or o.legal_bundle_version_id is null or o.price_plan_version_id is null then
    perform public.gridex_sync_internal_offer_to_canonical(o.id);
    select * into o from public.contract_offers where id=o.id;
  end if;
  if o.contract_product_version_id is null or o.legal_bundle_version_id is null or o.price_plan_version_id is null then
    raise exception using errcode='23514',message='internal_offer_not_canonical_ready';
  end if;

  select id into v_assignment_id from public.tenant_contract_assignments
  where company_id=p_company_id and contract_product_version_id=o.contract_product_version_id
  order by created_at desc limit 1;
  if v_assignment_id is null then
    insert into public.tenant_contract_assignments(
      company_id,contract_product_version_id,internal_sales_allowed,website_publication_allowed,status,legal_mode,valid_from,valid_to,assigned_by
    ) values(
      p_company_id,o.contract_product_version_id,true,false,
      case when o.is_active and o.status='active' then 'active' else 'paused' end,
      'ops_standard',o.valid_from,o.valid_to,p_actor_user_id
    ) returning id into v_assignment_id;
  end if;

  insert into public.contract_publications(assignment_id,channel,status,created_by)
  values(v_assignment_id,'internal',case when o.is_active and o.status='active' then 'published' else 'draft' end,p_actor_user_id)
  on conflict(assignment_id,channel) do update
    set status=excluded.status,updated_at=now()
  returning id into v_publication_id;

  v_status:=case when o.is_active and o.status='active' then 'published' else 'draft' end;
  v_snapshot:=jsonb_strip_nulls(jsonb_build_object(
    'schema','gridex_internal_publication_v1',
    'company_id',p_company_id,
    'legacy_contract_offer_id',o.id,
    'contract_product_version_id',o.contract_product_version_id,
    'price_plan_id',o.price_plan_id,
    'price_plan_version_id',o.price_plan_version_id,
    'legal_bundle_version_id',o.legal_bundle_version_id,
    'name',o.name,
    'customer_type',o.customer_type,
    'contract_type',o.contract_type,
    'valid_from',o.valid_from,
    'valid_to',o.valid_to
  ));
  v_hash:=encode(digest(v_snapshot::text,'sha256'),'hex');
  select id into v_version_id
  from public.contract_publication_versions
  where contract_publication_id=v_publication_id and content_sha256=v_hash limit 1;

  if v_version_id is null then
    select coalesce(max(version_number),0)+1 into v_number
    from public.contract_publication_versions where contract_publication_id=v_publication_id;
    v_offer_reference:='internal_'||replace(o.id::text,'-','')||'_v'||v_number::text;
    insert into public.contract_publication_versions(
      contract_publication_id,version_number,contract_product_version_id,price_plan_id,price_plan_version_id,
      price_book_id,legal_bundle_version_id,legacy_public_contract_offer_id,customer_type,channel,
      valid_from,valid_to,publication_snapshot,offer_reference,content_sha256,status,
      published_at,locked_at,created_by
    ) values(
      v_publication_id,v_number,o.contract_product_version_id,o.price_plan_id,o.price_plan_version_id,
      o.price_book_id,o.legal_bundle_version_id,null,coalesce(o.customer_type,'both'),'internal',
      o.valid_from::timestamptz,o.valid_to::timestamptz,v_snapshot,v_offer_reference,v_hash,v_status,
      case when v_status='published' then now() end,case when v_status='published' then now() end,p_actor_user_id
    ) returning id into v_version_id;
  elsif v_status='published' then
    perform set_config('gridex.version_transition','on',true);
    update public.contract_publication_versions set status='published',published_at=coalesce(published_at,now()),locked_at=coalesce(locked_at,now())
    where id=v_version_id;
  end if;

  return v_version_id;
end $$;

-- Best-effort canonical backfill before strict transition guards are enabled.
-- Rows that cannot be repaired are kept readable and receive a diagnostic in
-- metadata; they cannot progress to a new legal status until explicitly fixed.
do $$
declare
  r record;
  v_publication_id uuid;
begin
  for r in
    select id,company_id,contract_offer_id,coalesce(created_by,updated_by) as actor_user_id
    from public.customer_contracts
    where contract_publication_version_id is null and contract_offer_id is not null
  loop
    begin
      v_publication_id:=public.gridex_ensure_internal_contract_publication(
        r.company_id,r.contract_offer_id,r.actor_user_id
      );
      update public.customer_contracts c
      set contract_publication_version_id=pub.id,
          contract_product_version_id=product_version.id,
          contract_product_id=product_version.contract_product_id,
          price_plan_id=pub.price_plan_id,
          price_plan_version_id=pub.price_plan_version_id,
          price_book_id=pub.price_book_id,
          legal_bundle_version_id=pub.legal_bundle_version_id,
          offer_reference=coalesce(c.offer_reference,pub.offer_reference),
          commercial_snapshot=product_version.commercial_snapshot,
          legal_snapshot=(select rendered_snapshot from public.legal_bundle_versions where id=pub.legal_bundle_version_id),
          metadata=coalesce(c.metadata,'{}'::jsonb)||jsonb_build_object('canonical_backfilled_at',now()),
          updated_at=now()
      from public.contract_publication_versions pub
      join public.contract_product_versions product_version on product_version.id=pub.contract_product_version_id
      where c.id=r.id and pub.id=v_publication_id;
    exception when others then
      update public.customer_contracts
      set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'canonical_backfill_status','blocked',
        'canonical_backfill_error',sqlerrm,
        'canonical_backfill_attempted_at',now()
      )
      where id=r.id;
    end;
  end loop;

  update public.customer_contracts c
  set contract_publication_version_id=pub.id,
      contract_product_version_id=product_version.id,
      contract_product_id=product_version.contract_product_id,
      price_plan_id=pub.price_plan_id,
      price_plan_version_id=pub.price_plan_version_id,
      price_book_id=pub.price_book_id,
      legal_bundle_version_id=pub.legal_bundle_version_id,
      offer_reference=coalesce(c.offer_reference,pub.offer_reference),
      commercial_snapshot=product_version.commercial_snapshot,
      legal_snapshot=legal_version.rendered_snapshot,
      metadata=coalesce(c.metadata,'{}'::jsonb)||jsonb_build_object('canonical_backfilled_at',now()),
      updated_at=now()
  from public.public_contract_offers offer
  join public.contract_publication_versions pub on pub.id=offer.contract_publication_version_id
  join public.contract_product_versions product_version on product_version.id=pub.contract_product_version_id
  join public.legal_bundle_versions legal_version on legal_version.id=pub.legal_bundle_version_id
  where c.contract_publication_version_id is null
    and c.public_contract_offer_id=offer.id
    and c.company_id=offer.company_id;
end $$;

create or replace function public.gridex_bind_internal_customer_contract()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_publication_id uuid; v_publication public.contract_publication_versions%rowtype;
  v_product public.contract_product_versions%rowtype;
begin
  if new.contract_offer_id is null or new.contract_publication_version_id is not null then return new; end if;
  v_publication_id:=public.gridex_ensure_internal_contract_publication(new.company_id,new.contract_offer_id,coalesce(new.created_by,new.updated_by));
  select * into v_publication from public.contract_publication_versions where id=v_publication_id;
  select * into v_product from public.contract_product_versions where id=v_publication.contract_product_version_id;
  new.contract_publication_version_id:=v_publication.id;
  new.contract_product_version_id:=v_product.id;
  new.contract_product_id:=v_product.contract_product_id;
  new.legal_bundle_version_id:=v_publication.legal_bundle_version_id;
  new.price_plan_id:=v_publication.price_plan_id;
  new.price_plan_version_id:=v_publication.price_plan_version_id;
  new.price_book_id:=v_publication.price_book_id;
  new.offer_reference:=coalesce(new.offer_reference,v_publication.offer_reference);
  new.commercial_snapshot:=v_product.commercial_snapshot;
  new.legal_snapshot:=(select rendered_snapshot from public.legal_bundle_versions where id=v_publication.legal_bundle_version_id);
  return new;
end $$;

drop trigger if exists customer_contracts_bind_internal_publication on public.customer_contracts;
create trigger customer_contracts_bind_internal_publication
before insert or update of contract_offer_id on public.customer_contracts
for each row execute function public.gridex_bind_internal_customer_contract();

create or replace function public.gridex_require_customer_contract_canonical_binding()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_requires_binding_check boolean;
begin
  v_requires_binding_check := tg_op='INSERT'
    or old.contract_publication_version_id is not null
    or new.status is distinct from old.status
    or new.signed_at is distinct from old.signed_at
    or new.contract_offer_id is distinct from old.contract_offer_id
    or new.public_contract_offer_id is distinct from old.public_contract_offer_id
    or new.contract_publication_version_id is distinct from old.contract_publication_version_id
    or new.contract_product_version_id is distinct from old.contract_product_version_id
    or new.price_plan_version_id is distinct from old.price_plan_version_id
    or new.legal_bundle_version_id is distinct from old.legal_bundle_version_id;

  if new.status <> 'draft' and v_requires_binding_check then
    if new.contract_publication_version_id is null
       or new.contract_product_version_id is null
       or new.price_plan_version_id is null
       or new.legal_bundle_version_id is null then
      raise exception using errcode='23514',message='customer_contract_canonical_versions_required';
    end if;
  end if;

  if (new.signed_at is not null or new.status in ('signed','active'))
     and (v_requires_binding_check or new.contract_publication_version_id is not null) then
    if coalesce(new.commercial_snapshot,'{}'::jsonb)='{}'::jsonb
       or coalesce(new.legal_snapshot,'{}'::jsonb)='{}'::jsonb then
      raise exception using errcode='23514',message='signed_customer_contract_exact_snapshots_required';
    end if;
    if not exists(
      select 1
      from public.contract_publication_versions cpv
      join public.contract_product_versions ctv on ctv.id=cpv.contract_product_version_id
      join public.price_plan_versions ppv on ppv.id=cpv.price_plan_version_id
      join public.legal_bundle_versions lbv on lbv.id=cpv.legal_bundle_version_id
      join public.contract_publications cp on cp.id=cpv.contract_publication_id
      join public.tenant_contract_assignments ta on ta.id=cp.assignment_id
      where cpv.id=new.contract_publication_version_id
        and ta.company_id=new.company_id
        and cpv.contract_product_version_id=new.contract_product_version_id
        and cpv.price_plan_version_id=new.price_plan_version_id
        and cpv.legal_bundle_version_id=new.legal_bundle_version_id
        and cpv.status='published' and cpv.locked_at is not null
        and ctv.status='approved' and ctv.locked_at is not null
        and ppv.status in('published','approved','active') and ppv.locked_at is not null
        and lbv.status='published' and lbv.locked_at is not null
        and cardinality(lbv.unresolved_variables)=0
    ) then
      raise exception using errcode='23514',message='signed_customer_contract_versions_not_locked';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists zz_customer_contracts_require_canonical_binding on public.customer_contracts;
create trigger zz_customer_contracts_require_canonical_binding
before insert or update of status,signed_at,contract_offer_id,public_contract_offer_id,contract_publication_version_id,contract_product_version_id,price_plan_version_id,legal_bundle_version_id on public.customer_contracts
for each row execute function public.gridex_require_customer_contract_canonical_binding();

-- -----------------------------------------------------------------------------
-- Permanent immutable PDF archive.
-- -----------------------------------------------------------------------------
alter table public.customer_contract_documents
  add column if not exists storage_bucket text,
  add column if not exists archived_at timestamptz,
  add column if not exists verified_at timestamptz;

create unique index if not exists customer_contract_documents_storage_uidx
  on public.customer_contract_documents(storage_bucket,storage_path)
  where storage_bucket is not null and storage_path is not null;

create or replace function public.gridex_lock_customer_contract_document()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
begin
  if tg_op='DELETE' then
    raise exception using errcode='55000',message='customer_contract_document_immutable';
  end if;
  if old.storage_path is not null and (
    new.company_id is distinct from old.company_id
    or new.customer_contract_id is distinct from old.customer_contract_id
    or new.document_type is distinct from old.document_type
    or new.storage_bucket is distinct from old.storage_bucket
    or new.storage_path is distinct from old.storage_path
    or new.mime_type is distinct from old.mime_type
    or new.document_sha256 is distinct from old.document_sha256
    or new.generation_snapshot is distinct from old.generation_snapshot
  ) then
    raise exception using errcode='55000',message='customer_contract_document_immutable';
  end if;
  return new;
end $$;

drop trigger if exists customer_contract_documents_immutable on public.customer_contract_documents;
create trigger customer_contract_documents_immutable
before update or delete on public.customer_contract_documents
for each row execute function public.gridex_lock_customer_contract_document();

do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets(id,name,public)
    values('customer-contract-documents','customer-contract-documents',false)
    on conflict(id) do update set public=false;

    if exists(
      select 1 from information_schema.columns
      where table_schema='storage' and table_name='buckets' and column_name='file_size_limit'
    ) then
      execute 'update storage.buckets set file_size_limit=10485760 where id=$1'
      using 'customer-contract-documents';
    end if;
    if exists(
      select 1 from information_schema.columns
      where table_schema='storage' and table_name='buckets' and column_name='allowed_mime_types'
    ) then
      execute 'update storage.buckets set allowed_mime_types=$2 where id=$1'
      using 'customer-contract-documents',array['application/pdf']::text[];
    end if;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Complete tenant-aware contract communication set. Existing tenant edits are
-- preserved; only missing templates/rules receive platform defaults.
-- -----------------------------------------------------------------------------
insert into public.company_email_templates(
  company_id,template_key,name,subject,body_html,body_text,language,is_active,updated_at
)
select c.id,t.template_key,t.name,t.subject,t.body_html,t.body_text,'sv',true,now()
from public.companies c
cross join (values
  ('contract.power_of_attorney_required','Begäran om fullmakt','Fullmakt behövs för ditt avtal hos {{company_name}}',
   '<p>Hej {{customer_name}},</p><p>För att vi ska kunna fortsätta med avtalet {{contract_name}} behöver du lämna eller signera fullmakt.</p><p>Använd denna länk: {{power_of_attorney_url}}</p><p>Har du frågor når du oss på {{support_email}}.</p>',
   'Hej {{customer_name}}, för att vi ska kunna fortsätta med avtalet {{contract_name}} behöver du lämna eller signera fullmakt. Länk: {{power_of_attorney_url}}.'),
  ('contract.facility_id_required','Begäran om anläggnings-ID','Vi behöver ditt anläggnings-ID',
   '<p>Hej {{customer_name}},</p><p>Vi behöver anläggnings-ID eller mätpunkts-ID för att fortsätta ditt avtal hos {{company_name}}.</p><p>Komplettera i portalen: {{portal_url}}</p>',
   'Hej {{customer_name}}, vi behöver anläggnings-ID eller mätpunkts-ID för att fortsätta ditt avtal hos {{company_name}}. Portal: {{portal_url}}.'),
  ('contract.customer_information_required','Begäran om kunduppgifter','Ditt avtal behöver kompletteras',
   '<p>Hej {{customer_name}},</p><p>Vi behöver följande uppgifter för att fortsätta ditt avtal hos {{company_name}}:</p><p>{{required_information}}</p><p>Komplettera i portalen: {{portal_url}}</p>',
   'Hej {{customer_name}}, vi behöver följande uppgifter: {{required_information}}. Portal: {{portal_url}}.'),
  ('contract.completion_reminder','Påminnelse om komplettering','Påminnelse: komplettera ditt avtal',
   '<p>Hej {{customer_name}},</p><p>Det finns fortfarande uppgifter som behöver kompletteras för avtalet {{contract_name}}.</p><p>{{required_information}}</p><p>Komplettera senast {{completion_deadline}} via {{portal_url}}.</p>',
   'Hej {{customer_name}}, avtalet {{contract_name}} behöver kompletteras: {{required_information}}. Senast {{completion_deadline}} via {{portal_url}}.'),
  ('contract.rejected','Avtal avslaget','Information om din avtalsansökan',
   '<p>Hej {{customer_name}},</p><p>Vi kan inte godkänna din ansökan om {{contract_name}} i nuvarande form.</p><p>Orsak: {{review_reason}}</p><p>Kontakta {{support_email}} om du vill få beslutet förklarat.</p>',
   'Hej {{customer_name}}, ansökan om {{contract_name}} kan inte godkännas i nuvarande form. Orsak: {{review_reason}}.'),
  ('contract.manual_review','Manuell granskning','Din avtalsansökan granskas manuellt',
   '<p>Hej {{customer_name}},</p><p>Din ansökan om {{contract_name}} hos {{company_name}} behöver granskas manuellt.</p><p>Orsak: {{review_reason}}</p><p>Vi återkommer när granskningen är klar.</p>',
   'Hej {{customer_name}}, din ansökan om {{contract_name}} hos {{company_name}} granskas manuellt. Orsak: {{review_reason}}.')
) as t(template_key,name,subject,body_html,body_text)
where coalesce(c.status,'')<>'deleted_test_only'
on conflict(company_id,template_key,language) do nothing;

insert into public.email_event_rules(
  company_id,event_key,template_key,enabled,is_active,delay_minutes,send_to_customer,send_to_admin,updated_at
)
select c.id,r.event_key,r.event_key,true,true,0,true,false,now()
from public.companies c
cross join (values
  ('contract.power_of_attorney_required'),
  ('contract.facility_id_required'),
  ('contract.customer_information_required'),
  ('contract.completion_reminder'),
  ('contract.rejected'),
  ('contract.manual_review')
) as r(event_key)
where coalesce(c.status,'')<>'deleted_test_only'
on conflict(company_id,event_key,template_key) do nothing;

-- -----------------------------------------------------------------------------
-- One tenant readiness object for UI/API/diagnostics.
-- -----------------------------------------------------------------------------
create or replace function public.gridex_contract_platform_readiness(p_company_id uuid)
returns jsonb
language sql
stable
security definer
set search_path=public,pg_temp
as $$
with tenant as (
  select * from public.gridex_tenant_contract_readiness_v where company_id=p_company_id
), email_status as (
  select
    case
      when not exists(select 1 from public.company_email_settings s where s.company_id=p_company_id) then 'unknown'
      when exists(select 1 from public.company_email_settings s where s.company_id=p_company_id and coalesce(s.is_active,false)=true and nullif(s.sender_email,'') is not null) then 'ready'
      else 'blocked'
    end as status,
    array_remove(array[
      case when not exists(select 1 from public.company_email_settings s where s.company_id=p_company_id) then 'email_settings_missing' end,
      case when exists(select 1 from public.company_email_settings s where s.company_id=p_company_id) and not exists(select 1 from public.company_email_settings s where s.company_id=p_company_id and coalesce(s.is_active,false)=true and nullif(s.sender_email,'') is not null) then 'email_sender_not_ready' end,
      case when not exists(select 1 from public.company_email_templates t where t.company_id=p_company_id and t.is_active=true) then 'active_email_templates_missing' end
    ],null) blockers
), docs as (
  select
    case when exists(
      select 1 from public.customer_contracts c
      where c.company_id=p_company_id and c.signed_at is not null
        and not exists(
          select 1 from public.customer_contract_documents d
          where d.customer_contract_id=c.id and d.document_type='signed_contract_pdf'
            and d.storage_bucket='customer-contract-documents' and nullif(d.storage_path,'') is not null
        )
    ) then 'blocked' else 'ready' end status,
    coalesce(array(
      select 'signed_contract_pdf_missing:'||c.id::text
      from public.customer_contracts c
      where c.company_id=p_company_id and c.signed_at is not null
        and not exists(
          select 1 from public.customer_contract_documents d
          where d.customer_contract_id=c.id and d.document_type='signed_contract_pdf'
            and d.storage_bucket='customer-contract-documents' and nullif(d.storage_path,'') is not null
        )
      order by c.created_at desc limit 25
    ),'{}') blockers
), operations as (
  select
    case when exists(
      select 1 from public.customer_contracts c
      where c.company_id=p_company_id and c.status in('signed','active')
        and (c.contract_publication_version_id is null or c.price_plan_version_id is null or c.legal_bundle_version_id is null)
    ) then 'blocked' else 'ready' end status,
    coalesce(array(
      select 'customer_contract_version_binding_missing:'||c.id::text
      from public.customer_contracts c
      where c.company_id=p_company_id and c.status in('signed','active')
        and (c.contract_publication_version_id is null or c.price_plan_version_id is null or c.legal_bundle_version_id is null)
      order by c.created_at desc limit 25
    ),'{}') blockers
)
select jsonb_build_object(
  'company_id',p_company_id,
  'legal_profile',jsonb_build_object(
    'status',coalesce(t.legal_profile_status,'unknown'),
    'missing_fields',coalesce(t.legal_profile_missing_fields,'{}'),
    'review_required',coalesce(t.legal_profile_review_required,false)
  ),
  'publication',jsonb_build_object(
    'status',coalesce(t.overall_status,'unknown'),
    'blockers',coalesce(t.publication_blockers,'{}'),
    'published_versions',coalesce(t.published_publication_versions,0)
  ),
  'website',jsonb_build_object(
    'can_display',coalesce(t.can_display,false),
    'blockers',case when coalesce(t.can_display,false) then '[]'::jsonb else to_jsonb(coalesce(t.publication_blockers,'{}')) end
  ),
  'applications',jsonb_build_object(
    'can_accept',coalesce(t.can_accept_applications,false),
    'blockers',case when coalesce(t.can_accept_applications,false) then '[]'::jsonb else to_jsonb(coalesce(t.publication_blockers,'{}')) end
  ),
  'email',jsonb_build_object('status',e.status,'blockers',e.blockers),
  'documents',jsonb_build_object('status',d.status,'blockers',d.blockers),
  'customer_operations',jsonb_build_object('status',o.status,'blockers',o.blockers),
  'evaluated_at',now()
)
from (select 1 as singleton) seed
left join tenant t on true
cross join email_status e
cross join docs d
cross join operations o;
$$;

revoke all on function public.gridex_resolve_or_create_legal_source_bundle(uuid,jsonb,jsonb,uuid) from public,anon,authenticated;
revoke all on function public.gridex_create_legal_template_version(text,text,text,text,boolean,uuid) from public,anon,authenticated;
revoke all on function public.gridex_update_draft_legal_template_version(uuid,text,text,uuid) from public,anon,authenticated;
revoke all on function public.gridex_publish_legal_template_version(uuid,uuid) from public,anon,authenticated;
revoke all on function public.gridex_archive_draft_legal_template_version(uuid) from public,anon,authenticated;
revoke all on function public.gridex_create_tenant_legal_override(uuid,text,text,text,text,text,boolean,uuid) from public,anon,authenticated;
revoke all on function public.gridex_publish_tenant_legal_override(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.gridex_archive_draft_tenant_legal_override(uuid,uuid) from public,anon,authenticated;
revoke all on function public.gridex_sync_internal_offer_to_canonical(uuid) from public,anon,authenticated;
revoke all on function public.gridex_upsert_internal_contract_offer(uuid,uuid,jsonb,jsonb,uuid) from public,anon,authenticated;
revoke all on function public.gridex_prepare_manual_contract_binding(uuid,jsonb,jsonb,uuid) from public,anon,authenticated;
revoke all on function public.gridex_materialize_legal_bundle_version(uuid,uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.gridex_publish_contract_version(uuid,uuid,text,jsonb,jsonb,uuid) from public,anon,authenticated;
revoke all on function public.gridex_ensure_internal_contract_publication(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.gridex_contract_platform_readiness(uuid) from public,anon;
grant execute on function public.gridex_create_legal_template_version(text,text,text,text,boolean,uuid) to service_role;
grant execute on function public.gridex_update_draft_legal_template_version(uuid,text,text,uuid) to service_role;
grant execute on function public.gridex_publish_legal_template_version(uuid,uuid) to service_role;
grant execute on function public.gridex_archive_draft_legal_template_version(uuid) to service_role;
grant execute on function public.gridex_create_tenant_legal_override(uuid,text,text,text,text,text,boolean,uuid) to service_role;
grant execute on function public.gridex_publish_tenant_legal_override(uuid,uuid,uuid) to service_role;
grant execute on function public.gridex_archive_draft_tenant_legal_override(uuid,uuid) to service_role;
grant execute on function public.gridex_sync_internal_offer_to_canonical(uuid) to service_role;
grant execute on function public.gridex_upsert_internal_contract_offer(uuid,uuid,jsonb,jsonb,uuid) to service_role;
grant execute on function public.gridex_prepare_manual_contract_binding(uuid,jsonb,jsonb,uuid) to service_role;
grant execute on function public.gridex_publish_contract_version(uuid,uuid,text,jsonb,jsonb,uuid) to service_role;
grant execute on function public.gridex_ensure_internal_contract_publication(uuid,uuid,uuid) to service_role;
grant execute on function public.gridex_contract_platform_readiness(uuid) to authenticated,service_role;
grant select on public.canonical_internal_contract_offers_v to authenticated,service_role;
grant select on public.canonical_legal_template_versions_v to authenticated,service_role;
grant select on public.canonical_tenant_legal_overrides_v to authenticated,service_role;

revoke insert,update,delete on public.legal_text_versions from anon,authenticated;
revoke insert,update,delete on public.legal_bundles from anon,authenticated;
revoke insert,update,delete on public.legal_bundle_items from anon,authenticated;
revoke insert,update,delete on public.platform_default_legal_templates from anon,authenticated;
revoke insert,update,delete on public.contract_offers from anon,authenticated;
revoke insert,update,delete on public.public_contract_offers from anon,authenticated;
revoke insert,update,delete on public.price_books from anon,authenticated;
revoke insert,update,delete on public.base_price_components from anon,authenticated;

comment on function public.gridex_materialize_legal_bundle_version(uuid,uuid,uuid,uuid) is
  'Creates an immutable legal bundle directly from published legal_template_versions and approved tenant overrides. Legacy bundle arguments are ignored.';
comment on function public.gridex_contract_platform_readiness(uuid) is
  'Canonical tenant readiness object for legal profile, publication, website, applications, email, document archive and customer operations.';
comment on view public.canonical_internal_contract_offers_v is
  'Read-only compatibility view for internal offers with canonical product/legal status. Application writes must use canonical RPCs.';

commit;
