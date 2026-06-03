-- Mail readiness, Expisoft certificate cache, and AGT/TGT setup package metadata.

alter table if exists public.ediel_system_test_settings
  add column if not exists setup_package text null,
  add column if not exists actor_role text null,
  add column if not exists message_family text null,
  add column if not exists application_reference text null,
  add column if not exists environment_type text null,
  add column if not exists certificate_environment text null,
  add column if not exists transport_environment text null,
  add column if not exists smtp_provider text null,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table if exists public.ediel_route_profiles
  add column if not exists smtp_provider text null,
  add column if not exists certificate_environment text null,
  add column if not exists transport_environment text null,
  add column if not exists target_system text null,
  add column if not exists route_name text null;

create table if not exists public.ediel_certificate_directory_cache (
  id uuid primary key default gen_random_uuid(),
  party_id uuid null references public.ediel_parties(id) on delete set null,
  company_id uuid null references public.companies(id) on delete cascade,
  smtp_email text not null,
  ediel_id text null,
  subaddress text null,
  source text not null default 'expisoft_ldap',
  certificate_id uuid null references public.ediel_certificates(id) on delete set null,
  public_certificate_pem text null,
  raw_der_base64 text null,
  subject text null,
  issuer text null,
  serial_number text null,
  not_before timestamptz null,
  not_after timestamptz null,
  sha256_fingerprint text not null,
  key_usage text null,
  subject_alt_names text null,
  crl_distribution_points text null,
  fetched_at timestamptz not null default now(),
  last_validated_at timestamptz null,
  status text not null default 'unknown',
  diagnostics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ediel_certificate_directory_cache_status_chk check (status in ('valid', 'expired', 'revoked', 'not_yet_valid', 'invalid', 'unknown'))
);

create unique index if not exists ediel_certificate_directory_cache_email_fp_idx
  on public.ediel_certificate_directory_cache(smtp_email, sha256_fingerprint);

create index if not exists ediel_certificate_directory_cache_lookup_idx
  on public.ediel_certificate_directory_cache(smtp_email, status, fetched_at desc);
