# P2/T51: genuine portal-bundle data-quality issue count

Date: 2026-10-01. Root authorized exactly the existing bundle producer's array-to-count correction, this unique actual-export suite and this report. The frozen eight-route wiring/telemetry projection packages remain unchanged. This is an observability defect; it is not newly established customer-data leakage.

## Actual reproduction and correction

The exported `GET` and `POST /api/v1/customer/portal-bundle` derived genuine `customerStatus.issues` arrays, then passed the arrays as `metadata.data_quality_issues`. The existing strict telemetry projection accepts that key only as a nonnegative integer (or null). Consequently it omitted both a genuine nonempty array and an empty array from persisted diagnostic metadata.

The real exported-route baseline was **4 RED / 10 controls PASS across 14 cases**: GET and POST each lacked a persisted issue count for the eight-issue state and for the zero-issue state. All public issue/status assertions passed before the failing persistence assertion. There were no syntax/setup failures in this baseline. Synthetic business/read fixtures produced the two states through the actual status builder, not a mocked status/count function.

The sole production change is `data_quality_issues: customerStatus.issues.length`. The closed generic sink whitelist is unchanged. Removing this `.length` produces the entire HEAD route byte for byte (pre-correction SHA-256 `796ff334c2c4538cde253823aaac162135a4b94a8ae9328bc7331ac5b504ac12`). The preceding source-only metadata inventory retains that historical pre-correction route SHA; it is not relabeled as current after this correction.

Public customer/status/data-quality issue arrays, contract/site/document rows, bundle availability semantics and authenticated customer/provider context are unchanged. The correction creates no business write, API policy, token/identity grant, provider action or historical row rewrite.

## Actual local receipts and authority boundaries

New suite: **14/14 PASS**. Related command: **40/40 PASS across six files**, including existing portal telemetry, delegated-assertion cryptography, delegated-boundary, bundle audit and active/disabled portal-context cases. The final Vitest start was **06:18:20 process-local Europe/Berlin (+02:00)**; this is not tagged UTC.

The new suite executes both actual exports, the real API-access adapter, real delegated-customer boundary, real local RS256/JWKS verification, real status derivation and public DTO/response helpers, and the actual telemetry writer/projection. The synthetic signing key and trust configuration exist only in the local test; no real issuer or customer credential is involved. Auth RPC/current account resolution and section/database readers are controlled outer boundaries. The account resolver receives the verified signed subject for both account identifiers; all section contexts use the authenticated company/customer. Native database/account/session enforcement is not claimed.

For both methods, the incomplete fixture produces the exact existing eight public issue labels and `needs_facility_data`/blocking state, with the existing `needs_action` data-quality response and complete bundle status. The complete fixture produces public active/success state and empty issue lists while the actual telemetry contains numeric zero. The section graphs remain equal to their original fixtures and only diagnostic insertion is permitted. Count/profile/bundle outcomes are asserted independently of the telemetry helper, which is not mocked.

Ten method-specific controls cover current missing scope, missing API credentials, missing delegated proof, a correctly signed proof for a foreign company and a conflicting supplied subject. They deny before customer/section lookup as appropriate; missing credentials precede the Auth RPC and any diagnostic insertion. These control cases preserve the existing guards. They are not additional native issuer or hosted-tenant acceptance.

```sh
/tmp/ediel-toolchain/node_modules/node/bin/node node_modules/vitest/vitest.mjs run __tests__/portal-bundle-data-quality-count-20261001.test.ts __tests__/customer-portal-api-telemetry.test.ts __tests__/customer-delegation-assertion.test.ts __tests__/customer-delegation-boundary.test.ts __tests__/customer-portal-bundle-audit.test.ts __tests__/customer-portal-context-status.test.ts
/tmp/ediel-toolchain/node_modules/node/bin/node node_modules/eslint/bin/eslint.js app/api/v1/customer/portal-bundle/route.ts __tests__/portal-bundle-data-quality-count-20261001.test.ts
/tmp/ediel-toolchain/node_modules/node/bin/node node_modules/typescript/bin/tsc --project /tmp/portal-bundle-data-quality-count-20261001.tsconfig.json
```

Focused TypeScript and scoped ESLint: exit 0, zero lint errors/warnings. Scoped whitespace check: exit 0. The temporary TypeScript config extends the current root, disables plugins/incremental and includes the actual suite plus transitive source. Generic-helper hashes remain `dd37e355…` and `bef0de85…`. No broad app/build or published-head CI receipt is claimed. Native persistence, real browser, hosted customer issuer/API and provider execution counts for this packet are **0**.

## Frozen manifest and remaining work

| Path | SHA-256 |
| --- | --- |
| `app/api/v1/customer/portal-bundle/route.ts` | `70b5a8f35d148a253d5d619f0232503d85e6359b5ed6de14c300dd9f274e648a` |
| `__tests__/portal-bundle-data-quality-count-20261001.test.ts` | `a21da05de7f473fa43bfc6292a6f0ffd0a30f211d2916d03a964b47c2e0f9d87` |

This report is the third file; its SHA is sent separately. Source/test bytes are frozen for bounded independent review. Other raw serializer/application metadata cleanup remains a separate source proposal requiring exact existing-file reservation and appropriate actual-caller proof. Remaining unbound request-ID producers, top-level telemetry necessity, native diagnostic durability and all other P2/T51/P7 requirements remain separately tracked; this count correction does not close the whole masterplan.
