-- Declared synthetic embedded probe schema only; not generated native schema/provenance.
CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
CREATE TABLE public.companies(id uuid PRIMARY KEY);
CREATE TABLE public.company_memberships(company_id uuid,user_id uuid,status text,is_active boolean,accepted_at timestamptz);
CREATE TABLE public.user_profiles(id uuid,user_status text);
CREATE FUNCTION public.gridex_actor_has_company_permission(uuid,uuid,text) RETURNS boolean LANGUAGE sql AS 'SELECT true';
CREATE SCHEMA gridex_received_sources;
CREATE FUNCTION gridex_received_sources.reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'received_source_evidence_is_append_only'; END$$;
CREATE TABLE public.ediel_messages(id uuid PRIMARY KEY,company_id uuid,created_by uuid,message_standard text,message_family text,message_code text,direction text,raw_payload text,immutable_rendered_at timestamptz,immutable_payload_hash text,sender_ediel_id text,receiver_ediel_id text,file_name text,grid_owner_id uuid,environment text DEFAULT 'test');
CREATE TABLE public.tenant_ediel_profiles(id uuid DEFAULT gen_random_uuid(),company_id uuid,environment text,market text,is_enabled boolean,valid_from timestamptz,valid_to timestamptz);
CREATE TABLE public.tenant_actor_identifiers(id uuid DEFAULT gen_random_uuid(),company_id uuid,environment text,actor_id uuid,identifier_type text,identifier_value text,valid_from timestamptz,valid_to timestamptz);
CREATE TABLE public.tenant_actor_roles(id uuid DEFAULT gen_random_uuid(),company_id uuid,environment text,actor_id uuid,role_code text,valid_from timestamptz,valid_to timestamptz);
CREATE TABLE public.ai_list_imports(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid,created_by uuid,list_type text,gdpr_basis text,retention_until date,raw_payload text,filename text,grid_owner_id uuid,status text,row_count int,discrepancy_count int,metadata jsonb);
CREATE TABLE public.ai_list_import_rows(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid,import_id uuid,row_number int,raw_columns jsonb,metering_point_external_id text,matched_metering_point_id uuid,matched_customer_id uuid,matched_customer_site_id uuid,match_status text,discrepancy_reasons text[]);
CREATE TABLE public.ai_list_discrepancies(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid,import_id uuid,import_row_id uuid,discrepancy_type text,severity text,current_values jsonb,imported_values jsonb,status text);
CREATE TABLE public.customers(id uuid PRIMARY KEY,company_id uuid);
CREATE TABLE public.customer_sites(id uuid PRIMARY KEY,company_id uuid);
CREATE TABLE public.metering_points(id uuid PRIMARY KEY,company_id uuid,customer_id uuid,site_id uuid,customer_site_id uuid,metering_point_id text,meter_point_id text,ediel_reference text,site_facility_id text,grid_area_code text,grid_owner_ediel_id text);
