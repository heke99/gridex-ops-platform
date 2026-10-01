# OPS source reconciliation and semantic qualification, pass 3

This is a new additive source snapshot taken on 2026-10-01. The original 147-page/323-family AST evidence remains unchanged. The current source adds the invoice redelivery decision page, so the current reachable source denominator has **148 pages**, not 147. The old 29-action sample is not the whole OPS denominator.

## What is enumerated and what remains open

| Evidence | Exact meaning |
|---|---|
| All 323 archived source families | Every original ID is reconciled to current families/commands or an explicit historical binding decision. |
| All 11 archived unresolved families | Each retains its original ID and a concrete filter/local/conditional/lexical/generic-facade decision; table below. |
| 148 current page sources and 5,832 reachable source control contexts | Current AST/import/layout closure, including component caller props and source declaration/caller links. Import reachability does not prove a control renders on each page. |
| 327 current handler families | Conservative source-handler identities, alias/caller references and explicit duplicate decisions. This is not a unique business-action count. |
| 302 current source command identities | Canonical hand-read facade targets plus distinct remaining roots and two attachment GETs. Each has exact source, function/branch facts, caller/test references and stable qualification-gap IDs. |
| 33 manually resolved facade sources and 43 manually profiled domain/field-policy intents | Actual source delegation and concrete status/import/visibility/override/report choices. This does not classify every remaining nested branch as a business action. |
| 5,683 function facts and 19,078 source branch facts in the snapshot | Exact call sites, guard/resource/database/effect references, source hash, branch condition/body hashes and unresolved method/identifier evidence. A branch fact is not automatically a separate business operation or exercised case. |
| 11 bounded command receipts | Only explicitly executed/owner-reported reviewed suites with their boundaries; each command retains its other open requirements. No test reference automatically means PASS. |
| 1,893 explicit qualification gaps | 302 each for business branch/dedup, current actor/target authority, durable effect/retry, mounted UI/result/state and exact-source receipt; 302 bounded/unfollowed effect-chain gaps; 81 generic caller/submit contexts. |

The **accepted unique semantic business-action total is still `null`**. `verifiedWholeOpsActions` is deliberately **0**: bounded cases do not make an entire action, page, U01–U20 or whole OPS PASS. Domain branches, dynamically returned object/repository methods, SQL effects and materially different mounted callers still need their own qualification. This report makes those remaining cases individually addressable; it does not certify an automatic count.

## Archived unresolved decisions

| Original family | Source decision |
|---|---|
| `OPS-FAMILY-2b1c0ef482caa839` | User role/status/query GET filters and reset navigation; no server writer. |
| `OPS-FAMILY-54cb6584899431aa` | Auto-readiness GET status filters; no server writer. |
| `OPS-FAMILY-8f6cc12881f2e29b` | Platform work-queue query/type/status GET filters. |
| `OPS-FAMILY-fc8517b2276c0b70` | Platform Ediel company/direction/environment/status GET filters. |
| `OPS-FAMILY-a22aaf48fd230eae` | CustomerEditForm local discard/reset clears draft/dirty/result and optionally cancels. |
| `OPS-FAMILY-2938cbf5e3df41d7` | Automation `customer_data` and `supplier_switch` select two distinct canonical commands. |
| `OPS-FAMILY-54e8eed66eb0a352` | Website channel conditional reuses existing publish/unpublish commands. |
| `OPS-FAMILY-cb4669ef8f189a98` | Generic BulkActionButton delegates to four actual missing-metering/missing-underlay/ready-switch/ready-billing queue commands; it is not a fifth writer. |
| `OPS-FAMILY-a49d19b2ac2b66a2` | Two lexical `save` functions resolve separately to customer billing default and contract billing override. Each current control records its lexical owner and canonical command. |
| `OPS-FAMILY-38a9b4ecbb049c7b` | CustomerEditForm action/fallback shell; concrete callers/props are recorded separately. |
| `OPS-FAMILY-90ff3e390e658935` | SupportActionForm enhanced/fallback pairs share create/status/message/attachment operations, with revision/visibility/phone/caller policies still separate cases. |

The archived reconciliation contains exact original control IDs/routes, current family IDs and canonical command keys. The new command registry separately stores the underlying permission/tenant/resource/effect function references; duplicate source wrappers do not erase differing state/redirect/JS-fallback outcomes.

## Source extraction correction and meaningful findings

The historical extractor did not read `button formAction`. The new script does, with explicit `formAction` precedence over inherited form action. This restores actual bulk customer-import preview/commit and website application address/grid-owner/received/readiness/requeue button bindings to their real handlers. The old artifact is preserved as historical evidence rather than silently rewritten.

Every uppercase form/button component invocation retains its supplied source props and resolves its actual local/imported declaration where possible. Generic source controls retain exact syntactic caller-context IDs, declaration owner, page, source line and qualification gap. This distinguishes shared submit/discard/clipboard/disclosure behavior, parent DOM submission, GET filters, simple fields, navigation, enhanced/fallback wrappers and persisted commands. A syntactic caller link still does not prove that its conditional branch mounted with a particular actor/resource.

