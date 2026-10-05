# Support portal storage target

User requirement: all new support, customer, staff, membership, role and Auth
data belongs to named **gridex-prod**, reference **ayiuxjlfazkjmmtlvhsl**.
Historical acceptance against OPS project `piidsfebjqjmnepdpnas`
(`gridex-ops-dev`) must not be relabeled as named-prod acceptance.

The independent portal requests `X-Gridex-Expected-Project-Ref` on every Staff
API call. `withStaffApi` rejects malformed/mismatching targets with HTTP412,
code `storage_project_mismatch`, before resolving API authentication, replay
state, rate limits, audit or domain handlers. Thus a rejected write cannot
write even a request/audit row in another database.

The advertised project is parsed from `SUPABASE_SERVICE_URL`, captured from the
exact settings supplied to both real SDK service-client constructors.
Successful JSON and binary handler responses carry `X-Gridex-Project-Ref`.
Failures do not make a successful storage attestation. Existing API clients
that do not send the new expected-target header preserve their existing
behavior; the new support client requires the header in its successful probe
before it can issue a command.

This is an additive deployment safeguard around the immutable Staff
`2026-10-04.1` release. The frozen contract body and historical qualification
sources are unchanged. This report documents the new header and412 separately;
it does not claim all error/header variants are described by the old manifest.

Read-only named-prod readiness inspection is **NOT_READY**:26 functions named
by the22 Staff forwards are absent,17 of34 sampled real relations are absent,
the private attachment bucket is absent, and no frozen Staff forward is
recorded in the six-entry migration ledger. Staff write execution additionally
requires the actually used `customer_portal_write_idempotency`, which is absent;
`user_permissions` exists. Root company inventory found Div3rsa AB and Nibela
AB, no Gridex row. Production tenant/admin registration remains unresolved.

No migration, client/provider registration, real invitation, domain reassignment
or deployment configuration change has been performed for this integration.
Code and offline verification do not establish named-prod live readiness.
