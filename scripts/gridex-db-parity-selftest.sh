#!/usr/bin/env bash
# GRIDEX OPS master remediation plan, Fas 4 (§7) — parity engine self-test.
#
# The parity engine is a production gate, so it needs a gate of its own: a
# comparator that silently stops detecting drift is worse than no comparator,
# because a green run would then be read as parity.
#
# Builds two throwaway databases from one schema, asserts they compare clean,
# injects one drift of every class the plan requires, and asserts each class is
# reported. Reads no repository schema and leaves no databases behind.
#
# Usage: scripts/gridex-db-parity-selftest.sh [admin-postgres-url]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ADMIN_URL="${1:-${GRIDEX_PARITY_SELFTEST_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}}"
CANON_DB="gridex_parity_selftest_canon"
TARGET_DB="gridex_parity_selftest_target"
BASE_URL="${ADMIN_URL%/*}"
CANON_URL="$BASE_URL/$CANON_DB"
TARGET_URL="$BASE_URL/$TARGET_DB"
REPORT="$(mktemp)"

command -v psql >/dev/null || { echo "psql is required" >&2; exit 127; }

drop_databases() {
  psql "$ADMIN_URL" -X -q -Atc "drop database if exists $CANON_DB;" >/dev/null 2>&1 || true
  psql "$ADMIN_URL" -X -q -Atc "drop database if exists $TARGET_DB;" >/dev/null 2>&1 || true
}
cleanup() { drop_databases; rm -f "$REPORT"; }
trap cleanup EXIT

drop_databases
psql "$ADMIN_URL" -X -q -v ON_ERROR_STOP=1 -c "create database $CANON_DB;" -c "create database $TARGET_DB;"

apply_base() {
  psql "$1" -X -q -v ON_ERROR_STOP=1 <<'SQL'
create table companies (id uuid primary key, name text not null, created_at timestamptz default now());
create table customers (
  id uuid primary key,
  company_id uuid not null references companies(id),
  customer_number text not null,
  email text,
  constraint customers_company_number_key unique (company_id, customer_number)
);
create index customers_active_idx on customers (company_id) where email is not null;
create type parity_selftest_state as enum ('pending', 'sent', 'done');
create table switches (id uuid primary key, company_id uuid not null, state parity_selftest_state not null default 'pending');
alter table customers enable row level security;
create policy customers_tenant_read on customers for select
  using (company_id = current_setting('app.company_id', true)::uuid);
create function selftest_normalize() returns trigger language plpgsql as $$
begin new.email := lower(new.email); return new; end $$;
create trigger customers_normalize before insert on customers for each row execute function selftest_normalize();
create view active_customers as select id, company_id from customers where email is not null;
grant select on customers to public;
-- Built-in monitoring role exists in each throwaway database; no cluster role
-- creation or cleanup is needed for grant-option comparison.
grant select on customers to pg_monitor;
grant execute on function selftest_normalize() to pg_monitor;
grant usage on schema public to pg_monitor;
create view secure_customers with (security_invoker=true, security_barrier=true)
  as select id, company_id from customers;
SQL
}
apply_base "$CANON_URL"
apply_base "$TARGET_URL"

echo "[parity selftest] identical schemas must compare clean in blocking mode"
if ! node "$ROOT/scripts/gridex-db-parity.cjs" \
  --canonical "$CANON_URL" --target "$TARGET_URL" --mode blocking --no-ignore > "$REPORT" 2>&1; then
  echo "[parity selftest] FAIL: identical schemas reported drift" >&2
  cat "$REPORT" >&2
  exit 1
fi

# One drift per class the plan requires the engine to see.
psql "$TARGET_URL" -X -q -v ON_ERROR_STOP=1 <<'SQL'
drop table switches;
create table audit_extra (id uuid primary key, note text);
drop view active_customers;
alter table customers alter column email type varchar(50);
create view active_customers as select id, company_id from customers;
alter table companies alter column name drop not null;
alter table companies alter column created_at drop default;
alter table customers drop constraint customers_company_number_key;
alter table customers drop constraint customers_company_id_fkey;
drop index customers_active_idx;
alter table customers disable row level security;
drop policy customers_tenant_read on customers;
create policy customers_tenant_read on customers for select using (true);
drop trigger customers_normalize on customers;
create or replace function selftest_normalize() returns trigger language plpgsql as $$
begin return new; end $$;
revoke select on customers from public;
alter view secure_customers set (security_invoker=false, security_barrier=false);
alter table companies set (fillfactor=80);
grant select on customers to pg_monitor with grant option;
grant execute on function selftest_normalize() to pg_monitor with grant option;
grant usage on schema public to pg_monitor with grant option;
SQL
psql "$CANON_URL" -X -q -v ON_ERROR_STOP=1 -c "alter type parity_selftest_state add value 'cancelled';"

echo "[parity selftest] injected drift must fail blocking mode"
if node "$ROOT/scripts/gridex-db-parity.cjs" \
  --canonical "$CANON_URL" --target "$TARGET_URL" --mode blocking --no-ignore > "$REPORT" 2>&1; then
  echo "[parity selftest] FAIL: injected drift did not fail blocking mode" >&2
  cat "$REPORT" >&2
  exit 1
fi

expect() {
  if ! grep -qF -- "$2" "$REPORT"; then
    echo "[parity selftest] FAIL: $1 was not detected (expected substring: $2)" >&2
    cat "$REPORT" >&2
    exit 1
  fi
  echo "[parity selftest]   ok: $1"
}

expect "dropped relation"            "relation public.switches: in canonical, missing in target"
expect "unexpected live relation"    "relation public.audit_extra: in target, missing in canonical"
expect "column type change"          "column public.customers.email: data_type differs"
expect "nullability change"          "column public.companies.name: is_nullable differs"
expect "column default change"       "column public.companies.created_at: column_default differs"
expect "dropped unique constraint"   "constraint public.customers.customers_company_number_key: in canonical, missing in target"
expect "dropped foreign key"         "constraint public.customers.customers_company_id_fkey: in canonical, missing in target"
expect "dropped partial index"       "index public.customers.customers_active_idx: in canonical, missing in target"
expect "disabled row level security" "relation public.customers: relrowsecurity differs"
expect "rewritten policy"            "policy public.customers.customers_tenant_read: using_expression differs"
expect "dropped trigger"             "trigger public.customers.customers_normalize: in canonical, missing in target"
expect "changed function body"       "function public.selftest_normalize(): body_md5 differs"
expect "revoked grant"               "relation grant public.customers SELECT -> PUBLIC: in canonical, missing in target"
expect "added enum value"            "enum value public.parity_selftest_state.cancelled: in canonical, missing in target"
expect "silently rewritten view"     "relation public.active_customers: view_definition differs"

expect "view security options"       "relation public.secure_customers: reloptions differs"
expect "table relation options"      "relation public.companies: reloptions differs"
expect "relation grant delegation"   "relation grant public.customers SELECT -> pg_monitor: is_grantable differs"
expect "function grant delegation"   "function grant public.selftest_normalize() EXECUTE -> pg_monitor: is_grantable differs"
expect "schema grant delegation"     "schema grant public USAGE -> pg_monitor: is_grantable differs"

echo "[parity selftest] PASS: every required drift class is detected"
