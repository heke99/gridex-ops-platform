# Customer portfolio SQL behaviour test

Runs `20261003130000_customer_portfolio_analytics_whitelabel.sql` against a
minimal stub schema in a throwaway Postgres 16 database and asserts tenant
isolation, white-label read-only access, superadmin-only assignment, audit
logging and idempotent snapshots. Any `LEAK` / `ERROR` line is a failure.

```sh
createdb pt
psql -d pt -v ON_ERROR_STOP=1 -f scripts/sql/customer-portfolio/00_stub.sql
psql -d pt -v ON_ERROR_STOP=1 -f supabase/migrations/20261003130000_customer_portfolio_analytics_whitelabel.sql
psql -d pt -v ON_ERROR_STOP=1 -f scripts/sql/customer-portfolio/10_behaviour.sql
```
