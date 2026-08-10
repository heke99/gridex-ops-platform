# Quality Constitution: Gridex OPS external integration remediation

## Purpose

Quality in this campaign means that an external tenant can use Gridex OPS without learning internal database structure, crossing a tenant boundary, losing historical records, or receiving a plausible success when the platform cannot establish truth. Following Deming, these constraints are built into typed registries, DTO boundaries, forward migrations, and executable gates rather than inspected manually after release.

Juran's fitness-for-use standard is concrete here: a tenant must be able to bootstrap, traverse every eligible resource, retry every write, verify every webhook, and recover from transient infrastructure failures using only the published contract. Crosby's prevention principle means strict response validation, migration parity, and tenant-isolation tests are cheaper than repairing financial, legal, or privacy damage after deployment.

## Coverage Targets

| Subsystem | Target | Why |
|---|---:|---|
| Public DTO and response boundary | 95% | A single raw UUID or newly added DB field is a tenant-visible privacy defect. |
| Pagination, detail lookup, idempotency | 95% | Boundary defects can silently hide 901 of 1,001 invoices or wedge a committed write. |
| Authentication, identity and rate limiting | 90% | These are tenant authorization decisions and must fail closed under dependency failure. |
| OpenAPI registry and release generation | 90% | Contract drift already admitted an invalid operationId and misleading parity failures. |
| Webhook projection, signing and delivery | 90% | A global secret or blacklist projection can cross tenant and schema boundaries. |
| Migration and database integrity gates | 85% | The connected dev ledger is ten migrations ahead of the uploaded repository. |
| Release evidence and operational telemetry | 80% | Performance and provenance claims require environment-specific evidence. |

## Coverage Theater Prevention

The following do not count as verification: checking only HTTP 200; asserting that a mapper returned an object; testing pagination on an already materialized array while ignoring the database query; validating handwritten examples instead of route output; mocking a limiter to return its configured value; counting migrations without comparing their ledger statements; or calling a webhook mapper without asserting its exact allowed keys and tenant-specific signature.

## Fitness-to-Purpose Scenarios

### Scenario 1: The 1,001st invoice remains reachable

**Requirement tag:** [Req: formal — master points 4, 5 and 58]

**What happened:** List helpers cap database reads at 100 rows before Node pagination. For a customer with 1,001 invoices, 901 records can never be returned and the API may claim has_more=false while financial history exists.

**The requirement:** Every supported portal list must perform tenant-bound keyset pagination in PostgreSQL, fetch page size plus one, and traverse duplicate sort timestamps without loss or duplication.

**How to verify:** Seed 1,001 rows including timestamp ties, walk every opaque cursor, and assert the ordered identity set is exactly equal to the seed set.

### Scenario 2: An old invoice opens directly

**Requirement tag:** [Req: formal — master point 6]

**What happened:** Invoice detail scans the first 100 list results, so an older but valid reference becomes a false 404 when enough newer invoices exist.

**The requirement:** Detail resolution is one indexed lookup by company, customer and canonical invoice reference; another tenant receives the same neutral 404 as an unknown reference.

**How to verify:** Put the target beyond row 1,000 and assert one tenant-bound database lookup returns it while a second tenant cannot distinguish it from missing.

### Scenario 3: Broken schema never looks empty

**Requirement tag:** [Req: formal — master points 7 and 73]

**What happened:** Exhausted schema fallbacks return an empty array. A column removal can therefore appear to customers and operators as a healthy account with no contracts or metering data.

**The requirement:** Recognized schema incompatibility produces the canonical platform_schema_not_ready 503 envelope. Empty 200 is reserved for a successful zero-row query.

**How to verify:** Inject a missing-column error and assert 503, retryable=true, blockers present, and no data array.

### Scenario 4: Public output cannot inherit a database column

**Requirement tag:** [Req: formal — master points 1–3, 16–18 and 69]

**What happened:** Existing mappers are mostly allowlists, but the common serializer accepts arbitrary objects. A new nested internal field can reach a response or example without a global gate noticing it.

