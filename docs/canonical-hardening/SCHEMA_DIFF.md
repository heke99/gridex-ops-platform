# Schema diff summary

## Remote vs local

| Area | Remote observation | Local intended state | Status |
|---|---|---|---|
| Migration ledger | 9 applied versions | complete registered history | BLOCKED |
| A–C canonical functions | bodies match local | ledger + schema aligned | PARTIAL MATCH |
| D–F evidence/provisioning/backfill | ledger absent | applied before convergence | NOT VERIFIED |
| Request-bound idempotency | `request_hash` absent | non-null SHA-256 + mismatch rejection | PENDING |
| Actor verification | caller-supplied actor trusted by old RPC | active Auth/profile + DB permission | PENDING |
| Canonical readiness | no canonical read-only gate | `canonical_company_readiness` | PENDING |
| Profile identity | active profile selected by timestamp | explicit `(company, environment) -> profile_id` | PENDING |
| Internal function grants | trigger helpers broadly executable | owner/internal only | PENDING |
| Test tenant scope | 153 runs missing company | quarantined/resolved before constraints | BLOCKED |

No remote mutation was performed, so all intended changes remain pending until staging apply.
