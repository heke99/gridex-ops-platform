# CURRENT FINAL SOURCE CANDIDATE — actual SMTP envelope P2 corrected

Technical source `9a849a8bba86835e42c885a194a49a0b49369b2e`, tree `670eebe6971a5b88223c170dff9ff7a97f689177`, ordered parent `7fd384584e2929c1567618c737d648f328ba0d1c`, source base actuald798/e3b6. This supersedes preliminary7fd/cee450 and earlier freezes preserved below as immutable history. Author PAUSED pending TWO fresh noncoauthor final rebinds. Same full e247receipt/all2GET_MATCH authenticated BEFORE resumed writes. No new file/producer/whole scope or production change. Localbranch only; no push/PR/native.

The independent A P2 supplied by ROOT is confirmed against actual public unchanged `lib/email/sendEdielEmail.ts:56/91`: both real branches call sendMail with `envelope:{from,to:[input.to]}` and `raw`, without top-level `to`. My earlier mocked `accepted:[mail.to]` returned undefined; selected raw/selector tests missed this. Added real adapter RAW+ATTACHMENT tests reproduce RED BEFORE the correction: actual sendEdielEmail returned accepted:[undefined] instead of literalrecipient in both2cases. Its classification/SQL uncertainty consequence is source-traced, NOT an executed SQL/native failure. The old RED source snapshot/input hash and all stderr/stdout/exit are preserved.

Correction: shared synthetic SMTP observation now reads and validates ONLY genuine actual `mail.envelope.to/from` + Buffer raw supplied by the real production adapter, requiring its single nonempty stringrecipient. It never uses top-level `to`, JSON selector/default recipient/from fallback or manufactured acceptance authority. The same callback serves both finite boundary controls and later native cases. Real readiness/config/MailComposer/gate-binding construction/return normalization executed through declared lower MIME archive/storage, nodemailer SMTP session and beforeProviderCall database-fence ports. These ports are modeled; no real archive/storage/SQL/journal/current native acceptance, backend, network/provider/capture/GEN was invoked. Returned adapter recipient is asserted independently against the literal call input, not merely the mock output. Actual adapter propagates the declared session's empty-recipient refusal; no accepted recipient is invented. Dynamic archive mocking is removed, module cache reset and environments restored in finally; native ports keep the real module.

- `scripts/ediel-at-z03l-z03lk-supplier-ack-join-native.test.ts`: 651lines; blob `97af108c460d2e64108290270c7217676f8ba234`; SHA256 `ea2aeea8b0731bce7e34c34a042df7e2523be5b10998a8c112ab6d68c6c6a77c`.
- `scripts/ediel-at-z03l-z03lk-supplier-ack-join-native.config.ts`: 8lines; blob `324261dc8d442ed72e32dce19cb55962f9c1101d`; SHA256 `411756e455969e5b04dad4f24007d17d2937c4db74bd840dc615eaa168bd1117`.

Fresh exact final postimage Node22.23.3/Vitest4.1.9 **10 finite PASS/0FAIL;2 native NOTSELECTED**, with every prior8control and both native cases retained. Strict semantic TypeScript actual closure and exact2file projectESLint exit0/no diagnostics; diff0/all9843old blobs/modes+12pins unchanged. Actual freeze-controller `418033a579fa738e9a0b8139150c3af326eab371f3a460eeee4747cfa91946d9`; full201-artifact registry `acacc23ef76c8c1843c80d92531c7a56e18e80f4e5763f6c74129e65159c5faf`. ALL prior154 originals hash-exact, verified individually. Current final command/source/input bindings and both actual RED/GREEN outputs follow. No old37/69 or native/SQL child was rerun. Source INPUT HOLD/current cohort qualification and6149872172 separate P1/P2-calendar limits remain exactly as below; positive actual provider-observed window assertion is retained, no late-queue fix. No ledger/whole approval.

Skills: receiving-code-review applied to verify the P2 against actual implementation; TDD/verification applied before correction and freeze. Two reviewers remain noncoauthors; no peer consultation or reviewer code/proof edits. Next: independent final reviews of this exact final source+checkpoint, affected fixes/requalification only if concrete, then root-coordinated public selective handoff.

## SMTP P2 raw qualification/source/controller records


### source-freeze-smtp.json

Bytes 853; SHA256 `20a499580dd378c3dac34fb666922242f9e6eaaa66eeda952c5c633a1b19b9d6`.

```text
{
  "sourceHead": "9a849a8bba86835e42c885a194a49a0b49369b2e",
  "sourceTree": "670eebe6971a5b88223c170dff9ff7a97f689177",
  "orderedParents": [
    "7fd384584e2929c1567618c737d648f328ba0d1c"
  ],
  "base": "d798eb36f35cd4f437d44c8d234b4dbb81adc7a6",
  "supersedesTechnicalHead": "cee450283bbc5cd66dbb30ace71cf1572e3d0e9b",
  "technicalFiles": [
    {
      "path": "scripts/ediel-at-z03l-z03lk-supplier-ack-join-native.test.ts",
      "blob": "97af108c460d2e64108290270c7217676f8ba234",
      "sha256": "ea2aeea8b0731bce7e34c34a042df7e2523be5b10998a8c112ab6d68c6c6a77c",
      "lines": 651
    },
    {
      "path": "scripts/ediel-at-z03l-z03lk-supplier-ack-join-native.config.ts",
      "blob": "324261dc8d442ed72e32dce19cb55962f9c1101d",
      "sha256": "411756e455969e5b04dad4f24007d17d2937c4db74bd840dc615eaa168bd1117",
      "lines": 8
    }
  ]
}
```

### smtp-red-input.json

Bytes 599; SHA256 `852f051750a8d94eaa61750e540d461beeca73daec33aa372e40d6035615af54`.

```text
{
  "cwd": "/workspace/scratch/gridex-z03-ack-join-helper-20261013",
  "command": [
    "/workspace/scratch/gridex-c2-takeover-01a131d2/node-v22.23.3-linux-x64/bin/node",
    "node_modules/vitest/vitest.mjs",
    "run",
    "--config",
    "/workspace/scratch/ediel-z03-ack-join-20261013/finite.config.ts",
    "-t",
    "actual sendEdielEmail"
  ],
  "sourceSha256": "71960a5de5e36e856c879671d4f0c14a919f0a1709992cd33a06b04c6028f247",
  "modeledPorts": [
    "MIME archive",
    "external nodemailer SMTP session"
  ],
  "realAdapter": "lib/email/sendEdielEmail.ts",
  "nativeCallbacksInvoked": 0
}
```

### smtp-adapter-red.stdout

Bytes 578; SHA256 `aa4eb35489d7a7b9dcf43008ce278ab715716c1ed8e5d31d89beb0ce84888975`.

```text

 RUN  v4.1.9 /workspace/scratch/gridex-z03-ack-join-helper-20261013

 ❯ scripts/ediel-at-z03l-z03lk-supplier-ack-join-native.test.ts (12 tests | 2 failed | 10 skipped) 87ms
     × actual sendEdielEmail raw reaches the declared SMTP boundary with its real envelope recipient 69ms
     × actual sendEdielEmail attachment reaches the declared SMTP boundary with its real envelope recipient 17ms

 Test Files  1 failed (1)
      Tests  2 failed | 10 skipped (12)
   Start at  16:53:01
   Duration  935ms (transform 608ms, setup 0ms, import 711ms, tests 87ms, environment 0ms)

```

### smtp-adapter-red.stderr

Bytes 2344; SHA256 `b636ec3ecc430795d86fa78779aa21f3c530ccdd8aeed6da9132a0594400f1bd`.

```text

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  scripts/ediel-at-z03l-z03lk-supplier-ack-join-native.test.ts > finite Z03 join input and raw boundary > actual sendEdielEmail raw reaches the declared SMTP boundary with its real envelope recipient
AssertionError: expected { accepted: [ undefined ], …(3) } to match object { …(4) }

- Expected
+ Received

  {
    "accepted": [
-     "recipient@example.invalid",
+     undefined,
    ],
    "messageId": "<synthetic-z03-join-04f1f5fe-9fff-4869-9276-b150e6b2c293@example.invalid>",
    "rejected": [],
    "response": "250 explicitly synthetic SMTP acceptance",
  }

 ❯ scripts/ediel-at-z03l-z03lk-supplier-ack-join-native.test.ts:626:22
    624|       const result = await sendEdielEmail(input, { archiveContext,
    625|         beforeProviderCall: async binding => { bindings.push(binding) …
    626|       expect(result).toMatchObject({ accepted: ['recipient@example.inv…
       |                      ^
    627|         messageId: expect.stringMatching(/^<synthetic-z03-join-/), res…
    628|       expect(bindings).toHaveLength(1)

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/2]⎯

 FAIL  scripts/ediel-at-z03l-z03lk-supplier-ack-join-native.test.ts > finite Z03 join input and raw boundary > actual sendEdielEmail attachment reaches the declared SMTP boundary with its real envelope recipient
AssertionError: expected { accepted: [ undefined ], …(3) } to match object { …(4) }

- Expected
+ Received

  {
    "accepted": [
-     "recipient@example.invalid",
+     undefined,
    ],
    "messageId": "<synthetic-z03-join-9579c5f3-c63e-4874-a28d-7967ec8c70b9@example.invalid>",
    "rejected": [],
    "response": "250 explicitly synthetic SMTP acceptance",
  }

 ❯ scripts/ediel-at-z03l-z03lk-supplier-ack-join-native.test.ts:626:22
    624|       const result = await sendEdielEmail(input, { archiveContext,
    625|         beforeProviderCall: async binding => { bindings.push(binding) …
    626|       expect(result).toMatchObject({ accepted: ['recipient@example.inv…
       |                      ^
    627|         messageId: expect.stringMatching(/^<synthetic-z03-join-/), res…
    628|       expect(bindings).toHaveLength(1)

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/2]⎯

```

### smtp-adapter-red.exit

Bytes 1; SHA256 `6b86b273ff34fce19d6b804eff5a3f5747ada4eaa22f1d49c01e52ddb7875b4b`.

```text
1
```

### qualification-smtp-commands.json

Bytes 1734; SHA256 `e2bbd7e5040c5576f7a95f11a02e84d4cd29dc55382183ec8986077a27c17ae3`.

```text
{
  "cwd": "/workspace/scratch/gridex-z03-ack-join-helper-20261013",
  "source": {
    "scripts/ediel-at-z03l-z03lk-supplier-ack-join-native.test.ts": "1bd5bd79143b3b243b98c93e94dab3154c8c22f2aa893b01411f7938edc45839",
    "scripts/ediel-at-z03l-z03lk-supplier-ack-join-native.config.ts": "411756e455969e5b04dad4f24007d17d2937c4db74bd840dc615eaa168bd1117"
  },
  "commands": {
    "finite-smtp-final": [
      "/workspace/scratch/gridex-c2-takeover-01a131d2/node-v22.23.3-linux-x64/bin/node",
      "node_modules/vitest/vitest.mjs",
      "run",
      "--config",
      "/workspace/scratch/ediel-z03-ack-join-20261013/finite.config.ts",
      "-t",
      "finite Z03 join input and raw boundary"
    ],
    "tsc-smtp-final": [
      "/workspace/scratch/gridex-c2-takeover-01a131d2/node-v22.23.3-linux-x64/bin/node",
      "node_modules/typescript/bin/tsc",
      "--project",
      "/workspace/scratch/ediel-z03-ack-join-20261013/tsconfig.focused.json",
      "--pretty",
      "false"
    ],
    "eslint-smtp-final": [
      "/workspace/scratch/gridex-c2-takeover-01a131d2/node-v22.23.3-linux-x64/bin/node",
      "node_modules/eslint/bin/eslint.js",
      "scripts/ediel-at-z03l-z03lk-supplier-ack-join-native.test.ts",
      "scripts/ediel-at-z03l-z03lk-supplier-ack-join-native.config.ts"
    ]
  },
  "change": "review P2: inspect only current actual envelope.to/from/raw supplied by production sendEdielEmail; raw and attachment real adapter controls plus empty-recipient refusal",
  "modeledPorts": [
    "MIME archive/storage",
    "nodemailer SMTP session",
    "beforeProviderCall database fence"
  ],
  "actualProductionAdapter": "lib/email/sendEdielEmail.ts",
  "nativeCallbacksInvoked": 0,
  "backendCommandsInvoked": 0
}
```

### finite-smtp-final.stdout

Bytes 252; SHA256 `943aaf51743915148cbd897aa7923f93d9691ec653b15684afe9b982ce0de0e3`.

```text

 RUN  v4.1.9 /workspace/scratch/gridex-z03-ack-join-helper-20261013


 Test Files  1 passed (1)
      Tests  10 passed | 2 skipped (12)
   Start at  16:54:19
   Duration  901ms (transform 443ms, setup 0ms, import 651ms, tests 104ms, environment 0ms)

```

### finite-smtp-final.stderr

Bytes 0; SHA256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.

```text

```

### finite-smtp-final.exit

Bytes 1; SHA256 `5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9`.

```text
0
```

### tsc-smtp-final.stdout

Bytes 0; SHA256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.

```text

```

### tsc-smtp-final.stderr

Bytes 0; SHA256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.

```text

```

### tsc-smtp-final.exit

Bytes 1; SHA256 `5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9`.

```text
0
```

### eslint-smtp-final.stdout

Bytes 0; SHA256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.

```text

```

### eslint-smtp-final.stderr

Bytes 0; SHA256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.

```text

```

### eslint-smtp-final.exit

Bytes 1; SHA256 `5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9`.

```text
0
```

### qualification-smtp-final-source-commands.json

Bytes 1697; SHA256 `9dadd1ee1ba6a7bb0898108ee9f8b47219d9c82a85c910e58ed9b1ddefa56609`.

```text
{
  "cwd": "/workspace/scratch/gridex-z03-ack-join-helper-20261013",
  "source": {
    "scripts/ediel-at-z03l-z03lk-supplier-ack-join-native.test.ts": "ea2aeea8b0731bce7e34c34a042df7e2523be5b10998a8c112ab6d68c6c6a77c",
    "scripts/ediel-at-z03l-z03lk-supplier-ack-join-native.config.ts": "411756e455969e5b04dad4f24007d17d2937c4db74bd840dc615eaa168bd1117"
  },
  "commands": {
    "finite-smtp-final-source": [
      "/workspace/scratch/gridex-c2-takeover-01a131d2/node-v22.23.3-linux-x64/bin/node",
      "node_modules/vitest/vitest.mjs",
      "run",
      "--config",
      "/workspace/scratch/ediel-z03-ack-join-20261013/finite.config.ts",
      "-t",
      "finite Z03 join input and raw boundary"
    ],
    "tsc-smtp-final-source": [
      "/workspace/scratch/gridex-c2-takeover-01a131d2/node-v22.23.3-linux-x64/bin/node",
      "node_modules/typescript/bin/tsc",
      "--project",
      "/workspace/scratch/ediel-z03-ack-join-20261013/tsconfig.focused.json",
      "--pretty",
      "false"
    ],
    "eslint-smtp-final-source": [
      "/workspace/scratch/gridex-c2-takeover-01a131d2/node-v22.23.3-linux-x64/bin/node",
      "node_modules/eslint/bin/eslint.js",
      "scripts/ediel-at-z03l-z03lk-supplier-ack-join-native.test.ts",
      "scripts/ediel-at-z03l-z03lk-supplier-ack-join-native.config.ts"
    ]
  },
  "change": "correct finite-scope disclosure for actual sendEdielEmail adapter controls; final exact postimage verification",
  "modeledPorts": [
    "MIME archive/storage",
    "nodemailer SMTP session",
    "beforeProviderCall database fence"
  ],
  "actualProductionAdapter": "lib/email/sendEdielEmail.ts",
  "nativeCallbacksInvoked": 0,
  "backendCommandsInvoked": 0
}
```

### finite-smtp-final-source.stdout

Bytes 252; SHA256 `7963ea1a27a707842931175c034f5de93d26caa399d91dbd59026e8a35b3d968`.

```text

 RUN  v4.1.9 /workspace/scratch/gridex-z03-ack-join-helper-20261013


 Test Files  1 passed (1)
      Tests  10 passed | 2 skipped (12)
   Start at  16:58:00
   Duration  753ms (transform 390ms, setup 0ms, import 450ms, tests 181ms, environment 0ms)

```

### finite-smtp-final-source.stderr

Bytes 0; SHA256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.

```text

```

### finite-smtp-final-source.exit

Bytes 1; SHA256 `5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9`.

```text
0
```

### tsc-smtp-final-source.stdout

Bytes 0; SHA256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.

```text

```

### tsc-smtp-final-source.stderr

Bytes 0; SHA256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.

```text

```

### tsc-smtp-final-source.exit

Bytes 1; SHA256 `5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9`.

```text
0
```

### eslint-smtp-final-source.stdout

Bytes 0; SHA256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.

```text

```

### eslint-smtp-final-source.stderr

Bytes 0; SHA256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.

```text

```

### eslint-smtp-final-source.exit

Bytes 1; SHA256 `5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9`.

```text
0
```

### freeze-smtp-controller.py

Bytes 2733; SHA256 `418033a579fa738e9a0b8139150c3af326eab371f3a460eeee4747cfa91946d9`.

```text
from pathlib import Path
import hashlib,json,subprocess
r=Path('/workspace/scratch/gridex-z03-ack-join-helper-20261013');p=Path('/workspace/scratch/ediel-z03-ack-join-20261013')
sha=lambda b:hashlib.sha256(b).hexdigest()
def git(*args):return subprocess.check_output(['git',*args],cwd=r).decode().strip()
f=json.loads((p/'source-freeze-smtp.json').read_text())
for row in f['technicalFiles']:assert sha((r/row['path']).read_bytes())==row['sha256'] and git('rev-parse',f['sourceHead']+':'+row['path'])==row['blob']
for label in ['finite-smtp-final-source','tsc-smtp-final-source','eslint-smtp-final-source']:assert (p/(label+'.exit')).read_text()=='0'
assert (p/'smtp-adapter-red.exit').read_text()=='1'
red=json.loads((p/'smtp-red-input.json').read_text());assert sha((p/'smtp-red-source.test.ts').read_bytes())==red['sourceSha256']
prior=json.loads((p/'artifact-index-window.json').read_text())
for row in prior['artifacts']:assert sha((p/row['name']).read_bytes())==row['sha256']
old={line.split('\t',1)[1]:line.split('\t',1)[0] for line in git('ls-tree','-r',f['base']).splitlines()};now={line.split('\t',1)[1]:line.split('\t',1)[0] for line in git('ls-tree','-r',f['sourceHead']).splitlines()}
assert all(now.get(k)==v for k,v in old.items());assert set(now)-set(old)=={x['path'] for x in f['technicalFiles']}|{'.agent-memory/masterplan-z03-ack-join-helper-20261013-checkpoint.md'}
for row in json.loads((p/'readonly-source-pins.json').read_text()):assert sha((r/row['path']).read_bytes())==row['actualSha256']
subprocess.run(['git','diff','--check',f['base'],f['sourceHead']],cwd=r,check=True)
index=[]
for path in sorted(p.iterdir()):
 if path.is_file() and path.name not in ['artifact-index-smtp.json','freeze-smtp-controller.stdout','freeze-smtp-controller.stderr','freeze-smtp-controller.exit']:
  b=path.read_bytes();index.append({'name':path.name,'bytes':len(b),'sha256':sha(b)})
a={'controllerSha256':sha(Path(__file__).read_bytes()),'source':f,'artifacts':index,'priorOriginalIndexSha256':sha((p/'artifact-index-window.json').read_bytes()),'prior154OriginalsPreserved':True,'preexistingPreserved':len(old),'actualProductionAdapterInvokedFinite':['raw','attachment'],'modeledPorts':['MIME archive/storage','nodemailer SMTP session','beforeProviderCall database fence'],'physicalNativeResult':'NATIVE_NOT_RUN','nativeCallbacksInvoked':0,'backendCommandsInvoked':0};(p/'artifact-index-smtp.json').write_text(json.dumps(a,indent=2));print(json.dumps({'sourceHead':f['sourceHead'],'artifactCount':len(index),'controllerSha256':a['controllerSha256'],'artifactIndexSha256':sha((p/'artifact-index-smtp.json').read_bytes()),'preexistingPreserved':len(old),'prior154OriginalsPreserved':True,'nativeCallbacksInvoked':0},indent=2))
```

### freeze-smtp-controller.stdout

Bytes 371; SHA256 `59d982a9efad8e4a4e6c90978d7f7fd0826c8a04fc5c2453cb71d5eb366baab9`.

```text
{
  "sourceHead": "9a849a8bba86835e42c885a194a49a0b49369b2e",
  "artifactCount": 201,
  "controllerSha256": "418033a579fa738e9a0b8139150c3af326eab371f3a460eeee4747cfa91946d9",
  "artifactIndexSha256": "acacc23ef76c8c1843c80d92531c7a56e18e80f4e5763f6c74129e65159c5faf",
  "preexistingPreserved": 9843,
  "prior154OriginalsPreserved": true,
  "nativeCallbacksInvoked": 0
}
```

### freeze-smtp-controller.stderr

Bytes 0; SHA256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.

```text

```

