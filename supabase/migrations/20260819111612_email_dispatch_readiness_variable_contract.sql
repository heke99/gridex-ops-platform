create or replace view public.gridex_tenant_email_dispatch_readiness_v
with (security_invoker = true)
as
with canonical_rules(event_key, template_key, event_label, legal_or_critical, available_variables) as (
  values
    ('contract.application_received'::text,'contract.application_received'::text,'Ansökan mottagen'::text,false,array['customer_name','first_name','last_name','customer_email','customer_phone','customer_number','company_name','support_email','portal_url']::text[]),
    ('contract.confirmation_sent','contract.confirmation_sent','Avtalsbekräftelse',true,array['customer_name','first_name','last_name','customer_number','company_name','contract_name','contract_number','signed_at','start_date','price_summary','legal_versions_summary','offer_reference','agreement_pdf_note','support_email','portal_url']::text[]),
    ('contract.cooling_off_sent','contract.cooling_off_sent','Ångerrätt',true,array['customer_name','first_name','customer_number','company_name','contract_name','contract_number','cancellation_deadline','support_email','portal_url']::text[]),
    ('contract.power_of_attorney_required','contract.power_of_attorney_required','Begäran om fullmakt',true,array['customer_name','first_name','customer_number','company_name','contract_name','contract_number','power_of_attorney_url','support_email','portal_url']::text[]),
    ('contract.facility_id_required','contract.facility_id_required','Begäran om anläggnings-ID',true,array['customer_name','first_name','customer_number','company_name','contract_name','contract_number','facility_id','metering_point_id','support_email','portal_url']::text[]),
    ('contract.customer_information_required','contract.customer_information_required','Begäran om kunduppgifter',true,array['customer_name','first_name','customer_number','company_name','contract_name','contract_number','required_information','support_email','portal_url']::text[]),
    ('contract.completion_reminder','contract.completion_reminder','Påminnelse om komplettering',true,array['customer_name','first_name','customer_number','company_name','contract_name','contract_number','required_information','completion_deadline','support_email','portal_url']::text[]),
    ('contract.rejected','contract.rejected','Avtal avslaget',true,array['customer_name','first_name','customer_number','company_name','contract_name','contract_number','review_reason','support_email','portal_url']::text[]),
    ('contract.manual_review','contract.manual_review','Manuell granskning',true,array['customer_name','first_name','customer_number','company_name','contract_name','contract_number','review_reason','support_email','portal_url']::text[]),
    ('switch.started','switch.started','Leverantörsbyte startat',true,array['customer_name','first_name','customer_number','company_name','contract_name','contract_number','facility_id','metering_point_id','start_date','support_email','portal_url','cancellation_deadline']::text[]),
    ('switch.confirmed','switch.confirmed','Leverantörsbyte bekräftat',true,array['customer_name','first_name','customer_number','company_name','contract_name','contract_number','facility_id','metering_point_id','start_date','support_email','portal_url','cancellation_deadline']::text[]),
    ('switch.action_required','switch.action_required','Komplettering behövs',true,array['customer_name','first_name','customer_number','company_name','contract_name','contract_number','facility_id','metering_point_id','start_date','support_email','portal_url','cancellation_deadline','case_message','case_subject']::text[]),
    ('customer.welcome_active','customer.welcome_active','Välkommen som kund',true,array['customer_name','first_name','customer_number','company_name','contract_name','contract_number','facility_id','metering_point_id','start_date','support_email','portal_url','cancellation_deadline']::text[])
), raw as (
  select c.id as company_id,
         c.name as company_name,
         cr.event_key,
         cr.template_key,
         cr.event_label,
         cr.legal_or_critical,
         cr.available_variables,
         coalesce(e.enabled,true) as enabled,
         coalesce(e.is_active,e.enabled,true) as rule_active,
         t.id as template_id,
         coalesce(t.name,cr.event_label) as template_name,
         t.subject,
         t.body_html,
         t.body_text,
         coalesce(t.is_active,false) as template_active,
         s.id as settings_id,
         s.sender_name,
         s.sender_email,
         s.reply_to_email,
         s.domain,
         coalesce(s.verification_status,'not_started') as domain_status,
         coalesce(s.is_active,true) as sender_is_active,
         coalesce(s.fallback_allowed,s.id is null) as fallback_allowed,
         coalesce(s.sender_mode,'fallback_platform_sender') as sender_mode,
         coalesce(s.block_legal_mail_when_unverified,true) as block_legal_mail_when_unverified,
         coalesce(e.updated_at,t.updated_at) as event_rule_updated_at,
         t.updated_at as template_updated_at
  from public.companies c
  cross join canonical_rules cr
  left join public.email_event_rules e on e.company_id=c.id and e.event_key=cr.event_key and e.template_key=cr.template_key
  left join public.company_email_templates t on t.company_id=c.id and t.template_key=cr.template_key and t.language='sv'
  left join public.company_email_settings s on s.company_id=c.id
), placeholders as (
  select raw.*,
         coalesce((
           select array_agg(distinct btrim(m[1]))
           from regexp_matches(coalesce(raw.subject,'') || E'\n' || coalesce(raw.body_html,'') || E'\n' || coalesce(raw.body_text,''), '\{\{([^{}]*)\}\}', 'g') as m
         ), '{}'::text[]) as referenced_variables
  from raw
), contracted as (
  select placeholders.*,
         coalesce((
           select array_agg(v order by v)
           from unnest(placeholders.referenced_variables) as v
           where nullif(btrim(v),'') is null or not (v = any(placeholders.available_variables))
         ), '{}'::text[]) as contract_invalid_variables
  from placeholders
), evaluated as (
  select contracted.*,
         cardinality(contracted.contract_invalid_variables)=0 as template_contract_valid,
         contracted.sender_is_active=true
           and lower(coalesce(contracted.domain_status,'')) = any(array['verified','active','ready'])
           and nullif(coalesce(contracted.sender_email,''),'') is not null
           and nullif(coalesce(contracted.sender_name,''),'') is not null as has_verified_sender,
         contracted.sender_is_active=true and contracted.fallback_allowed=true and contracted.sender_mode <> 'disabled' as fallback_permitted
  from contracted
)
select company_id,
       company_name,
       event_key,
       template_key,
       enabled,
       template_id,
       template_name,
       subject,
       template_active,
       sender_email,
       reply_to_email,
       domain,
       domain_status,
       case
         when enabled is not true or rule_active is not true then false
         when template_id is null or template_active is not true then false
         when nullif(coalesce(subject,''),'') is null or nullif(coalesce(body_html,body_text,''),'') is null then false
         when template_contract_valid is not true then false
         when sender_is_active is not true then false
         when legal_or_critical=true then has_verified_sender
         when has_verified_sender=true or fallback_permitted=true then true
         else false
       end as can_send,
       array_remove(array[
         case when enabled is not true or rule_active is not true then 'Utskicket är avstängt' end,
         case when template_id is null then 'Mailmall saknas' end,
         case when template_active is not true then 'Mailmallen är inaktiv' end,
         case when nullif(coalesce(subject,''),'') is null then 'Ämnesrad saknas' end,
         case when nullif(coalesce(body_html,body_text,''),'') is null then 'Mallinnehåll saknas' end,
         case when template_contract_valid is not true then 'Mailmallens variabelkontrakt är ogiltigt: ' || array_to_string(contract_invalid_variables, ', ') end,
         case when sender_is_active is not true then 'Avsändaren är avstängd' end,
         case when legal_or_critical=true and has_verified_sender is not true then 'Juridiska eller kritiska mail kräver verifierad bolagsdomän och avsändare' end,
         case when legal_or_critical=false and has_verified_sender is not true and fallback_permitted=true then 'Skickas via plattformens fallback-avsändare' end,
         case when legal_or_critical=false and has_verified_sender is not true and fallback_permitted is not true then 'Verifierad avsändare saknas och fallback är avstängd' end,
         case when has_verified_sender is not true and nullif(coalesce(sender_email,''),'') is null then 'Bolagets verifierade avsändarmail saknas' end,
         case when has_verified_sender is not true and nullif(coalesce(sender_name,''),'') is null then 'Avsändarnamn saknas' end
       ],null) as issues,
       event_rule_updated_at,
       template_updated_at,
       sender_mode,
       fallback_allowed,
       legal_or_critical,
       legal_or_critical=false and has_verified_sender is not true and fallback_permitted=true as requires_platform_fallback
from evaluated;
