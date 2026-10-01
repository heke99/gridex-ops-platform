# T36/P7: actual Next/GoTrue protected-read denial journey

Status: **PREPARED; native seed 0, Next browser journey 0, native postcheck 0 executed.** This packet adds evidence fixtures only. It changes none of the frozen scanner25/T40 production files, SQL, permissions, public 3.3 contracts or provider configuration. The earlier scanner17 PostgreSQL-core/26 controlled runtime receipts and scanner14 prepared native cases remain separate evidence; they do not qualify this journey.

## Scope and actual boundaries

The seed requires a disposable local GoTrue/Data API/Storage stack at `http://127.0.0.1:54321` and PostgreSQL at `127.0.0.1:54322`. It first requires nonempty invoice, export-item, underlay, pricing, invoice-line and invoice-document tables from the preceding genuine billing fixtures. It captures every current public table in the `billing_`, `invoice_`, `pricing_`, `customer_invoice` families plus contracts/price snapshots, including every complete row and count, as SHA-256 snapshots. Native seed must not change that prior financial surface.

Four synthetic users are created and confirmed through actual GoTrue Admin, then log in through actual GoTrue password issuing. `getClaims()` and `getUser()` verify the real subject/session before the native OPS command and attachment intake. No `auth.users`/`auth.sessions` INSERT fabricates issuing. Current custom company permissions/memberships use the existing canonical authority engine; no platform grant is given. The intake uses the unchanged support command/intake library, real private Storage upload/download and physical SHA-256 verification. Synthetic companies/legal versions, immutable intake receipts and private objects are retained until disposable stack disposal.

The browser uses the rendered Next login form and unchanged Server Action. Its new cookie is verified through the installed SSR client’s `getClaims()`/`getUser()` and the canonical authenticated tenant RPC. Its session must exist in GoTrue’s database and differ from every pre-seed session. Only the ordinary selected-company preference cookie is set by the controller. Actual mounted Next download, process and verdict routes run their existing guard/current-support-session/nonce/owner/Storage/final-clock code. The controller supplies no fake guard, caller-asserted verification or fabricated Auth cookie.

The locally generated RS256 issuer/key and private trust root qualify only synthetic evidence mechanics. An actual Next callback must authenticate its transport, verify the signed exact-lineage challenge and physical private bytes, commit once and reject replay after current root revocation. The unchanged production adapter remains absent, so the process route must persist `blocked_scanner_qualification`. Every download remains denied, including after synthetic `clean` evidence. There is no malware-provider approval, physical scanner qualification, production tenant/account, external key enrollment or released/downloadable file in this proof.

## Prepared journey: 12 explicit checks

| Check | Required observed result |
| --- | --- |
| Anonymous cookie | Actual GET/POST return 401 with protected JSON/security headers and no nonce. |
| Callback transport | Unauthorized and multibyte bearer return safe 401; no receipt is written. |
| Controlled signature | Actual Next callback/replay returns private blocked evidence, exactly one receipt, no release. |
| Absent adapter/current root | Process blocks the second exact intent; revoked root denies prior signed callback replay. |
| Actual Next session/physical read | Current writer gets a nonce and physical-hash-verified 423; same-session replay is denied. |
| Session/resource/CSRF binding | A different actual session of the same user is denied on a still-unconsumed nonce with exact row equality; sibling and cross-site requests are denied. |
| Current read permissions | `cases.read` without `cases.write` can inspect only a denied read; lacking `cases.read` gets 403. |
| Foreign tenant | Actual foreign membership and forged selected-company preference are both denied. |
| Final post-physical clock | An exact owned final-nonce trigger expires only the genuine current session inside that transaction. The surviving sequence must show exactly one hook call, while the nonce and complete session rows roll back. |
| TTL/current membership | The immutable issued nonce expires by the real 60-second clock; a current membership revoked after capture rejects its still-unconsumed capability. Both denied nonce rows stay unchanged. |
| Actual GoTrue revocation | Local-scope GoTrue logout removes the exact browser-issued session; its captured browser cookie/read capability still yields 401/403 and no nonce effect. |
| Whole baselines/private bytes | Complete financial/identity/profile/role and preexisting-session snapshots, own public command/audit/domain rows, quiet tenant and Storage lineage/physical bytes stay equal. Public/authenticated Storage access and browser file downloads return no bytes. |

The final-clock fault is explicitly fixture-only: one private function/sequence and trigger, restricted to one exact synthetic nonce and its already GoTrue-issued session. It has no executable RPC/grant and never disables an existing trigger, guard or RLS policy. `finally` removes only those owned hooks. Sequence advancement is nontransactional and excludes an early session denial false positive. The real nonce TTL is observed without rewriting immutable `issued_at`/`expires_at` fields.