### freeze-smtp-controller.exit

Bytes 1; SHA256 `5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9`.

```text
0
```

### Preserved RED test source snapshot

SHA256 `71960a5de5e36e856c879671d4f0c14a919f0a1709992cd33a06b04c6028f247`; bytes preserved outside and exactsource below, no claim that this superseded snapshot is current native source.

```typescript
// masterplan-component: AT-Z03L-SUPPLIER, AT-Z03LK-SUPPLIER
// SOURCE PREPARATION. No whole-ID credit. Native cases require the retained
// producer's current disposable, genuinely admitted prospective L/LK cohorts.
// JSON supplies selectors only; it cannot supply authority/context/acceptance.
// SMTP and counterparty wire are explicitly synthetic external boundaries.
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { EdifactEnvelopeCodec } from '@/lib/ediel/core/edifactEnvelopeCodec'
import { segmentComposite, segmentElementCount, tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import type { EdielMessageRow } from '@/lib/ediel/types'
import type { Parts } from '../__tests__/fixtures/prodat-register'
import { prodatMarketMinuteToUtc, prodatNowDate203 } from '@/lib/ediel/prodat/render/dates'
import { originalAckPartyIdentities, originalAckLegalNadSegment } from '@/lib/ediel/core/originalAckPartyIdentities'
import { guideOrderedFixtureBody } from '../__tests__/helpers/prodatGuideOrderedFixture'

type Row = Record<string, unknown>
type Variant = 'L' | 'LK'
type Selector = { variant: Variant; companyId: string; actorUserId: string; switchId: string;
  routeId: string; unrelatedSwitchId: string; siblingCompanyId: string }
type Input = { sourceCommit: string; sourceTree: string; inputEpoch: string; cases: Selector[] }
const digest = (raw: string) => createHash('sha256').update(raw, 'utf8').digest('hex')

const record = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
function exactKeys(value: unknown, keys: string[]): Row {
  const row = record(value)
  if (Object.keys(row).sort().join('|') !== [...keys].sort().join('|')) throw Error('z03_join_selector_keys_required')
  return row
}
function selectorInput(value: unknown): Input {
  const input = exactKeys(value, ['sourceCommit', 'sourceTree', 'inputEpoch', 'cases'])
  if (![input.sourceCommit, input.sourceTree].every(v => typeof v === 'string' && /^[a-f0-9]{40}$/.test(v))
    || typeof input.inputEpoch !== 'string' || !/^[a-zA-Z0-9_-]{8,120}$/.test(input.inputEpoch)
    || !Array.isArray(input.cases) || input.cases.length !== 2) throw Error('z03_join_source_selectors_required')
  const cases = input.cases.map(value => {
    const row = exactKeys(value, ['variant', 'companyId', 'actorUserId', 'switchId', 'routeId', 'unrelatedSwitchId', 'siblingCompanyId'])
    if (!['L', 'LK'].includes(String(row.variant)) || Object.entries(row).some(([key, v]) => key !== 'variant'
      && (typeof v !== 'string' || !uuid.test(v)))) throw Error('z03_join_cohort_selectors_required')
    return row as Selector
  })
  if (cases.map(r => r.variant).sort().join('|') !== 'L|LK'
    || ['companyId', 'actorUserId', 'switchId', 'routeId'].some(key => new Set(cases.map(r => r[key as keyof Selector])).size !== 2)
    || cases.some(r => r.switchId === r.unrelatedSwitchId || r.companyId === r.siblingCompanyId)
    || cases.some(r => cases.some(other => r.switchId === other.unrelatedSwitchId || r.companyId === other.siblingCompanyId))) {
    throw Error('z03_join_disjoint_l_lk_required')
  }
  return { sourceCommit: input.sourceCommit as string, sourceTree: input.sourceTree as string,
    inputEpoch: input.inputEpoch, cases }
}
function observeOwnWire(raw: string, code: 'Z03' | 'Z04', variant: Variant) {
  const wire = tokenizeEdifact(raw), envelope = EdifactEnvelopeCodec.decode(raw)
  const single = (tag: string, scope = wire.segments, qualifier?: string) => {
    const rows = scope.filter(t => t.tag === tag && (!qualifier || segmentComposite(t, 1, wire.una)[0] === qualifier))
    if (rows.length !== 1) throw Error('z03_join_unique_wire_field_required')
    return rows[0]
  }
  const bgm = single('BGM'), lin = single('LIN'), first = wire.segments.slice(wire.segments.indexOf(lin), wire.segments.indexOf(single('UNT')))
  single('UNH')
  const reasonRows = first.filter(t => t.tag === 'CCI' && segmentComposite(t, 2, wire.una)[0] === 'Z13')
  if (reasonRows.length !== 1) throw Error('z03_join_unique_wire_field_required')
  const cav = first[first.indexOf(reasonRows[0]) + 1], reason = cav?.tag === 'CAV' ? segmentComposite(cav, 1, wire.una)[0] : null
  if (segmentComposite(bgm, 1, wire.una)[0] !== code || reason !== (variant === 'L' ? 'Z22' : 'Z23')
    || envelope.applicationReference !== '23-DDQ-PRODAT' || envelope.environment !== 'test') throw Error('z03_join_variant_wire_required')
  const installation = first.filter(t => t.tag === 'NAD' && segmentComposite(t, 1, wire.una)[0] === 'IT')
  const linId = segmentComposite(lin, 3, wire.una), itId = installation.length === 1 ? segmentComposite(installation[0], 2, wire.una) : []
  if (installation.length > 1 || (linId[0] && itId[0] && linId[0] !== itId[0])) throw Error('z03_join_unique_wire_field_required')
  const point = linId[0] || (code === 'Z03' ? itId[0] : ''), agency = linId[0] ? linId[3] : itId[2]
  const li = segmentComposite(single('RFF', first, 'LI'), 1, wire.una)[1]
  const start = segmentComposite(single('DTM', first, '92'), 1, wire.una)[1]
  const customerIdentity = segmentComposite(single('NAD', first, 'UD'), 2, wire.una)
  const gridArea = segmentComposite(single('RFF', first, 'Z05'), 1, wire.una)[1]
  if (!point || !['9', '89'].includes(agency) || !li || !/^\d{12}$/.test(start) || !customerIdentity[0]
    || !gridArea) throw Error('z03_join_physical_own_tuple_required')
  return { code, reason, point, agency, li, start, customerIdentity, gridArea,
    document: segmentComposite(bgm, 2, wire.una)[0], envelope }
}

const smtp = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail: smtp.send }) } }))
function configureSyntheticSmtp() {
  smtp.send.mockReset()
  smtp.send.mockImplementation(async (mail: { to: string }) => ({ accepted: [mail.to], rejected: [],
    messageId: `<synthetic-z03-join-${randomUUID()}@example.invalid>`, response: '250 explicitly synthetic SMTP acceptance' }))
}

// Dynamic imports keep finite raw/selector checks entirely outside native
// setup. These are the current real ports, never JSON executable adapters.
async function nativePorts() {
  const [fixture, mailbox, db, source, method, processContext, switchFlow, transport, ack, committed,
    match, tenant, birth, reception, inbound, decision, responses, technical, auth, smtpConfig, registry, spec] = await Promise.all([
    import('./helpers/ediel-normal-switch-native-fixture'), import('./helpers/originalMailboxNative'),
    import('@/lib/ediel/db'), import('@/lib/ediel/production/customerMasterdataSource'),
    import('@/lib/ediel/production/contractRequestedMethodSource'), import('@/lib/customer-operations/customerSiteProcessContext'),
    import('@/lib/ediel/flows/prodatSwitch'), import('@/lib/ediel/transport/acceptedProjection'),
    import('@/lib/ediel/ack'), import('@/lib/ediel/ack/committedInboundAck'),
    import('@/lib/inbound-mail/inboundMatcher'), import('@/lib/ediel/tenant/resolveInboundTenant'),
    import('@/lib/inbound-mail/inboundStatusUpdater'), import('@/lib/ediel/inbound/receptions'),
    import('@/lib/ediel/flows/inboundProcessing'), import('@/lib/ediel/core/runtimeDecision'),
    import('@/lib/ediel/inbound/businessAckMessages'), import('@/lib/ediel/ack/technicalSyntaxAuthority'),
    import('@supabase/supabase-js'), import('@/lib/ediel/mailReadiness'),
    import('@/lib/supabase/service'), import('@/lib/ediel/specRegistry'),
  ])
  const [outbox, schedule] = await Promise.all([import('@/lib/ediel/outbox/sendOutboxItem'), import('@/lib/operations/supplierSwitchScheduler')])
  return { ...fixture, ...mailbox, ...db, ...source, ...method, ...processContext, ...switchFlow, ...transport,
    ...ack, ...committed, ...match, ...tenant, ...birth, ...reception, ...inbound, ...decision, ...responses,
    ...technical, ...auth, ...smtpConfig, ...registry, ...spec, ...outbox, ...schedule, sql: fixture.nativeSql }
}
type Ports = Awaited<ReturnType<typeof nativePorts>>
type Cohort = Selector & { customerId: string; siteId: string; pointId: string; contractId: string;
  requestedStartDate: string; external: string; brp: string; customerName: string }

function currentSelectors(variant: Variant): Selector {
  const path = process.env.GRIDEX_NATIVE_Z03_ACK_JOIN_INPUT
  if (!path) throw Error('z03_join_INPUT_HOLD:retained_producer_current_prospective_selectors_required')
  const input = selectorInput(JSON.parse(readFileSync(path, 'utf8')))
  // Bind to the producer's actual selected source union and input epoch, rather
  // than this preparation base. No guessed source-applicability or clock override.
  expect(execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()).toBe(input.sourceCommit)
  expect(execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim()).toBe(input.sourceTree)
  execFileSync('git', ['ls-files', '--error-unmatch', 'scripts/ediel-at-z03l-z03lk-supplier-ack-join-native.test.ts',
    'scripts/ediel-at-z03l-z03lk-supplier-ack-join-native.config.ts'], { encoding: 'utf8' })
  execFileSync('git', ['diff', '--exit-code', 'HEAD'], { encoding: 'utf8' })
  expect(process.env.GRIDEX_NATIVE_INPUT_EPOCH).toBe(input.inputEpoch)
  return input.cases.find(row => row.variant === variant)!
}

async function admittedCohort(p: Ports, selected: Selector): Promise<Cohort> {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:54321') throw Error('z03_join_owned_disposable_backend_required')
  const own = p.sql<{ sw: Row; site: Row; point: Row; customer: Row; contract: Row; brp: string; future: boolean }>(`
    SELECT jsonb_build_object('sw',to_jsonb(s),'site',to_jsonb(site),'point',to_jsonb(mp),
      'customer',to_jsonb(c),'contract',to_jsonb(contract),'future',s.requested_start_date>(now() AT TIME ZONE 'Europe/Stockholm')::date,
      'brp',(SELECT brp_ediel_id FROM public.ediel_brp_settings WHERE company_id=s.company_id AND environment='test'))
    FROM public.supplier_switch_requests s JOIN public.customer_sites site ON site.id=s.site_id AND site.company_id=s.company_id
    JOIN public.metering_points mp ON mp.id=s.metering_point_id AND mp.company_id=s.company_id
    JOIN public.customers c ON c.id=s.customer_id AND c.company_id=s.company_id
    JOIN public.customer_contracts contract ON contract.id=coalesce(s.customer_contract_id,s.contract_id) AND contract.company_id=s.company_id
    WHERE s.company_id=${p.literal(selected.companyId)} AND s.id=${p.literal(selected.switchId)}`)
  expect(own, 'z03_join_INPUT_HOLD:current_owned_prospective_graph_required').toBeTruthy()
  const reason = selected.variant === 'L' ? 'Z22' : 'Z23'
  expect(own.sw).toMatchObject({ id: selected.switchId, company_id: selected.companyId, prodat_variant: selected.variant,
    prodat_reason: reason, request_type: selected.variant === 'L' ? 'switch' : 'move_in',
    outbound_z03_message_id: null, inbound_z04_message_id: null, lifecycle_blocked: false })
  expect(['draft', 'ready', 'ready_for_switch', 'ready_for_z03', 'z03_ready'].includes(String(own.sw.status))).toBe(true)
  expect(own.future).toBe(true)
  expect(own.customer).toMatchObject({ is_test_data: true })
  expect(own.site).toMatchObject({ is_test_data: true, customer_id: own.customer.id })
  expect(own.point).toMatchObject({ is_test_data: true, customer_id: own.customer.id, site_id: own.site.id })
  expect(own.contract).toMatchObject({ customer_id: own.customer.id, metering_point_id: own.point.id,
    requested_start_date: own.sw.requested_start_date })
  expect(['signed', 'active']).toContain(own.contract.status)
  expect(own.contract.signed_at).toEqual(expect.any(String))
  expect(own.contract.signature_snapshot_sha256).toMatch(/^[a-f0-9]{64}$/)
  expect(own.contract.document_sha256).toMatch(/^[a-f0-9]{64}$/)
  expect(own.brp).toEqual(expect.any(String))
  const f: Cohort = { ...selected, customerId: String(own.customer.id), siteId: String(own.site.id),
    pointId: String(own.point.id), contractId: String(own.contract.id), external: String(own.point.ediel_metering_point_id),
    requestedStartDate: String(own.sw.requested_start_date), brp: own.brp, customerName: String(own.customer.name) }
  const siteProcess = await p.resolveCustomerSiteProcessContext({ companyId: f.companyId, customerId: f.customerId, siteId: f.siteId })
  expect(siteProcess.processType).toBe(f.variant === 'LK' ? 'move_in' : 'supplier_switch_existing_site')
  if (f.variant === 'LK') expect(own.site.move_in_date).toBe(f.requestedStartDate)
  const method = await p.readContractRequestedMethodSource({ companyId: f.companyId, contractId: f.contractId,
    actorUserId: f.actorUserId, environment: 'test' })
  if (method.status === 'held') throw Error(`z03_join_INPUT_HOLD:current_requested_method:${method.missing.join(',')}`)
  p.assertContractRequestedMethodSelection(method, { companyId: f.companyId, contractId: f.contractId,
    customerId: f.customerId, siteId: f.siteId, meteringPointId: f.pointId, environment: 'test' })
  expect(method.pointId).toBe(f.external)
  const masterdata = await p.prepareCustomerMasterdataSource({ companyId: f.companyId, customerId: f.customerId,
    actorUserId: f.actorUserId, environment: 'test' })
  expect(masterdata.customerIdentity.id).toBe(own.customer.org_number || own.customer.personal_number)
  // Actual disposable GoTrue authentication; no caller-supplied JWT/claims,
  // password, grants or accepted user/context seed. No email is sent.
  const existing = await p.supabaseService.auth.admin.getUserById(f.actorUserId)
  expect(existing.error).toBeNull()
  const email = existing.data.user?.email
  if (!email?.endsWith('@example.invalid')) throw Error('z03_join_INPUT_HOLD:disposable_current_actor_required')
  const link = await p.supabaseService.auth.admin.generateLink({ type: 'magiclink', email })
  expect(link.error).toBeNull(); expect(link.data.user?.id).toBe(f.actorUserId)
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!anon) throw Error('z03_join_owned_local_anon_required')
  const client = p.createClient('http://127.0.0.1:54321', anon, { auth: { persistSession: false, autoRefreshToken: false } })
  try {
    const signed = await client.auth.verifyOtp({ token_hash: link.data.properties!.hashed_token, type: 'email' })
    expect(signed.error).toBeNull(); expect(signed.data.user?.id).toBe(f.actorUserId)
    const current = await client.auth.getUser()
    expect(current.error).toBeNull(); expect(current.data.user?.id).toBe(f.actorUserId)
  } finally { await client.auth.signOut({ scope: 'local' }) }
  return f
}

function exactRows(p: Ports, table: string, company: string, predicate = 'true', order = 'id') {
  // JSON strings, rather than parsed numeric row projections, preserve exact
  // source/control bytes. Table/ordering/predicate are fixed source literals.
  return p.sql<string[]>(`SELECT coalesce(jsonb_agg(to_jsonb(r)::text ORDER BY ${order}),'[]') FROM ${table} r
    WHERE company_id=${p.literal(company)} AND ${predicate}`)
}
function market(p: Ports, f: Cohort) {
  return { customers: exactRows(p, 'public.customers', f.companyId), sites: exactRows(p, 'public.customer_sites', f.companyId),
    points: exactRows(p, 'public.metering_points', f.companyId), contracts: exactRows(p, 'public.customer_contracts', f.companyId),
    periods: exactRows(p, 'public.customer_supply_periods', f.companyId),
    activations: exactRows(p, 'gridex_received_sources.normal_supply_activations', f.companyId, 'true', 'period_id') }
}
function controls(p: Ports, f: Cohort) {
  const ownOther = exactRows(p, 'public.supplier_switch_requests', f.companyId, `id=${p.literal(f.unrelatedSwitchId)}`)
  expect(ownOther, 'z03_join_INPUT_HOLD:nonempty_unrelated_switch_required').toHaveLength(1)
  const otherOriginal = record(JSON.parse(ownOther[0])).outbound_z03_message_id
  expect(otherOriginal, 'z03_join_INPUT_HOLD:unrelated_bound_original_required').toEqual(expect.any(String))
  const original = exactRows(p, 'public.ediel_messages', f.companyId, `id=${p.literal(otherOriginal)}`)
  expect(original).toHaveLength(1)
  const sibling = { customers: exactRows(p, 'public.customers', f.siblingCompanyId),
    switches: exactRows(p, 'public.supplier_switch_requests', f.siblingCompanyId),
    originals: exactRows(p, 'public.ediel_messages', f.siblingCompanyId), market: market(p, { ...f, companyId: f.siblingCompanyId }) }
  expect(sibling.customers.length).toBeGreaterThan(0); expect(sibling.switches.length).toBeGreaterThan(0)
  expect(sibling.originals.length).toBeGreaterThan(0)
  return { ownOther, original, sibling }
}
function sealed(p: Ports, company: string, id: string) {
  return p.sql<string>(`SELECT to_jsonb(jsonb_build_object('id',m.id,'company',m.company_id,'environment',m.environment,
    'raw',m.raw_payload,'hash',m.immutable_payload_hash,'direction',m.direction,'sourceOperation',m.source_operation_id,
    'customer',m.customer_id,'site',m.site_id,'point',m.metering_point_id,'intent',m.intent_id,'request',m.outbound_request_id,
    'canonical',jsonb_build_object('pack',m.canonical_rule_pack_id,'profile',m.rule_profile_version_id,'key',m.rule_profile_key,
      'checksum',m.rule_pack_checksum,'snapshot',m.rule_pack_snapshot),'execution',m.execution_context_snapshot,
    'source',(SELECT to_jsonb(r) FROM gridex_received_sources.sources r WHERE source_message_id=m.id),
    'origin',(SELECT to_jsonb(r) FROM gridex_received_sources.switch_originals r WHERE message_id=m.id))::text)
    FROM public.ediel_messages m WHERE m.id=${p.literal(id)} AND m.company_id=${p.literal(company)}`)
}

async function sendOwn(p: Ports, f: Cohort, message: EdielMessageRow) {
  const outboxes = p.sql<Row[]>(`SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY id),'[]') FROM public.ediel_outbox o
    WHERE company_id=${p.literal(f.companyId)} AND environment='test' AND ediel_message_id=${p.literal(message.id)}`)
  expect(outboxes).toHaveLength(1)
  expect(outboxes[0]).toMatchObject({ immutable_payload_hash: digest(message.raw_payload!), status: 'queued', sent_at: null })
  const result = await p.sendOutboxItem({ actorUserId: f.actorUserId, outboxItemId: String(outboxes[0].id), smtpMimeMode: 'nodemailer-attachment' })
  expect(result.status, JSON.stringify(result)).toBe('sent')
  const accepted = await p.readAcceptedEdielTransportProjection({ companyId: f.companyId, environment: 'test',
    actorUserId: f.actorUserId, messageId: message.id })
  expect(accepted).toMatchObject({ status: 'accepted_projection', companyId: f.companyId, environment: 'test',
    messageId: message.id, originalHash: digest(message.raw_payload!), lane: 'generic_journal',
    businessExpectationPlan: null, authorizesProviderEntry: false, deliveryProven: false })
  expect(accepted!.providerReceipt.accepted).toEqual([accepted!.frozenRecipient])
  expect(accepted!.providerReceipt.rejected).toEqual([])
  expect(accepted!.providerReceipt.messageId).toBe(result.messageId)
  return accepted!
}

async function physicalReceive(p: Ports, f: Cohort, raw: string) {
  const mailbox = await p.seedOriginalMailboxNative(
    <T = unknown>(statement: string): T => p.nativeSql<T>(`BEGIN;\nSET LOCAL ROLE service_role;\n${statement}\nCOMMIT;`),
    p.literal, { companyId: f.companyId, environment: 'test', raw, smtpFrom: p.edielSmtpConfig().from!, senderEmail: 'recipient@example.invalid' })
  const parsed = mailbox.parsed
  const [outboundMatch, meteringPointMatch] = await Promise.all([
    p.matchOutboundRequestForInbound({ companyId: f.companyId, parsed, inboundEmailMessageId: mailbox.inboundEmailMessageId, parseResultId: mailbox.parseResultId }),
    p.matchMeteringPointForInbound({ companyId: f.companyId, parsed, inboundEmailMessageId: mailbox.inboundEmailMessageId, parseResultId: mailbox.parseResultId }),
  ])
  const tenant = await p.resolveInboundTenantFromIdentifiers({ mailboxCompanyId: f.companyId, mailboxId: mailbox.mailboxId,
    environment: 'test', senderEdielId: parsed.senderEdielId, senderSubaddress: parsed.senderSubAddress,
    receiverEdielId: parsed.receiverEdielId, receiverSubaddress: parsed.receiverSubAddress,
    marketActorEdielId: p.inboundLegalReceiverEdielId(raw, parsed.receiverEdielId), applicationReference: parsed.applicationReference,
    messageFamily: parsed.messageFamily, messageCode: parsed.messageCode, referenceCandidates: Object.values(parsed.references).flat() })
  expect(tenant, 'physical current tenant resolution').toMatchObject({ status: 'resolved', companyId: f.companyId })
  const id = await p.createInboundEdielMessage({ companyId: f.companyId, actorUserId: f.actorUserId, environment: 'test',
    inboundEmailMessageId: mailbox.inboundEmailMessageId, parseResultId: mailbox.parseResultId, parsed,
    outboundMatch, meteringPointMatch, tenantResolution: tenant })
  expect(id, 'z03_join_physical_canonical_birth_required').toEqual(expect.any(String))
  const message = (await p.getEdielMessageById(id!, { companyId: f.companyId }))!
  expect(message).toMatchObject({ company_id: f.companyId, environment: 'test', direction: 'inbound',
    inbound_email_message_id: mailbox.inboundEmailMessageId, mailbox_message_id: mailbox.inboundEmailMessageId,
    raw_payload: raw, immutable_payload_hash: digest(raw) })
  const custody = await p.readInboundReceptionRequest({ companyId: f.companyId, messageId: message.id,
    inboundEmailMessageId: mailbox.inboundEmailMessageId, actorUserId: f.actorUserId })
  expect(custody).toMatchObject({ companyId: f.companyId, sourceMessageId: message.id, classification: 'first_reception',
    inboundEmailMessageId: mailbox.inboundEmailMessageId, parseResultId: mailbox.parseResultId,
    canonicalPayloadHash: digest(raw), receivedPayloadHash: digest(raw), businessEffectAuthorized: false })
  const decision = await p.resolveCanonicalRuntimeDecisionWithRegistry(message, { actorUserId: f.actorUserId })
  expect([decision.syntaxDecision, decision.applicationDecision, decision.functionalDecision], JSON.stringify(decision))
    .toEqual(['accepted', 'accepted', 'accepted'])
  return { message, mailbox, custody }
}

function assertAckWire(raw: string, sourceRaw: string, family: 'CONTRL' | 'APERAK', point: string) {
  const source = tokenizeEdifact(sourceRaw), wire = tokenizeEdifact(raw)
  const envelope = EdifactEnvelopeCodec.decode(sourceRaw), reverse = EdifactEnvelopeCodec.decode(raw)
  expect(reverse).toMatchObject({ sender: envelope.receiver, receiver: envelope.sender, senderSubAddress: envelope.receiverSubAddress,
    receiverSubAddress: envelope.senderSubAddress, environment: 'test', applicationReference: '23-DDQ-PRODAT' })
  const single = (tag: string, qualifier?: string) => {
    const found = wire.segments.filter(s => s.tag === tag && (!qualifier || segmentComposite(s, 1, wire.una)[0] === qualifier))
    expect(found).toHaveLength(1); return found[0]
  }
  expect(segmentComposite(single('UNH'), 2, wire.una)[0]).toBe(family)
  if (family === 'CONTRL') {
    const uci = single('UCI'), unb = source.segments.find(s => s.tag === 'UNB')!
    expect(segmentComposite(uci, 1, wire.una)[0]).toBe(envelope.interchangeReference!.slice(0, 14))
    expect(segmentComposite(uci, 4, wire.una)[0]).toBe('1')
    for (const i of [2, 3]) expect(segmentComposite(uci, i, wire.una)).toEqual(segmentComposite(unb, i, source.una))
    for (const ucm of wire.segments.filter(s => s.tag === 'UCM')) {
      expect(segmentComposite(ucm, 1, wire.una)[0]).toBe(segmentComposite(source.segments.find(s => s.tag === 'UNH')!, 1, source.una)[0])
      expect(segmentComposite(ucm, 3, wire.una)[0]).toBe('1')
    }
  } else {
    const sourceParties = originalAckPartyIdentities({ rawPayload: sourceRaw })
    for (const [role, party] of [['FR', sourceParties.legalReceiver], ['DO', sourceParties.legalSender]] as const)
      expect(segmentComposite(single('NAD', role), 2, wire.una)).toEqual(party.identityComponents)
    expect(wire.segments.filter(t => t.tag === 'ERC').map(t => segmentComposite(t, 1, wire.una))).toEqual([['100', '', '260']])
    const bgm = source.segments.find(s => s.tag === 'BGM')!
    const li = source.segments.find(s => s.tag === 'RFF' && segmentComposite(s, 1, source.una)[0] === 'LI')!
    expect(segmentComposite(single('RFF', 'ACW'), 1, wire.una)).toEqual(['ACW', segmentComposite(bgm, 2, source.una)[0]])
    expect(segmentComposite(single('RFF', 'LI'), 1, wire.una)).toEqual(segmentComposite(li, 1, source.una))
    expect(segmentComposite(single('RFF', 'Z07'), 1, wire.una)).toEqual(['Z07', point])
  }
}

async function ownRequestAck(p: Ports, f: Cohort, original: EdielMessageRow, family: 'CONTRL' | 'APERAK') {
  // A DSO view is only pure raw rendering input. The sealed supplier original
  // is never rewritten, and this view is never passed as a received source.
  const input = { actorUserId: f.actorUserId, sourceMessage: { ...original, direction: 'inbound' as const }, outcome: 'positive' as const }
  const raw = (family === 'CONTRL' ? p.buildContrlDraft(input) : p.buildAperakDraft(input)).rawPayload!
  assertAckWire(raw, original.raw_payload!, family, f.external)
  const received = await physicalReceive(p, f, raw)
  expect(received.message.message_family).toBe(family)
  await p.processInboundEdielMessage({ actorUserId: f.actorUserId, edielMessageId: received.message.id })
  const message = (await p.getEdielMessageById(received.message.id, { companyId: f.companyId }))!
  const receipt = await p.readCommittedInboundAck({ actorUserId: f.actorUserId, message })
  expect(receipt).toMatchObject({ kind: 'exact_receipt', sourceMessageId: original.id,
    result: { outcome: 'positive', sourceMessage: { id: original.id, company_id: f.companyId, environment: 'test',
      direction: 'outbound', raw_payload: original.raw_payload, immutable_payload_hash: digest(original.raw_payload!) } } })
  expect(p.sql<Row>(`SELECT to_jsonb(c) FROM gridex_ack_authority.source_correlations c
    WHERE ack_message_id=${p.literal(message.id)} AND company_id=${p.literal(f.companyId)}`)).toMatchObject({
    company_id: f.companyId, environment: 'test', source_message_id: original.id, source_payload_hash: digest(original.raw_payload!),
    ack_message_id: message.id, ack_payload_hash: digest(raw), ack_family: family, ack_outcome: 'positive' })
  return { ...received, message, receipt }
}

function externalZ04(f: Pick<Cohort, 'variant' | 'customerName' | 'brp'>, originalRaw: string) {
  const own = observeOwnWire(originalRaw, 'Z03', f.variant), parties = originalAckPartyIdentities({ rawPayload: originalRaw })
  const parts = (raw: string): Parts[] => {
    const wire = tokenizeEdifact(raw)
    return wire.segments.map(s => [s.tag, ...Array.from({ length: segmentElementCount(s, wire.una) }, (_, i) => segmentComposite(s, i + 1, wire.una))])
  }
  const characteristic = (qualifier: string, value: string, position = 0): Parts[] =>
    [['CCI', '', qualifier], ['CAV', [...Array<string>(position).fill(''), value]]]
  const body: Parts[] = [['BGM', 'Z04', randomUUID().replaceAll('-', '').slice(0, 14), '9', 'AB'],
    ['DTM', ['137', prodatNowDate203(), '203']], ['DTM', ['ZZZ', '1', '805']],
    ...parts(originalAckLegalNadSegment('FR', parties.legalReceiver) + "'"),
    ...parts(originalAckLegalNadSegment('DO', parties.legalSender) + "'"),
    ['LIN', '1', '', [own.point, '', '', own.agency]], ['DTM', ['92', own.start, '203']], ['DTM', ['354', '15', '806']],
    ['QTY', ['31', '1000', 'KWH']], ...characteristic('Z13', own.reason), ...characteristic('Z04', 'Z03'),
    ...characteristic('Z07', 'Z12'), ...characteristic('Z12', 'D', 3), ...characteristic('Z15', 'Z32'),
    ...characteristic('Z02', '10', 3), ...characteristic('Z05', '8', 3), ...characteristic('Z16', '101', 3),
    ['CCI', '', 'Z14'], ['CAV', ['', '', '', 'L917', '8716867000030']],
    ['RFF', ['MG', `SYNTHETIC-${own.point}`]], ['RFF', ['LI', own.li]], ['RFF', ['Z05', own.gridArea]],
    ['NAD', 'UD', own.customerIdentity, '', f.customerName, 'Synthetic DSO road', 'Teststad', '', '12345', 'SE'],
    ['NAD', 'IT', [own.point, '', '9'], '', '', 'Synthetic installation road', 'Teststad', '', '12345', 'SE'],
    ['NAD', 'Z02', [f.brp, '160', 'SVK'], '', '', '', '', '', '', 'SE']]
  const render = (part: Parts) => part.map(v => (typeof v === 'string' ? [v] : v)
    .map(s => s.replace(/[?':+]/g, ch => '?' + ch)).join(':')).join('+')
  const e = own.envelope
  // External synthetic DSO representation; only the actual physical mailbox,
  // canonical birth/current source owners and normal transition can qualify it.
  return EdifactEnvelopeCodec.encode({ sender: e.receiver!, receiver: e.sender!, senderQualifier: e.receiverQualifier,
    receiverQualifier: e.senderQualifier, senderSubAddress: e.receiverSubAddress, receiverSubAddress: e.senderSubAddress,
    applicationReference: '23-DDQ-PRODAT', acknowledgementRequest: true, environment: 'test', createdAt: new Date(),
    interchangeReference: randomUUID().replaceAll('-', '').slice(0, 14), messages: [{
      messageReference: randomUUID().replaceAll('-', '').slice(0, 14), messageTypeToken: 'PRODAT:D:97A:UN:E2SE6A',
      businessSegments: guideOrderedFixtureBody(body).map(render) }] })
}

async function causalZ04(p: Ports, f: Cohort, original: EdielMessageRow) {
  const raw = externalZ04(f, original.raw_payload!), own = observeOwnWire(original.raw_payload!, 'Z03', f.variant)
  const physical = observeOwnWire(raw, 'Z04', f.variant)
  for (const key of ['reason', 'point', 'agency', 'li', 'start', 'customerIdentity', 'gridArea'] as const)
    expect(physical[key], key).toEqual(own[key])
  const before = market(p, f), received = await physicalReceive(p, f, raw)
  expect(received.message).toMatchObject({ message_family: 'PRODAT', message_code: 'Z04', customer_id: f.customerId,
    metering_point_id: f.pointId })
  await p.processInboundEdielMessage({ actorUserId: f.actorUserId, edielMessageId: received.message.id })
  const confirmed = p.sql<{ proof: Row; period: Row; transition: Row; sw: Row; future: boolean }>(`
    SELECT jsonb_build_object('proof',to_jsonb(c),'period',to_jsonb(period),'transition',to_jsonb(t),'sw',to_jsonb(s),
      'future',c.market_start_at>now()) FROM gridex_received_sources.normal_switch_confirmations c
    JOIN public.customer_supply_periods period ON period.id=c.period_id AND period.company_id=c.company_id
    JOIN public.supplier_switch_requests s ON s.id=c.switch_id AND s.company_id=c.company_id
    JOIN gridex_received_sources.supply_source_transitions t ON t.source_message_id=c.source_message_id AND t.company_id=c.company_id
    WHERE c.company_id=${p.literal(f.companyId)} AND c.source_message_id=${p.literal(received.message.id)} AND c.switch_id=${p.literal(f.switchId)}`)
  expect(confirmed, 'actual canonical consumer must commit the exact same-original confirmation').toBeTruthy()
  expect(confirmed.proof).toMatchObject({ company_id: f.companyId, switch_id: f.switchId, original_message_id: original.id,
    original_payload_hash: digest(original.raw_payload!), source_message_id: received.message.id, contract_id: f.contractId,
    source_object: { point: own.point, li: own.li, start: own.start, reason: own.reason, customerIdentity: own.customerIdentity[0] } })
  expect(confirmed.period).toMatchObject({ company_id: f.companyId, customer_id: f.customerId, metering_point_id: f.pointId,
    contract_id: f.contractId, source_switch_request_id: f.switchId, source_message_id: received.message.id,
    start_date: f.requestedStartDate, status: 'confirmed_by_grid_owner', market_state_version: 1 })
  expect(confirmed.sw).toMatchObject({ status: 'accepted', inbound_z04_message_id: received.message.id,
    confirmed_start_date: f.requestedStartDate, outbound_z03_message_id: original.id, rff_li_reference: own.li })
  expect(confirmed.transition).toMatchObject({ company_id: f.companyId, source_message_id: received.message.id,
    payload_hash: digest(raw), qualified_switch_ids: [f.switchId], source_code: 'Z04', actor_user_id: f.actorUserId })
  expect(confirmed.future).toBe(true)
  expect(Date.parse(String(confirmed.proof.market_start_at))).toBe(Date.parse(prodatMarketMinuteToUtc(own.start)!))
  expect(Date.parse(String(confirmed.period.market_start_at))).toBe(Date.parse(String(confirmed.proof.market_start_at)))
  const after = market(p, f)
  for (const key of ['customers', 'sites', 'points', 'contracts', 'activations'] as const) expect(after[key], key).toEqual(before[key])
  expect(after.periods).toHaveLength(before.periods.length + 1)
  expect(after.periods).toEqual(expect.arrayContaining(before.periods))
  const acks = await p.listBusinessAckMessagesForSource({ companyId: f.companyId, environment: 'test',
    sourceMessageId: received.message.id, actorUserId: f.actorUserId })
  expect(acks.map(m => m.message_family).sort()).toEqual(['APERAK', 'CONTRL'])
  for (const ack of acks) {
    expect(ack).toMatchObject({ direction: 'outbound', company_id: f.companyId, environment: 'test',
      related_message_id: received.message.id, ack_outcome: 'positive', immutable_payload_hash: digest(ack.raw_payload!) })
    assertAckWire(ack.raw_payload!, raw, ack.message_family as 'CONTRL' | 'APERAK', f.external)
    if (ack.message_family === 'CONTRL') {
      const basis = await p.readPersistedEdielTechnicalContrlBasis({ companyId: f.companyId, environment: 'test',
        ackMessageId: ack.id, expectedRawPayload: ack.raw_payload!, actorUserId: f.actorUserId, phase: 'read' })
      expect(basis.evidence).toMatchObject({ sourceMessageId: received.message.id, sourceHash: digest(raw), syntaxDecision: 'accepted' })
    } else {
      // Bind the business response's actual immutable owner/facet consumption
      // to this Z04 hash, separately from the request's incoming ACK receipts.
      expect(p.sql<boolean>(`SELECT to_jsonb(EXISTS(SELECT FROM public.ediel_messages m
        JOIN gridex_ediel_outbound_owner.witnesses w ON w.id::text=m.execution_context_snapshot->>'outboundOwnerWitnessId'
        JOIN gridex_ediel_outbound_owner.consumptions c ON c.witness_id=w.id AND c.source_message_id=m.id
        WHERE m.id=${p.literal(ack.id)} AND m.company_id=${p.literal(f.companyId)} AND m.environment='test'
        AND m.direction='outbound' AND m.message_family='APERAK' AND m.related_message_id=${p.literal(received.message.id)}
        AND w.company_id=m.company_id AND w.environment=m.environment AND w.family='APERAK'
        AND w.actor_user_id=${p.literal(f.actorUserId)} AND w.related_message_id=m.related_message_id
        AND w.payload_sha256=${p.literal(digest(ack.raw_payload!))} AND c.payload_sha256=w.payload_sha256
        AND c.company_id=m.company_id AND c.environment=m.environment AND (
          EXISTS(SELECT FROM gridex_ediel_ack_guide.prodat_response_owner_bindings b
            JOIN gridex_received_sources.prodat_response_facets r ON r.assessment_id=b.assessment_id
            WHERE b.witness_id=w.id AND b.source_message_id=m.related_message_id AND b.company_id=m.company_id
            AND b.environment=m.environment AND b.ack_hash=w.payload_sha256 AND b.facet_hash=r.response_facts_hash
            AND r.source_message_id=b.source_message_id AND r.company_id=b.company_id AND r.environment=b.environment
            AND r.source_payload_hash=${p.literal(digest(raw))}
            AND r.response_facts_hash=encode(sha256(convert_to(r.response_facts_text,'UTF8')),'hex'))
          OR EXISTS(SELECT FROM gridex_ediel_ack_guide.prodat_structural_response_bindings b
            WHERE b.witness_id=w.id AND b.source_message_id=m.related_message_id AND b.company_id=m.company_id
            AND b.environment=m.environment AND b.ack_hash=w.payload_sha256
            AND b.facet_hash=encode(sha256(convert_to(b.facet_text,'UTF8')),'hex')
            AND b.facet_text::jsonb->>'sourcePayloadHash'=${p.literal(digest(raw))}))))`)).toBe(true)
    }
    await sendOwn(p, f, ack)
  }
  return { ...received, confirmed, acks }
}

describe('native prospective own Z03 L/LK ACK-to-Z04 join', () => {
  it.each(['L', 'LK'] as const)('%s joins its sent original and physical request ACKs to only its own future Z04', async variant => {
    const selected = currentSelectors(variant), p = await nativePorts(), f = await admittedCohort(p, selected)
    // Transparent external SMTP substitution only. Actual send-owner chooses
    // the recipient, enters the provider and commits its observed acceptance.
    configureSyntheticSmtp()
    const preservedControls = controls(p, f), before = market(p, f)
    const prepared = await p.prepareAndQueueEdielZ03({ actorUserId: f.actorUserId, switchRequestId: f.switchId,
      communicationRouteId: f.routeId, environment: 'test' })
    const original = (await p.getEdielMessageById(prepared.id, { companyId: f.companyId }))!
    expect(original).toMatchObject({ direction: 'outbound', environment: 'test', message_family: 'PRODAT', message_code: 'Z03',
      company_id: f.companyId, customer_id: f.customerId, site_id: f.siteId, metering_point_id: f.pointId,
      switch_request_id: f.switchId, immutable_payload_hash: digest(original.raw_payload!) })
    const own = observeOwnWire(original.raw_payload!, 'Z03', variant)
    expect(own.point).toBe(f.external); expect(own.start.slice(0, 8)).toBe(f.requestedStartDate.replaceAll('-', ''))
    const origin = p.sql<Row>(`SELECT to_jsonb(o) FROM gridex_received_sources.switch_originals o
      WHERE message_id=${p.literal(original.id)} AND company_id=${p.literal(f.companyId)} AND switch_id=${p.literal(f.switchId)}`)
    expect(origin).toMatchObject({ message_id: original.id, company_id: f.companyId, switch_id: f.switchId,
      payload_hash: digest(original.raw_payload!), actor_user_id: f.actorUserId, contract_id: f.contractId })
    expect(record(origin.previous_switch)).toMatchObject({ prodat_variant: variant, prodat_reason: variant === 'L' ? 'Z22' : 'Z23',
      outbound_z03_message_id: null })
    const immutable = sealed(p, f.companyId, original.id), accepted = await sendOwn(p, f, original)
    // Observe the accepted provider instant against the current normative
    // policy and this immutable original's physical start. This changes no
    // clock and proves no delayed-queue refusal: that separate guard is held.
    const originalStartDate = `${own.start.slice(0, 4)}-${own.start.slice(4, 6)}-${own.start.slice(6, 8)}`
    const observedWindow = p.evaluateSupplierSwitchSendWindow({ requestedStartDate: originalStartDate,
      policy: p.loadSupplierSwitchPolicy({ subtype: variant }), now: new Date(accepted.observedAt) })
    expect(observedWindow, 'selected positive original must actually have been sent inside its own lawful window')
      .toMatchObject({ requestedStartDate: f.requestedStartDate, transactionSubtype: variant, windowOpen: true, reason: 'open' })
    const sent = (await p.getEdielMessageById(original.id, { companyId: f.companyId }))!
    expect(['sent', 'acknowledged']).toContain(sent.status)
    expect(Date.parse(sent.message_sent_at!)).toBe(Date.parse(accepted.observedAt))
    for (const due of [sent.ack_due_at, sent.contrl_due_at])
      expect(Date.parse(due!)).toBe(Date.parse(accepted.observedAt) + p.EDIEL_ACK_DEADLINE_MINUTES * 60000)
    const attempt = p.sql<{ plan: Row; policy: Row; originalHash: string; recipient: string; actor: string; owner: Row }>(`SELECT jsonb_build_object('plan',binding->'technicalExpectationPlan',
      'originalHash',binding->>'originalHash','recipient',binding->>'to','actor',actor_user_id,'owner',owner,
      'policy',jsonb_build_object('guideRevision',binding#>'{admissionDecision,guide,guideRevision}',
        'referenceDate',binding#>'{admissionDecision,referenceDate}','profileKey',binding#>'{admissionDecision,profileKey}',
        'sourceTrace',binding#>'{admissionDecision,sourceTrace}')) FROM gridex_ediel_transport.attempts
      WHERE id=${p.literal(accepted.attemptId)} AND company_id=${p.literal(f.companyId)} AND environment='test'
        AND message_id=${p.literal(original.id)} AND classification='accepted' AND observed_at=${p.literal(accepted.observedAt)}::timestamptz`)
    expect(attempt.plan).toEqual({ version: 1, ruleId: 'TM-CONTRL', offset: p.EDIEL_ACK_DEADLINE_MINUTES, unit: 'minutes',
      anchor: 'actual_accepted_smtp_observed_at', timerKind: 'internal_sender_watch', remoteReceiptKnown: false, policy: attempt.policy })
    expect(attempt.policy).toMatchObject({ guideRevision: expect.any(String), referenceDate: expect.any(String),
      profileKey: expect.any(String), sourceTrace: expect.any(Array) })
    expect(attempt).toMatchObject({ originalHash: digest(original.raw_payload!), recipient: accepted.frozenRecipient,
      actor: f.actorUserId, owner: { kind: 'worker', outboxId: expect.any(String), sendAttemptId: expect.any(String) } })
    expect(market(p, f)).toEqual(before); expect(sealed(p, f.companyId, original.id)).toBe(immutable)
    const contrl = await ownRequestAck(p, f, original, 'CONTRL')
    expect(market(p, f)).toEqual(before)
    let aperak: Awaited<ReturnType<typeof ownRequestAck>>, z04: Awaited<ReturnType<typeof causalZ04>>
    if (variant === 'L') {
      aperak = await ownRequestAck(p, f, original, 'APERAK')
      expect(market(p, f)).toEqual(before)
      z04 = await causalZ04(p, f, original)
    } else {
      // Correct business confirmation is allowed before the full request pair.
      const partial = (await p.getEdielMessageById(original.id, { companyId: f.companyId }))!
      expect(partial.contrl_status).toBe('received'); expect(partial.aperak_status).not.toBe('received')
      z04 = await causalZ04(p, f, original)
      const confirmedMarket = market(p, f)
      aperak = await ownRequestAck(p, f, original, 'APERAK')
      expect(market(p, f)).toEqual(confirmedMarket)
    }
    expect(aperak.receipt).toMatchObject({ kind: 'exact_receipt', sourceMessageId: original.id,
      result: { finalAckReached: true, sourceAccepted: true, wholeSourceRejected: false } })
    expect(await p.getEdielMessageById(original.id, { companyId: f.companyId })).toMatchObject({ contrl_status: 'received', aperak_status: 'received' })
    expect(contrl.message.id).not.toBe(aperak.message.id)
    for (const requestAck of [contrl.message, aperak.message]) {
      expect(requestAck.direction).toBe('inbound')
      expect(z04.acks.some(reply => reply.id === requestAck.id)).toBe(false)
    }
    expect(p.sql<Row>(`SELECT to_jsonb(s) FROM public.supplier_switch_requests s WHERE company_id=${p.literal(f.companyId)} AND id=${p.literal(f.switchId)}`))
      .toMatchObject({ status: 'accepted', inbound_z04_message_id: z04.message.id, outbound_z03_message_id: original.id,
        prodat_variant: variant, prodat_reason: variant === 'L' ? 'Z22' : 'Z23' })
    expect(sealed(p, f.companyId, original.id)).toBe(immutable)
    expect(controls(p, f)).toEqual(preservedControls)
    const replay = () => ({ market: market(p, f), controls: controls(p, f), original: sealed(p, f.companyId, original.id),
      sources: [contrl.message, aperak.message, z04.message].map(m => sealed(p, f.companyId, m.id)),
      correlations: exactRows(p, 'gridex_ack_authority.source_correlations', f.companyId, 'true', 'ack_message_id'),
      applied: p.sql(`SELECT coalesce(jsonb_agg(to_jsonb(r)::text ORDER BY r.ack_message_id),'[]')
        FROM gridex_ack_authority.applied_receipts r JOIN gridex_ack_authority.source_correlations c USING(ack_message_id)
        WHERE c.company_id=${p.literal(f.companyId)}`),
      confirmations: exactRows(p, 'gridex_received_sources.normal_switch_confirmations', f.companyId, 'true', 'period_id'),
      transitions: exactRows(p, 'gridex_received_sources.supply_source_transitions', f.companyId, 'true', 'source_message_id'),
      outboxes: exactRows(p, 'public.ediel_outbox', f.companyId), attempts: exactRows(p, 'gridex_ediel_transport.attempts', f.companyId),
      sends: smtp.send.mock.calls.length })
    const frozen = replay()
    for (const m of [contrl.message, aperak.message, z04.message])
      await p.processInboundEdielMessage({ actorUserId: f.actorUserId, edielMessageId: m.id })
    expect(replay()).toEqual(frozen)
    for (const received of [contrl, aperak, z04]) {
      expect(await p.readInboundReceptionRequest({ companyId: f.companyId, messageId: received.message.id,
        inboundEmailMessageId: received.mailbox.inboundEmailMessageId, actorUserId: f.actorUserId })).toEqual(received.custody)
    }
  })
})

// Finite tests exercise only the selector/raw-wire assertion boundary used by
// the prospective native cases. No backend, source admission or native callback.
describe('finite Z03 join input and raw boundary', () => {
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
  const data = () => ({ sourceCommit: 'a'.repeat(40), sourceTree: 'b'.repeat(40), inputEpoch: 'disposable-own-epoch',
    cases: (['L', 'LK'] as const).map((variant, i) => ({ variant, companyId: id(i * 10 + 1),
      actorUserId: id(i * 10 + 2), switchId: id(i * 10 + 3), routeId: id(i * 10 + 4),
      unrelatedSwitchId: id(i * 10 + 5), siblingCompanyId: id(i * 10 + 6) })) })
  it('admits only disjoint L/LK data selectors', () => {
    expect(selectorInput(data())).toEqual(data())
  })
  it('refuses authority facts supplied by an input instead of its consumers', () => {
    const value = data()
    expect(() => selectorInput({ ...value, accepted: true })).toThrow('z03_join_selector_keys_required')
    expect(() => selectorInput({ ...value, cases: [{ ...value.cases[0], receivedAckContext: {} }, value.cases[1]] }))
      .toThrow('z03_join_selector_keys_required')
  })
  it('refuses relabelled or overlapping prospective cohort selectors', () => {
    const value = data()
    expect(() => selectorInput({ ...value, cases: [value.cases[0], { ...value.cases[1], variant: 'L' }] }))
      .toThrow('z03_join_disjoint_l_lk_required')
    expect(() => selectorInput({ ...value, cases: [value.cases[0], { ...value.cases[1], switchId: value.cases[0].switchId }] }))
      .toThrow('z03_join_disjoint_l_lk_required')
  })
  const wire = (reason: string) => EdifactEnvelopeCodec.encode({ sender: '40001', receiver: '60001',
    senderQualifier: '14', receiverQualifier: '14', environment: 'test', applicationReference: '23-DDQ-PRODAT',
    interchangeReference: 'OWN-INTERCHANGE', acknowledgementRequest: true, createdAt: new Date('2026-10-13T12:00:00Z'),
    messages: [{ messageReference: 'OWN-MESSAGE', messageTypeToken: 'PRODAT:D:97A:UN:E2SE6A', businessSegments: [
      'BGM+Z03+OWN-DOCUMENT+9+AB', 'NAD+FR+40001::260+++++++SE', 'NAD+DO+60001::260+++++++SE',
      'LIN+1++735123456789012345:::9', 'DTM+92:202610270000:203', `CCI++Z13`, `CAV+${reason}`,
      'RFF+LI:OWN-LI', 'RFF+Z05:TES', 'NAD+UD+199001011234:SE2:260',
    ] }] })
  it.each([['L', 'Z22'], ['LK', 'Z23']] as const)('observes the actual own %s wire identity', (variant, reason) => {
    expect(observeOwnWire(wire(reason), 'Z03', variant)).toMatchObject({ code: 'Z03', reason,
      point: '735123456789012345', agency: '9', li: 'OWN-LI', start: '202610270000',
      customerIdentity: ['199001011234', 'SE2', '260'], gridArea: 'TES', document: 'OWN-DOCUMENT' })
  })
  it('refuses the wrong original subtype and duplicate own LI before causal comparison', () => {
    expect(() => observeOwnWire(wire('Z22'), 'Z03', 'LK')).toThrow('z03_join_variant_wire_required')
    expect(() => observeOwnWire(wire('Z22').replace('RFF+LI:OWN-LI', 'RFF+LI:FOREIGN-LI\'RFF+LI:OWN-LI'), 'Z03', 'L'))
      .toThrow('z03_join_unique_wire_field_required')
  })
  it.each([['L', 'Z22'], ['LK', 'Z23']] as const)('renders only a synthetic external Z04%s representation of the own tuple', (variant, reason) => {
    const raw = externalZ04({ variant, customerName: 'Synthetic Own Customer', brp: '99876' }, wire(reason))
    expect(observeOwnWire(raw, 'Z04', variant)).toMatchObject({ code: 'Z04', reason,
      point: '735123456789012345', agency: '9', li: 'OWN-LI', start: '202610270000',
      customerIdentity: ['199001011234', 'SE2', '260'], gridArea: 'TES',
      envelope: { sender: '60001', receiver: '40001', environment: 'test', applicationReference: '23-DDQ-PRODAT' } })
    const replyWire = tokenizeEdifact(raw)
    for (const [role, party] of [['FR', '60001'], ['DO', '40001']] as const) {
      const nad = replyWire.segments.filter(t => t.tag === 'NAD' && segmentComposite(t, 1, replyWire.una)[0] === role)
      expect(nad).toHaveLength(1); expect(segmentComposite(nad[0], 2, replyWire.una)[0]).toBe(party)
    }
  })
  it.each(['raw', 'attachment'] as const)('actual sendEdielEmail %s reaches the declared SMTP boundary with its real envelope recipient', async mode => {
    // Finite adapter qualification only: actual config/readiness, MailComposer,
    // provider-gate binding and return normalization execute. MIME storage is
    // the declared lower port; no archive/backend/journal/native effect exists.
    const archiveContext = { companyId: id(90), messageId: id(91) }, bindings: Row[] = []
    vi.resetModules()
    vi.doMock('@/lib/ediel/transport/rawMimeArchive', () => ({
      archiveTransportRawMime: async (raw: Buffer, context: typeof archiveContext) => {
        if (context.companyId !== archiveContext.companyId || context.messageId !== archiveContext.messageId)
          throw Error('finite_smtp_archive_scope_mismatch')
        const messageId = raw.toString('latin1').match(/^Message-ID:\s*(<[^\r\n]+>)$/im)?.[1]
        if (!messageId) throw Error('finite_smtp_archive_header_required')
        return { mimeArchiveRef: 'modeled://finite-mime-port', mimeSha256: createHash('sha256').update(raw).digest('hex'),
          mimeLength: raw.length, rfcMessageId: messageId, mimePayloadSnapshotId: id(92) }
      },
    }))
    for (const [key, value] of Object.entries({ EMAIL_PROVIDER: 'resend', EDIEL_EMAIL_PROVIDER: 'strato',
      EDIEL_SMTP_HOST: 'synthetic-smtp.example.invalid', EDIEL_SMTP_PORT: '465', EDIEL_SMTP_SECURE: 'true',
      EDIEL_SMTP_FROM: 'synthetic@example.invalid', EDIEL_SMTP_USER: 'synthetic@example.invalid',
      EDIEL_SMTP_PASS: 'synthetic-only', EDIEL_APP_DKIM_ENABLED: 'false' })) vi.stubEnv(key, value)
    try {
      configureSyntheticSmtp()
      const { sendEdielEmail } = await import('@/lib/email/sendEdielEmail')
      const input = mode === 'raw'
        ? { to: 'recipient@example.invalid', envelopeFrom: 'synthetic@example.invalid',
          raw: Buffer.from('From: synthetic@example.invalid\r\nTo: recipient@example.invalid\r\nMessage-ID: <finite-raw@example.invalid>\r\nContent-Type: application/edifact\r\n\r\nUNB+finite\'') }
        : { to: 'recipient@example.invalid', subject: 'Declared finite adapter input', text: 'Synthetic boundary only',
          attachments: [{ filename: 'payload.edi', content: Buffer.from('UNB+finite\'') }] }
      const result = await sendEdielEmail(input, { archiveContext,
        beforeProviderCall: async binding => { bindings.push(binding) } })
      expect(result).toMatchObject({ accepted: ['recipient@example.invalid'], rejected: [],
        messageId: expect.stringMatching(/^<synthetic-z03-join-/), response: '250 explicitly synthetic SMTP acceptance' })
      expect(bindings).toHaveLength(1)
      expect(bindings[0]).toMatchObject({ mode, from: 'synthetic@example.invalid', to: 'recipient@example.invalid',
        mimeArchiveRef: 'modeled://finite-mime-port', mimePayloadSnapshotId: id(92) })
      const bytes = Buffer.from(String(bindings[0].rawBase64), 'base64')
      expect(bindings[0].mimeSha256).toBe(createHash('sha256').update(bytes).digest('hex'))
      expect(bindings[0].mimeLength).toBe(bytes.length)
    } finally {
      vi.doUnmock('@/lib/ediel/transport/rawMimeArchive'); vi.resetModules(); vi.unstubAllEnvs()
    }
  })
})

```

## Preserved earlier candidate/qualification history (superseded)

# CURRENT FINAL SOURCE CANDIDATE — observed lawful positive send

Technical source `cee450283bbc5cd66dbb30ace71cf1572e3d0e9b`, tree `f462cabba33d2354c40884e6a94d47a6d3071870`, ordered parent `8e48a6ed9452d976cfac8fb6a681141e52d0de66`, source base actuald798/e3b6. This supersedes preliminary technical4386/document8e48 freezes preserved below verbatim as historical receipts. Two NEW technical files only, own unique checkpoint; author PAUSED. No push/native/whole approval.

ROOT's precise follow-up on public6149872172 authorizes ONLY one necessary own positive assertion: actual accepted provider `observedAt` is evaluated against the current unchanged canonical supplier-switch window derived from the same immutable original's physical start/subtype. `evaluateSupplierSwitchSendWindow` and `loadSupplierSwitchPolicy` are imported unchanged and the actual provider instant is observed, never used to alter JS/SQL clocks. Both selected positive cohorts must have windowOpen=true/reason=open. This supplies no rejection mechanism or qualification for the separately found P1 late queued send and P2 too_early classifier. Those remain with retained calendar/transport owners; no whole calendar credit is inherited from the old four-card map. No product/scheduler/SQL file is written.

- `scripts/ediel-at-z03l-z03lk-supplier-ack-join-native.test.ts`: 593lines; blob `552800ec56bd4a13a778fbeab0360c4ac5ba6f71`; SHA256 `f9ce7baa96d4660bf88356643ec10e97087cdd3a6ca8de3288b77ad527c3cc97`.
- `scripts/ediel-at-z03l-z03lk-supplier-ack-join-native.config.ts`: 8lines; blob `324261dc8d442ed72e32dce19cb55962f9c1101d`; SHA256 `411756e455969e5b04dad4f24007d17d2937c4db74bd840dc615eaa168bd1117`.

Affected final proof is fresh: Node22.23.3/Vitest4.1.9 8finitePASS/0FAIL/2nativeNOTSELECTED; strictsemanticTS full actual import closure and two-file projectESLint exit0,0diagnostics; diffexit0/all9,843 preexisting modes/blobs+12pins preserved. No backend/setup/native/SQL child or sourceprefix was invoked. Qualification commands registry SHA256 `6dcbf5e26dba692823ca2f04fe75c471c5516189bef6c90d770c10af18f90ec1`; actual freeze-controller SHA256 `4479e1d20e380bdd6f702bf5f47a24ccddae569d0e17c6489922f089de4aa247`; new full artifact index SHA256 `5fc972f19d60fbe508dac390aa1635b01b229709c2bffdb102ad4ebf56272628` references all154 current/previous immutable outside artifacts, including prior index. Previous originals were never overwritten. Source INPUT HOLD/qualification pending and SOURCE/PREPARATION-only limits below remain. Two FRESH OTHER NONCOAUTHOR final peers will review this exact final source and checkpoint; all author/runner/coauthor exclusions remain.

## Final window-affected raw inputs/outputs


### source-freeze-window.json

Bytes 853; SHA256 `69ca4804cabfa26fb3cd759796f7bcb53fdeeb35c40f05fdf516b1a63de8874e`.

```text
{
  "sourceHead": "cee450283bbc5cd66dbb30ace71cf1572e3d0e9b",
  "sourceTree": "f462cabba33d2354c40884e6a94d47a6d3071870",
  "orderedParents": [
    "8e48a6ed9452d976cfac8fb6a681141e52d0de66"
  ],
  "base": "d798eb36f35cd4f437d44c8d234b4dbb81adc7a6",
  "supersedesTechnicalHead": "4386f9c7c27d366794af845b1e55beb095647ee1",
  "technicalFiles": [
    {
      "path": "scripts/ediel-at-z03l-z03lk-supplier-ack-join-native.test.ts",
      "blob": "552800ec56bd4a13a778fbeab0360c4ac5ba6f71",
      "sha256": "f9ce7baa96d4660bf88356643ec10e97087cdd3a6ca8de3288b77ad527c3cc97",
      "lines": 593
    },
    {
      "path": "scripts/ediel-at-z03l-z03lk-supplier-ack-join-native.config.ts",
      "blob": "324261dc8d442ed72e32dce19cb55962f9c1101d",
      "sha256": "411756e455969e5b04dad4f24007d17d2937c4db74bd840dc615eaa168bd1117",
      "lines": 8
    }
  ]
}
```

### qualification-window-commands.json

Bytes 1519; SHA256 `6dcbf5e26dba692823ca2f04fe75c471c5516189bef6c90d770c10af18f90ec1`.

```text
{
  "cwd": "/workspace/scratch/gridex-z03-ack-join-helper-20261013",
  "source": {
    "scripts/ediel-at-z03l-z03lk-supplier-ack-join-native.test.ts": "f9ce7baa96d4660bf88356643ec10e97087cdd3a6ca8de3288b77ad527c3cc97",
    "scripts/ediel-at-z03l-z03lk-supplier-ack-join-native.config.ts": "411756e455969e5b04dad4f24007d17d2937c4db74bd840dc615eaa168bd1117"
  },
  "commands": {
    "finite-window-final": [
      "/workspace/scratch/gridex-c2-takeover-01a131d2/node-v22.23.3-linux-x64/bin/node",
      "node_modules/vitest/vitest.mjs",
      "run",
      "--config",
      "/workspace/scratch/ediel-z03-ack-join-20261013/finite.config.ts",
      "-t",
      "finite Z03 join input and raw boundary"
    ],
    "tsc-window-final": [
      "/workspace/scratch/gridex-c2-takeover-01a131d2/node-v22.23.3-linux-x64/bin/node",
      "node_modules/typescript/bin/tsc",
      "--project",
      "/workspace/scratch/ediel-z03-ack-join-20261013/tsconfig.focused.json",
      "--pretty",
      "false"
    ],
    "eslint-window-final": [
      "/workspace/scratch/gridex-c2-takeover-01a131d2/node-v22.23.3-linux-x64/bin/node",
      "node_modules/eslint/bin/eslint.js",
      "scripts/ediel-at-z03l-z03lk-supplier-ack-join-native.test.ts",
      "scripts/ediel-at-z03l-z03lk-supplier-ack-join-native.config.ts"
    ]
  },
  "change": "root-authorized own positive actual provider observation must fall inside current canonical original subtype/start window; no late-queue refusal or clock mutation",
  "nativeCallbacksInvoked": 0
}
```

### finite-window-final.stdout

Bytes 250; SHA256 `e5bd965a5a3e24b1ed86844ae7c50b2a67b1eadb9e56d054346d13f15069283e`.

```text

 RUN  v4.1.9 /workspace/scratch/gridex-z03-ack-join-helper-20261013


 Test Files  1 passed (1)
      Tests  8 passed | 2 skipped (10)
   Start at  16:36:26
   Duration  565ms (transform 339ms, setup 0ms, import 397ms, tests 33ms, environment 0ms)

```

### finite-window-final.stderr

Bytes 0; SHA256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.

```text

```

### finite-window-final.exit

Bytes 1; SHA256 `5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9`.

```text
0
```

### tsc-window-final.stdout

Bytes 0; SHA256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.

```text

```

### tsc-window-final.stderr

Bytes 0; SHA256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.

```text

```

### tsc-window-final.exit

Bytes 1; SHA256 `5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9`.

```text
0
```

### eslint-window-final.stdout

Bytes 0; SHA256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.

```text

```

### eslint-window-final.stderr

Bytes 0; SHA256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.

```text

```

### eslint-window-final.exit

Bytes 1; SHA256 `5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9`.

```text
0
```

### freeze-window-controller.py

Bytes 2164; SHA256 `4479e1d20e380bdd6f702bf5f47a24ccddae569d0e17c6489922f089de4aa247`.

```text
from pathlib import Path
import hashlib,json,subprocess
r=Path('/workspace/scratch/gridex-z03-ack-join-helper-20261013');p=Path('/workspace/scratch/ediel-z03-ack-join-20261013')
sha=lambda b:hashlib.sha256(b).hexdigest()
def git(*args):return subprocess.check_output(['git',*args],cwd=r).decode().strip()
f=json.loads((p/'source-freeze-window.json').read_text())
for row in f['technicalFiles']:assert sha((r/row['path']).read_bytes())==row['sha256'] and git('rev-parse',f['sourceHead']+':'+row['path'])==row['blob']
for label in ['finite-window-final','tsc-window-final','eslint-window-final']:assert (p/(label+'.exit')).read_text()=='0'
old={line.split('\t',1)[1]:line.split('\t',1)[0] for line in git('ls-tree','-r',f['base']).splitlines()}
now={line.split('\t',1)[1]:line.split('\t',1)[0] for line in git('ls-tree','-r',f['sourceHead']).splitlines()}
assert all(now.get(k)==v for k,v in old.items())
assert set(now)-set(old)=={x['path'] for x in f['technicalFiles']}|{'.agent-memory/masterplan-z03-ack-join-helper-20261013-checkpoint.md'}
for row in json.loads((p/'readonly-source-pins.json').read_text()):assert sha((r/row['path']).read_bytes())==row['actualSha256']
subprocess.run(['git','diff','--check',f['base'],f['sourceHead']],cwd=r,check=True)
index=[]
for path in sorted(p.iterdir()):
 if path.is_file() and path.name not in ['artifact-index-window.json','freeze-window-controller.stdout','freeze-window-controller.stderr','freeze-window-controller.exit']:
  b=path.read_bytes();index.append({'name':path.name,'bytes':len(b),'sha256':sha(b)})
a={'controllerSha256':sha(Path(__file__).read_bytes()),'source':f,'artifacts':index,'priorOriginalIndexSha256':sha((p/'artifact-index.json').read_bytes()),'preexistingPreserved':len(old),'physicalNativeResult':'NATIVE_NOT_RUN','nativeCallbacksInvoked':0,'backendCommandsInvoked':0};(p/'artifact-index-window.json').write_text(json.dumps(a,indent=2));print(json.dumps({'sourceHead':f['sourceHead'],'artifactCount':len(index),'controllerSha256':a['controllerSha256'],'artifactIndexSha256':sha((p/'artifact-index-window.json').read_bytes()),'preexistingPreserved':len(old),'nativeCallbacksInvoked':0},indent=2))
```

### freeze-window-controller.stdout

Bytes 333; SHA256 `3b2dbbfe44982b59c8164e6154f393a816aeeb85494155f398a3a4fe2b43dc37`.

```text
{
  "sourceHead": "cee450283bbc5cd66dbb30ace71cf1572e3d0e9b",
  "artifactCount": 154,
  "controllerSha256": "4479e1d20e380bdd6f702bf5f47a24ccddae569d0e17c6489922f089de4aa247",
  "artifactIndexSha256": "5fc972f19d60fbe508dac390aa1635b01b229709c2bffdb102ad4ebf56272628",
  "preexistingPreserved": 9843,
  "nativeCallbacksInvoked": 0
}
```

### freeze-window-controller.stderr

Bytes 0; SHA256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.

```text

```

### freeze-window-controller.exit

Bytes 1; SHA256 `5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9`.

```text
0
```

## Preserved preliminary source/qualification history

# Z03 L/LK own ACK → causal Z04 source-preparation checkpoint

Agent `codex-ediel-z03-ack-join-helper-20261013`, packet `d3617284-ab1b-4eab-923a-2b279f14afa7`, epoch `gridex-five-agent-20261012`, helper, IDs empty. Source base actual main `d798eb36f35cd4f437d44c8d234b4dbb81adc7a6`, tree `e3b6c11677a2b871a128504f1616def7d22dba1e`. Branch `codex/ediel-z03-ack-join-helper-20261013` at `/workspace/scratch/gridex-z03-ack-join-helper-20261013`.

Custody: neutral remote GitData receipt `e24766be665f684886b465bb1a06fd6168bc2bbe` has main's exact tree and sole parent main. Sorted CREATE_IF_ABSENT and every own GET_MATCH completed before technical write. Full claim [6149828468](https://github.com/heke99/gridex-ops-platform/issues/766#issuecomment-6149828468) read back byteidentically. ROOT independently authenticated full receipt, all two refs, main, claim and remote source-branch absence, then explicitly cleared exact source writes. Own unique checkpoint needs no shared-memory lock.

Only technical paths: `scripts/ediel-at-z03l-z03lk-supplier-ack-join-native.test.ts` and `scripts/ediel-at-z03l-z03lk-supplier-ack-join-native.config.ts`; respective resource suffixes `file-1201455a6deacbe6a3728c6839255b5c91d6179f2c2aee1899ab00cdb3d117f5` and `file-178b708b18ce2587ace7bc588122d1e30489588b67ff3187b8cce54fa9cc9596`.

Availability reuses public four-card map6148935435@35ced72c and supplied current custody/input-plan. Fresh authenticated #766 whole read through6149776855 (797comments), all195refs and57 full scopes adds only disjoint SC03797d and Z04C359d to the prior snapshot. Neither exact file exists at actual main, other receipts or current PR path sets. Existing C1 macro/helpers/current config, SC037, native/GEN/producer/solecollector retain their scopes. New calendar6149735333 is read-only, not same-criterion authoring. No absent-ID-only clearance.

Skills: using-git-worktrees applies to user-authorized isolated source; TDD/writing-good-tests to meaningful boundary assertions; verification-before-completion to scoped checks and freeze; Supabase skill to unchanged data/auth ports. using-superpowers explicitly excludes dispatched subagents. No brainstorming: exact behavior/scope already supplied. No parallel writers. No UI/React, migrations/GEN, performance, infrastructure, broad audit or new security surface. Docs changelog inspected: hosted TLS cipher/Postgres release notices do not change local HTTP selectors or existing schema. Auth generateLink/verifyOtp current docs consulted. No Supabase CLI/backend command is needed.

Input dependency: current public createZ01SupplierNativeFixture selects genuine prospective LK before original, but its underlying normal helper directly inserts synthetic private issuer/signed_declarations/contract_request_declarations (`:268/:278`). This source does not invoke that prefix or copy its accepted authority. Existing serial producer must provide admissible current prospective data selectors; otherwise native input admission is HOLD. Native cases must use actual current consumers/production APIs with no status/context/assessment seed. Raw DSO and SMTP synthetic boundaries remain disclosed.

Verification outputs live outside source at `/workspace/scratch/ediel-z03-ack-join-20261013`. NATIVE_NOT_RUN; no backend/global setup/GEN/SQL child/provider/native callback invoked. Initial finite selector/wire tests written before boundary implementation. No push/PR/merge/ledger or external communication.

Next: verify finite RED honestly, implement exact native source with current authority/canonical receive/original joins, scoped strict semantic TypeScript + two-file ESLint + preservation/diff; freeze and request two fresh noncoauthor final source reviews from ROOT.

## Verified source freeze and bounded qualification

Observed 2026-10-13T18:33:14.256121+02:00. Technical source FROZEN/PAUSED at `4386f9c7c27d366794af845b1e55beb095647ee1`, tree `36337e758de3064b4d12434e5895e5cd7b0dd3ee`, ordered sole parent `d798eb36f35cd4f437d44c8d234b4dbb81adc7a6`. Exact two ADDs only.

- `scripts/ediel-at-z03l-z03lk-supplier-ack-join-native.test.ts`: 585lines, blob `3fef9d7bd96489d57b3e0347800a2d32881024f1`, SHA256 `815ab5be300ef385a3adc4128d278cbcc4574ba16df17186a5958930dc0d552c`.
- `scripts/ediel-at-z03l-z03lk-supplier-ack-join-native.config.ts`: 8lines, blob `324261dc8d442ed72e32dce19cb55962f9c1101d`, SHA256 `411756e455969e5b04dad4f24007d17d2937c4db74bd840dc615eaa168bd1117`.

Final actual Node22.23.3/Vitest4.1.9 finite input/raw-wire qualification: **8 PASS,0 FAIL;2 native cases deliberately NOT SELECTED (Vitest reports2skipped by name filter).** The finite mode exercises actual tokenizer/envelope/original-legal-party/date/body-order components and the test's selector/wire boundary; it never invokes native imports/callbacks/backend/global setup or claims actual domain/SQL/native approval. Strict semantic TypeScript checks the actual complete import closure with `strict:true`/noEmit,0 diagnostics/exit0, no baseline suppression. ESLint covers both technical files using the real project config,0 diagnostics/exit0. Cached diff check exit0. All9,843 preexisting blobs/modes preserved, including frozen registers/coverage/shared helpers/config/SQL/types/workflows;12 relevant sourcepins byte-match actuald798. No old37/69 suite or native/SQL child was rerun.

Prepared source contains genuine prospective subtype checks BEFORE original; actual current method/masterdata/process/GoTrue consumer ports; actual prepare→bound immutable original→claimed outbox/provider journal→observed technical watch; physical raw mailbox/parser/current tenant/canonical reception/runtime/request ACK consumers; exact committed incoming ACK source/hash/correlation; normal causal received Z04 original/LI/point/customer/start/reason/hash/period/transition; separate actual source-bound OUTGOING Z04 replies/owner consumption and SMTP projection. L takes request ACK pair before Z04; LK admits correct Z04 before positive request APERAK. No full-pair-before-business prerequisite was added. Exact original/control row-text snapshots and replay protect unrelated/sibling graphs, source receipts, confirmation, future nonactivation, outboxes and attempts. No activation worker or clock manipulation. H1506–1589 is assertion form only; no H approval is inherited.

INPUT boundary remains **SOURCE INPUT HOLD / QUALIFICATION PENDING**, not an executed native error. Existing `codex-takeover-delivery-20261012` serial producer/current GEN owner must provide `GRIDEX_NATIVE_Z03_ACK_JOIN_INPUT` JSON containing only current exact sourceCommit/sourceTree/inputEpoch + two disjoint L/LK selector rows (variant/companyId/actorUserId/switchId/routeId/unrelatedSwitchId/siblingCompanyId), and its matching current `GRIDEX_NATIVE_INPUT_EPOCH`. The selected actual cohorts must already contain genuine archived signed contract/current actor membership/permissions/legal identity/network/registry/masterdata/requested-method/BRP/route/ACK-route premises. Input supplies neither executable adapters nor accepted/status/context/authority facts. Actual source consumers/refusals remain mandatory. Existing helper's direct synthetic private declarations are not a new admitted prefix; this suite does not call that producer, update a subtype/contract/source row or manufacture admission. Public prospective original API and synthetic DSO representation stay separate: supplier Z04 producer remains blocked. Missing admissible current LK prefix/route/current-source qualification stops its case concretely; source preparation does not clear this producer dependency.

Config imports the unchanged current owner module (SHA256d9bd80bf7038f9232362ecba4deaa29b3ae264ef3c89000873fc91ad740fd0db) and appends the new include while preserving all prior includes/aliases/local status/backend/catalog/setup/serial behavior/timeouts. It starts no run. Audited41 unchanged workflows/7push/0ownbranch activations/0workflow_run/0repository_dispatch. No branch push/PR/dispatch/CI was performed. Existing producer alone chooses the subsequent coherent union/execution. Current119VERIFIED+204PASSED=323 unchanged; Z03L/LK remain NOT_EXECUTED.

Raw initial failures retained: absolute Vitest config import-resolution error; initial finite fixture missing acknowledgementRequest; initial strict config typeRoots failure; added pure Z04 test shadowed its fixture function; then pure fixture lacked mandatory legal NAD country. These are scaffold/fixture errors, not product/native RED. The valid finite RED before boundary implementation and final GREEN are distinct. Earlier exploratory attempt source snapshots were not captured; their stdout/stderr/exit are preserved and no historical source hash is invented. Final exact source/input/controller/output bindings are captured below. No fabricated mutable facts, fake field/native result or rerun of unchanged external proof.

Skill finish routing: requesting-code-review applies; ROOT will appoint TWO FRESH OTHER NONCOAUTHOR final peers of this exact candidate. Author/runner is excluded. The generic finish menu/full-suite instruction is superseded by the user's exact source-only handoff/sole producer mandate; branch/worktree remain preserved, no PR/merge/cleanup. No user permission was re-requested.

Next: two independent final source reviews; author addresses concrete findings only within own custody, affected checks/source/reviews rebound. After ROOT coordination and current no-chain audit, public source-only handoff may be published; no automatic native/GEN/CI/whole/ledger transition. Refs remain held; no custodytransfer/release occurred.

## Raw qualification and controller artifacts

All original bytes remain in `/workspace/scratch/ediel-z03-ack-join-20261013`. Freeze controller actual SHA256 `d44578ffcfb0003a725e066af83db1588bde996ff43ea1547be675a0556e267e`; index SHA256 `ae9c3f26ee54a06af3eb6383caa42e057cfdfef180e3ade22dfe704c2c0d880c`. These are authored proof/evidence, not reviewer evidence or whole acceptance.


### receipt-payload.json

Bytes 1124; SHA256 `a261fb9baa2fbc088f900cc887e515b665daacf129e7a8e561b1fcb10ab3b34d`.

```text
{
  "protocol": "masterplan-reservation-v1",
  "epoch": "gridex-five-agent-20261012",
  "slot": "helper",
  "agent": "codex-ediel-z03-ack-join-helper-20261013",
  "packet": "d3617284-ab1b-4eab-923a-2b279f14afa7",
  "branch": "codex/ediel-z03-ack-join-helper-20261013",
  "checkpoint": ".agent-memory/masterplan-z03-ack-join-helper-20261013-checkpoint.md",
  "ids": [],
  "files": [
    "scripts/ediel-at-z03l-z03lk-supplier-ack-join-native.test.ts",
    "scripts/ediel-at-z03l-z03lk-supplier-ack-join-native.config.ts"
  ],
  "base": "d798eb36f35cd4f437d44c8d234b4dbb81adc7a6",
  "createdAt": "2026-10-13T16:04:59.966795+00:00",
  "nextAction": "SOURCE_PREPARATION_ONLY exact two-file own genuine L/Z22 and LK/Z23 sent request -> physical own inbound CONTRL/APERAK -> causal right received Z04 and its outgoing replies join, using unchanged current public helpers/config/production APIs. Solewriter /root/z03_join_owner independently authenticates fullreceipt/allrefs/main/tree and root independent GET before firstwrite. No whole-ID/producer/native/backend/GEN/originalcollection/shared-source/ledger/PR/merge authority."
}
```

### qualification-commands.json

Bytes 1444; SHA256 `e5ac7c93741ae2247b80ffe3c83b8b816dc99138b1cd13c6d2c0a73ee4685e6c`.

```text
{
  "cwd": "/workspace/scratch/gridex-z03-ack-join-helper-20261013",
  "source": {
    "scripts/ediel-at-z03l-z03lk-supplier-ack-join-native.test.ts": "815ab5be300ef385a3adc4128d278cbcc4574ba16df17186a5958930dc0d552c",
    "scripts/ediel-at-z03l-z03lk-supplier-ack-join-native.config.ts": "411756e455969e5b04dad4f24007d17d2937c4db74bd840dc615eaa168bd1117"
  },
  "commands": {
    "finite-final": [
      "/workspace/scratch/gridex-c2-takeover-01a131d2/node-v22.23.3-linux-x64/bin/node",
      "node_modules/vitest/vitest.mjs",
      "run",
      "--config",
      "/workspace/scratch/ediel-z03-ack-join-20261013/finite.config.ts",
      "-t",
      "finite Z03 join input and raw boundary"
    ],
    "tsc-final": [
      "/workspace/scratch/gridex-c2-takeover-01a131d2/node-v22.23.3-linux-x64/bin/node",
      "node_modules/typescript/bin/tsc",
      "--project",
      "/workspace/scratch/ediel-z03-ack-join-20261013/tsconfig.focused.json",
      "--pretty",
      "false"
    ],
    "eslint-final": [
      "/workspace/scratch/gridex-c2-takeover-01a131d2/node-v22.23.3-linux-x64/bin/node",
      "node_modules/eslint/bin/eslint.js",
      "scripts/ediel-at-z03l-z03lk-supplier-ack-join-native.test.ts",
      "scripts/ediel-at-z03l-z03lk-supplier-ack-join-native.config.ts"
    ]
  },
  "nativeInvocations": 0,
  "backendInvocations": 0,
  "setupFiles": [],
  "globalSetup": [],
  "selectedTests": "finite Z03 join input and raw boundary"
}
```

### source-freeze.json

Bytes 780; SHA256 `7d24a64f3b59afc45d2fede217cc99ebd0a8bc36a2660ca5f9d597cf1f2e0fe8`.

```text
{
  "sourceHead": "4386f9c7c27d366794af845b1e55beb095647ee1",
  "sourceTree": "36337e758de3064b4d12434e5895e5cd7b0dd3ee",
  "orderedParents": [
    "d798eb36f35cd4f437d44c8d234b4dbb81adc7a6"
  ],
  "base": "d798eb36f35cd4f437d44c8d234b4dbb81adc7a6",
  "technicalFiles": [
    {
      "path": "scripts/ediel-at-z03l-z03lk-supplier-ack-join-native.test.ts",
      "blob": "3fef9d7bd96489d57b3e0347800a2d32881024f1",
      "sha256": "815ab5be300ef385a3adc4128d278cbcc4574ba16df17186a5958930dc0d552c",
      "lines": 585
    },
    {
      "path": "scripts/ediel-at-z03l-z03lk-supplier-ack-join-native.config.ts",
      "blob": "324261dc8d442ed72e32dce19cb55962f9c1101d",
      "sha256": "411756e455969e5b04dad4f24007d17d2937c4db74bd840dc615eaa168bd1117",
      "lines": 8
    }
  ]
}
```

### finite.config.ts

Bytes 579; SHA256 `7946efd7fd513fc67f26ea341e8061d33be46474ddd84ef4d40f08d525b4e7de`.

```text
export default {cacheDir:"/workspace/scratch/ediel-z03-ack-join-20261013/vite-cache",root:'/workspace/scratch/gridex-z03-ack-join-helper-20261013',resolve:{alias:[{find:'@',replacement:'/workspace/scratch/gridex-z03-ack-join-helper-20261013'},{find:/^server-only$/,replacement:'/workspace/scratch/gridex-z03-ack-join-helper-20261013/node_modules/next/dist/compiled/server-only/empty.js'}]},test:{include:['scripts/ediel-at-z03l-z03lk-supplier-ack-join-native.test.ts'],environment:'node',setupFiles:[],globalSetup:[],fileParallelism:false,pool:'forks',maxWorkers:1,cache:false}}
```

### tsconfig.focused.json

Bytes 759; SHA256 `499d6c91092a34a29ab049d6c2fcea5df3fd925c076a89cad30222472f225aca`.

```text
{
  "extends": "/workspace/scratch/gridex-z03-ack-join-helper-20261013/tsconfig.json",
  "compilerOptions": {
    "incremental": false,
    "noEmit": true,
    "strict": true,
    "types": [
      "node"
    ],
    "typeRoots": [
      "/workspace/scratch/gridex-z03-ack-join-helper-20261013/node_modules/@types"
    ],
    "baseUrl": "/workspace/scratch/gridex-z03-ack-join-helper-20261013"
  },
  "include": [
    "/workspace/scratch/gridex-z03-ack-join-helper-20261013/scripts/ediel-at-z03l-z03lk-supplier-ack-join-native.test.ts",
    "/workspace/scratch/gridex-z03-ack-join-helper-20261013/scripts/ediel-at-z03l-z03lk-supplier-ack-join-native.config.ts",
    "/workspace/scratch/gridex-z03-ack-join-helper-20261013/types/**/*.d.ts"
  ],
  "exclude": []
}
```

### preservation.json

Bytes 730; SHA256 `596bfafcf406fa1447857865872ff80f34493b86d47cbeadd799e6a8f7145c01`.

```text
{
  "base": "d798eb36f35cd4f437d44c8d234b4dbb81adc7a6",
  "baseTree": "e3b6c11677a2b871a128504f1616def7d22dba1e",
  "provisionalOwnTree": "0c62cc675fc36d62bd2bfd13da4935a3589b3bdf",
  "preexistingPreserved": 9843,
  "exactAdds": {
    "scripts/ediel-at-z03l-z03lk-supplier-ack-join-native.config.ts": [
      null,
      "100644 blob 324261dc8d442ed72e32dce19cb55962f9c1101d"
    ],
    "scripts/ediel-at-z03l-z03lk-supplier-ack-join-native.test.ts": [
      null,
      "100644 blob 3fef9d7bd96489d57b3e0347800a2d32881024f1"
    ],
    ".agent-memory/masterplan-z03-ack-join-helper-20261013-checkpoint.md": [
      null,
      "100644 blob dc2808d08cff8953a597a8ee693700fa5bd7b4a5"
    ]
  },
  "frozenAndLedgerUnchanged": true
}
```

### readonly-source-pins.json

Bytes 3836; SHA256 `5f343ece924be56e6f4f273b6429a4aa337eed95cf5d346202f0345a4932a638`.

```text
[
  {
    "path": "docs/ediel/masterplan-v2/registers/acceptance_tests.json",
    "sha256": "e9aa623c8b54fabaedca1096fe1516a29a11569b65ee6e95736c82748c541a10",
    "blob": "3717ce88daaf98c916bb996edc6fe7887bf65b6c",
    "same95d": true,
    "actualSha256": "e9aa623c8b54fabaedca1096fe1516a29a11569b65ee6e95736c82748c541a10"
  },
  {
    "path": "__tests__/ediel-at-z03l-z03lk-supplier-profile.test.ts",
    "sha256": "62ce79e23e93a17b0f9912901f5b930c484528bcb6fbc3b80013f51e6ddd95fe",
    "blob": "edc93b6869f7cf055108f71a5832918389fce746",
    "same95d": true,
    "actualSha256": "62ce79e23e93a17b0f9912901f5b930c484528bcb6fbc3b80013f51e6ddd95fe"
  },
  {
    "path": "__tests__/ediel-prodat-own-source-register-reading-component.test.ts",
    "sha256": "da138ae72834d9e5223ac146e94829491d4aec67a683121e112cdccca0b9cd21",
    "blob": "a3353f0c304e35a3f1c57984afa65d7c591b255a",
    "same95d": true,
    "actualSha256": "da138ae72834d9e5223ac146e94829491d4aec67a683121e112cdccca0b9cd21"
  },
  {
    "path": "__tests__/ediel-z03-dispatch-window.test.ts",
    "sha256": "61642e9f92224711ad016d45e4bbb9cd4b67a4604137939989f5770ee56ea21d",
    "blob": "fbd40dfd7577fbc4ea77bbc961f3b4d1349f80e9",
    "same95d": true,
    "actualSha256": "61642e9f92224711ad016d45e4bbb9cd4b67a4604137939989f5770ee56ea21d"
  },
  {
    "path": "scripts/ediel-at-z03h-z04h-supplier-native.test.ts",
    "sha256": "66891bc7df0ea5a2ff3c8d5fba7b318b6a6162653c7c6e37c45918cfe2dd52eb",
    "blob": "6e19c324df57fdc6a9b6fedf95e8f7f81261df15",
    "same95d": true,
    "actualSha256": "66891bc7df0ea5a2ff3c8d5fba7b318b6a6162653c7c6e37c45918cfe2dd52eb"
  },
  {
    "path": "scripts/ediel-at-z03h-z04h-supplier-native.config.ts",
    "sha256": "aa56b9c4657f270ac8c0e63e75ec10794b0319a39f6c610906d29ae699dcf97b",
    "blob": "aaba4723b90c8ef9ec9dded0cfbc0fadfff75407",
    "same95d": true,
    "actualSha256": "aa56b9c4657f270ac8c0e63e75ec10794b0319a39f6c610906d29ae699dcf97b"
  },
  {
    "path": "scripts/helpers/ediel-normal-switch-native-fixture.ts",
    "sha256": "b03ed608fe49648281b11bbd8a83e09673a7aa6a08f51a4e661d38a58e826cdc",
    "blob": "e138f50cc1f30b16eced98b1668df2667af72788",
    "same95d": true,
    "actualSha256": "b03ed608fe49648281b11bbd8a83e09673a7aa6a08f51a4e661d38a58e826cdc"
  },
  {
    "path": "scripts/helpers/ediel-z02-supplier-native-fixture.ts",
    "sha256": "1a097c8e0688be649b5b978d6e14a65452cb8735d8b2e67549f99e27bfc4e37c",
    "blob": "e7902d47328fdc535c5743af809802ee0e8f4a60",
    "same95d": true,
    "actualSha256": "1a097c8e0688be649b5b978d6e14a65452cb8735d8b2e67549f99e27bfc4e37c"
  },
  {
    "path": "scripts/ediel-at-z02-supplier-native.test.ts",
    "sha256": "440d69500c16a4bf41cb79139b81390dcf45a34b1f099f753f35a70be8e082f2",
    "blob": "a5d189252b1497b323c2a4f5a444acd1300755e2",
    "same95d": true,
    "actualSha256": "440d69500c16a4bf41cb79139b81390dcf45a34b1f099f753f35a70be8e082f2"
  },
  {
    "path": "lib/ediel/flows/prodatSwitch.ts",
    "sha256": "9ae579c5acd42927894479d0a833c1560cda190ab72f37eaf69a4559f27cb3eb",
    "blob": "bd12c6a9796a051867f8353232931eccf6b6d183",
    "same95d": true,
    "actualSha256": "9ae579c5acd42927894479d0a833c1560cda190ab72f37eaf69a4559f27cb3eb"
  },
  {
    "path": "lib/ediel/ack/committedInboundAck.ts",
    "sha256": "9c75cf2321f634b701081ca006c41f57c6c293aa74b97b623b35a4cfd938ba0d",
    "blob": "51ec84a1bd2516a4d596ab77be0912715db7c4c0",
    "same95d": true,
    "actualSha256": "9c75cf2321f634b701081ca006c41f57c6c293aa74b97b623b35a4cfd938ba0d"
  },
  {
    "path": "scripts/ediel-source-owner-native.config.ts",
    "sha256": "d9bd80bf7038f9232362ecba4deaa29b3ae264ef3c89000873fc91ad740fd0db",
    "blob": "bc031b12e0c85e45f5427868871648b994780b3b",
    "same95d": true,
    "actualSha256": "d9bd80bf7038f9232362ecba4deaa29b3ae264ef3c89000873fc91ad740fd0db"
  }
]
```

### push-trigger-audit.json

Bytes 9197; SHA256 `99c6fec10391f683b4d903c71f55104e34ea90a79fcae07b900156d064d4ad7a`.

```text
{
  "branch": "codex/ediel-z03-ack-join-helper-20261013",
  "changedPaths": [
    "scripts/ediel-at-z03l-z03lk-supplier-ack-join-native.test.ts",
    "scripts/ediel-at-z03l-z03lk-supplier-ack-join-native.config.ts",
    ".agent-memory/masterplan-z03-ack-join-helper-20261013-checkpoint.md"
  ],
  "totalWorkflows": 41,
  "pushWorkflows": 7,
  "ownPushActivations": 0,
  "workflowRunEvents": 0,
  "repositoryDispatchEvents": 0,
  "rows": [
    {
      "path": ".github/workflows/browser-deps-lock-sync-temporary.yml",
      "push": true,
      "events": [
        "push",
        "workflow_dispatch"
      ],
      "branches": [
        "agent/release-certification-hardening-20260817"
      ],
      "branchesIgnore": [],
      "paths": null,
      "pathsIgnore": [],
      "ownBranchMatched": false,
      "ownPushWouldActivate": false
    },
    {
      "path": ".github/workflows/browser-quality-e2e.yml",
      "push": true,
      "events": [
        "pull_request",
        "push",
        "schedule",
        "workflow_dispatch"
      ],
      "branches": [
        "main"
      ],
      "branchesIgnore": [],
      "paths": null,
      "pathsIgnore": [],
      "ownBranchMatched": false,
      "ownPushWouldActivate": false
    },
    {
      "path": ".github/workflows/canonical-quote-db-release-gate.yml",
      "push": false,
      "events": [
        "workflow_dispatch",
        "workflow_call"
      ]
    },
    {
      "path": ".github/workflows/ediel-cancellation-public-acceptance-native.yml",
      "push": false,
      "events": [
        "pull_request"
      ]
    },
    {
      "path": ".github/workflows/ediel-cancellation-public-birth-native.yml",
      "push": false,
      "events": [
        "pull_request"
      ]
    },
    {
      "path": ".github/workflows/ediel-db01-current-native.yml",
      "push": false,
      "events": [
        "pull_request"
      ]
    },
    {
      "path": ".github/workflows/ediel-db04-current-consumers-native.yml",
      "push": false,
      "events": [
        "pull_request"
      ]
    },
    {
      "path": ".github/workflows/ediel-db05-native.yml",
      "push": false,
      "events": [
        "pull_request"
      ]
    },
    {
      "path": ".github/workflows/ediel-esco-z14vh-z15v-native.yml",
      "push": false,
      "events": [
        "pull_request"
      ]
    },
    {
      "path": ".github/workflows/ediel-masterplan-v2.yml",
      "push": true,
      "events": [
        "pull_request",
        "push"
      ],
      "branches": [
        "main"
      ],
      "branchesIgnore": [],
      "paths": null,
      "pathsIgnore": [],
      "ownBranchMatched": false,
      "ownPushWouldActivate": false
    },
    {
      "path": ".github/workflows/ediel-p08-native.yml",
      "push": false,
      "events": [
        "pull_request"
      ]
    },
    {
      "path": ".github/workflows/ediel-prodat-response-hold-native.yml",
      "push": false,
      "events": [
        "pull_request"
      ]
    },
    {
      "path": ".github/workflows/ediel-recovery-native.yml",
      "push": false,
      "events": [
        "pull_request"
      ]
    },
    {
      "path": ".github/workflows/ediel-sc003-sc005-native.yml",
      "push": false,
      "events": [
        "pull_request"
      ]
    },
    {
      "path": ".github/workflows/ediel-sc014-z14v-native.yml",
      "push": false,
      "events": [
        "pull_request"
      ]
    },
    {
      "path": ".github/workflows/ediel-sc053-native.yml",
      "push": false,
      "events": [
        "pull_request"
      ]
    },
    {
      "path": ".github/workflows/ediel-sc054-native.yml",
      "push": false,
      "events": [
        "pull_request"
      ]
    },
    {
      "path": ".github/workflows/ediel-sc064-native.yml",
      "push": false,
      "events": [
        "pull_request"
      ]
    },
    {
      "path": ".github/workflows/ediel-sc071-native.yml",
      "push": false,
      "events": [
        "pull_request"
      ]
    },
    {
      "path": ".github/workflows/ediel-tr09-current-native.yml",
      "push": false,
      "events": [
        "pull_request"
      ]
    },
    {
      "path": ".github/workflows/ediel-z02-supplier-native.yml",
      "push": false,
      "events": [
        "pull_request"
      ]
    },
    {
      "path": ".github/workflows/ediel-z03h-z04h-supplier-native.yml",
      "push": false,
      "events": [
        "pull_request"
      ]
    },
    {
      "path": ".github/workflows/ediel-z04a-assigned-supply-native.yml",
      "push": false,
      "events": [
        "pull_request"
      ]
    },
    {
      "path": ".github/workflows/ediel-z05-public-birth-native.yml",
      "push": false,
      "events": [
        "pull_request"
      ]
    },
    {
      "path": ".github/workflows/ediel-z05-supplier-native.yml",
      "push": false,
      "events": [
        "pull_request"
      ]
    },
    {
      "path": ".github/workflows/ediel-z06e-z09e-native.yml",
      "push": false,
      "events": [
        "pull_request"
      ]
    },
    {
      "path": ".github/workflows/ediel-z08lk-native.yml",
      "push": false,
      "events": [
        "pull_request"
      ]
    },
    {
      "path": ".github/workflows/ediel-z10m-supplier-native.yml",
      "push": false,
      "events": [
        "pull_request"
      ]
    },
    {
      "path": ".github/workflows/ediel-z14n-native.yml",
      "push": false,
      "events": [
        "pull_request"
      ]
    },
    {
      "path": ".github/workflows/ediel-z15c-z18v-native.yml",
      "push": false,
      "events": [
        "pull_request"
      ]
    },
    {
      "path": ".github/workflows/full-e2e.yml",
      "push": true,
      "events": [
        "pull_request",
        "push",
        "schedule",
        "workflow_dispatch"
      ],
      "branches": [
        "main"
      ],
      "branchesIgnore": [],
      "paths": null,
      "pathsIgnore": [],
      "ownBranchMatched": false,
      "ownPushWouldActivate": false
    },
    {
      "path": ".github/workflows/one-off-offer-binding-native.yml",
      "push": false,
      "events": [
        "pull_request"
      ]
    },
    {
      "path": ".github/workflows/one-shot-operation-id-fix.yml",
      "push": false,
      "events": [
        "workflow_dispatch"
      ]
    },
    {
      "path": ".github/workflows/ops-hardening.yml",
      "push": true,
      "events": [
        "pull_request",
        "push"
      ],
      "branches": [
        "main"
      ],
      "branchesIgnore": [],
      "paths": null,
      "pathsIgnore": [],
      "ownBranchMatched": false,
      "ownPushWouldActivate": false
    },
    {
      "path": ".github/workflows/production-certification-e2e.yml",
      "push": false,
      "events": [
        "workflow_dispatch"
      ]
    },
    {
      "path": ".github/workflows/repair-generated-supabase-types.yml",
      "push": false,
      "events": [
        "workflow_dispatch"
      ]
    },
    {
      "path": ".github/workflows/staff-api-schema-capture.yml",
      "push": false,
      "events": [
        "pull_request"
      ]
    },
    {
      "path": ".github/workflows/tenant-integrity-regression.yml",
      "push": true,
      "events": [
        "pull_request",
        "push"
      ],
      "branches": [
        "main"
      ],
      "branchesIgnore": [],
      "paths": [
        "supabase/migrations/**",
        "lib/tenant/integrity.ts",
        "lib/tenant/scope.ts",
        "lib/tenant/lifecycle.ts",
        "lib/tenant/operationPolicy.ts",
        "lib/integrations/apiAuth.ts",
        "lib/integrations/webhooks.ts",
        "lib/email/emailOutbox.ts",
        "lib/ediel/orchestrator.ts",
        "app/admin/companies/**",
        "app/admin/system/tenant-integrity/**",
        "scripts/gridex-tenant-integrity-regression.cjs",
        "scripts/gridex-tenant-shutdown-regression.cjs",
        "lib/supabase/service.ts",
        "lib/supabase/tenantDb.ts",
        "lib/admin/guards.ts",
        "lib/admin/apiGuards.ts",
        "scripts/check-service-role-tenant-ratchet.cjs",
        "scripts/service-role-tenant-ratchet.json",
        "scripts/sql/tenant-isolation-invariants.sql",
        ".github/workflows/tenant-integrity-regression.yml"
      ],
      "pathsIgnore": [],
      "ownBranchMatched": false,
      "ownPushWouldActivate": false
    },
    {
      "path": ".github/workflows/tenant-isolation-invariants.yml",
      "push": false,
      "events": [
        "workflow_dispatch",
        "workflow_call",
        "schedule"
      ]
    },
    {
      "path": ".github/workflows/vercel-production-deploy.yml",
      "push": true,
      "events": [
        "push",
        "workflow_dispatch"
      ],
      "branches": [
        "main"
      ],
      "branchesIgnore": [],
      "paths": null,
      "pathsIgnore": [],
      "ownBranchMatched": false,
      "ownPushWouldActivate": false
    },
    {
      "path": ".github/workflows/zero-admin-production-crawler.yml",
      "push": false,
      "events": [
        "pull_request"
      ]
    }
  ],
  "notExecuted": "No push/PR/dispatch/CI was performed. YAML branch exclusions are literal/manual-inspected; no unknown positive predicate."
}
```

### freeze-controller.py

Bytes 1337; SHA256 `d44578ffcfb0003a725e066af83db1588bde996ff43ea1547be675a0556e267e`.

```text
from pathlib import Path
import hashlib,json,subprocess
r=Path('/workspace/scratch/gridex-z03-ack-join-helper-20261013')
p=Path('/workspace/scratch/ediel-z03-ack-join-20261013')
sha=lambda b:hashlib.sha256(b).hexdigest()
f=json.loads((p/'source-freeze.json').read_text())
for row in f['technicalFiles']:
 assert sha((r/row['path']).read_bytes())==row['sha256']
 assert subprocess.check_output(['git','rev-parse',f["sourceHead"]+':'+row['path']],cwd=r).decode().strip()==row['blob']
for label in ['finite-final','tsc-final','eslint-final','diff-check']:
 assert (p/(label+'.exit')).read_text()=='0'
index=[]
for path in sorted(p.iterdir()):
 if path.is_file() and path.name not in ['artifact-index.json','freeze-controller.stdout','freeze-controller.stderr','freeze-controller.exit']:
  b=path.read_bytes();index.append({'name':path.name,'bytes':len(b),'sha256':sha(b)})
(p/'artifact-index.json').write_text(json.dumps({'controllerSha256':sha(Path(__file__).read_bytes()),'source':f,'artifacts':index,'nativeCallbacksInvoked':0,'backendCommandsInvoked':0,'physicalNativeResult':'NATIVE_NOT_RUN'},indent=2))
print(json.dumps({'sourceHead':f['sourceHead'],'artifactCount':len(index),'controllerSha256':sha(Path(__file__).read_bytes()),'artifactIndexSha256':sha((p/'artifact-index.json').read_bytes()),'nativeCallbacksInvoked':0},indent=2))
```

### freeze-controller.stdout

Bytes 301; SHA256 `43fc01175787ee589d0fd6e574904b2466b865156370a814c9545fbdaabea805`.

```text
{
  "sourceHead": "4386f9c7c27d366794af845b1e55beb095647ee1",
  "artifactCount": 127,
  "controllerSha256": "d44578ffcfb0003a725e066af83db1588bde996ff43ea1547be675a0556e267e",
  "artifactIndexSha256": "ae9c3f26ee54a06af3eb6383caa42e057cfdfef180e3ade22dfe704c2c0d880c",
  "nativeCallbacksInvoked": 0
}
```

### finite-red.stdout

Bytes 0; SHA256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.

```text

```

### finite-red.stderr

Bytes 1909; SHA256 `96953324392f3ff16d5a78c778607d0ee05649254023676877e9be90f8f4ef68`.

```text
failed to load config from /workspace/scratch/ediel-z03-ack-join-20261013/finite.config.ts

⎯⎯⎯⎯⎯⎯⎯ Startup Error ⎯⎯⎯⎯⎯⎯⎯⎯
Error: Build failed with 1 error:

[31m[UNRESOLVED_IMPORT] [0mCould not resolve '/workspace/scratch/gridex-z03-ack-join-helper-20261013/node_modules/vitest/config' in ../ediel-z03-ack-join-20261013/finite.config.ts
 - Module not found. in ../ediel-z03-ack-join-20261013/finite.config.ts at 347..430

    at aggregateBindingErrorsIntoJsError (file:///workspace/scratch/gridex-helper-20261012/main/node_modules/rolldown/dist/shared/error-BlQ0-ek7.mjs:48:18)
    at unwrapBindingResult (file:///workspace/scratch/gridex-helper-20261012/main/node_modules/rolldown/dist/shared/error-BlQ0-ek7.mjs:18:128)
    at #build (file:///workspace/scratch/gridex-helper-20261012/main/node_modules/rolldown/dist/shared/rolldown-build-aV0QeeTW.mjs:3256:34)
    at async bundleConfigFile (file:///workspace/scratch/gridex-helper-20261012/main/node_modules/vite/dist/node/chunks/node.js:35685:17)
    at async bundleAndLoadConfigFile (file:///workspace/scratch/gridex-helper-20261012/main/node_modules/vite/dist/node/chunks/node.js:35593:18)
    at async loadConfigFromFile (file:///workspace/scratch/gridex-helper-20261012/main/node_modules/vite/dist/node/chunks/node.js:35554:42)
    at async resolveConfig (file:///workspace/scratch/gridex-helper-20261012/main/node_modules/vite/dist/node/chunks/node.js:35170:22)
    at async _createServer (file:///workspace/scratch/gridex-helper-20261012/main/node_modules/vite/dist/node/chunks/node.js:25332:65)
    at async createViteServer (file:///workspace/scratch/gridex-helper-20261012/main/node_modules/vitest/dist/chunks/cli-api.24X8XwN1.js:8835:17)
    at async createVitest (file:///workspace/scratch/gridex-helper-20261012/main/node_modules/vitest/dist/chunks/cli-api.24X8XwN1.js:14221:18) {
  errors: [Getter/Setter]
}



```

### finite-red.exit

Bytes 1; SHA256 `6b86b273ff34fce19d6b804eff5a3f5747ada4eaa22f1d49c01e52ddb7875b4b`.

```text
1
```

### finite-red-assertions.stdout

Bytes 737; SHA256 `c32a222aa7b6add1df7bebaec6dfbf3b5eba0acea114a3ea655b6362a3b38395`.

```text

 RUN  v4.1.9 /workspace/scratch/gridex-z03-ack-join-helper-20261013

 ❯ scripts/ediel-at-z03l-z03lk-supplier-ack-join-native.test.ts (6 tests | 6 failed) 15ms
     × admits only disjoint L/LK data selectors 4ms
     × refuses authority facts supplied by an input instead of its consumers 5ms
     × refuses relabelled or overlapping prospective cohort selectors 1ms
     × observes the actual own L wire identity 2ms
     × observes the actual own LK wire identity 1ms
     × refuses the wrong original subtype and duplicate own LI before causal comparison 1ms

 Test Files  1 failed (1)
      Tests  6 failed (6)
   Start at  16:13:42
   Duration  342ms (transform 149ms, setup 0ms, import 172ms, tests 15ms, environment 0ms)

```

### finite-red-assertions.stderr

Bytes 4648; SHA256 `79e475b26aa0f228d5dd67a8faa83cdd2da4e39d317939d0de7671b5972fc2ef`.

```text

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 6 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  scripts/ediel-at-z03l-z03lk-supplier-ack-join-native.test.ts > finite Z03 join input and raw boundary > admits only disjoint L/LK data selectors
Error: z03_join_selector_boundary_not_implemented
 ❯ selectorInput scripts/ediel-at-z03l-z03lk-supplier-ack-join-native.test.ts:20:9
     18|
     19| function selectorInput(_value: unknown): Input {
     20|   throw new Error('z03_join_selector_boundary_not_implemented')
       |         ^
     21| }
     22| function observeOwnWire(_raw: string, _code: 'Z03' | 'Z04', _variant: …
 ❯ scripts/ediel-at-z03l-z03lk-supplier-ack-join-native.test.ts:35:12

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/6]⎯

 FAIL  scripts/ediel-at-z03l-z03lk-supplier-ack-join-native.test.ts > finite Z03 join input and raw boundary > refuses authority facts supplied by an input instead of its consumers
AssertionError: expected [Function] to throw error including 'z03_join_selector_keys_required' but got 'z03_join_selector_boundary_not_implem…'

Expected: "z03_join_selector_keys_required"
Received: "z03_join_selector_boundary_not_implemented"

 ❯ scripts/ediel-at-z03l-z03lk-supplier-ack-join-native.test.ts:39:63
     37|   it('refuses authority facts supplied by an input instead of its cons…
     38|     const value = data()
     39|     expect(() => selectorInput({ ...value, accepted: true })).toThrow(…
       |                                                               ^
     40|     expect(() => selectorInput({ ...value, cases: [{ ...value.cases[0]…
     41|       .toThrow('z03_join_selector_keys_required')

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/6]⎯

 FAIL  scripts/ediel-at-z03l-z03lk-supplier-ack-join-native.test.ts > finite Z03 join input and raw boundary > refuses relabelled or overlapping prospective cohort selectors
AssertionError: expected [Function] to throw error including 'z03_join_disjoint_l_lk_required' but got 'z03_join_selector_boundary_not_implem…'

Expected: "z03_join_disjoint_l_lk_required"
Received: "z03_join_selector_boundary_not_implemented"

 ❯ scripts/ediel-at-z03l-z03lk-supplier-ack-join-native.test.ts:46:8
     44|     const value = data()
     45|     expect(() => selectorInput({ ...value, cases: [value.cases[0], { .…
     46|       .toThrow('z03_join_disjoint_l_lk_required')
       |        ^
     47|     expect(() => selectorInput({ ...value, cases: [value.cases[0], { .…
     48|       .toThrow('z03_join_disjoint_l_lk_required')

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/6]⎯

 FAIL  scripts/ediel-at-z03l-z03lk-supplier-ack-join-native.test.ts > finite Z03 join input and raw boundary > observes the actual own L wire identity
 FAIL  scripts/ediel-at-z03l-z03lk-supplier-ack-join-native.test.ts > finite Z03 join input and raw boundary > observes the actual own LK wire identity
Error: edifact_acknowledgement_request_required
 ❯ Function.encode lib/ediel/core/edifactEnvelopeCodec.ts:217:13
    215|     if (input.messages.length === 0) throw new Error('edifact_at_least…
    216|     if (typeof input.acknowledgementRequest !== 'boolean') {
    217|       throw new Error('edifact_acknowledgement_request_required')
       |             ^
    218|     }
    219|     const interchangeReference = trimOrNull(input.interchangeReference)
 ❯ wire scripts/ediel-at-z03l-z03lk-supplier-ack-join-native.test.ts:50:57
 ❯ scripts/ediel-at-z03l-z03lk-supplier-ack-join-native.test.ts:59:27

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[4/6]⎯

 FAIL  scripts/ediel-at-z03l-z03lk-supplier-ack-join-native.test.ts > finite Z03 join input and raw boundary > refuses the wrong original subtype and duplicate own LI before causal comparison
AssertionError: expected [Function] to throw error including 'z03_join_variant_wire_required' but got 'edifact_acknowledgement_request_requi…'

Expected: "z03_join_variant_wire_required"
Received: "edifact_acknowledgement_request_required"

 ❯ scripts/ediel-at-z03l-z03lk-supplier-ack-join-native.test.ts:64:60
     62|   })
     63|   it('refuses the wrong original subtype and duplicate own LI before c…
     64|     expect(() => observeOwnWire(wire('Z22'), 'Z03', 'LK')).toThrow('z0…
       |                                                            ^
     65|     expect(() => observeOwnWire(wire('Z22').replace('RFF+LI:OWN-LI', '…
     66|       .toThrow('z03_join_unique_wire_field_required')

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[5/6]⎯

```

### finite-red-assertions.exit

Bytes 1; SHA256 `6b86b273ff34fce19d6b804eff5a3f5747ada4eaa22f1d49c01e52ddb7875b4b`.

```text
1
```

### finite-red-valid.stdout

Bytes 737; SHA256 `bbaf081b2bbd73d1ac577b231cdb5f49349c68f1e50064a5af6590e59de738d2`.

```text

 RUN  v4.1.9 /workspace/scratch/gridex-z03-ack-join-helper-20261013

 ❯ scripts/ediel-at-z03l-z03lk-supplier-ack-join-native.test.ts (6 tests | 6 failed) 32ms
     × admits only disjoint L/LK data selectors 3ms
     × refuses authority facts supplied by an input instead of its consumers 4ms
     × refuses relabelled or overlapping prospective cohort selectors 2ms
     × observes the actual own L wire identity 16ms
     × observes the actual own LK wire identity 3ms
     × refuses the wrong original subtype and duplicate own LI before causal comparison 2ms

 Test Files  1 failed (1)
      Tests  6 failed (6)
   Start at  16:13:58
   Duration  292ms (transform 91ms, setup 0ms, import 115ms, tests 32ms, environment 0ms)

```

### finite-red-valid.stderr

Bytes 4439; SHA256 `794f9b503409dcfc1caa72c1349071c122e953f9d6cef23754c370ec47adb05b`.

```text

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 6 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  scripts/ediel-at-z03l-z03lk-supplier-ack-join-native.test.ts > finite Z03 join input and raw boundary > admits only disjoint L/LK data selectors
Error: z03_join_selector_boundary_not_implemented
 ❯ selectorInput scripts/ediel-at-z03l-z03lk-supplier-ack-join-native.test.ts:20:9
     18|
     19| function selectorInput(_value: unknown): Input {
     20|   throw new Error('z03_join_selector_boundary_not_implemented')
       |         ^
     21| }
     22| function observeOwnWire(_raw: string, _code: 'Z03' | 'Z04', _variant: …
 ❯ scripts/ediel-at-z03l-z03lk-supplier-ack-join-native.test.ts:35:12

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/6]⎯

 FAIL  scripts/ediel-at-z03l-z03lk-supplier-ack-join-native.test.ts > finite Z03 join input and raw boundary > refuses authority facts supplied by an input instead of its consumers
AssertionError: expected [Function] to throw error including 'z03_join_selector_keys_required' but got 'z03_join_selector_boundary_not_implem…'

Expected: "z03_join_selector_keys_required"
Received: "z03_join_selector_boundary_not_implemented"

 ❯ scripts/ediel-at-z03l-z03lk-supplier-ack-join-native.test.ts:39:63
     37|   it('refuses authority facts supplied by an input instead of its cons…
     38|     const value = data()
     39|     expect(() => selectorInput({ ...value, accepted: true })).toThrow(…
       |                                                               ^
     40|     expect(() => selectorInput({ ...value, cases: [{ ...value.cases[0]…
     41|       .toThrow('z03_join_selector_keys_required')

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/6]⎯

 FAIL  scripts/ediel-at-z03l-z03lk-supplier-ack-join-native.test.ts > finite Z03 join input and raw boundary > refuses relabelled or overlapping prospective cohort selectors
AssertionError: expected [Function] to throw error including 'z03_join_disjoint_l_lk_required' but got 'z03_join_selector_boundary_not_implem…'

Expected: "z03_join_disjoint_l_lk_required"
Received: "z03_join_selector_boundary_not_implemented"

 ❯ scripts/ediel-at-z03l-z03lk-supplier-ack-join-native.test.ts:46:8
     44|     const value = data()
     45|     expect(() => selectorInput({ ...value, cases: [value.cases[0], { .…
     46|       .toThrow('z03_join_disjoint_l_lk_required')
       |        ^
     47|     expect(() => selectorInput({ ...value, cases: [value.cases[0], { .…
     48|       .toThrow('z03_join_disjoint_l_lk_required')

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/6]⎯

 FAIL  scripts/ediel-at-z03l-z03lk-supplier-ack-join-native.test.ts > finite Z03 join input and raw boundary > observes the actual own L wire identity
 FAIL  scripts/ediel-at-z03l-z03lk-supplier-ack-join-native.test.ts > finite Z03 join input and raw boundary > observes the actual own LK wire identity
Error: z03_join_wire_boundary_not_implemented
 ❯ observeOwnWire scripts/ediel-at-z03l-z03lk-supplier-ack-join-native.test.ts:23:9
     21| }
     22| function observeOwnWire(_raw: string, _code: 'Z03' | 'Z04', _variant: …
     23|   throw new Error('z03_join_wire_boundary_not_implemented')
       |         ^
     24| }
     25|
 ❯ scripts/ediel-at-z03l-z03lk-supplier-ack-join-native.test.ts:59:12

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[4/6]⎯

 FAIL  scripts/ediel-at-z03l-z03lk-supplier-ack-join-native.test.ts > finite Z03 join input and raw boundary > refuses the wrong original subtype and duplicate own LI before causal comparison
AssertionError: expected [Function] to throw error including 'z03_join_variant_wire_required' but got 'z03_join_wire_boundary_not_implemented'

Expected: "z03_join_variant_wire_required"
Received: "z03_join_wire_boundary_not_implemented"

 ❯ scripts/ediel-at-z03l-z03lk-supplier-ack-join-native.test.ts:64:60
     62|   })
     63|   it('refuses the wrong original subtype and duplicate own LI before c…
     64|     expect(() => observeOwnWire(wire('Z22'), 'Z03', 'LK')).toThrow('z0…
       |                                                            ^
     65|     expect(() => observeOwnWire(wire('Z22').replace('RFF+LI:OWN-LI', '…
     66|       .toThrow('z03_join_unique_wire_field_required')

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[5/6]⎯

```

### finite-red-valid.exit

Bytes 1; SHA256 `6b86b273ff34fce19d6b804eff5a3f5747ada4eaa22f1d49c01e52ddb7875b4b`.

```text
1
```

### finite-green-first.stdout

Bytes 237; SHA256 `aeb63a060b52b286955ca90cf451019a2e77f7b1f16247a18565b294ccc08675`.

```text

 RUN  v4.1.9 /workspace/scratch/gridex-z03-ack-join-helper-20261013


 Test Files  1 passed (1)
      Tests  6 passed (6)
   Start at  16:15:07
   Duration  349ms (transform 170ms, setup 0ms, import 199ms, tests 34ms, environment 0ms)

```

### finite-green-first.stderr

Bytes 0; SHA256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.

```text

```

### finite-green-first.exit

Bytes 1; SHA256 `5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9`.

```text
0
```

### tsc-first.stdout

Bytes 185; SHA256 `2006ff7e3158ee4c229b2542745f6046300daa50bbd1b20e5cfddc27a47068c3`.

```text
error TS2688: Cannot find type definition file for 'vitest/globals'.
  The file is in the program because:
    Entry point of type library 'vitest/globals' specified in compilerOptions
```

### tsc-first.stderr

Bytes 0; SHA256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.

```text

```

### tsc-first.exit

Bytes 1; SHA256 `d4735e3a265e16eee03f59718b9b5d03019c07d8b6c51f90da3a666eec13ab35`.

```text
2
```

### tsc-second.stdout

Bytes 0; SHA256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.

```text

```

### tsc-second.stderr

Bytes 0; SHA256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.

```text

```

### tsc-second.exit

Bytes 1; SHA256 `5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9`.

```text
0
```

### eslint-first.stdout

Bytes 0; SHA256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.

```text

```

### eslint-first.stderr

Bytes 0; SHA256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.

```text

```

### eslint-first.exit

Bytes 1; SHA256 `5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9`.

```text
0
```

### finite-pure-z04-first.stdout

Bytes 533; SHA256 `32ba9aefe968a0ec392c92e07bc2ad8bed7759be00d06a0a5887f4e38b426bdb`.

```text

 RUN  v4.1.9 /workspace/scratch/gridex-z03-ack-join-helper-20261013

 ❯ scripts/ediel-at-z03l-z03lk-supplier-ack-join-native.test.ts (10 tests | 2 failed | 2 skipped) 31ms
     × renders only a synthetic external Z04L representation of the own tuple 5ms
     × renders only a synthetic external Z04LK representation of the own tuple 0ms

 Test Files  1 failed (1)
      Tests  2 failed | 6 passed | 2 skipped (10)
   Start at  16:25:57
   Duration  699ms (transform 466ms, setup 0ms, import 524ms, tests 31ms, environment 0ms)

```

### finite-pure-z04-first.stderr

Bytes 1093; SHA256 `430df92d05310279755365168ecc6785d93053abd099385868426ad66c1362d7`.

```text

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  scripts/ediel-at-z03l-z03lk-supplier-ack-join-native.test.ts > finite Z03 join input and raw boundary > renders only a synthetic external Z04L representation of the own tuple
 FAIL  scripts/ediel-at-z03l-z03lk-supplier-ack-join-native.test.ts > finite Z03 join input and raw boundary > renders only a synthetic external Z04LK representation of the own tuple
ReferenceError: Cannot access 'wire' before initialization
 ❯ scripts/ediel-at-z03l-z03lk-supplier-ack-join-native.test.ts:572:96
    570|   })
    571|   it.each([['L', 'Z22'], ['LK', 'Z23']] as const)('renders only a synt…
    572|     const raw = externalZ04({ variant, customerName: 'Synthetic Own Cu…
       |                                                                                                ^
    573|     expect(observeOwnWire(raw, 'Z04', variant)).toMatchObject({ code: …
    574|       point: '735123456789012345', agency: '9', li: 'OWN-LI', start: '…

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/2]⎯

```

### finite-pure-z04-first.exit

Bytes 1; SHA256 `6b86b273ff34fce19d6b804eff5a3f5747ada4eaa22f1d49c01e52ddb7875b4b`.

```text
1
```

### finite-pure-z04-second.stdout

Bytes 533; SHA256 `78d1b9c495261a908ef0f6dca62b9ddd253efa4f6aa69af7ae598ed03264bfb8`.

```text

 RUN  v4.1.9 /workspace/scratch/gridex-z03-ack-join-helper-20261013

 ❯ scripts/ediel-at-z03l-z03lk-supplier-ack-join-native.test.ts (10 tests | 2 failed | 2 skipped) 33ms
     × renders only a synthetic external Z04L representation of the own tuple 8ms
     × renders only a synthetic external Z04LK representation of the own tuple 1ms

 Test Files  1 failed (1)
      Tests  2 failed | 6 passed | 2 skipped (10)
   Start at  16:26:15
   Duration  566ms (transform 317ms, setup 0ms, import 377ms, tests 33ms, environment 0ms)

```

### finite-pure-z04-second.stderr

Bytes 998; SHA256 `8302d0fa70afe1a26284580151a41aef02d15107de73978b6a0efe309c10dacb`.

```text

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  scripts/ediel-at-z03l-z03lk-supplier-ack-join-native.test.ts > finite Z03 join input and raw boundary > renders only a synthetic external Z04L representation of the own tuple
 FAIL  scripts/ediel-at-z03l-z03lk-supplier-ack-join-native.test.ts > finite Z03 join input and raw boundary > renders only a synthetic external Z04LK representation of the own tuple
EdielExecutionFailure: Kvittensen kräver entydiga juridiska parter i ursprungsmeddelandets eget fysiska NAD-huvud.
 ❯ held lib/ediel/core/originalAckPartyIdentities.ts:27:37

 ❯ party lib/ediel/core/originalAckPartyIdentities.ts:44:114
 ❯ Module.originalAckPartyIdentities lib/ediel/core/originalAckPartyIdentities.ts:52:18
 ❯ externalZ04 scripts/ediel-at-z03l-z03lk-supplier-ack-join-native.test.ts:328:72
 ❯ scripts/ediel-at-z03l-z03lk-supplier-ack-join-native.test.ts:572:17

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/2]⎯

```

### finite-pure-z04-second.exit

Bytes 1; SHA256 `6b86b273ff34fce19d6b804eff5a3f5747ada4eaa22f1d49c01e52ddb7875b4b`.

```text
1
```

### finite-pure-z04-green.stdout

Bytes 250; SHA256 `7c39001510da194f74ad1ffe139eb6ad7441e3b65c521146795d8801e9547512`.

```text

 RUN  v4.1.9 /workspace/scratch/gridex-z03-ack-join-helper-20261013


 Test Files  1 passed (1)
      Tests  8 passed | 2 skipped (10)
   Start at  16:27:09
   Duration  534ms (transform 319ms, setup 0ms, import 378ms, tests 36ms, environment 0ms)

```

### finite-pure-z04-green.stderr

Bytes 0; SHA256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.

```text

```

### finite-pure-z04-green.exit

Bytes 1; SHA256 `5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9`.

```text
0
```

### finite-final.stdout

Bytes 250; SHA256 `284af060fe7962f653f3ef81e374fd6132d93be8b23b0f707d377d5227822b07`.

```text

 RUN  v4.1.9 /workspace/scratch/gridex-z03-ack-join-helper-20261013


 Test Files  1 passed (1)
      Tests  8 passed | 2 skipped (10)
   Start at  16:28:14
   Duration  697ms (transform 448ms, setup 0ms, import 517ms, tests 35ms, environment 0ms)

```

### finite-final.stderr

Bytes 0; SHA256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.

```text

```

### finite-final.exit

Bytes 1; SHA256 `5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9`.

```text
0
```

### tsc-final.stdout

Bytes 0; SHA256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.

```text

```

### tsc-final.stderr

Bytes 0; SHA256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.

```text

```

### tsc-final.exit

Bytes 1; SHA256 `5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9`.

```text
0
```

### eslint-final.stdout

Bytes 0; SHA256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.

```text

```

### eslint-final.stderr

Bytes 0; SHA256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.

```text

```

### eslint-final.exit

Bytes 1; SHA256 `5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9`.

```text
0
```

### diff-check.stdout

Bytes 0; SHA256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.

```text

```

### diff-check.stderr

Bytes 0; SHA256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.

```text

```

### diff-check.exit

Bytes 1; SHA256 `5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9`.

```text
0
```

## Outside artifact index

```json
{
  "controllerSha256": "d44578ffcfb0003a725e066af83db1588bde996ff43ea1547be675a0556e267e",
  "source": {
    "sourceHead": "4386f9c7c27d366794af845b1e55beb095647ee1",
    "sourceTree": "36337e758de3064b4d12434e5895e5cd7b0dd3ee",
    "orderedParents": [
      "d798eb36f35cd4f437d44c8d234b4dbb81adc7a6"
    ],
    "base": "d798eb36f35cd4f437d44c8d234b4dbb81adc7a6",
    "technicalFiles": [
      {
        "path": "scripts/ediel-at-z03l-z03lk-supplier-ack-join-native.test.ts",
        "blob": "3fef9d7bd96489d57b3e0347800a2d32881024f1",
        "sha256": "815ab5be300ef385a3adc4128d278cbcc4574ba16df17186a5958930dc0d552c",
        "lines": 585
      },
      {
        "path": "scripts/ediel-at-z03l-z03lk-supplier-ack-join-native.config.ts",
        "blob": "324261dc8d442ed72e32dce19cb55962f9c1101d",
        "sha256": "411756e455969e5b04dad4f24007d17d2937c4db74bd840dc615eaa168bd1117",
        "lines": 8
      }
    ]
  },
  "artifacts": [
    {
      "name": "board-current.json",
      "bytes": 4939275,
      "sha256": "655ca15c3d19210bf2c25488d63dcce9a868972d308c3a66c95f6e9ca7f41b1c"
    },
    {
      "name": "board-page-1.exit",
      "bytes": 1,
      "sha256": "5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9"
    },
    {
      "name": "board-page-1.stderr",
      "bytes": 0,
      "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    },
    {
      "name": "board-page-1.stdout",
      "bytes": 583652,
      "sha256": "a64eee801ce67816af0cc3c3f2065f3a3d6f6645b6d05784bb03c0b53dfbda83"
    },
    {
      "name": "board-page-2.exit",
      "bytes": 1,
      "sha256": "5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9"
    },
    {
      "name": "board-page-2.stderr",
      "bytes": 0,
      "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    },
    {
      "name": "board-page-2.stdout",
      "bytes": 541433,
      "sha256": "0c42560523695a648f3a96a0c64c2ea36db7c4695e47135e2fbb44ae7cab2525"
    },
    {
      "name": "board-page-3.exit",
      "bytes": 1,
      "sha256": "5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9"
    },
    {
      "name": "board-page-3.stderr",
      "bytes": 0,
      "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    },
    {
      "name": "board-page-3.stdout",
      "bytes": 595237,
      "sha256": "cc71fcee4aee104fe938f4ddb520bbf1c3d0cd8ef87b511dec53005c7b6407bb"
    },
    {
      "name": "board-page-4.exit",
      "bytes": 1,
      "sha256": "5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9"
    },
    {
      "name": "board-page-4.stderr",
      "bytes": 0,
      "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    },
    {
      "name": "board-page-4.stdout",
      "bytes": 513552,
      "sha256": "e3fd5dbf68d661db0595bd9cd016aed28e3964245c722b2056943d0a6db8971f"
    },
    {
      "name": "board-page-5.exit",
      "bytes": 1,
      "sha256": "5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9"
    },
    {
      "name": "board-page-5.stderr",
      "bytes": 0,
      "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    },
    {
      "name": "board-page-5.stdout",
      "bytes": 476088,
      "sha256": "2c16891122d7c9bb7815da751bfeef419c6434b0c9a174162cc7cb5ba87cf0bd"
    },
    {
      "name": "board-page-6.exit",
      "bytes": 1,
      "sha256": "5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9"
    },
    {
      "name": "board-page-6.stderr",
      "bytes": 0,
      "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    },
    {
      "name": "board-page-6.stdout",
      "bytes": 466678,
      "sha256": "06afa652edc78174aeb394f53d14834c9bdf30c388805a11dd4fdfc8184791f5"
    },
    {
      "name": "board-page-7.exit",
      "bytes": 1,
      "sha256": "5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9"
    },
    {
      "name": "board-page-7.stderr",
      "bytes": 0,
      "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    },
    {
      "name": "board-page-7.stdout",
      "bytes": 478103,
      "sha256": "ef8ec7d74d5e29b0a1e72133d95e38b0da0d2c3e19eefc5e655244106f6039cc"
    },
    {
      "name": "board-page-8.exit",
      "bytes": 1,
      "sha256": "5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9"
    },
    {
      "name": "board-page-8.stderr",
      "bytes": 0,
      "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    },
    {
      "name": "board-page-8.stdout",
      "bytes": 585521,
      "sha256": "f9231bd1e2e46bdc83f27cff5ed310d4abdb762fc0207bd4f9756328e2f1f2de"
    },
    {
      "name": "branch-absence.exit",
      "bytes": 1,
      "sha256": "6b86b273ff34fce19d6b804eff5a3f5747ada4eaa22f1d49c01e52ddb7875b4b"
    },
    {
      "name": "branch-absence.stderr",
      "bytes": 25,
      "sha256": "d2c8985c89b29a842ac4946d13bdbc297709f44f20bb968faf9682664b211db6"
    },
    {
      "name": "branch-absence.stdout",
      "bytes": 114,
      "sha256": "e2e3c64edab172132f77ce89a0e8c190db1cd30936a096344f45893bd5b75f8a"
    },
    {
      "name": "claim-body.md",
      "bytes": 2772,
      "sha256": "2b3c0ffffa3af010c28f8b5285772c7cb70ba4f1e90be627929b76758135d85a"
    },
    {
      "name": "claim-create.json",
      "bytes": 6076,
      "sha256": "36562081630e2b1f5d808128d4ea152c03b64c27a9e3f56b630e47ba5a4dc686"
    },
    {
      "name": "claim-create.stderr",
      "bytes": 0,
      "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    },
    {
      "name": "claim-readback.json",
      "bytes": 6076,
      "sha256": "36562081630e2b1f5d808128d4ea152c03b64c27a9e3f56b630e47ba5a4dc686"
    },
    {
      "name": "claim-request.json",
      "bytes": 2814,
      "sha256": "dd8d82fa951b573b78273cb8313437666db879446cdf85aa3478efa45d94015c"
    },
    {
      "name": "diff-check.exit",
      "bytes": 1,
      "sha256": "5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9"
    },
    {
      "name": "diff-check.stderr",
      "bytes": 0,
      "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    },
    {
      "name": "diff-check.stdout",
      "bytes": 0,
      "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    },
    {
      "name": "ediel-at-z03l-z03lk-supplier-ack-join-native.config.ts",
      "bytes": 458,
      "sha256": "411756e455969e5b04dad4f24007d17d2937c4db74bd840dc615eaa168bd1117"
    },
    {
      "name": "ediel-at-z03l-z03lk-supplier-ack-join-native.test.ts",
      "bytes": 47732,
      "sha256": "815ab5be300ef385a3adc4128d278cbcc4574ba16df17186a5958930dc0d552c"
    },
    {
      "name": "eslint-final.exit",
      "bytes": 1,
      "sha256": "5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9"
    },
    {
      "name": "eslint-final.stderr",
      "bytes": 0,
      "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    },
    {
      "name": "eslint-final.stdout",
      "bytes": 0,
      "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    },
    {
      "name": "eslint-first.exit",
      "bytes": 1,
      "sha256": "5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9"
    },
    {
      "name": "eslint-first.stderr",
      "bytes": 0,
      "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    },
    {
      "name": "eslint-first.stdout",
      "bytes": 0,
      "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    },
    {
      "name": "file-absence-0.exit",
      "bytes": 1,
      "sha256": "6b86b273ff34fce19d6b804eff5a3f5747ada4eaa22f1d49c01e52ddb7875b4b"
    },
    {
      "name": "file-absence-0.stderr",
      "bytes": 25,
      "sha256": "d2c8985c89b29a842ac4946d13bdbc297709f44f20bb968faf9682664b211db6"
    },
    {
      "name": "file-absence-0.stdout",
      "bytes": 127,
      "sha256": "e45906ce02e79f16fb87a838d86bb4e497e37a9591f97608fa013bbcd8b9cbc2"
    },
    {
      "name": "file-absence-1.exit",
      "bytes": 1,
      "sha256": "6b86b273ff34fce19d6b804eff5a3f5747ada4eaa22f1d49c01e52ddb7875b4b"
    },
    {
      "name": "file-absence-1.stderr",
      "bytes": 25,
      "sha256": "d2c8985c89b29a842ac4946d13bdbc297709f44f20bb968faf9682664b211db6"
    },
    {
      "name": "file-absence-1.stdout",
      "bytes": 127,
      "sha256": "e45906ce02e79f16fb87a838d86bb4e497e37a9591f97608fa013bbcd8b9cbc2"
    },
    {
      "name": "finite-final.exit",
      "bytes": 1,
      "sha256": "5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9"
    },
    {
      "name": "finite-final.stderr",
      "bytes": 0,
      "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    },
    {
      "name": "finite-final.stdout",
      "bytes": 250,
      "sha256": "284af060fe7962f653f3ef81e374fd6132d93be8b23b0f707d377d5227822b07"
    },
    {
      "name": "finite-green-first.exit",
      "bytes": 1,
      "sha256": "5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9"
    },
    {
      "name": "finite-green-first.stderr",
      "bytes": 0,
      "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    },
    {
      "name": "finite-green-first.stdout",
      "bytes": 237,
      "sha256": "aeb63a060b52b286955ca90cf451019a2e77f7b1f16247a18565b294ccc08675"
    },
    {
      "name": "finite-pure-z04-first.exit",
      "bytes": 1,
      "sha256": "6b86b273ff34fce19d6b804eff5a3f5747ada4eaa22f1d49c01e52ddb7875b4b"
    },
    {
      "name": "finite-pure-z04-first.stderr",
      "bytes": 1093,
      "sha256": "430df92d05310279755365168ecc6785d93053abd099385868426ad66c1362d7"
    },
    {
      "name": "finite-pure-z04-first.stdout",
      "bytes": 533,
      "sha256": "32ba9aefe968a0ec392c92e07bc2ad8bed7759be00d06a0a5887f4e38b426bdb"
    },
    {
      "name": "finite-pure-z04-green.exit",
      "bytes": 1,
      "sha256": "5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9"
    },
    {
      "name": "finite-pure-z04-green.stderr",
      "bytes": 0,
      "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    },
    {
      "name": "finite-pure-z04-green.stdout",
      "bytes": 250,
      "sha256": "7c39001510da194f74ad1ffe139eb6ad7441e3b65c521146795d8801e9547512"
    },
    {
      "name": "finite-pure-z04-second.exit",
      "bytes": 1,
      "sha256": "6b86b273ff34fce19d6b804eff5a3f5747ada4eaa22f1d49c01e52ddb7875b4b"
    },
    {
      "name": "finite-pure-z04-second.stderr",
      "bytes": 998,
      "sha256": "8302d0fa70afe1a26284580151a41aef02d15107de73978b6a0efe309c10dacb"
    },
    {
      "name": "finite-pure-z04-second.stdout",
      "bytes": 533,
      "sha256": "78d1b9c495261a908ef0f6dca62b9ddd253efa4f6aa69af7ae598ed03264bfb8"
    },
    {
      "name": "finite-red-assertions.exit",
      "bytes": 1,
      "sha256": "6b86b273ff34fce19d6b804eff5a3f5747ada4eaa22f1d49c01e52ddb7875b4b"
    },
    {
      "name": "finite-red-assertions.stderr",
      "bytes": 4648,
      "sha256": "79e475b26aa0f228d5dd67a8faa83cdd2da4e39d317939d0de7671b5972fc2ef"
    },
    {
      "name": "finite-red-assertions.stdout",
      "bytes": 737,
      "sha256": "c32a222aa7b6add1df7bebaec6dfbf3b5eba0acea114a3ea655b6362a3b38395"
    },
    {
      "name": "finite-red-valid.exit",
      "bytes": 1,
      "sha256": "6b86b273ff34fce19d6b804eff5a3f5747ada4eaa22f1d49c01e52ddb7875b4b"
    },
    {
      "name": "finite-red-valid.stderr",
      "bytes": 4439,
      "sha256": "794f9b503409dcfc1caa72c1349071c122e953f9d6cef23754c370ec47adb05b"
    },
    {
      "name": "finite-red-valid.stdout",
      "bytes": 737,
      "sha256": "bbaf081b2bbd73d1ac577b231cdb5f49349c68f1e50064a5af6590e59de738d2"
    },
    {
      "name": "finite-red.exit",
      "bytes": 1,
      "sha256": "6b86b273ff34fce19d6b804eff5a3f5747ada4eaa22f1d49c01e52ddb7875b4b"
    },
    {
      "name": "finite-red.stderr",
      "bytes": 1909,
      "sha256": "96953324392f3ff16d5a78c778607d0ee05649254023676877e9be90f8f4ef68"
    },
    {
      "name": "finite-red.stdout",
      "bytes": 0,
      "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    },
    {
      "name": "finite.config.ts",
      "bytes": 579,
      "sha256": "7946efd7fd513fc67f26ea341e8061d33be46474ddd84ef4d40f08d525b4e7de"
    },
    {
      "name": "freeze-controller.py",
      "bytes": 1337,
      "sha256": "d44578ffcfb0003a725e066af83db1588bde996ff43ea1547be675a0556e267e"
    },
    {
      "name": "fresh-receipt-359d27a100e3f5de4992e5abd921060c85988ae4.json",
      "bytes": 2935,
      "sha256": "193c6d42c3ae2c567e5c66c5baeed3bf8df6e0f7bdf2191e59e3e60c19d0ef7d"
    },
    {
      "name": "fresh-receipt-97d7007594fad27d78a9c7232a3ac7fce64b88e8.json",
      "bytes": 2409,
      "sha256": "84948897be3583469e45d569fb5a890d0ab8da0f41778c1105a6b7a3e106e063"
    },
    {
      "name": "fresh-summary.json",
      "bytes": 16124,
      "sha256": "add495fbdb63121ac2beb2c5daf0541a167e4664ba4d54ee9c36197bb37380fd"
    },
    {
      "name": "main-commit.exit",
      "bytes": 1,
      "sha256": "5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9"
    },
    {
      "name": "main-commit.stderr",
      "bytes": 0,
      "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    },
    {
      "name": "main-commit.stdout",
      "bytes": 2801,
      "sha256": "c569acb62a48a77bd68a98f4cd634e645e76922faf15102566db9b1031d9fb9b"
    },
    {
      "name": "main.exit",
      "bytes": 1,
      "sha256": "5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9"
    },
    {
      "name": "main.stderr",
      "bytes": 0,
      "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    },
    {
      "name": "main.stdout",
      "bytes": 350,
      "sha256": "8c70466de17099e0e9f2c6b89c180561408330fee528d1913f8691598ff329f5"
    },
    {
      "name": "preservation.json",
      "bytes": 730,
      "sha256": "596bfafcf406fa1447857865872ff80f34493b86d47cbeadd799e6a8f7145c01"
    },
    {
      "name": "push-trigger-audit.json",
      "bytes": 9197,
      "sha256": "99c6fec10391f683b4d903c71f55104e34ea90a79fcae07b900156d064d4ad7a"
    },
    {
      "name": "qualification-commands.json",
      "bytes": 1444,
      "sha256": "e5ac7c93741ae2247b80ffe3c83b8b816dc99138b1cd13c6d2c0a73ee4685e6c"
    },
    {
      "name": "readonly-source-pins.json",
      "bytes": 3836,
      "sha256": "5f343ece924be56e6f4f273b6429a4aa337eed95cf5d346202f0345a4932a638"
    },
    {
      "name": "receipt-create.exit",
      "bytes": 1,
      "sha256": "5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9"
    },
    {
      "name": "receipt-create.stderr",
      "bytes": 0,
      "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    },
    {
      "name": "receipt-create.stdout",
      "bytes": 2265,
      "sha256": "04dfb4457ee76455f1fc83e1f1e30ad3ebaa3b3e34e11009ed815c33f4808020"
    },
    {
      "name": "receipt-get.json",
      "bytes": 2265,
      "sha256": "04dfb4457ee76455f1fc83e1f1e30ad3ebaa3b3e34e11009ed815c33f4808020"
    },
    {
      "name": "receipt-payload.json",
      "bytes": 1124,
      "sha256": "a261fb9baa2fbc088f900cc887e515b665daacf129e7a8e561b1fcb10ab3b34d"
    },
    {
      "name": "receipt-request.json",
      "bytes": 1250,
      "sha256": "b6a78c90839c57486c56c24b8b9f216ecd55ebbf8d30ca997094a8488538bd70"
    },
    {
      "name": "receipts-current.json",
      "bytes": 64667,
      "sha256": "e18a98b4da0891007750170c4cc317825f4fe0d8ed3b193e1e05d02e585e5e0b"
    },
    {
      "name": "ref-create-0-request.json",
      "bytes": 165,
      "sha256": "f30c0b7a62ccbb80daf31061c52fc00568b23fe7c0f3aadd575eea9afc7ff1d8"
    },
    {
      "name": "ref-create-0.exit",
      "bytes": 1,
      "sha256": "5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9"
    },
    {
      "name": "ref-create-0.stderr",
      "bytes": 0,
      "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    },
    {
      "name": "ref-create-0.stdout",
      "bytes": 646,
      "sha256": "d7fb1a9fa652500830941aab8e02ef384fb1f272823dc0d8edc87d62b4e93188"
    },
    {
      "name": "ref-create-1-request.json",
      "bytes": 165,
      "sha256": "195fb53edb75d38c8f17cac6c2c355332f0c84c5e3a33b6a3f3a0714598c49f6"
    },
    {
      "name": "ref-create-1.exit",
      "bytes": 1,
      "sha256": "5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9"
    },
    {
      "name": "ref-create-1.stderr",
      "bytes": 0,
      "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    },
    {
      "name": "ref-create-1.stdout",
      "bytes": 646,
      "sha256": "e68c501c77b0e90439ebf85ab6be5b016c81d64cc62a7fa775d685805ad42bf0"
    },
    {
      "name": "ref-get-0.json",
      "bytes": 646,
      "sha256": "d7fb1a9fa652500830941aab8e02ef384fb1f272823dc0d8edc87d62b4e93188"
    },
    {
      "name": "ref-get-1.json",
      "bytes": 646,
      "sha256": "e68c501c77b0e90439ebf85ab6be5b016c81d64cc62a7fa775d685805ad42bf0"
    },
    {
      "name": "refs-before.exit",
      "bytes": 1,
      "sha256": "5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9"
    },
    {
      "name": "refs-before.stderr",
      "bytes": 0,
      "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    },
    {
      "name": "refs-before.stdout",
      "bytes": 120676,
      "sha256": "f5f6e6d0554332d6ad77983e735f8c2ad106b5bcf1d4e4a8fb53776f28e361fc"
    },
    {
      "name": "root-file-1201455a6deacbe6a3728c6839255b5c91d6179f2c2aee1899ab00cdb3d117f5.json",
      "bytes": 684,
      "sha256": "8a0ec07dd147467ef6a55b6cac5e680bc07574d48d3a9a2e05ebdd1c16c9de7f"
    },
    {
      "name": "root-file-178b708b18ce2587ace7bc588122d1e30489588b67ff3187b8cce54fa9cc9596.json",
      "bytes": 684,
      "sha256": "bad935e88214fca2f7a872842833c437387c5d79686b1dd42d1210db3e04fd8b"
    },
    {
      "name": "root-independent-branch-absence.stderr",
      "bytes": 25,
      "sha256": "d2c8985c89b29a842ac4946d13bdbc297709f44f20bb968faf9682664b211db6"
    },
    {
      "name": "root-independent-claim.json",
      "bytes": 6729,
      "sha256": "1549b8bcfbf3a42a2db3a1aca107ea8973f7dd7ea72040332431c16afe189e00"
    },
    {
      "name": "root-independent-receipt.json",
      "bytes": 2433,
      "sha256": "a62a59e1829465dd9faa72b3682dccef43ee59a7ad5c4a5741b9c8e46e60a1ab"
    },
    {
      "name": "source-freeze.json",
      "bytes": 780,
      "sha256": "7d24a64f3b59afc45d2fede217cc99ebd0a8bc36a2660ca5f9d597cf1f2e0fe8"
    },
    {
      "name": "source-postimages-first.json",
      "bytes": 272,
      "sha256": "dea3bcad39c32db78f35f914292977a0435663d27f45ae804aeb841023150470"
    },
    {
      "name": "supabase-changelog.md",
      "bytes": 101535,
      "sha256": "ecbfee55a8959c49f4e63402fb4f802ed2f06272c53781ef427682e0c4d53610"
    },
    {
      "name": "tsc-final.exit",
      "bytes": 1,
      "sha256": "5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9"
    },
    {
      "name": "tsc-final.stderr",
      "bytes": 0,
      "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    },
    {
      "name": "tsc-final.stdout",
      "bytes": 0,
      "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    },
    {
      "name": "tsc-first.exit",
      "bytes": 1,
      "sha256": "d4735e3a265e16eee03f59718b9b5d03019c07d8b6c51f90da3a666eec13ab35"
    },
    {
      "name": "tsc-first.stderr",
      "bytes": 0,
      "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    },
    {
      "name": "tsc-first.stdout",
      "bytes": 185,
      "sha256": "2006ff7e3158ee4c229b2542745f6046300daa50bbd1b20e5cfddc27a47068c3"
    },
    {
      "name": "tsc-second.exit",
      "bytes": 1,
      "sha256": "5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9"
    },
    {
      "name": "tsc-second.stderr",
      "bytes": 0,
      "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    },
    {
      "name": "tsc-second.stdout",
      "bytes": 0,
      "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    },
    {
      "name": "tsconfig.focused.json",
      "bytes": 759,
      "sha256": "499d6c91092a34a29ab049d6c2fcea5df3fd925c076a89cad30222472f225aca"
    }
  ],
  "nativeCallbacksInvoked": 0,
  "backendCommandsInvoked": 0,
  "physicalNativeResult": "NATIVE_NOT_RUN"
}
```

## Final authenticated metadata refresh

Actual main stilld798;197refs, no new fullreceipt delta, both own refs still GET_MATCH e247. New calendar [6149872172](https://github.com/heke99/gridex-ops-platform/issues/766#issuecomment-6149872172) identifies a separate queued-send/calendar/classifier correction request, not a competing same-positive-join source writer. This packet neither fixes nor approves that scope; whole Z03 timing remains retained-owner qualification. Z13 [6149872726](https://github.com/heke99/gridex-ops-platform/issues/766#issuecomment-6149872726) is disjoint. Ref absence was not used to overtake either criterion. Fresh metadata artifact SHA256 `88c20c161342596508440f576bd9d05a27a688081b864a13f92c9d6c0f8b0b4e`.

Technical source remains byteidentical4386. Author is PAUSED; root requested two fresh other noncoauthor source reviewers before final source-only publication/handoff.
