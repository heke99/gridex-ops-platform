-- Ediel party registry, party technical addresses, actor-specific PRODAT subaddresses,
-- transport security modes and receiver-certificate separation.

alter table if exists public.ediel_certificates
  add column if not exists owner_ediel_id text null,
  add column if not exists owner_subaddress text null,
  add column if not exists owner_party_id uuid null,
  add column if not exists message_family text null,
  add column if not exists message_type text null,
  add column if not exists environment text null,
  add column if not exists purpose text null,
  add column if not exists usage text null,
  add column if not exists public_certificate_pem text null,
  add column if not exists p12_secret_ref text null,
  add column if not exists private_key_secret_ref text null,
  add column if not exists p12_password_secret_ref text null,
  add column if not exists thumbprint_sha256 text null,
  add column if not exists fingerprint_sha256 text null,
  add column if not exists issuer text null,
  add column if not exists serial_number text null,
  add column if not exists subject text null,
  add column if not exists valid_from timestamptz null,
  add column if not exists valid_to timestamptz null,
  add column if not exists source text null,
  add column if not exists has_private_material boolean not null default false,
  add column if not exists is_private_material_available boolean not null default false,
  add column if not exists last_verified_at timestamptz null,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create table if not exists public.ediel_parties (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  organization_number text null,
  ediel_id text not null,
  roles text[] not null default '{}'::text[],
  status text not null default 'draft',
  visible_to_customer_flow boolean not null default false,
  source text not null default 'manual',
  notes text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid null,
  updated_by uuid null,
  constraint ediel_parties_status_chk check (status in ('draft', 'verified', 'inactive', 'blocked', 'needs_verification')),
  constraint ediel_parties_source_chk check (source in ('ediel_registry', 'ediel_catalog', 'grid_owner_confirmation', 'manual_verified', 'manual', 'import'))
);

create unique index if not exists ediel_parties_ediel_id_idx
  on public.ediel_parties(ediel_id);

create index if not exists ediel_parties_customer_flow_idx
  on public.ediel_parties(visible_to_customer_flow, status)
  where visible_to_customer_flow = true;

create table if not exists public.ediel_party_addresses (
  id uuid primary key default gen_random_uuid(),
  party_id uuid not null references public.ediel_parties(id) on delete cascade,
  ediel_id text not null,
  qualifier text not null default 'ZZ',
  subaddress text null,
  message_family text not null,
  message_type text null,
  business_code text null,
  environment text not null,
  smtp_address text not null,
  transport_security_mode text not null default 'needs_verification',
  requires_subaddress boolean not null default false,
  certificate_required boolean not null default false,
  receiver_certificate_id uuid null references public.ediel_certificates(id) on delete set null,
  status text not null default 'needs_verification',
  source text not null default 'manual',
  last_verified_at timestamptz null,
  valid_from timestamptz null,
  valid_to timestamptz null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid null,
  updated_by uuid null,
  constraint ediel_party_addresses_environment_chk check (environment in ('test', 'production', 'agt')),
  constraint ediel_party_addresses_security_chk check (transport_security_mode in ('required_encrypted', 'encrypted', 'unencrypted', 'needs_verification')),
  constraint ediel_party_addresses_status_chk check (status in ('active', 'inactive', 'expired', 'needs_verification')),
  constraint ediel_party_addresses_source_chk check (source in ('ediel_registry', 'ediel_catalog', 'grid_owner_confirmation', 'manual_verified', 'manual'))
);

create unique index if not exists ediel_party_addresses_route_unique_idx
  on public.ediel_party_addresses(
    party_id,
    environment,
    message_family,
    coalesce(nullif(business_code, ''), '*'),
    coalesce(subaddress, ''),
    smtp_address
  );

create index if not exists ediel_party_addresses_resolution_idx
  on public.ediel_party_addresses(party_id, environment, message_family, business_code, status);

