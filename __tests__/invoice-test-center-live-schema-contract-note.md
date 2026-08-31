# Fakturatest live schema contract

Verified against Supabase project `piidsfebjqjmnepdpnas` on 2026-08-31.

`customer_contracts` uses `starts_at` as the canonical contract start timestamp. It does not expose a `start_date` column. Delivery periods continue to use `customer_supply_periods.start_date` and `actual_start_date`.

The Fakturatest EDIFACT materialization path must therefore read `customer_contracts.starts_at` and only use `customer_supply_periods.start_date` for supply-period persistence.
