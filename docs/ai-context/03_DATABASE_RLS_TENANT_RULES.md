# Database, RLS and Tenant Rules

## Core tenant rules

- Every tenant-owned operational record must be scoped by company_id or an equivalent tenant identifier.
- Server actions must not trust company_id submitted from forms.
- Resolve company_id from authenticated membership, platform role, route profile or verified actor configuration.
- Platform/superadmin operations must be explicitly guarded.
- Regular tenant admins must not access other tenants' data.
- Shared mailbox data must be routed to tenant only after verified Ediel/CMS/route parsing.
- Uploaded billing/import files must be tenant-scoped.
- Billing underlay rows must be tenant-scoped.
- Platform usage events must be tenant-scoped.

## RLS principles

- RLS must protect tenant data.
- Policies must be explicit and predictable.
- Avoid broad public access.
- Service role usage must be limited to server-side trusted operations.
- If RLS is changed, document why.

## Database migration rules

When creating or changing migrations:

- use idempotent patterns where possible
- do not delete data unless explicitly required
- avoid destructive changes
- include indexes for tenant/query-heavy tables
- include audit where relevant
- preserve existing approved Ediel flows
- check table/column existence if live DB may differ from repo migrations
- avoid migration names that collide with existing migration files
- keep customer billing and platform billing separated in table names and logic

## Known live DB risk

Live database and repo migrations may not always match. Before assuming a table/column exists, inspect actual schema references or existing migrations.

## Superadmin vs tenant admin

Tenant admins should not create/edit:

- grid owners
- electricity suppliers
- Ediel parties
- subaddresses
- routes
- certificates
- SMTP/mailbox settings
- production Ediel route settings
- platform usage pricing

These should be controlled by superadmin/platform admin or technical admin.