alter table if exists public.ediel_route_profiles
  add column if not exists party_id uuid null references public.ediel_parties(id) on delete set null,
  add column if not exists party_address_id uuid null references public.ediel_party_addresses(id) on delete set null,
  add column if not exists environment text not null default 'test',
  add column if not exists message_standard text not null default 'edifact',
  add column if not exists ack_mode text not null default 'default',
  add column if not exists payload_format text not null default 'edifact',
  add column if not exists message_family text null,
  add column if not exists business_code text null,
  add column if not exists sender_ediel_id text null,
  add column if not exists sender_name text null,
  add column if not exists sender_sub_address text null,
  add column if not exists sender_subaddress text null,
  add column if not exists receiver_ediel_id text null,
  add column if not exists receiver_name text null,
  add column if not exists receiver_subaddress text null,
  add column if not exists receiver_sub_address text null,
  add column if not exists receiver_message_subaddress text null,
  add column if not exists mailbox text null,
  add column if not exists application_reference text null,
  add column if not exists default_message_version text null,
  add column if not exists default_test_flag integer not null default 1,
  add column if not exists default_timezone integer not null default 1,
  add column if not exists is_enabled boolean not null default true,
  add column if not exists notes text null,
  add column if not exists encryption_mode text null,
  add column if not exists signing_mode text not null default 'none',
  add column if not exists transport_security_mode text null,
  add column if not exists transport_mode text null,
  add column if not exists tls_required boolean not null default true,
  add column if not exists certificate_id uuid null,
  add column if not exists receiver_certificate_id uuid null references public.ediel_certificates(id) on delete set null,
  add column if not exists certificate_required boolean not null default false,
  add column if not exists subaddress_required boolean not null default false,
  add column if not exists allow_unencrypted_test boolean not null default true,
  add column if not exists allow_unencrypted_production boolean not null default false,
  add column if not exists allow_unencrypted_production_expires_at timestamptz null,
  add column if not exists allow_unencrypted_production_granted_by uuid null,
  add column if not exists allow_unencrypted_production_reason text null,
  add column if not exists security_policy_status text not null default 'not_checked',
  add column if not exists smtp_host text null,
  add column if not exists smtp_port integer null,
  add column if not exists imap_host text null,
  add column if not exists imap_port integer null,
  add column if not exists smtp_to text null,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table if exists public.ediel_messages
  add column if not exists party_id uuid null references public.ediel_parties(id) on delete set null,
  add column if not exists party_address_id uuid null references public.ediel_party_addresses(id) on delete set null,
  add column if not exists transport_security_mode text null,
  add column if not exists route_transport_security_mode text null,
  add column if not exists was_smime_encrypted boolean null,
  add column if not exists expected_receiver_certificate_id uuid null,
  add column if not exists cms_expected_receiver_present boolean null;

do $$
declare
  portal_party_id uuid;
  lab_party_id uuid;
begin
  insert into public.ediel_parties (
    name,
    organization_number,
    ediel_id,
    roles,
    status,
    visible_to_customer_flow,
    source,
    notes
  )
  values (
    'Edielportalen / Testsystem',
    null,
    '91100',
    array['ediel_portal', 'test_counterparty', 'grid_owner_in_agt_context'],
    'verified',
    false,
    'manual_verified',
    'Seeded technical party for Edielportalen AGT PRODAT. UNB receiver 91100:ZZ:PRODAT, SMTP 91100@ediel.se.'
  )
  on conflict (ediel_id) do update
     set name = excluded.name,
         roles = excluded.roles,
         status = 'verified',
         visible_to_customer_flow = false,
         source = 'manual_verified',
         notes = excluded.notes,
         updated_at = now()
  returning id into portal_party_id;

  insert into public.ediel_party_addresses (
    party_id,
    ediel_id,
    qualifier,
    subaddress,
    message_family,
    message_type,
    business_code,
    environment,
    smtp_address,
    transport_security_mode,
    requires_subaddress,
    certificate_required,
    receiver_certificate_id,
    status,
    source,
    last_verified_at,
    metadata
  )
  values (
    portal_party_id,
    '91100',
    'ZZ',
    'PRODAT',
    'PRODAT',
    'PRODAT',
    null,
    'agt',
    '91100@ediel.se',
    'encrypted',
    true,
    false,
    null,
    'active',
    'manual_verified',
    now(),
    jsonb_build_object(
      'allowedTransportSelections', jsonb_build_array('required_encrypted', 'unencrypted'),
      'encryptedModeRequiresReceiverCertificate', true,
      'unencryptedModeRequiresPortalLockOff', true
    )
  )
  on conflict (party_id, environment, message_family, coalesce(nullif(business_code, ''), '*'), coalesce(subaddress, ''), smtp_address)
  do update set
    qualifier = excluded.qualifier,
    subaddress = excluded.subaddress,
    transport_security_mode = excluded.transport_security_mode,
    requires_subaddress = excluded.requires_subaddress,
    certificate_required = excluded.certificate_required,
    status = excluded.status,
    source = excluded.source,
    last_verified_at = excluded.last_verified_at,
    metadata = excluded.metadata,
    updated_at = now();

  insert into public.ediel_parties (
    name,
    organization_number,
    ediel_id,
    roles,
    status,
    visible_to_customer_flow,
    source,
    notes
  )
  values (
    'TVLAB / test counterparty 11900',
    null,
    '11900',
    array['grid_owner', 'test_counterparty'],
    'needs_verification',
    false,
    'grid_owner_confirmation',
    'Routing instruction: Subaddress PRODAT-SE, send all PRODAT to Ediel ID 11900, SMTP 11900@tvlab.se.'
  )
  on conflict (ediel_id) do update
     set roles = excluded.roles,
         source = excluded.source,
         notes = excluded.notes,
         updated_at = now()
  returning id into lab_party_id;

  insert into public.ediel_party_addresses (
    party_id,
    ediel_id,
    qualifier,
    subaddress,
    message_family,
    message_type,
    business_code,
    environment,
    smtp_address,
    transport_security_mode,
    requires_subaddress,
    certificate_required,
    receiver_certificate_id,
    status,
    source,
    last_verified_at,
    metadata
  )
  values (
    lab_party_id,
    '11900',
    'ZZ',
    'PRODAT-SE',
    'PRODAT',
    'PRODAT',
    null,
    'test',
    '11900@tvlab.se',
    'required_encrypted',
    true,
    true,
    null,
    'needs_verification',
    'grid_owner_confirmation',
    now(),
    jsonb_build_object('appliesToBusinessCodes', '*')
  )
  on conflict (party_id, environment, message_family, coalesce(nullif(business_code, ''), '*'), coalesce(subaddress, ''), smtp_address)
  do update set
    subaddress = excluded.subaddress,
    smtp_address = excluded.smtp_address,
    transport_security_mode = excluded.transport_security_mode,
    requires_subaddress = excluded.requires_subaddress,
    certificate_required = excluded.certificate_required,
    source = excluded.source,
    metadata = excluded.metadata,
    updated_at = now();