**The requirement:** Versioned output schemas reject unknown properties, forbidden internal field names, and non-allowlisted UUID-like values at the final serialization boundary.

**How to verify:** Mutate every fixture with nested company_id, workflow_id and a UUID; each response validation must fail before bytes are emitted.

### Scenario 5: Retried writes are deterministic and tenant-local

**Requirement tag:** [Req: formal — master points 8, 9 and 35]

**What happened:** Claiming an idempotency record is durable, but completing it is best effort. A committed mutation can remain processing and become unreplayable after the client already received success.

**The requirement:** Claim, business mutation, critical audit and response completion share a durable lifecycle bound to tenant, client, operation, resource, key and canonical hash.

**How to verify:** Exercise same-key/same-body replay, same-key/different-body conflict, two-tenant key reuse, and injected completion failure.

### Scenario 6: Bootstrap references reveal no primary key

**Requirement tag:** [Req: formal — master points 19–21 and 55]

**What happened:** api_client_reference removes UUID hyphens but preserves all UUID bits. Clients can reconstruct the internal primary key and correlate internal records.

**The requirement:** Tenant and API-client references are persisted random or tenant-bound cryptographic identifiers, and all lookups repeat the server-resolved tenant predicate.

**How to verify:** Assert the bootstrap response contains required readiness/version links, no internal IDs, and no reversible UUID representation.

### Scenario 7: Registry and release cannot drift

**Requirement tag:** [Req: formal — master points 10–18, 24, 50 and 57]

**What happened:** Registry and OpenAPI are independent representations; one operationId contains a closing brace and source-string parity checks inspect a facade instead of runtime modules.

**The requirement:** One typed operation registry drives operation metadata, OpenAPI, fixtures and release gates; operationIds are valid and globally unique.

**How to verify:** Generate artifacts twice, compare bytes, validate every route both directions, validate examples and actual responses, and lint identifiers and versions.

### Scenario 8: Webhook secrets never cross tenants

**Requirement tag:** [Req: formal — master points 36–39 and 60]

**What happened:** Webhook data is blacklist-sanitized and a production subscription may use a global fallback secret. A new sensitive field or shared secret can silently cross a tenant boundary.

**The requirement:** Registered event versions have exact DTO schemas and per-subscription active/previous secrets while durable retry, locking and public delivery references remain intact.

**How to verify:** Sign the same event for tenants A and B; neither secret verifies the other payload, unknown fields are rejected, and delivery identities stay separate.

### Scenario 9: Repository replay reconstructs connected dev

**Requirement tag:** [Req: formal — master points 40–49 and 61–62]

**What happened:** The live dev migration ledger contains ten versions missing from source. A clean environment can pass repository checks while lacking atomic auth, route cost, identity and fingerprint functions.

**The requirement:** Historical statements are restored exactly, all new fixes are forward migrations, and clean replay/catalog checks cover functions, constraints, indexes and RLS.

**How to verify:** Replay into an empty database, compare migration checksums and catalog fingerprints with connected dev, then run tenant-isolation SQL.

### Scenario 10: Release claims are environment-specific

**Requirement tag:** [Req: formal — master points 43, 63–65 and 71–75]

**What happened:** Only dev is connected and the archive has no Git metadata. Treating dev results as production verification would create a false release stamp with no exact source, CI or deployment SHA.

**The requirement:** Evidence identifies environment and immutable source; production closure requires matching source, CI and deployed SHA plus production database parity and measured latency.

**How to verify:** The release gate rejects missing or mismatched provenance and never promotes dev-only evidence to production status.

## AI Session Quality Discipline

1. Read this constitution before implementation.
2. Write a failing reproducer for every confirmed defect before its fix.
3. Preserve historical migrations and apply only reviewed forward changes.
4. Run focused tests while editing and the complete gate set before handoff.
5. Record live evidence with project and environment identifiers.
6. Never remove a scenario; update evidence when architecture changes.

## The Human Gate

Production and staging credentials, GitHub branch protection, Vercel deployment provenance, business approval of deprecation dates, retention periods for legal evidence, and UX judgment require an authorized human or connected system. Dev evidence cannot satisfy those gates.
