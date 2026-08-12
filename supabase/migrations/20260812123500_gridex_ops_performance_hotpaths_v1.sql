-- Gridex OPS production hot-path remediation v1.
-- 1) Keep duplicate detection narrow: the previous CTE materialized the entire
--    wide grid_owners row although the view only needs four columns.
-- 2) Give actor readiness a narrow certificate path so it does not repeatedly
--    scan PEM-heavy certificate rows when resolving active production encryption.

create index if not exists platform_actor_certificates_active_prod_encryption_idx
  on public.platform_actor_certificates (actor_id, valid_to desc)
  include (fingerprint_sha256, ediel_id)
  where environment = 'production'
    and purpose = 'encryption'
    and coalesce(status, '') = any (array['valid'::text, 'expires_soon'::text])
    and valid_to is not null
    and nullif(btrim(coalesce(raw_certificate_pem, '')), '') is not null;

create or replace view public.gridex_grid_owner_duplicate_v
with (security_invoker = true)
as
with base as (
  select
    g.id,
    g.name,
    g.ediel_id,
    g.org_number,
    case
      when nullif(btrim(coalesce(g.ediel_id, '')), '') is not null
        then 'ediel:' || btrim(g.ediel_id)
      when nullif(btrim(coalesce(g.org_number, '')), '') is not null
        then 'org:' || regexp_replace(g.org_number, '\\D', '', 'g')
      else 'name:' || lower(regexp_replace(coalesce(g.name, ''), '\\s+', ' ', 'g'))
    end as duplicate_key
  from public.grid_owners g
), grouped as (
  select
    base.duplicate_key,
    count(*)::integer as duplicate_count,
    array_agg(base.id order by base.name) as duplicate_ids
  from base
  where base.duplicate_key is not null
    and base.duplicate_key <> 'name:'
  group by base.duplicate_key
)
select
  b.id as grid_owner_id,
  b.name,
  b.ediel_id,
  b.org_number,
  b.duplicate_key,
  coalesce(g.duplicate_count, 1) as duplicate_count,
  coalesce(g.duplicate_ids, array[b.id]) as duplicate_ids
from base b
left join grouped g on g.duplicate_key = b.duplicate_key;

comment on view public.gridex_grid_owner_duplicate_v is
  'Canonical grid-owner duplicate projection. Deliberately keeps the base CTE narrow to avoid materializing wide operational rows on readiness/health paths.';
