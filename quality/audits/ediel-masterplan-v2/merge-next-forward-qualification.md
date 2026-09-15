# Fresh auth-action and access-capability qualification identities

Status: reviewed-source workflow preparation; actual new runs and CLI identities pending.

The earlier auth-email action-domain and canonical-access capability qualifications produced CLI identities earlier than retained-history forward `20260915172543`. They cannot be blindly appended after that source while retaining chronological timestamp selection. The coordinating task requests fresh actual qualification and genuine CLI identities after this boundary.

The available GitHub connector exposes failed-job retries but no workflow dispatch. The two isolated qualification workflows now also accept pushes only to `codex/ediel-masterplan-v2-alignment-20260915`, with their existing respective path sets. Job conditions require the exact repository and either that exact push branch or a same-repository pull request. Existing checkout chooses event PR head or push SHA with persisted credentials disabled. Permissions remain `contents: read`; PostgreSQL 17 services and their cleanup are still workflow-owned. This allows source qualification without updating or cancelling the long-running PR310 native workflow.

Every existing source pin, actual SQL behavior/atomicity/cleanup check, receipt requirement and fixed candidate hash remains required before the genuine Supabase CLI 2.101.0 creation step. The resulting filename must additionally have a timestamp strictly greater than `20260915172543`; the workflow checks the CLI output and does not construct or rename migration identities.

Qualified candidate source hashes remain:

- Auth-email action domain: `69b8d5693f586209f37950be866e3f3dd8e5d910408c34ed9cb075daab85407c`.
- Canonical-access capabilities: `ddee41e3266948eef7f9082b331f873823602266448efe7cabcb03fdb3566683`.

Offline checks pass: auth-action admission 4 tests; access-capability admission 4 tests; both YAML documents parse; exact branch/path parity/read-only permissions/owned PostgreSQL checks pass; all embedded Python blocks parse. These checks do not qualify actual SQL execution or provide fresh CLI provenance.

After both actual jobs pass, inspect their receipts and preserve genuine CLI filenames in chronological source order. Neither candidate is registered as forward eight or nine by this workflow-only change. No existing migration, seventh-forward registration, schema reference, generated type artifact or production target is modified.
