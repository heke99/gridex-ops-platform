-- Preserve the existing readiness view shape, security_invoker and grants.
-- Tighten only sender usability and nonblank same-tenant production BRP identity.
BEGIN;

CREATE OR REPLACE VIEW public.platform_go_live_readiness_v WITH (security_invoker='true') AS
 SELECT c.id AS company_id,
    c.name AS company_name,
    COALESCE(pa.ediel_id, pa.actor_ediel_id, c.production_ediel_id, c.ediel_id) AS ediel_id,
    b.brp_ediel_id,
    (EXISTS ( SELECT 1
           FROM public.ediel_actor_settings a
          WHERE ((a.company_id = c.id) AND (a.environment = 'production'::text) AND (COALESCE(a.is_active, true) = true) AND (COALESCE(a.ediel_id, a.actor_ediel_id) IS NOT NULL)))) AS has_actor_setting,
    (EXISTS ( SELECT 1
           FROM public.ediel_brp_settings brp
          WHERE ((brp.company_id = c.id) AND (brp.environment = 'production'::text) AND (btrim(brp.brp_ediel_id) <> ''::text)))) AS has_brp,
    (EXISTS ( SELECT 1
           FROM public.ediel_route_profiles r
          WHERE ((r.company_id = c.id) AND (r.environment = 'production'::text) AND (COALESCE(r.is_enabled, true) = true) AND (COALESCE(r.is_active, true) = true) AND (upper(COALESCE(r.message_family, r.application_reference, ''::text)) = 'PRODAT'::text)))) AS has_prodat_route,
    (EXISTS ( SELECT 1
           FROM public.ediel_route_profiles r
          WHERE ((r.company_id = c.id) AND (r.environment = 'production'::text) AND (COALESCE(r.is_enabled, true) = true) AND (COALESCE(r.is_active, true) = true) AND (upper(COALESCE(r.message_family, r.application_reference, ''::text)) = 'UTILTS'::text)))) AS has_utilts_route,
    (EXISTS ( SELECT 1
           FROM public.ediel_mailboxes m
          WHERE ((m.company_id IS NULL) AND (m.environment = 'production'::text) AND (COALESCE(m.is_active, true) = true)))) AS has_shared_mailbox,
    (EXISTS ( SELECT 1
           FROM public.legal_text_versions l
          WHERE ((l.company_id = c.id) AND (l.type = 'terms'::text) AND (l.status = 'published'::text)))) AS has_terms,
    (EXISTS ( SELECT 1
           FROM public.legal_text_versions l
          WHERE ((l.company_id = c.id) AND (l.type = 'privacy_policy'::text) AND (l.status = 'published'::text)))) AS has_privacy_policy,
    (EXISTS ( SELECT 1
           FROM public.legal_text_versions l
          WHERE ((l.company_id = c.id) AND (l.type = 'withdrawal'::text) AND (l.status = 'published'::text)))) AS has_withdrawal,
    (EXISTS ( SELECT 1
           FROM public.legal_text_versions l
          WHERE ((l.company_id = c.id) AND (l.type = 'power_of_attorney'::text) AND (l.status = 'published'::text)))) AS has_power_of_attorney_text,
    (EXISTS ( SELECT 1
           FROM public.legal_text_versions l
          WHERE ((l.company_id = c.id) AND (l.type = 'price_terms'::text) AND (l.status = 'published'::text)))) AS has_price_terms,
    (EXISTS ( SELECT 1
           FROM public.price_plan_versions ppv
          WHERE ((ppv.company_id = c.id) AND (ppv.status = ANY (ARRAY['active'::text, 'published'::text]))))) AS has_published_contracts,
    (EXISTS ( SELECT 1
           FROM public.company_email_settings s
          WHERE ((s.company_id = c.id) AND (s.is_active = true) AND (s.sender_mode <> 'disabled'::text) AND (lower(COALESCE(s.verification_status, ''::text)) = ANY (ARRAY['verified'::text, 'completed'::text, 'active'::text]))))) AS has_sender_identity,
    public.gridex_resolve_ediel_route_for_process(c.id, 'PRODAT'::text, 'supplier_switch'::text, NULL::text, NULL::text) AS prodat_route_decision,
    now() AS evaluated_at
   FROM ((public.companies c
     LEFT JOIN LATERAL ( SELECT a.id,
            a.company_id,
            a.actor_name,
            a.actor_ediel_id,
            a.actor_role,
            a.environment,
            a.is_active,
            a.sender_name,
            a.sender_sub_address,
            a.default_application_reference,
            a.default_timezone,
            a.default_charset,
            a.default_test_flag,
            a.smtp_from_email,
            a.smtp_reply_to_email,
            a.mailbox,
            a.brp_name,
            a.brp_ediel_id,
            a.brp_status,
            a.esett_status,
            a.valid_from,
            a.valid_to,
            a.notes,
            a.metadata,
            a.created_at,
            a.updated_at,
            a.created_by,
            a.updated_by,
            a.market,
            a.role,
            a.ediel_id,
            a.sender_subaddress,
            a.receiver_subaddress,
            a.receiver_sub_address,
            a.application_reference,
            a.legal_name,
            a.organization_number,
            a.market_roles,
            a.test_status,
            a.production_status,
            a.production_send_lock_enabled,
            a.first_production_send_approved,
            a.first_production_message_id,
            a.approved_by,
            a.approved_at,
            a.contact_email,
            a.operations_contact_email,
            a.sender_subaddress_prodat,
            a.sender_subaddress_utilts,
            a.default_transport_channel,
            a.transport_profile_id,
            a.subaddress_required,
            a.receiver_message_subaddress
           FROM public.ediel_actor_settings a
          WHERE ((a.company_id = c.id) AND (a.environment = 'production'::text) AND (COALESCE(a.is_active, true) = true))
          ORDER BY a.updated_at DESC NULLS LAST, a.created_at DESC NULLS LAST
         LIMIT 1) pa ON (true))
     LEFT JOIN LATERAL ( SELECT brp.id,
            brp.company_id,
            brp.environment,
            brp.brp_ediel_id,
            brp.brp_name,
            brp.brp_email,
            brp.brp_phone,
            brp.contact_person,
            brp.is_default,
            brp.valid_from,
            brp.valid_to,
            brp.metadata,
            brp.created_at,
            brp.updated_at,
            brp.created_by,
            brp.updated_by
           FROM public.ediel_brp_settings brp
          WHERE ((brp.company_id = c.id) AND (brp.environment = 'production'::text))
          ORDER BY brp.is_default DESC NULLS LAST, brp.updated_at DESC NULLS LAST, brp.created_at DESC NULLS LAST
         LIMIT 1) b ON (true));

COMMIT;
