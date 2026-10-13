# Auth-behörighetssteg för OPS

Projekt: `piidsfebjqjmnepdpnas`. Kör hela de två granskade SQL-filerna, i denna ordning.

1. [hela SQL-fil 001](release-proposals/installer-capability/001-protected-auth-schema-usage.sql) som den befintliga schemaägaren `supabase_admin`.
2. [hela SQL-fil 002](release-proposals/installer-capability/002-protected-auth-users-select-update.sql) som den befintliga tabellägaren `supabase_auth_admin`.

Kontrollera den aktuella rollen med `SELECT current_user;`. Vanlig `postgres` eller `dashboard_user` kan inte utföra de saknade behörighetsgrantsen eller anta dessa skyddade ägarroller. Om du saknar ägaranslutning behöver Supabase utföra de två filerna. Ingen API-nyckel eller service-role-token ger dessa Postgres-ägarbehörigheter. Ändra inte ägarskapskontrollerna i filerna.

Efter körningen verifierar vi de faktiska rättigheterna och kör den beroende installationskedjan. Att köra dessa två filer i sig installerar inte modulen.

Filerna finns i PR #794 under `quality/audits/2026-10-12-ops-api-contracts/release-proposals/installer-capability/` och är byte-identiska med granskade filer på commit `3e23df70`.
