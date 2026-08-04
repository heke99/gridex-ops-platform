#!/usr/bin/env bash
set -euo pipefail

PROJECT_REF="${GRIDEX_SUPABASE_PROJECT_REF:-piidsfebjqjmnepdpnas}"

command -v supabase >/dev/null 2>&1 || {
  echo "Supabase CLI saknas. Installera/aktivera CLI och kör skriptet igen." >&2
  exit 1
}
command -v psql >/dev/null 2>&1 || {
  echo "psql saknas. Installera PostgreSQL-klienten innan migrationshistoriken repareras." >&2
  exit 1
}
if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL krävs för att verifiera liveeffekterna innan migration repair." >&2
  echo "Hämta den direkta/poolade anslutningssträngen från Supabase och exportera den utan att checka in den." >&2
  exit 1
fi

supabase link --project-ref "$PROJECT_REF"
supabase migration list --linked

migration_003_state="$({ psql "$DATABASE_URL" -X -A -t -v ON_ERROR_STOP=1 <<'SQL'
with facts as (
  select
    exists (
      select 1 from supabase_migrations.schema_migrations
      where version::text = '20260804003000'
        and name = 'customer_contract_fee_consistency'
    ) as registered,
    to_regclass('public.customer_contracts') is not null as base_table_present,
    exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name='customer_contracts'
        and column_name='invoice_fee_sek' and data_type='numeric'
    ) as invoice_fee_column,
    exists (
      select 1 from pg_constraint con
      join pg_class rel on rel.oid=con.conrelid
      join pg_namespace ns on ns.oid=rel.relnamespace
      where ns.nspname='public' and rel.relname='customer_contracts'
        and con.conname='customer_contracts_invoice_fee_nonnegative'
        and con.convalidated
    ) as fee_constraint,
    exists (
      select 1 from pg_trigger tg
      join pg_class rel on rel.oid=tg.tgrelid
      join pg_namespace ns on ns.oid=rel.relnamespace
      where ns.nspname='public' and rel.relname='customer_contracts'
        and tg.tgname='gridex_apply_contract_offer_standard_fees_trg'
        and not tg.tgisinternal and tg.tgenabled <> 'D'
    ) as fee_trigger,
    coalesce((
      select encode(extensions.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')
      from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
      where ns.nspname='public'
        and p.oid=to_regprocedure('public.gridex_apply_contract_offer_standard_fees()')
    ), '') as function_hash,
    coalesce((
      select not has_function_privilege('anon', p.oid, 'EXECUTE')
         and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
         and has_function_privilege('service_role', p.oid, 'EXECUTE')
      from pg_proc p
      where p.oid=to_regprocedure('public.gridex_apply_contract_offer_standard_fees()')
    ), false) as acl_ok,
    case when to_regclass('public.customer_contracts') is null
           or to_regclass('public.contract_offers') is null then null
      else (
        select count(*)
        from public.customer_contracts contract
        join public.contract_offers offer
          on offer.id=contract.contract_offer_id and offer.company_id=contract.company_id
        where coalesce(contract.source_type,'') not in ('manual','manual_override')
          and (
            (contract.monthly_fee_sek is null and offer.monthly_fee_sek is not null)
            or (contract.invoice_fee_sek is null and offer.invoice_fee_sek is not null)
            or (contract.green_fee_value is null and offer.green_fee_value is not null)
            or (contract.discount_value is null and offer.discount_value is not null)
            or (contract.discount_unit is null and offer.discount_unit is not null)
            or (contract.start_fee_sek is null and offer.start_fee_sek is not null)
            or (contract.admin_fee_sek is null and offer.admin_fee_sek is not null)
            or (contract.break_fee_sek is null and offer.break_fee_sek is not null)
            or (contract.vat_rate is null and offer.vat_rate is not null)
          )
      ) end as backfill_gaps
)
select case
  when registered then 'registered'
  when not base_table_present then 'pending'
  when not invoice_fee_column
       and to_regprocedure('public.gridex_apply_contract_offer_standard_fees()') is null then 'pending'
  when invoice_fee_column and fee_constraint and fee_trigger
       and function_hash='2683a102674fb3468c7ad69806f60a69ac4b8f7375529bd144d1253df3fc4821'
       and acl_ok and backfill_gaps=0 then 'repair'
  else 'unsafe'
