# Gridex OPS canonical remediation — design

Date: 2026-08-10

## Decision

The existing platform remains the implementation boundary. Access, tenant lifecycle, invitation delivery, provisioning jobs, customer-application repair, reconciliation and release evidence converge on canonical PostgreSQL commands.

## Runtime boundaries

- Authentication and authorization resolve once per request through `canonical_authenticated_tenant_context`; uncertainty fails closed.
- `canonical_create_tenant_invitation` persists durable intent before any Auth provider call. Acceptance occurs only through the token-bound canonical access command.
- Tenant state changes use `canonical_transition_tenant_lifecycle`.
- Provisioning workers use lease claims, bounded attempts and canonical completion.
- Incomplete legacy customer applications receive an owner, reason, SLA and explicit repair state. Replay is permitted only after current schema and identity requirements pass.
- Reconciliation persists findings and records a failed check as critical, never green.
- Release receipts bind Git, CI, deployment and migration identities.

All database changes are additive forward migrations. Public APIs remain compatible. Service-role operations remain server-only and no customer data is fabricated to repair missing legacy input.