The source pass produced a concrete U17/U20 correction: analytics missing-schema fallback generated a successful empty attachment for an unavailable report, and ordinary DB failure escaped without a safe response. Actual GET/helper tests reproduced **2 RED + 1 genuine-empty control**, followed by the separate frozen four-file correction, **13 new + 15 existing = 28/28 PASS**. All eight whitelisted report branches now require confirmed availability in the export path, while workspace fallback remains unchanged. See `analytics-export-durable-outcome-20261001.md`; native/browser remain unexecuted here.

Read-only independent billing continuation reviews also distinguished live customer billing revision from immutable invoice revision and eliminated a false-positive denied replay proof: the replay now targets the captured original card path and requires actor-specific RSC denial rather than accepting any 400/500. Independent exported boundary suites executed here: billing recipient command/cache cases **8/8**, current customer list/invoice page **22/22**, and actual list-loader revision cases **9/9**. Their prepared native/browser pipelines are still **0 executed**; these receipts are not propagated to every related command/branch.

## Evidence files and reproducibility

The new unique generator writes only the following new derivative artifacts; the archived source inventories remain unchanged:

- `scripts/tenantservice/ops-ui-semantic-denominator-20260930.mjs`
- `ops-ui-semantic-command-registry-20260930.jsonl.gz`
- `ops-ui-semantic-handler-registry-20260930.jsonl.gz`
- `ops-ui-semantic-callchain-source-20260930.jsonl.gz`
- `ops-ui-semantic-context-registry-20260930.jsonl.gz`
- `ops-ui-semantic-frozen-reconciliation-20260930.jsonl.gz`
- `ops-ui-semantic-source-hashes-20260930.jsonl.gz`
- `ops-ui-semantic-qualification-gaps-20260930.jsonl.gz`
- `ops-ui-semantic-pages-20260930.jsonl`
- `ops-ui-semantic-summary-20260930.json`
- This `ops-ui-semantic-denominator-pass3.md` report.

Artifact paths above, except the generator, are relative to `quality/audits/tenantservice-api-ops-20260928/continuation-20260930/`. No repetitive raw JSONL copy of compressed artifacts is retained. Gzip uses level 9 and mtime 0. The summary records generator and archived-input SHA-256, every artifact's compressed/uncompressed hash, and a source manifest covering reachable modules **and all scanned lexical test files**. Generation fails if a read file, generator, archived input or test-file denominator changes during the run.

The final coordinated source/test barrier produced **two byte-identical summary/artifact runs** (both exit 0). Independent artifact checks passed every row count, compressed/uncompressed SHA-256, gzip mtime 0 and command/function/gap/family/component-caller reference. Scoped ESLint and `node --check` passed with exit 0. The snapshot includes 1,682 source/test hashes. Source manifest SHA-256: `a3bf422ba60e425702a80b858cd98d8f0882ba542a70759d1620cf488c864594`; generator SHA-256: `7e2462bd8e529d40c98c5005c8fca2b3ac8727a57a37546d6580273d32be3334`. Earlier runs with new test files being added changed only the explicit input-hash artifact; they were never reported as identical-input replay.

Run from the repository root with the required Node 22 PATH prefix:

```sh
node scripts/tenantservice/ops-ui-semantic-denominator-20260930.mjs
npx eslint scripts/tenantservice/ops-ui-semantic-denominator-20260930.mjs
node --check scripts/tenantservice/ops-ui-semantic-denominator-20260930.mjs
gzip -dc quality/audits/tenantservice-api-ops-20260928/continuation-20260930/ops-ui-semantic-command-registry-20260930.jsonl.gz
```

Join command `sourceCallGraph` IDs to callchain-source facts, `qualificationGapIds` to gap rows, family/context IDs to handler/control registries and every referenced path to source hashes. The exact `identity` is `source file#symbol`; branch/intent/gap IDs are stable hashes of their explicit source identity or requested intent. The registries state bounded trace depth 5/200 functions, include nested callback source, and retain namespace/import resolution and unfollowed dynamic property-method evidence. SQL RPC names are source call evidence until their actual latest definition and target effects are independently qualified.

## Current limits for U01/U02 and remaining U requirements

All original page/family inventory entries now have an addressable current-source or historical decision. U01/U02 acceptance still requires manual completion of business branch/dedup and actual mounted generic caller cases; U03–U20 require the respective current actor/tenant/resource, explicit effect/outcome and runtime receipts referenced by each gap. These are **OPEN work gaps**, not invented infrastructure blockers or PASS results. Local Docker/PostgreSQL/browser runtime is unavailable in this workspace; root owns the separate native CI lifecycle and receipt qualification.

Do not regenerate this snapshot merely to relabel a later tree as qualified. Later source/test changes need a separate snapshot/delta or exact current source qualification. A source census, a historical passing suite, a direct URL or a missing visible link cannot substitute for current end-to-end action acceptance.
