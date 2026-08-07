# GRIDEX-AUD-001 legacy Storage object decision

Date: 2026-08-07
Environment inspected: `gridex-ops-dev` (`piidsfebjqjmnepdpnas`)
Production changed: No

## Evidence

The `customer-documents` bucket contains exactly nine historical objects. All nine use the same six-segment legacy shape:

`companies/{companyId}/customers/{customerId}/authorizations/{filename}`

Direct database/storage inspection established:

- 9 / 9 path company IDs resolve to an existing `public.companies` row;
- the nine objects belong to one existing company ID;
- 0 / 9 path customer IDs resolve to a current `public.customers` row;
- there are eight distinct missing historical customer UUIDs;
- 0 / 9 objects have an exact `public.customer_authorization_documents` row for bucket/path/customer/company;
- 0 / 9 path customer IDs have a matching `public.powers_of_attorney` row;
- 0 / 9 path customer IDs have a matching `public.customer_contracts` row;
- the objects were created between 2026-07-08 and 2026-07-10 UTC.

The final authenticated Storage helper requires the canonical seven-segment layout:

`companies/{companyId}/customers/{customerId}/{scope}/{documentType}/{filename}`

and validates current company/customer/site ownership. The nine historical six-segment objects therefore fail closed for authenticated users and remain reachable only through the explicit service-role administrative path.

## Decision

**Retain all nine objects as service-role-only quarantine. Do not migrate, relabel, attach to a current customer, or delete them in GRIDEX-AUD-001.**

Reason: the company can be identified, but canonical customer ownership cannot be proven from current database state and no surviving authorization, POA, or contract row binds the objects to those historical customer UUIDs. Guessing ownership would be less safe than quarantine, and deletion would destroy potentially relevant historical evidence without an approved retention basis.

## Release consequence

The previous “ownership/retention decision” blocker is resolved by this evidence-based quarantine decision. No data mutation is required to implement it because the new policies already deny authenticated access to these legacy paths.

This does **not** satisfy the remaining release gates. GRIDEX-AUD-001 still requires:

1. real authenticated Storage upload/download/delete and signed-URL E2E on an approved staging target;
2. human approval of the security-sensitive Storage/migration boundary;
3. post-merge/deployment verification before `VERIFIED_CLOSED`.

Any future migration or deletion of these nine objects requires new evidence that proves ownership or an independently approved retention/deletion decision.
