# Customer native proof SQLSTATE diagnostics — bounded continuation

Date: 2026-10-01. Root authorized exactly the existing `proofSql` region plus one import, a new pure projection/unit/report and the lifecycle native `afterEach` fixed stages. No production business command, SQL migration, grant, Auth caller or original lifecycle assertion is changed.

Skill routing: systematic debugging tracks the genuine unavailable cause separately from wrapper behavior; test-driven development supplies the executed wrapper RED/GREEN; code review and verification-before-completion cover the exact diff, safe projection and freeze. Database source inspection is bounded to teardown semantics. UI, performance, external scanner/provider, privilege exercises and broad contract compliance are outside this diagnostic packet.

## Genuine first failure and scope

Eighth candidate head `c4ab486a9c83d629a9dbd26f8b974f9186e860f6`, actual clean job `110231824354`, emitted the three lifecycle source-binding test-body markers at 05:26:07–08 UTC. Each test then **FAILED** in `scripts/customer-lifecycle-source-binding-20261001.native.test.ts:35` → `scripts/customer-read-proof-native.ts:28`, with only `customer_api_proof_database_failed`. All three are failed native tests; body markers do not make them three PASS. The raw SQLSTATE/cause is **NOT_AVAILABLE** in that old receipt.

The shared helper deliberately scrubbed every child error. Its locality refusal, fixed disposable DB URL, `-XAtq`, `ON_ERROR_STOP=1`, 30-second timeout, private pipe stdio, JSON decoding and nonzero-error behavior remain. It now additionally requests `-v VERBOSITY=sqlstate` and returns only a safe diagnostic in a fresh Error with no raw cause.

## Safe protocol projection

The new pure helper considers only string/Buffer stderr up to 65,536 bytes. Exactly one anchored `ERROR`, `FATAL` or `PANIC` line, optionally carrying the normal psql file/line prefix, must contain only one strict five-character code. Known PostgreSQL SQLSTATE classes and the existing `PTnnn` SQL HTTP class are accepted; `00000`, arbitrary five-letter customer text, PostgREST/transport values, extra text on that error-prefix line, multiple error lines and absent/unreadable process objects yield `UNKNOWN`. Other DETAIL/CONTEXT lines are discarded. Filenames, messages, details, context, commands, SQL, stdout and raw process fields are never returned or logged. There is no raw-string fallback or attached Error cause.

Stage values come from the fixed seven-member allowlist: generic `customer_sql`, and lifecycle cleanup `fault`, `decisions`, `cases`, `contracts`, `customers`, `companies`. An arbitrary caller stage becomes `UNKNOWN`. The outward failure remains `customer_api_proof_database_failed` followed solely by the fixed stage and SQLSTATE/UNKNOWN. No error is swallowed, retried or promoted to PASS. Raw logs are not newly saved by this packet.

The lifecycle cleanup retains exactly the same seven DROP/DELETE statements and their order, now grouped into six individually labeled child calls. Each still stops on error. Quiet-tenant comparison, original-finance comparison, the three full business callbacks, durable decision=1, cancellation concurrency and late statement rollback are unchanged. This changes diagnostic attribution only; the earlier sequence already used psql autocommit and was not a transaction spanning the full teardown.

## Meaningful RED/GREEN and local checks

The actual exported shared wrapper with a controlled child-process boundary reproduced **5 meaningful RED / 5 unchanged controls PASS** at 07:36:42 process-local Europe/Berlin (+02:00) = 05:36:42 UTC. It lacked SQLSTATE-only arguments and the required safely projected state/stage. These are executed diagnostic failures, not a reproduction of the unavailable native DB cause. There was no missing-module/setup RED.

After the narrow wrapper/projection change, the same ten cases passed. Fourteen additional pure protocol cases cover strict prefixes/classes, free-text/transport rejection, multiple states, raw details/context, oversized stderr, unreadable process objects and no trust in an arbitrary error object's `code`. Final **24/24 PASS** comprises ten exported-wrapper cases plus fourteen pure cases. Controlled child errors are explicitly stubs; they are not PostgreSQL/Auth/native proof.

Scoped four-entry TypeScript import closure PASS, zero-warning ESLint PASS and whitespace checks PASS. An initial temporary type project omitted the Node ambient type root because it lived under `/tmp`; its Node/module resolution errors were harness setup, not product findings. The corrected temporary project explicitly uses the installed repository Node types. No new package/stub/dependency was installed. An attempted `git show c4ab486a` was unavailable locally and is not claimed as successful evidence.