Expected independent postcheck: six exact owned read nonces, two consumed; two unchanged cases/internal messages/attachments; exactly one private scan receipt; one default-absent blocked job; current GoTrue logout actually removed its session; the intended reader membership alone changed `is_active`; all preceding sessions/identities/roles/profile rows and complete finance/public/quiet/storage baselines stay equal. Login legitimately changes only `auth.users`/`auth.identities` last-login/update timestamps and creates the five newly verified browser sessions. Their identities and the explicit revocation are checked separately.

## Privacy and execution order

Run contiguously **after the billing-recipient and billing-revision-views native/browser/postcheck fixtures have produced and qualified their issued invoice graphs**, before starting unrelated mutable jobs. Keep the same fully migrated disposable stack and private native-status file. No external Next target or reused server is accepted.

```sh
export GRIDEX_SUPPORT_NEXT_FIXTURE="$RUNNER_TEMP/support-attachment-next-denial-20261001.json"
GRIDEX_SUPPORT_NEXT_PHASE=seed npx vitest run --config scripts/support-attachment-next-denial-20261001.native.config.ts
GRIDEX_SUPPORT_NEXT_BROWSER=1 npx playwright test --config=e2e/browser/support-attachment-next-denial-20261001.config.mjs --project=chromium
GRIDEX_SUPPORT_NEXT_PHASE=postcheck npx vitest run --config scripts/support-attachment-next-denial-20261001.native.config.ts
rm -f "$GRIDEX_SUPPORT_NEXT_FIXTURE"
```

Required inherited environment: `CI=true`, `RUNNER_TEMP`, `GRIDEX_NATIVE_STATUS` pointing to the real local stack’s private JSON status. The fixture must be a regular nonsymlink JSON file directly in the real `RUNNER_TEMP`, mode 0600. It contains synthetic password/signature/transport secrets, trusted JWK configuration and private snapshots. Never upload it or the status file. The isolated config reads these values and sets them only on its own new local Next process. Passwords, cookies, JWTs and private Storage bytes are never logged. Trace, screenshot and video are off; results live under `RUNNER_TEMP`. Browser-origin traffic is limited to localhost. No provider is dispatched. Stop/delete the disposable stack through the root’s existing cleanup; preserve immutable companies/evidence until then.

## Executed local verification; qualification limits

- Eight actual exported helper environment/path/mode/symlink/DB guard controls passed under Node22, with **zero database/Auth/network calls**. The temporary receipt command was `/tmp/ediel-toolchain/node_modules/node/bin/node /tmp/gridex-support-next-guards-20261001.cjs`; these are local fixture safety controls, not user/session/native acceptance.
- Actual Playwright collection first failed before any Next/DB/Auth work: named ESM import of the TypeScript helper resolved as CommonJS; default ESM import also failed to parse that module. New config/spec use Playwright’s installed transform through `createRequire`. Actual final `playwright test --config=… --list` passed, collecting exactly one Chromium journey. Collection used private synthetic nonworking status/key placeholders and never started Next or accessed Auth/Storage; it is loader qualification only.
- Four actual extracted snapshot SQL projections passed under PostgreSQL-core: the complete finance hash distinguishes changes below JavaScript decimal precision and beyond its safe bigint range; complete Storage metadata changes alter its hash; allowed Auth login timestamps alone preserve the identity hash while profile data changes do not. Hashing occurs inside PostgreSQL before JSON parsing. This is controlled SQL projection proof, not the complete native financial graph or real GoTrue/Storage proof.
- Scoped 1536MiB TypeScript, ESLint, both `.mjs` syntax checks and owned diff whitespace checks passed. No broad root gates or candidate-native execution is attributed to this package.
- Site owner independently reviewed current source/config: no concrete new GoTrue-cookie/current-tenant/resource/nonce/late-clock/Storage/release/privacy flaw found; wrong-session nonce and six/two counts reconcile. This was read-only source review, not actual Auth/Next/native execution.

Local `psql`/disposable Supabase stack are unavailable; therefore the genuine GoTrue issuing, mounted Next request, real native ACL/RLS/Storage and browser/postcheck outcomes are **pending internally executable CI**, not externally blocked or passed. The approved scanner/provider/transport enrollment and malware detection acceptance remain separate explicit external requirements. T36/P7 and all75 whole-plan outcomes are not promoted by this prepared packet.

Skills used: Supabase for actual Auth/SSR APIs and current-session boundaries; installed `verification-before-completion` and spec-to-code rules for precise evidence attribution. Installed `@supabase/ssr` is 0.9.0; the actual mounted source and pinned dependency behavior determine this fixture. Official SSR/getClaims guidance was checked; the changelog Markdown endpoint returned an unsupported content-type retrieval error and was not represented as successfully read. Browser-verification tooling was reviewed; no local development server was started or visually qualified here.
