# Integrations

- Supabase/PostgreSQL: canonical durable state and RLS.
- Vercel: production Next.js runtime and cron scheduling.
- Elprisetjustnu: normalized market-price source through database-driven policy.
- EDIEL/PRODAT/UTILTS: routed through tenant/environment/certificate readiness.
- Mail and invoice providers: external effects and provider references must be
  idempotent, audited and separated from canonical business identity.

Tenant integration requires one API key. Do not add tenant environment flags
for tenant identity, quote mode, area mode or reference placement.
