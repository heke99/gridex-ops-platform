# Tenant routing

Every read/write is scoped by `company_id` and environment. Inbound receiver identity determines tenant candidates; outbound source operation determines the tenant. Counterparty routes must reference the same tenant, and ambiguous matches fail closed. Two-tenant regression tests lock route materialization and mailbox behavior.