end
from facts;
SQL
} | tr -d '[:space:]')"

migration_935_state="$({ psql "$DATABASE_URL" -X -A -t -v ON_ERROR_STOP=1 <<'SQL'
with facts as (
  select
    exists (
      select 1 from supabase_migrations.schema_migrations
      where version::text = '20260804093500'
        and name = 'contract_publication_two_step_invoice_fee_repair'
    ) as registered,
    to_regclass('public.contract_publication_versions') is not null as base_table_present,
    coalesce((
      select encode(extensions.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')
      from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
      where ns.nspname='public'
        and p.oid=to_regprocedure('public.gridex_canonicalize_publication_invoice_fee_v1(jsonb,numeric)')
    ), '') as canonicalizer_hash,
    coalesce((
      select encode(extensions.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')
      from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
      where ns.nspname='public'
        and p.oid=to_regprocedure('public.gridex_finalize_contract_publication_v1(uuid,uuid,boolean)')
    ), '') as finalizer_hash,
    coalesce((
      select bool_and(
        not has_function_privilege('anon', p.oid, 'EXECUTE')
        and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
        and has_function_privilege('service_role', p.oid, 'EXECUTE')
      )
      from pg_proc p
      where p.oid in (
        to_regprocedure('public.gridex_canonicalize_publication_invoice_fee_v1(jsonb,numeric)'),
        to_regprocedure('public.gridex_finalize_contract_publication_v1(uuid,uuid,boolean)')
      )
    ), false) as acl_ok
)
select case
  when registered then 'registered'
  when not base_table_present then 'pending'
  when to_regprocedure('public.gridex_canonicalize_publication_invoice_fee_v1(jsonb,numeric)') is null
       and to_regprocedure('public.gridex_finalize_contract_publication_v1(uuid,uuid,boolean)') is null then 'pending'
  when canonicalizer_hash='33a081c873fdbc641263444cbee02ec579739efeebfbe0c00cd028bfc4ee4e67'
       and finalizer_hash='04b22c1511ae4ebbb5d4d566d774fc3979a0c1e5aec05e6d5a621f1236e53efa'
       and acl_ok then 'repair'
  else 'unsafe'
end
from facts;
SQL
} | tr -d '[:space:]')"

echo "Migration 20260804003000 classification: ${migration_003_state}"
echo "Migration 20260804093500 classification: ${migration_935_state}"

if [[ "${GRIDEX_APPLY_CONFIRMED:-}" != "YES" ]]; then
  cat >&2 <<'EOF'
No persistent database changes were made.
Review the classifications above, then rerun with:
  GRIDEX_APPLY_CONFIRMED=YES ./scripts/sync-multitenant-website-application-flow.sh
EOF
  exit 3
fi

repair_or_continue() {
  local version="$1"
  local state="$2"
  case "$state" in
    registered)
      echo "$version är redan registrerad; ingen ledgerändring behövs."
      ;;
    repair)
      echo "$version har exakt verifierade liveeffekter men saknar ledger-rad; registrerar applied."
      supabase migration repair "$version" --status applied --linked
      ;;
    pending)
      echo "$version är inte applicerad; lämnar den pending så db push kör SQL normalt."
      ;;
    *)
      echo "STOPP: $version har partiella eller avvikande liveeffekter. Migration repair är inte säker." >&2
      exit 1
      ;;
  esac
}

repair_or_continue 20260804003000 "$migration_003_state"
repair_or_continue 20260804093500 "$migration_935_state"

supabase migration list --linked
supabase db push --dry-run --linked
supabase db push --linked
supabase migration list --linked

psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 \
  -f scripts/post-apply-multitenant-website-application-flow.sql

npm run verify:multitenant-website-application-flow:static
