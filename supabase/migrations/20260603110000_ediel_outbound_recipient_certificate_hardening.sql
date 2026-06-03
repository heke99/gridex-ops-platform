-- Separates sender/private S/MIME certificates from receiver public certificates.
-- This prevents outbound Ediel S/MIME messages from being encrypted to our own mailbox/P12 certificate.

alter table if exists public.ediel_certificates
  add column if not exists owner_ediel_id text null,
  add column if not exists owner_subaddress text null,
  add column if not exists owner_party_id uuid null,
  add column if not exists message_type text null,
  add column if not exists purpose text null,
  add column if not exists usage text null,
  add column if not exists is_private_material_available boolean not null default false,
  add column if not exists source text null,
  add column if not exists needs_verification boolean not null default false;

alter table if exists public.ediel_route_profiles
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists receiver_subaddress text null,
  add column if not exists receiver_sub_address text null,
  add column if not exists receiver_message_subaddress text null,
  add column if not exists certificate_id uuid null,
  add column if not exists security_policy_status text null;

-- Backfill known private P12/PFX material as inbound/signing material, not outbound recipient material.
update public.ediel_certificates
   set owner_ediel_id = coalesce(owner_ediel_id, substring(coalesce(subject, metadata->>'subject', '') from 'serialNumber=([A-Za-z0-9_-]+)')),
       usage = case
         when coalesce(p12_secret_reference, private_key_secret_reference, secret_reference, metadata->>'p12SecretReference', metadata->>'privateKeySecretReference') is not null
           then coalesce(nullif(usage, ''), 'inbound_private')
         else usage
       end,
       purpose = case
         when coalesce(p12_secret_reference, private_key_secret_reference, secret_reference, metadata->>'p12SecretReference', metadata->>'privateKeySecretReference') is not null
           then coalesce(nullif(purpose, ''), 'both')
         else coalesce(nullif(purpose, ''), 'encryption')
       end,
       is_private_material_available = case
         when coalesce(p12_secret_reference, private_key_secret_reference, secret_reference, metadata->>'p12SecretReference', metadata->>'privateKeySecretReference') is not null then true
         else coalesce(is_private_material_available, false)
       end,
       source = coalesce(source, case
         when coalesce(p12_secret_reference, private_key_secret_reference, secret_reference, metadata->>'p12SecretReference', metadata->>'privateKeySecretReference') is not null then 'p12_import'
         else 'pem_import'
       end),
       needs_verification = case
         when coalesce(owner_ediel_id, substring(coalesce(subject, metadata->>'subject', '') from 'serialNumber=([A-Za-z0-9_-]+)')) is null then true
         else needs_verification
       end,
       metadata = metadata || jsonb_build_object(
         'ownerEdielId', coalesce(owner_ediel_id, substring(coalesce(subject, metadata->>'subject', '') from 'serialNumber=([A-Za-z0-9_-]+)')),
         'usage', case
           when coalesce(p12_secret_reference, private_key_secret_reference, secret_reference, metadata->>'p12SecretReference', metadata->>'privateKeySecretReference') is not null
             then coalesce(nullif(usage, ''), 'inbound_private')
           else coalesce(nullif(usage, ''), metadata->>'usage')
         end,
         'purpose', case
           when coalesce(p12_secret_reference, private_key_secret_reference, secret_reference, metadata->>'p12SecretReference', metadata->>'privateKeySecretReference') is not null
             then coalesce(nullif(purpose, ''), 'both')
           else coalesce(nullif(purpose, ''), metadata->>'purpose', 'encryption')
         end,
         'isPrivateMaterialAvailable', coalesce(p12_secret_reference, private_key_secret_reference, secret_reference, metadata->>'p12SecretReference', metadata->>'privateKeySecretReference') is not null
       )
 where to_regclass('public.ediel_certificates') is not null;

-- Normalize receiver subaddress columns so every runtime path sees PRODAT.
update public.ediel_route_profiles
   set receiver_subaddress = coalesce(nullif(receiver_subaddress, ''), nullif(receiver_sub_address, ''), nullif(receiver_message_subaddress, '')),
       receiver_sub_address = coalesce(nullif(receiver_sub_address, ''), nullif(receiver_subaddress, ''), nullif(receiver_message_subaddress, '')),
       receiver_message_subaddress = coalesce(nullif(receiver_message_subaddress, ''), nullif(receiver_subaddress, ''), nullif(receiver_sub_address, '')),
       updated_at = now()
 where to_regclass('public.ediel_route_profiles') is not null
   and coalesce(receiver_subaddress, receiver_sub_address, receiver_message_subaddress) is not null;

-- Remove wrong outbound route certificate links where route receiver and cert owner differ.
-- Example fixed here: route receiver 91100 was linked to Div3rsa/21660 certificate serial 04B3.
update public.ediel_route_profiles rp
   set certificate_id = null,
       security_policy_status = 'receiver_certificate_missing',
       metadata = coalesce(rp.metadata, '{}'::jsonb) || jsonb_build_object(
         'certificateClearedReason', 'Route certificate owner did not match receiver Ediel ID. Outbound route requires receiver public certificate.',
         'clearedAt', now()
       ),
       updated_at = now()
  from public.ediel_certificates c
 where rp.certificate_id = c.id
   and rp.receiver_ediel_id is not null
   and coalesce(c.owner_ediel_id, substring(coalesce(c.subject, c.metadata->>'subject', '') from 'serialNumber=([A-Za-z0-9_-]+)')) is not null
   and coalesce(c.owner_ediel_id, substring(coalesce(c.subject, c.metadata->>'subject', '') from 'serialNumber=([A-Za-z0-9_-]+)')) <> rp.receiver_ediel_id;

create index if not exists ediel_certificates_outbound_lookup_idx
  on public.ediel_certificates(environment, usage, owner_ediel_id, owner_subaddress, message_type, status);

create index if not exists ediel_route_profiles_receiver_certificate_idx
  on public.ediel_route_profiles(environment, receiver_ediel_id, receiver_subaddress, message_family, certificate_id);