The wrapper exact reverse preimage matches actual available immutable tree `077bcab` byte-for-byte (SHA-256 `ff4c4c429b09d439ff716336bbcfb86dc2da21f398b3aa78ae736e064695635a`). The native exact reverse preimage matches root's captured eighth source2 SHA `90a84ccd2dc231c634a33c0451a8aeb55635ae8a1d36c34febe0d034a969b3b4`. Automated comparison confirms identical seven cleanup statements/order. No other helper Auth, issuer, API-client, secret or authority region changed.

```sh
/tmp/gridex-event-v2-node22-cache/_npx/52027bd8fc0022aa/node_modules/node/bin/node node_modules/vitest/vitest.mjs run __tests__/customer-proof-sqlstate-diagnostic-20261001.test.ts
/tmp/gridex-event-v2-node22-cache/_npx/52027bd8fc0022aa/node_modules/node/bin/node --max-old-space-size=4096 node_modules/typescript/bin/tsc --noEmit --project /tmp/gridex-customer-proof-sqlstate-scope-20261001.json
/tmp/gridex-event-v2-node22-cache/_npx/52027bd8fc0022aa/node_modules/node/bin/node node_modules/eslint/bin/eslint.js scripts/customer-read-proof-native.ts scripts/helpers/customer-proof-sqlstate-diagnostic-20261001.ts scripts/customer-lifecycle-source-binding-20261001.native.test.ts __tests__/customer-proof-sqlstate-diagnostic-20261001.test.ts --max-warnings 0
```

## Actual business-core refutation and its limits

Installed-trigger source was read before attributing the failure. Current E035 capture text from `20260924145224_correction_process_archive_dates_v4.sql` appends a DELETE fact and returns OLD; the immutable function guards archive facts/gaps/epochs and TRUNCATE. A case DELETE is not itself a request to delete immutable process facts. The new lifecycle binding trigger runs INSERT/UPDATE, not DELETE. These observations do not identify the actual native cause.

One actual PGlite PostgreSQL business probe used the existing current lifecycle core/exported producer, exact original E035 epochs/facts/gaps/immutable definitions, the current complete capture function and the actual case/contract INSERT/UPDATE/DELETE trigger definitions. It created a real sourced decision=1, extracted the six current native cleanup callback SQL strings, substituted only owned synthetic fixture identities, and executed them in order. **All six stages completed and four capture facts remained.** This is one probe, not six independent tests or six native PASS. The model has narrow parent scaffolding; it omits full deployed FK/default/grant/Auth/Storage/provider infrastructure. It refutes guessing an inherent new lifecycle-binding or ordinary E035 capture failure in that model, without disproving a full-schema cascade/constraint dependency. No Auth, ordinary-role or privilege attack exercise occurred.

Reproduction uses the already committed/frozen business core plus current source text; no migration is applied to a real database and no source guard is removed:

```sh
NODE_PATH=/tmp/ediel-service-check/node_modules /tmp/gridex-event-v2-node22-cache/_npx/52027bd8fc0022aa/node_modules/node/bin/node <<'NODE'
const {readFileSync}=require('node:fs');
const {fixture}=require('./scripts/customer-lifecycle-source-binding-20261001-core.cjs');
(async()=>{const f=await fixture();try {
 const base=readFileSync('supabase/migrations/20260924073337_correction_process_facts_v1.sql','utf8');
 const current=readFileSync('supabase/migrations/20260924145224_correction_process_archive_dates_v4.sql','utf8');
 await f.db.exec('create schema gridex_correction_process;'+base.slice(base.indexOf('CREATE TABLE gridex_correction_process.epochs'),base.indexOf('CREATE FUNCTION gridex_correction_process.immutable_v1')));
 await f.db.exec(base.match(/CREATE FUNCTION gridex_correction_process\.immutable_v1\(\)[\s\S]*?END \$\$;/)[0]);
 await f.db.exec(current.match(/CREATE OR REPLACE FUNCTION gridex_correction_process\.capture_v1\(\)[\s\S]*?END \$\$;/)[0]);
 const schema=readFileSync('supabase/schema.sql','utf8');
 for(const table of ['customer_cases','customer_contracts']) for(const name of ['e035_process_after_write','e035_process_before_delete']) await f.db.exec(schema.match(new RegExp('CREATE TRIGGER '+name+'[^;]*ON public\\.'+table+'[^;]*;'))[0]);
 await f.db.exec(`create table public.companies(id uuid primary key); insert into public.companies values('${f.id(1)}'),('${f.id(11)}'); insert into public.customer_contracts(id,company_id,customer_id) values('${f.id(15)}','${f.id(11)}','${f.id(12)}');`);
 if(!await f.execute()) throw new Error('missing_owned_decision');
 const native=readFileSync('scripts/customer-lifecycle-source-binding-20261001.native.test.ts','utf8');
 const section=native.slice(native.indexOf('afterEach(() => {'),native.indexOf("it('actual PostgREST"));
 const vars={company:f.id(1),quiet:f.id(11),customer:f.id(2),quietCustomer:f.id(12),contract:f.id(5),quietContract:f.id(15),fault:'owned_cleanup_probe'};
 const calls=[...section.matchAll(/proofSql\(`([\s\S]*?)`, '(lifecycle_cleanup_[a-z]+)'\)/g)];
 if(calls.length!==6) throw new Error('wrong_fixed_stage_count');
 for(const [,template] of calls) await f.db.exec(template.replace(/\$\{quote\(f\.([A-Za-z]+)\)\}/g,(_,key)=>"'"+vars[key]+"'").replace(/\$\{f\.fault\}/g,vars.fault));
 console.log('BOUNDED_BUSINESS_CLEANUP_PASS stages=6 native_cause=NOT_AVAILABLE full_schema=false');
}finally{await f.close();}})();
NODE
```

