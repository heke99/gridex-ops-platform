#!/usr/bin/env bash
set -euo pipefail
: "${GRIDEX_CLEAN_DATABASE_URL:?Set GRIDEX_CLEAN_DATABASE_URL to a disposable empty database}"

node scripts/check-production-migration-readiness.cjs

mapfile -t migrations < <(find supabase/migrations -maxdepth 1 -type f -name '[0-9]*_*.sql' | sort)
for migration in "${migrations[@]}"; do
  echo "Applying $migration"
  psql "$GRIDEX_CLEAN_DATABASE_URL" -v ON_ERROR_STOP=1 -f "$migration"
done

psql "$GRIDEX_CLEAN_DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
select count(*) as public_tables
from information_schema.tables
where table_schema='public' and table_type='BASE TABLE';
select count(*) as public_views
from information_schema.views
where table_schema='public';
select count(*) as security_definer_functions
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.prosecdef;
SQL
