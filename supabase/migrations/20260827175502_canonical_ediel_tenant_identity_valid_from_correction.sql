begin;

update public.tenant_ediel_profiles
set valid_from = timestamptz '2026-08-27 17:31:32+00'
where valid_from = timestamptz '2026-08-27 19:30:00+00'
  and metadata ->> 'source' = 'canonical_ediel_tenant_identity_backfill_20260827';

update public.tenant_actor_identifiers
set valid_from = timestamptz '2026-08-27 17:31:32+00'
where valid_from = timestamptz '2026-08-27 19:30:00+00';

update public.tenant_actor_roles
set valid_from = timestamptz '2026-08-27 17:31:32+00'
where valid_from = timestamptz '2026-08-27 19:30:00+00';

commit;
