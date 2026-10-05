# Independent whole SC015 / SC016 review

**SC015 APPROVE; SC016 APPROVE — complete frozen code effects, at the declared finite ports.** No required-effect blocker remains. Reviewed immutable PR559 [f2081c55c86061ec3feb1cff0f93789da89f84cc](https://github.com/heke99/gridex-ops-platform/pull/559), tree `14ec93f2b097a5fddb3317a9a8c22aeb0c563d89`, actual merged-main base `507e8bfa20606be31933eea1582066267ff2577a`. Review timestamp `2026-10-05T02:52:58.027810+00:00`. This verdict does not assert authentic external legal/market custody, a new native replay, full current migration-prefix/concurrency/RLS proof, SMTP acceptance, or current-head mandatory CI/integration completion.

## Frozen complete literals and linked rules

```json
[
  {
    "id": "SC-015",
    "name": "Provider koordinerar pågående Z13",
    "given": "Samma P/kund/DSO har en väntande begäran från annat uppdrag.",
    "when": "K2 vill skicka ny Z13 för samma eller nya objekt.",
    "expected": "Pröva Handbokens nya-objekt-/upprepningsfall och koordinerad begäran.",
    "prohibited": "Beneficiary-id används inte för att kringgå21dagarsförloppet.",
    "rule_ids": [
      "TEN-09",
      "ESCO-06"
    ],
    "layer": "Integration/E2E",
    "execution_status": "Inte körd mot systemet",
    "evidence": ""
  },
  {
    "id": "SC-016",
    "name": "Delvis godkända ESCO-anläggningar",
    "given": "Z13 omfattar flera möjliga objekt; Z14 godkänner endast A.",
    "when": "Behandla Z14.",
    "expected": "Permission/grants omfattar endast uttryckligen godkänd information.",
    "prohibited": "B/C läggs inte till från kundregistret.",
    "rule_ids": [
      "ESCO-04"
    ],
    "layer": "Integration/E2E",
    "execution_status": "Inte körd mot systemet",
    "evidence": ""
  }
]
```

Full TEN09/ESCO06/ESCO04 cards and their annex text were read. TEN09 requires coordination across internal service missions under the same legal provider/customer/DSO, with independently assessed derivative assignments and grants. ESCO06 requires same-object repeat and relevant-new-object assessment; it forbids both an invented universal prohibition on every new Z13 before21days and beneficiary-ID bypass. ESCO04 confines permission/grants to source-approved objects and information. Canonical21days are a Z14 response deadline; the current Z15 ending sweep does not supply Z13 repeat evidence. The packet directly exercises the relevant pending same/new-object branches rather than treating calendar metadata as the proof. Exact three linked rule cards are retained in the machine receipt.

## Full effect matrix and actual producer reachability

| Card | Frozen given/effect | Actual producer/consumer path | Asserting effects and bounds |
|---|---|---|---|
| SC-015 | Given: same provider/customer/DSO has a pending request from another independent mission | actual archived/staged/separately reviewed/approved assignment and current public coordinator/resolver | retained two-day Z13/private origin/outbound request/source hash fixture binds first mission; second approved mission returns same permission and original message with pending state; full retained message/permission/origin/request/grant snapshot equal Boundary: prior sealed/sent Z13 and private original witness are explicit retained-history/transport fixtures; synthetic issuer/representation/legal terms |
| SC-015 | Same-object new mission reuses pending permission without beneficiary access | current43917 coordinator→actual020640 private pending resolver→final170000 gate | reuse_permission, exact original message/permission, marketPermissionState pending, accessGranted false; exact retry result and zero extra permission/origin/request/grant effects |
| SC-015 | New beneficiary ID cannot bypass the21-day handling window | third separately reviewed mission/current actual coordinator and first immutable owner | third beneficiary reuses same original/permission; original remains pending inside21days and full retained snapshot unchanged; public TS call sends assignment/provider scope and no beneficiary-ID authority |
| SC-015 | Additional relevant objects get a separate coordinated request immediately | actual new archive/stage/review/approval→current coordinator/resolver and new immutable owner/timing record | assessed [point-a,point-extra] obtains a distinct permission_required decision now; same provider/company/customer/DSO/environment/mode tuple; new replay adds no permission/origin and preserves old source Boundary: source terms external authority synthetic; current caller render proof consumes a finite decision/origin rather than this SQL run UUID |
| SC-015 | Actual public caller consumes pending decisions before wire/persistence effects | prepareAndQueueServicePermissionZ13→real coordinate/resolve adapters | same-object, different-mission and explicit permission-ID cases stop before origin/route/intent/request/finalize/queue; malformed accessGranted true fails closed Boundary: authority RPC responses/auth/route/persistence finite in these seven TS cases |
| SC-015 | Relevant permission-required decision can reach scoped DGI wire without a blanket21day hold | actual prepare→gateway→reporting context→service renderer→codec | new permission operation/idempotency key, physical point and23-DGI-PRODAT draft, no beneficiary ID, exactly one queue call Boundary: origin and route/version/intent/persistence/queue are declared finite responses; point-bearing mock basis is not protected SQL origin output; no SMTP proof |
| SC-015 | Current timing/source denials preserve original and create no authority | actual current issuer revocation/timing gate and exact retained hash port; actual public caller error path | current DSO representation revocation held; changed raw fails retained byte witness; rollback restores full retained snapshot; caller forwards exact source denial with no retry/wire |
| SC-016 | Given: multi-possible-object Z13; received physical Z14 approves only A | actual unchanged lexer/current source executor/group writer and automatic TS consumer | retained original parses [A,B,C]; inbound parses [A]; exact one A manifest and partially_approved parent; fullyApplied true means every physical received scope was processed, not that missing B/C was approved Boundary: retained ABC Z13, accepted transport, canonical/application/response facets and legal receiver are explicit fixtures; no claim that current protected origin produced ABC |
| SC-016 | Only explicit approved information enters effective permission sites | actual44351 group writer/source executor and committed-effect attester | exactly one A site and one committed metering_permission receipt with same physical object scope, source hash, assessment, permission ID, S17 and product; no automatic grant |
| SC-016 | Only A can become an active beneficiary grant after separate approval | actual full administration schema/SDK→current43917 administration/publish owner and000926 tuple predicate | A grant initially held and no active grant; separate approval port enabled then only A active/version2/accessGranted true; product/fields/dates supplied exactly within A source/assignment scope Boundary: assignment owner scope/approval, actor permission catalog, writer admission and governance are named fixtures; no authentic legal approval or native concurrency claim |
| SC-016 | B, C and ABC cannot acquire active permission/grant authority | actual same public SDK/SQL publisher against current A-only sites | three actual draft grant attempts remain held/version1, explicit_approved_object_product_period, accessGranted not true; active objects exactly [A] Boundary: held unapproved proposal rows are retained as proposals, not effective permission/access |
| SC-016 | No B/C expansion from populated customer register or caller data | actual automatic, SDK and manual source consumers plus current source/grant writers | hostile parsed/manual approvedSites B/C and dates never enter source-only RPC; all populated own/foreign customer_sites and metering_points full-row snapshots equal; retained original/raw/seal rows unchanged; actual sites remain A-only and same committed receipt |
| SC-016 | Exact idempotent source replay retains scope/provenance | actual source partition receipt/current predicate/manual read adapter | idempotent same manifest, same one committed receipt/object/source hash; source current true; raw/seal and registry snapshots retained |
| SC-016 | Foreign/inactive actor and missing source cannot borrow permission authority | actual source executor actor checks, manual source lookup, extracted real actor adapter and full administration SDK | foreign and inactive source holds, missing received source rejects, foreign publisher actor denies before any administration RPC; active grant/site/effect/registry/original snapshots unchanged |

SC015's seven new TS cases execute the real public prepare caller, command adapters, timing-result validation, render gateway, reporting, physical renderer and codec. Its RPC/origin/route/persistence/queue responses are finite. The companion SQL runs the real archive/stage/separate-review/assignment-approval pipeline and actual current coordinator/resolver over declared synthetic issuer/legal and retained prior-original facts. These are separate asserting executions joined by qualified unchanged RPC contracts; this review does not claim one fresh SQL→TS→SMTP execution. The physical point-bearing TS origin response is declared finite; the protected current Z13 service origin may emit an unspecified customer/grid-area request instead.

SC016's new SQL probe executes the complete production permission SDK and administration module, and whole AST-selected automatic/manual/actor function bodies through a real SQL-backed read/RPC adapter. Automatic caller→SDK→current source executor→group writer→committed-effect attester is actually executed, followed by real administration create/publish commands against that SAME permission/site state. Thus the A-only site/effect/no-auto-grant and subsequent A-only active grant with B/C/ABC holds are coupled effects, not independent metadata summaries. Rejected proposals remain held drafts with no effective access. A-only physical received manifest is fully processed even though the parent request is partially approved; no missing B/C physical response is fabricated.

## Independent frozen-source qualification

Independent trusted GitHub `git ls-remote` also returned exact frozen head `f2081c55c86061ec3feb1cff0f93789da89f84cc`; no publication mutation. All21 changed paths are new owned additions: two TS tests, three new SQL/wrapper scripts, own checkpoint and evidence. Every preexisting tracked file in the complete base tree is byte-unchanged; source/lib/app/schema/migrations/native fixtures/package/frozen specification and the complete352-row coverage ledger are unchanged. Additive ownership claims5305987058901/4915987060310 cover the three new scripts after initial claims5305986941347/4915986942920. Reviewer isolated ordinary `--no-local` detached clone `/workspace/agent-review-checkouts/sc015-sc016`; owner checkout untouched.

All32 declared bounded execution-input SHA256 hashes and all10 listed raw evidence hashes were independently rehashed, zero mismatches. This bounded manifest expressly is not an exhaustive import inventory. Whole preexisting-tree equality and prior same-session native/current qualification preserve unchanged sources; no narrower filename scan is called full source closure.

Seven SC015 recorded installed owner bodies and four SC016 bodies exactly match their qualified migration definitions and the ENTIRE actual current committed-schema bodies, including final170000 resolver, private020640 predecessor, current coordinator/timing/manual actor/writer lock and current partial/source-current/grant/tuple functions. Latest explicit definitions were independently checked; the private copy/rename chain was read. An additional15 real lexer/time/date/group/committed-effect/archive/review/assessment/timing-term dependencies were independently compared byte-exact to current schema bodies. These source comparisons are separate from the runtime prosrc assertions; no claim that the finite fixture installed the entire native catalog-transform tail.

The authentic primary0796 native schema snapshot SHA256 `ed529f341c4d631b60d08016c18b4e2584ea592c2144f4f74d8735c0dfc6984d` is byte-exact current schema, and all Supabase/migration sources remain unchanged from that authentic run to current507. Thus this is not final-schema equality used to speculate about unapplied forward migrations: prior authentic installed-prefix provenance and the unchanged migration tree were retained. The previously authenticated source was `0796a57181657d0c2b55dc4437f3ad5c6c8d88c3`, run37248883530/job111572220948/artifact11321572417, ZIP SHA256 `b2cbd4a6e42414711644c917bfc3bd97344a0d538328a6ca6ba72785aac0bd10`, native JUnit SHA256 `03c923add726f3798a8f446fbb66042c9864a527e8cc428edec72f72e09b5153`. Its exact one-object V archive/review/Z13/Z14/grant/storage/ACK case remains corroboration of unchanged source/owners only; it does not substitute for new pending/additional or partial effects. The prior two0796→507 archive/transport deltas were read and retain their limits; no full current archive/SMTP/native result is inferred.

## Verification commands and exact receipts

The reviewer ran ONLY the two newly published test files once, under Node22.23.3, unchanged absolute loopback preload and narrow network execution permission for PGlite children:

```sh
PATH=/tmp/masterplan-491-npm-cache/_npx/52027bd8fc0022aa/node_modules/node/bin:$PATH NODE_OPTIONS=--require=/workspace/agent-review-checkouts/sc015-sc016/scripts/lib/unit-loopback-network-boundary.cjs ./node_modules/.bin/vitest run __tests__/ediel-sc-015-pending-provider-request.test.ts __tests__/ediel-sc-016-partial-permission-membership.test.ts --pool=threads --maxWorkers=2 --reporter=verbose
```

Result: two files,10 cases PASS (SC0157 + SC0163),0 failures/errors/skips, start02:45:52UTC,3.68seconds. SC016's beforeAll actually executes its10 new SQL groups plus the retained partial helper. External reviewer log `/workspace/agent-review-checkpoints/sc015-sc016-current-unit10.log` SHA256 `19eb80850c92e1e46fd27ca52d2d36a993e7dc10aba3e281df821d487bf63a48`. Clone clean afterward.

Retained exact committed owner evidence: SC0158 new SQL groups +25 timing +64 inherited groups; new supported wrapper2/2PASS0skip; SC01610 new coupled groups +61 inherited groups. Owner7-case and3-case raw JUnit were parsed independently: no failures/errors/skips. These are declared owner results, not falsely reported as reviewer reruns. SC015 companion SQL and the wrapper were not duplicated. Scoped owner types/lint/syntax/frozen integrity are retained; ordinary current-head CI remains root-owned.

- Verification receipt SHA256 `e0efec075eedd6e8a5a927a820a9db199ca20046f647d87a472175ae07e3723e`.
- Bounded source manifest SHA256 `82f107b45b825668cd9d58249ed2dbc0034949e058bef4701d3d7425b28b10cd`.
- Independent qualification `/workspace/agent-review-checkpoints/sc015-sc016-freeze-qualification.json` SHA256 `39663d3f1d967814f75a024440d4be1a56f6ffecd1b42c621272c1b3f4eb5fc9`.
- Independent machine receipt `/workspace/agent-review-checkpoints/sc015-sc016-independent-receipt.json` SHA256 `520dcaa8ac3504bef79baa53fa5790ad28902d8765fdf823f3738512f675e6b3`.

## Explicit finite ports and limits

SC015 issuer namespace/key/representation and signed legal facts are synthetic external inputs; archive/stage/separate-review/approval and current timing/coordinator/resolver effects are actual outputs. Prior sealed/sent Z13/private origin/request/hash witness and accepted transport are declared retained facts, not newly produced source-authority receipts. Inherited accepted-storage/context helpers retain their finite historical limits.

SC016's retained ABC Z13, lexical DDQ wire template, canonical/application/response facets, legal receiver and accepted-original transport are fixture inputs. Protected service origination, authentic DGI/guide acceptance and market custody are not claimed. Separate assignment legal approval, actor permission catalog, writer graph admission, operational governance and event storage are declared ports. Current group/source/site/grant effects, provenance, actor/profile/membership checks and grant scope predicates run. Shared-schema/native RLS/concurrency is outside this finite proof. No tests send external mail or invent a general day-count rule authorizing all repeat requests.

The full populated own/foreign customer_sites and metering_points rows and original message/raw/seal/binding snapshots are checked where claimed; this review does not widen that to an unasserted every-table database snapshot. Actual source current/committed receipts qualify A's retained approved site and provenance. No broader legal/market/full-native claim is authorized by these bounded results.

## Instructions, skill routing and reviewer scope

AGENTS and the active .agent-memory instruction set were independently byte-qualified against the prior read SC001/002 instruction set; exact frozen literals/annex and linked rules were read. Applicable spec-to-code-compliance, code-review/differential review, verification-before-completion, using-git-worktrees and Supabase/Postgres routing is recorded. No new fan-out, implementation/TDD/debugging, full production E2E, branch completion, security/performance/UI-wide audit or third-party publication workflow applied. User/root current assignment overrides historical paused shared memory; no blocked U10/501 payload was accessed/copied.

Reviewer modified only these external review/evidence files; no owner/source/tests/schema/shared-memory/coverage/GitHub edits, no push/merge, no new native/full run or duplicated implementation. Root owns durable publication/current CI/main composition; technical owner may carry only the two approved SC015/SC016 rows with this exact source proof and all350 other rows unchanged.
