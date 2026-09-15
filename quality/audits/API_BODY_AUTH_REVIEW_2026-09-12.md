# Task 10a independent review 1

Spec compliance: **NEEDS FIXES**. Code quality: **NEEDS FIXES**. Three Important findings; zero Critical findings. This is a bounded source/spec review, not supported-runtime or production acceptance.

## Frozen scope and routing

Reviewed base `8f8d33119542a0b3cfd489eeb89107f8e686db33` against `task-10a-review-package-1.diff`: 64,449 bytes, SHA-256 `9486bfe0e5647577d7b2e710f0c0abfdafef8ddfc7f83047210597f14cd52bfd`. Author report: 8,631 bytes, SHA-256 `bc031b84189d2750f239c44887cc4a75de6ec103bfd38daca78c0476c483e094`. Independently recomputed both digests and all 13 file digests in the report; all matched. Review requirements are Task 10a only in `task-10-brief.md`, the exact decisions in `task-10a-prep.md`, and Task 10/global constraints in the current plan.

Read AGENTS, memory README/current-state/checkpoint, API/security/authentication memory, applicable decisions/known-failure entries, the frozen diff, all changed route bodies and relevant complete functions in the three large partner modules. Named cross-file risks justified reading actual dispatch selectors, auth/RPC and tenant-context construction, public-target URL/DNS policy, strict/idempotent reader path, bounded reader/wrapper, billing HMAC/target binding, manual-inbound HMAC/mailbox binding, Resend SDK wrapper/event persistence, and Ediel actor identity policy. The task brief/AGENTS full-path requirement overrides the generic task-reviewer template's diff-only default.

Activated local code-review, differential-review, find-bugs, verification-before-completion and the task-reviewer prompt; applied direct false-positive verification to the concrete envelope finding. Spec-to-code and quality-playbook were inspected for routing, but their broad agent fan-outs/patch generation are outside this explicitly bounded, no-agents/no-source-edits review. `using-superpowers` explicitly exempts dispatched subagents. Repository discovery/docs, new worktrees, planning/design, remediation/TDD, UI/performance, SQL/RLS mutation, supply-chain installation, scanner installation, hooks, skill authoring and delivery workflows were not activated: their operations are outside the frozen task or expressly prohibited. No broader baseline audit is claimed.

## Strengths and checked invariants

- Actual catch-all dispatch (`app/api/partner/v1/[[...path]]/route.ts:31`) now selects business, simple, canonical, then core without the clone preflight. Business returns null for either webhook path (`lib/partner-api/business.ts:769`); singular is selected by simple (`simple.ts:1159`), plural falls through canonical (`canonical.ts:337`) to core (`core.ts:1119`). Selected create handlers authenticate once, before their bounded JSON read (`simple.ts:1021`, `core.ts:738`). No new auth cache, body authority, widened scope, or company fallback was added.
- Real auth still passes the exact scope requirement and actual route cost to `authenticate_integration_request_v1` (`lib/integrations/apiAuth.ts:343` onward), then creates client/context from returned company/client values. Subscription idempotency and create calls use those same credential values (`simple.ts:1057`, `core.ts:784`). These are application-path observations; no native rate-counter or RLS result is inferred.
- Both successful selected paths run real public-target validation before idempotency/create (`simple.ts:1034–1065`, `core.ts:751–792`). The actual URL/DNS policy remains in `lib/integrations/publicWebhookTransport.ts`; no service-role subscription write accepts a private target on the inspected paths. Important finding T10A-R1 concerns the rejection contract, not an SSRF bypass.
- Price authenticates before `readJsonObject(request, 256_000)` and retains `ApiInputError` status/code/field (`business.ts:296`, `542–548`). Strict schema and price idempotency remain appropriately outside 10a.
- Billing uses 512,000 received bytes, manual inbound 2,000,000, and Resend the explicitly selected 2,000,000 application cap. All reuse the existing reader; streaming UTF-8 decoding, actual-byte accounting, early stop/cancel, and declared-length short circuit remain centralized in `lib/http/boundedRequestBody.ts:52`. Accepted body text passes directly to the existing signature implementations, without parse/reserialize in the new route layer. Resend preserves its missing-header/secret checks before the read (`app/api/webhooks/resend/route.ts:21–46`). Its existing unknown signed-event storage remains intact (`lib/email/resendWebhookEvents.ts:366` onward). This cap is not a documented provider maximum.
- All four worker routes test configured secrets and timing-safe authorization before reading. A distinct over-limit result returns 413 before worker/default dispatch; malformed/empty JSON compatibility remains the intentional wrapper behavior. Generic Ediel still supplies `companyId: null` and reports `blocked_on_generic_cron` for overrides (`app/api/ediel/outbox/process/route.ts:89–113`). Company maintenance keeps its separate secret set, reason/company checks and audit (`process-company/route.ts:17`, `60–110`). Independent missing-configuration probes returned 503, zero stream pulls, zero terminal worker calls for all four routes.
- Permanent tests import the actual catch-all, selected route modules, `requireIntegrationApiAccess`, public-target validator, readers, billing/manual signature code and Resend SDK wrapper. No Resend verifier mock occurs in the permanent test. The source proof is materially narrower; see T10A-R2.