The new diagnostic helper/native revision has **0 actual native executions**. The next genuine isolated CI must still fail on the real cleanup error, now carrying its strict code and fixed stage, until that exact business cause is reproduced and separately repaired. No guessed cascade fix, removed cleanup, lowered lifecycle assertion or acceptance of the three old failed cases is included.

## Frozen five-file manifest

| Path | SHA-256 | Git blob |
| --- | --- | --- |
| `scripts/customer-read-proof-native.ts` | `e0cf59ffeafd5aa4a6a591aadda6e4507ca7594700e9ca343f6cd649b5100c4f` | `642302081b3275d3b0e2141501aef58d620ef731` |
| `scripts/helpers/customer-proof-sqlstate-diagnostic-20261001.ts` | `5364e94f08931117b3aac66d0476552b6ceb2e3710f445a0b49467c2bd833e26` | `1b9217634c48497c6523f4fbe3d8630808874060` |
| `scripts/customer-lifecycle-source-binding-20261001.native.test.ts` | `607e333c78468b75249fa10d744b31c689c1ea5ec4c7b8f42943e68de8c35109` | `d3df5e9f8ffc12496fa0f1617dd137c3649307af` |
| `__tests__/customer-proof-sqlstate-diagnostic-20261001.test.ts` | `73180ea64fd1e43dc88a39a80e6c4c1d342e7d6d9b44d67a958e50d4030d49b5` | `e2d352c0e26ecf7bf23238ff1126d584ef1e008e` |

This report is the fifth file; its hash is sent in the exact ephemeral manifest. Root owns integration/checksums/workflow/ref/publication and actual native failure follow-up. Agreement runtime4, original agreement19 and all other frozen lifecycle files remain unchanged.

## Independent bounded receipt

The CI-evidence peer independently matched all five frozen SHA-256, Git blob and byte identities in manifest `850124a46c85d7931654a45989d969fb259cd7406c870fa612f475e7b67f2a50`, then ran the actual 24 exported-wrapper/pure cases at **07:56:50 Europe/Berlin (+02:00) = 05:56:50 UTC**, duration 532 ms: **24/24 PASS**. These are the same 24 cases, not 24 additional unique cases. The peer verified the exact `077bcab` shared-helper reverse preimage, all native bytes outside cleanup unchanged, and the same seven DROP/DELETE statements/order in six fixed calls. No concrete bounded projection, nonzero-error or locality blocker was found. The peer performed no SQL, Auth, native, network or provider exercise.

The separate single business-core cleanup probe remains a narrow model using actual E035 function/trigger text and lifecycle source binding. Its six successful stages and retained capture facts do not establish a full-schema teardown, a root cause, or native success. The old genuine three native cases remain **FAILED**, with original SQLSTATE **NOT_AVAILABLE**. This append changes only the report; all four code/test identities above remain unchanged. Root confirmed the preceding diagnostic manifest had not been captured in the ninth index, so the superseding manifest records this final report metadata before future integration.
