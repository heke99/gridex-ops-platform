# Dependency and platform security report

| Check | Result |
|---|---|
| Locked install under Node 22.22.0 | PASS |
| Production dependency audit | PASS — 0 vulnerabilities |
| Next.js 16.2.12 production build | PASS |
| Supabase PostgreSQL 17.6 compatibility | OBSERVED |
| SQL PostgreSQL parser | PASS |

Current Supabase release guidance was reviewed for PostgreSQL 17, supported Node runtimes, migrations, RLS and SECURITY DEFINER behavior. The project is tested on Node 22 rather than an unsupported older runtime.

Remote Supabase security/performance advisors still contain findings unrelated to merely changing source files. They must be rerun after staging migration apply. Advisor state is therefore **NOT VERIFIED POST-APPLY**.