## Important findings

### T10A-R1 — Medium: plural non-HTTPS targets lose the required rejection code and envelope

**Affected:** `lib/partner-api/core.ts:749–750`, in combination with removed catch-all preflight; regression assertions at `__tests__/api-body-auth-contracts.test.ts:278–289` cover only HTTPS loopback.

**Evidence/reproduction:** An authenticated otherwise-valid plural subscription body with `endpoint_url: "http://127.0.0.1/internal"` reaches the existing `startsWith('https://')` check before the new public-target catch. Current actual dispatch returns status 422, code `webhook_https_required`, keys `["error","request_id","api_version"]`. HTTPS loopback returns status 422, code `webhook_target_not_public`, keys `["error","request_id"]`. Both observed one auth RPC and zero idempotency/create writes. The frozen removed preflight checked every nonempty string target with `assertPublicWebhookTarget`, so the HTTP case previously returned `webhook_target_not_public` and the latter envelope.

**Impact/root cause:** The explicit existing public-target response contract changes on a normal rejected URL shape. The patch preserves that contract only after a surviving older HTTPS guard. No claim of private target acceptance is made.

**Targeted fix:** Route every nonempty target rejected by the public-target policy through the preserved public-target error response; retain any separately required missing-target semantics. Add actual singular/plural HTTP, malformed URL and HTTPS-private controls asserting exact error/request_id shape, headers, one auth call and zero idempotency/create effects. Do not restore the unbounded preflight or double authentication.

### T10A-R2 — Medium: required I/O-only verification replaces policy and routing logic

**Affected:** `quality/audits/proofs/api-body-auth-regression.mjs:88–108`, `133–140`, `295`, `326`; `__tests__/api-body-auth-contracts.test.ts:150`.

**Evidence:** The source proof replaces `isValidIdempotencyKey`, `assertPlatformSchemaReady`, `trustedClientIp`, `tenantContextForIntegration`, `publicRouteCost`, the native `isIP` parser, public payload safety and canonical dispatch. It additionally substitutes Resend header/secret/verifier helpers for its deliberately pre-verification source cases. The permanent test leaves the partner auth helpers real, but replaces `resolveConfiguredEdielAutomationActorId` with an unconditional `actor-1`. That helper is identity policy, not terminal I/O: the real implementation validates a UUID, resolves an existing profile/auth identity, and requires the appropriate profile/membership authority (`lib/ediel/automationActor.ts:14–19`, `68–79`). The fixture's actor value does not satisfy that actual policy.

**Impact/root cause:** The required actual-path/I/O-only evidence and author's broad “substitutes RPC/database/DNS/terminal-worker I/O” description are inaccurate. A passing source proof cannot establish preserved actual route-cost/context/policy behavior when those operations are replaced. Valid Ediel worker controls bypass the identity requirement. This is a test-fidelity gap; the reviewed production implementation itself does not replace those policies.

**Targeted fix:** Load/import actual policy and selected dispatch helpers, supply controlled environment plus DB/RPC/DNS/terminal I/O, and use real `node:net` parsing. For Ediel, provide a synthetic valid actor UUID and the minimal fake profile/auth/membership responses through the service boundary. Keep SDK execution explicitly hosted when unavailable locally; do not substitute a verifier then describe it as SDK acceptance. Update the evidence description to state any remaining intentional source-harness/framework limitations exactly.

### T10A-R3 — Medium: mandatory Resend raw UTF-8 signature fixture is missing

**Affected:** `__tests__/api-body-auth-contracts.test.ts:394–418`; report's signed fixture/UTF-8 claims.

**Evidence:** Every Resend event fixture consists solely of ASCII text; `jsonAtBytes` appends only ASCII `x`. `chunkBytes: 1` therefore never splits a multibyte character in a Resend SDK test. All Resend raw bodies originate from canonical `JSON.stringify`, so their signatures also fail to distinguish unchanged raw text from parse/reserialize. The noncanonical multibyte billing case at line 361 is useful but does not execute the Resend SDK contract required explicitly by prep.

**Impact/root cause:** The requested Resend exact-cap UTF-8/raw-signature proof is absent, even if every currently authored case passes. Source-only oversized rejection does not supply that evidence.

**Targeted fix:** Include a metadata-shaped Resend event containing real multibyte text and intentionally noncanonical JSON whitespace, signed over those exact received bytes, streamed so UTF-8 sequences cross chunk boundaries. Include exact 2,000,000-byte acceptance and 2,000,001-byte cancellation/rejection with absent/false length, using the installed verifier unchanged. Retain legitimate sent/bounced/clicked/received metadata controls and record the supported fixture sizes and actual SDK result; do not claim a provider maximum.

