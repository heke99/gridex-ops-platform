-- GRIDEX-REM-002 replay-only prerequisite.
-- Source: migrations/20260902100045_fix_website_poa_scope_and_grid_owner_aliases.sql
-- Reconstruct only the name-normalization function before the earlier-timestamped
-- advisor-hardening migration consumes it. The canonical source is replayed later.

create or replace function public.gridex_grid_owner_name_key(p_name text)
returns text
language sql
immutable
parallel safe
as $$
  select regexp_replace(
    regexp_replace(
      regexp_replace(lower(btrim(coalesce(p_name, ''))), '[^a-z0-9åäö]+', ' ', 'g'),
      '\\s+(ab|aktiebolag)$',
      '',
      'g'
    ),
    '\\s+',
    '',
    'g'
  );
$$;