end $$;

-- Backfill certificate usage for private Gridex/Div3rsa material so it cannot be
-- selected as outbound_recipient by route resolution.
update public.ediel_certificates
   set owner_ediel_id = coalesce(owner_ediel_id, '21660'),
       usage = case
         when coalesce(p12_secret_reference, p12_secret_ref, private_key_secret_reference, private_key_secret_ref, secret_reference, metadata->>'p12SecretReference') is not null
           then coalesce(nullif(usage, ''), 'inbound_private')
         else usage
       end,
       purpose = case
         when coalesce(p12_secret_reference, p12_secret_ref, private_key_secret_reference, private_key_secret_ref, secret_reference, metadata->>'p12SecretReference') is not null
           then coalesce(nullif(purpose, ''), 'both')
         else purpose
       end,
       has_private_material = true,
       is_private_material_available = true,
       metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
         'usage', case
           when coalesce(p12_secret_reference, p12_secret_ref, private_key_secret_reference, private_key_secret_ref, secret_reference, metadata->>'p12SecretReference') is not null
             then coalesce(nullif(usage, ''), 'inbound_private')
           else usage
         end,
         'ownerEdielId', coalesce(owner_ediel_id, '21660'),
         'outboundRecipientAllowed', false
       )
 where to_regclass('public.ediel_certificates') is not null
   and (
     coalesce(subject, metadata->>'subject', '') ~* '(Div3rsa|Gridex|serialNumber[[:space:]]*=[[:space:]]*21660|ediel@gridex\.se)'
     or coalesce(p12_secret_reference, p12_secret_ref, private_key_secret_reference, private_key_secret_ref, secret_reference, metadata->>'p12SecretReference') is not null
   );

