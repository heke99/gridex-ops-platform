# S3: staff customer access

Base: main `fa4147b`; isolated branch `feat/staff-api-s3-20261004`.

Activated skills: repository `using-superpowers`, `using-git-worktrees`, `code-security` (SQL injection/prototype pollution), `test-driven-development`, `verification-before-completion`, and Supabase plugin guidance. The user supplied the architecture and routes, so no architecture brainstorming or unrelated Ediel work applies. The installed Next.js route-handler documentation was read before route implementation.

Implemented:
- All four customer routes call the shared staff context. Reads require `customers.read`; contact editing preserves the actual OPS command's `masterdata.write`; identity requests require `customers.write`.
- Company-bound opaque reference lookup and customer/detail reads; every contact/address/site query includes both company and customer scope. Address-history tombstones remain honored. Child collections use deterministic initial windows of 100 rows and explicit returned/has-more metadata, rather than relying on the Data API's hidden row cap.
- Closed response projections mask both identity numbers and omit internal customer/company/creator identifiers and metadata.
- Contact changes require a valid `expectedUpdatedAt`, keep omitted fields untouched, reject identity/actor/company injection, and use the existing atomic command with both staff and API client attribution. The historical sequential fallback remains available to existing OPS/customer routes, but staff API requests fail closed if the atomic RPC is unavailable.
- Identity changes reuse the existing customer approval flow. Additive durable source/client attribution is sent only on staff requests, preserving deployment compatibility for existing OPS requests.
- Shared idempotency is used on both writes; the staff actor participates in payload matching. Domain contact keys include client, staff, customer and a hash of the external key.
- The strict company list uses a parameterized SQL search with deterministic paging. The original OPS search's newest-1000 cap is not inherited; regular OPS functions remain unchanged.

Executed verification:
- Failing tests first reproduced missing staff attribution and unsafe staff fallback, then passed after implementation.
- Five focused suites: 51/51 tests pass (new domain/ownership/routes/pagination plus existing contact and identity suites).
- Scoped ESLint: pass.
- Application TypeScript with 4096 MB heap: pass after copying the root-owned context/assertion dependencies into the isolated worktree for integration verification. These dependency files are excluded from the S3 commit.
- `git diff --check`: pass.
- Service-role tenant ratchet: pass, 2252 direct call sites versus unchanged baseline 2353.

Next integration gates belong to root: S1 SQL migrations (opaque lookup, complete search, atomic identity request audit and durable decision attribution), real native SQL regression, generated types/schema artifacts, complete tests/OpenAPI parity/exact-head CI, and authorized release. No production DDL, data mutation or publication occurred in this isolated package.
