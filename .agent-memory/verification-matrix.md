# Verification matrix — PHASE-43

| Area | Status | Evidence |
|---|---|---|
| API/OpenAPI/docs version | PASS | Canonical contract remains `2026-08-04.2` |
| SVK source/layer mapping | PASS | Current FeatureServer, layer 3, four exact canonical fields |
| Import source isolation | PASS static | Old source is failed; mixed source/layer resume rejected |
| Import diagnostics | PASS static/live | Structured errors plus BRL/SE3 rollback parser proof |
| Migration integrity | PASS | 366 files / 270 groups; checksums verified |
| Live database apply | PASS | Ledger versions `20260804190000` and `20260804193000` |
| DB billing area guard | PASS | Rollback E2E canonicalized SE3 and rejected SE4 |
| Snapshot tenant guard | PASS | Nonexistent trigger field removed; contract ownership enforced |
| Underlay area propagation | PASS static | Header/items use immutable snapshot area |
| Snapshot identity checks | PASS static | Missing and cross-contract snapshot blockers |
| Existing billing backfill | N/A | Zero contracts/snapshots/underlays in connected dev project |
| Changed TS/TSX syntax | PASS | TypeScript transpile syntax diagnostics: zero |
| Full npm gates | BLOCKED | Dependencies absent; registry DNS returned `EAI_AGAIN` |
| Full official SVK import | PENDING | Requires updated deployed code/cron; active rows currently zero |
| Quote-to-invoice E2E | PENDING | Requires deployed app and real test data |

## PHASE-44 — 2026-08-05T15:14:58+02:00

| Check | Result | Evidence |
|---|---|---|
| Three-document grouping | PASS | customer legal package regression |
| Grouped acceptance -> exact module rows | PASS | static regression and source inspection |
| POA exact scope/legal identity | PASS | website/platform POA regressions |
| Tenant snapshot historical rendering | PASS | legal package regression |
| API/OpenAPI 2026-08-05.1 | PASS | version, compatibility, examples, runtime and release gates |
| Changed TS/TSX syntax | PASS | TypeScript 5.8.3 transpile, 17 files |
| Full dependency gates | BLOCKED | package mirror 404 |
| Live private/business E2E | PENDING | deployment required |

| 2026-08-05T15:20:07+02:00 | Customer Portal grouped/legacy prevalidation and signed-event fail-closed guard | PASS | `gridex-customer-legal-package-regression.cjs` |

## PHASE-45 — 2026-08-06T08:50:00Z

| Check | Result | Evidence |
|---|---|---|
| Quote timestamptz + grid-area integrity | PASS | quote null-grid-area and website quote integrity regressions |
| OpenAPI immutable release verify | PASS | `verify-openapi-release.cjs` local |
| Market-price/quote required examples | PASS | documentation examples + integrity regression |
| Application/metering-point area normalizers | PASS | explicit-input preservation regression |
| API version/compatibility/runtime | PASS | documentation version, compatibility, public-contract runtime |
| Full dependency gates | BLOCKED | `node_modules` absent |
| Live quote create/validate | PENDING | deployment required |

## PHASE-45 follow-on — 2026-08-06T08:58:00Z (`6531`)

| Check | Result | Evidence |
|---|---|---|
| Quote price_area case integrity | PASS | website quote integrity regression assertions |
| AI/BI grid-area case normalize | PASS | `gridex:aibi-grid-area-case-regression` |
| Prior PHASE-45 package on tip | PASS | merge of `ec6b` + regressions above |
| Full dependency gates | BLOCKED | `node_modules` absent |
| Live quote create/validate | PENDING | deployment required |

## PHASE-45 after BL-002 — 2026-08-06T12:57:00Z (`fb8e`)

| Check | Result | Evidence |
|---|---|---|
| Merge health package onto main+BL-002 | PASS | merge commit of `6531` |
| Billing/public/portfolio price-area case | PASS | `gridex:price-area-case-normalization-regression` |
| Quote/AI-BI/OpenAPI package still green | PASS | quote-null, website-quote-integrity, aibi, api:release:verify, docs, compatibility, explicit-input |
| Residual BL-002 RLS variants | OPEN | documented as O-005..O-008; no second overlapping migration |
| Full dependency gates | BLOCKED | `node_modules` absent |
| Live quote create/validate | PENDING | deployment required |

## Post-#105 health residuals — 2026-08-10T22:30:00Z (`ee51`)

| Check | Result | Evidence |
|---|---|---|
| C28 control matches recorded_by FK index | PASS | `gridex:canonical-architecture-57-regression` 57/57 |
| O-008 PUBLIC privilege residual static | PASS | `gridex:o008-public-privilege-hardening-regression` checksum `f868b36b...` |
| Migration integrity | PASS | `check-migration-versions` 403 files / 307 groups |
| Types tip pin (grant-only) | PASS | `check-supabase-generated-types`; sha unchanged |
| Base O-008 / BL-001 / portal parse regressions | PASS | existing static scripts |
| OPS hardening CI wires 57 + O-008 PUBLIC | PASS static | `.github/workflows/ops-hardening.yml` |
| Staging SQL privilege matrix | NOT_RUN | no connected apply in this agent |
| ggshield secret scan | BLOCKED | CLI not installed |