update public.ediel_route_profiles rp
   set receiver_subaddress = coalesce(nullif(rp.receiver_subaddress, ''), nullif(rp.receiver_sub_address, ''), nullif(rp.receiver_message_subaddress, '')),
       receiver_sub_address = coalesce(nullif(rp.receiver_sub_address, ''), nullif(rp.receiver_subaddress, ''), nullif(rp.receiver_message_subaddress, '')),
       receiver_message_subaddress = coalesce(nullif(rp.receiver_message_subaddress, ''), nullif(rp.receiver_subaddress, ''), nullif(rp.receiver_sub_address, '')),
       transport_security_mode = case
         when rp.transport_security_mode in ('required_encrypted', 'encrypted', 'unencrypted', 'needs_verification') then rp.transport_security_mode
         when rp.encryption_mode = 'smime' then 'required_encrypted'
         when rp.environment = 'production' and upper(coalesce(rp.message_family, 'PRODAT')) = 'PRODAT' then 'required_encrypted'
         else coalesce(rp.transport_security_mode, 'unencrypted')
       end,
       receiver_certificate_id = coalesce(rp.receiver_certificate_id, rp.certificate_id),
       certificate_required = case
         when rp.encryption_mode = 'smime' then true
         when rp.environment = 'production' and upper(coalesce(rp.message_family, 'PRODAT')) = 'PRODAT' then true
         else rp.certificate_required
       end,
       updated_at = now()
 where to_regclass('public.ediel_route_profiles') is not null;

-- Known AGT portal PRODAT route values are seeded registry data; profiles still
-- carry them explicitly so runtime never synthesizes PRODAT globally.
update public.ediel_route_profiles rp
   set receiver_subaddress = coalesce(nullif(rp.receiver_subaddress, ''), 'PRODAT'),
       receiver_sub_address = coalesce(nullif(rp.receiver_sub_address, ''), 'PRODAT'),
       receiver_message_subaddress = coalesce(nullif(rp.receiver_message_subaddress, ''), 'PRODAT'),
       subaddress_required = true,
       transport_security_mode = coalesce(rp.transport_security_mode, 'encrypted'),
       allow_unencrypted_test = true,
       smtp_to = coalesce(rp.smtp_to, '91100@ediel.se'),
       updated_at = now()
 where to_regclass('public.ediel_route_profiles') is not null
   and rp.environment = 'test'
   and rp.receiver_ediel_id = '91100'
  and upper(coalesce(rp.message_family, 'PRODAT')) = 'PRODAT';

-- Existing installations may already have ediel_route_runtime_v as `select rp.*`,
-- where the first column is named id. PostgreSQL cannot CREATE OR REPLACE a
-- view while changing existing column names/order, so recreate it explicitly.
drop view if exists public.ediel_route_runtime_v;

create view public.ediel_route_runtime_v as
select
  rp.company_id,
  rp.id as route_profile_id,
  rp.communication_route_id,
  rp.environment,
  rp.message_standard,
  rp.ack_mode,
  rp.payload_format,
  rp.encryption_mode,
  rp.default_message_version,
  rp.default_test_flag,
  rp.default_timezone,
  rp.receiver_ediel_id,
  rp.receiver_sub_address,
  rp.receiver_subaddress,
  rp.receiver_message_subaddress,
  rp.receiver_name,
  rp.mailbox,
  rp.application_reference,
  rp.notes as route_profile_notes,
  rp.is_enabled,
  cr.route_name,
  cr.is_active as communication_route_active,
  cr.route_scope,
  cr.route_type,
  cr.grid_owner_id,
  cr.target_system,
  cr.endpoint,
  coalesce(rp.smtp_to, cr.target_email) as target_email,
  cr.supported_payload_version,
  cr.notes as communication_route_notes,
  rp.sender_ediel_id,
  rp.sender_name,
  rp.sender_sub_address,
  rp.sender_subaddress,
  rp.subaddress_required,
  rp.signing_mode,
  rp.tls_required,
  coalesce(rp.receiver_certificate_id, rp.certificate_id) as certificate_id,
  rp.receiver_certificate_id,
  rp.certificate_required,
  rp.allow_unencrypted_test,
  rp.allow_unencrypted_production,
  rp.allow_unencrypted_production_expires_at,
  rp.allow_unencrypted_production_granted_by,
  rp.allow_unencrypted_production_reason,
  rp.security_policy_status,
  rp.smtp_host,
  rp.smtp_port,
  rp.imap_host,
  rp.imap_port,
  rp.message_family,
  rp.business_code,
  rp.transport_security_mode,
  rp.party_id,
  rp.party_address_id
from public.ediel_route_profiles rp
join public.communication_routes cr on cr.id = rp.communication_route_id;

create index if not exists ediel_route_profiles_party_resolution_idx
  on public.ediel_route_profiles(party_id, environment, message_family, business_code, is_enabled);

create index if not exists ediel_certificates_outbound_owner_lookup_idx
  on public.ediel_certificates(environment, usage, purpose, owner_ediel_id, owner_subaddress, message_family, message_type, status);