## Nonblocking coverage notes and unverified checks

- Missing-secret worker behavior is correct by source and reviewer probes, but the permanent suite configures all secrets in every `beforeEach` and never exercises this branch. Add those cases while repairing the required tests; remove every fallback secret so the scenario is genuine. The company-specific test also lacks a valid authorized company/reason control and an explicit no-worker assertion after oversized input (`__tests__/api-body-auth-contracts.test.ts:479–489`). These omissions are not reported as additional production defects.
- Public-target permanent tests check only a partial error object and no create RPC, not exact envelope/headers or absence of an idempotency row. Strengthen them with R1.
- The heterogeneous `it.each` table at lines 420–425 still needs supported TypeScript verification; no compiler failure is claimed without the missing toolchain. Prefer explicitly typed case objects if the hosted compiler rejects inferred header values.
- Supported Node 22 ESLint, script/test typechecks, Vitest, Next build and actual `resend@6.12.4` verifier execution remain NOT RUN locally. No absent-tool retry or install was attempted. The author’s claimed 21 GREEN source cases and 32 permanent cases are not substituted for these gates. The source harness intentionally strips imports/exports and executes VM contexts; it is neither a Next server nor native DB/SDK acceptance.
- No external DB, provider, DNS network request or worker was invoked. No source, migration, generated types, dependency, workflow, memory, index, commit, branch or publication changes were made by this review. Only this SDD review file was written; unrelated dirty metadata remains outside the package. Prior Task 11c acceptance and Task 10b/10c are out of scope.

## Commands and results

Read-only inspection used `rg`, `cat`, `nl -ba`, selected `sed` ranges, initial `git status --short`/`git diff --stat`, and a final status check. Hash verification used Python `hashlib.sha256` against both frozen artifacts and every file/hash row in the author report: all 13 matched.

Focused runtime check 1 used the existing source harness setup **only**, stopped before its case loop, and appended two actual catch-all calls; no files were changed:

```js
// Executed via node --experimental-strip-types --input-type=module, stdin.
const proof = readFileSync('quality/audits/proofs/api-body-auth-regression.mjs', 'utf8')
const prefix = proof.slice(0, proof.indexOf("for (const path of [['webhook', 'subscription']"))
// Import prefix + the following body as an in-memory data URL module:
for (const endpoint_url of ['http://127.0.0.1/internal', 'https://127.0.0.1/internal']) {
  state.authCalls = 0; state.createCalls = []; state.databaseCalls = []
  const path = ['webhooks', 'subscriptions']
  const req = streamedRequest(path, JSON.stringify({ name: 'Valid name', endpoint_url,
    event_types: ['customer.created'], signing_secret: 'x'.repeat(32) }))
  const res = await route.POST(req.request, { params: Promise.resolve({ path }) })
  const body = await res.json()
  console.log({ endpoint_url, status: res.status, code: body.error?.code,
    keys: Object.keys(body), authCalls: state.authCalls, creates: state.createCalls.length,
    idemWrites: state.databaseCalls.filter(x => x.table === 'customer_portal_write_idempotency').length })
}
```

Exit 0. HTTP: `422 / webhook_https_required / error,request_id,api_version / auth=1,create=0,idem=0`. HTTPS: `422 / webhook_target_not_public / error,request_id / auth=1,create=0,idem=0`. The probe has the source-harness limitations documented in R2; dispatch selection was independently checked against actual canonical source, and the early HTTPS guard does not depend on its substituted policies.

Focused runtime check 2 used the same in-memory loader and real four worker routes plus real `readJsonWithLimit`/bounded reader. Deleted the five synthetic/fallback worker-secret environment names, supplied a 300,000-byte Request stream to each POST, and asserted status 503, zero pulls, zero worker calls. All four passed, exit 0. Actor helper was an unreachable throw sentinel; these probes test only the missing-secret boundary, not authorized actor acceptance.

A focused fixture parsing doubt was checked by evaluating the billing raw string literal from line 362 and `JSON.parse` in Node: valid JSON, preserved whitespace/multibyte text. This was a rejected suspicion, not a finding.

Both VM checks emitted Node's known `stripTypeScriptTypes` ExperimentalWarning. Recorded as a harness/runtime limitation; no application error warning or supported acceptance is inferred. Full authored source/permanent suites were not re-run merely to duplicate the author report.

## Assessment

The main remediation is narrow and preserves the intended company and secret boundaries, but the explicit rejection contract and required verification fidelity need correction. Return the three stable findings to the original author, re-freeze the corrected package, and independently review before the root-owned supported/hosted gates. Do not label Task 10a verified from this review or the current source proof.
