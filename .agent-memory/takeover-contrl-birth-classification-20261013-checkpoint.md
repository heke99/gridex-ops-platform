# Fresh CONTRL birth classification — own helper checkpoint

Owner: retained ROOT/C3 `codex-takeover-C3-20261012`, delegated by ROOT/C1;
sole writer `/root/contrl_birth_classification_writer`. ROOT/C3 is paused for
exactly the creator and new test below. Prior completed helper remains paused.

Base `4e52854ecc19f0bd1266825cb114c19a3e983f27`, tree
`50de06f93e89fc698f06906bebfb49e1ac4b8516`; isolated branch
`codex/contrl-birth-classification-20261013`. Before writes the clean creator was
blob `8ae5df1d9907a7c90a37572cc226c16714ee063e`, SHA256
`3d582e8bff449bf657ec84574ddf5fcccf19a6b291f9923ab2a01d7f29154196`.

Authenticated helper readback matches new test resource `file-c8eac647…` to
neutral receipt `214ce31f1a500d6f890cdb33fc83d0f88da873d6`, retained creator
resource `file-cebbab…` to `ce0731382b942703ac09746c63e0065b6014b252`, and slot-C3
to `2255742ce5a41aa5968ace2d99baec3dcf40defd`. Neutral payload names this helper,
exact two files, original base/tree and paused owner. Full helper readback is
`/tmp/contrl-birth-helper-firstwrite-custody-readback.json`. Public CLAIM
[#766/6154130955](https://github.com/heke99/gridex-ops-platform/issues/766#issuecomment-6154130955)
and explicit ROOT first-write GO precede implementation.

Allowed writes: `lib/inbound-mail/inboundStatusUpdater.ts`,
`__tests__/ediel-contrl-canonical-birth-classification-root-20261013.test.ts`,
and this own checkpoint. No shared memory, frozen registers, ledger, SQL, other
tests/fixtures, private proposals, original collection, native/backend/GEN,
publication, push, PR, CI producer or release.

Plan [6153949444](https://github.com/heke99/gridex-ops-platform/issues/766#issuecomment-6153949444):
canonical UCI1 positive, UCI4 negative, missing/conflicting/unknown invalid;
coherent fresh insert status/processing/ACK fields and one processed event.
Invalid uses failed/manual_review, null ACK outcome and canonical failure reason.
Shared negative/ACK/event helpers, nonbirth diagnostics, legacy business
consumers, immutable source/reception and customer task guards remain unchanged.

Skills: isolated worktree, systematic debugging, TDD and verification before
completion; existing Supabase SDK ports only. No database feature/schema change,
Resend setup, UI, performance or broad audit. Reuse qualified cause
6153609861/6153738767; no duplicate extracted probe.

Implemented only within `createInboundEdielMessage`: one canonical CONTRL birth
classification governs fresh status/processing/ACK fields and the processed
event after observed first reception. UCI1 is received/accepted/positive/info;
UCI4 is failed/rejected/negative/warning. Missing, conflicting and unknown UCI
are failed/manual_review/rejected with null ACK outcome, canonical reason,
failed timestamp and no acknowledged timestamp. Unmatched positive/negative
retain manual review and null customer authority. Stored originals are never
backfilled; same-source and 23505 replay observe reception and equality before
return, with no duplicate processed event. Held/conflicting reception stops.

The meaningful RED ran on unchanged creator SHA256 `3d582e…`: new full-creator
20 cases gave 14 PASS/6 FAIL, exit 1. Failures are UCI4, missing/conflicting/7/9
and unmatched UCI4; the real parser/classifier already gave the expected
classification. Original RED `/tmp/contrl-birth-fullcreator-red.log`, SHA256
`76a38c859a6872d3ecdba0346e9b73166f87547e455685770cc2635de55718b4`.
Before the fix, 8 current regression files passed all 145 tests.

After the minimal fix, 10 files passed 182/182 tests: new full-creator 20,
retained regressions 145 and canonical ACK 17. The regressions include APERAK,
UTILTS, PRODAT physical birth, tenant/raw/source/receive-context/reception,
DSN and legacy late-ACK behavior. Full output is
`/tmp/contrl-birth-fullcreator-green-and-regressions.log`; no existing assertion,
fixture or timeout was rewritten. Node 22.23.3 and existing identical-lock
dependencies were reused. Only local test IPC used the network-enabled sandbox;
all Supabase tables/RPCs were declared finite IO ports, not a live backend.

Scoped ESLint on the two technical files passed, exit 0. Scoped TypeScript with
the project options and both technical roots plus their transitive imports
passed, exit 0; incremental output was disabled. Outputs/config are
`/tmp/contrl-birth-scoped-{lint,typecheck}.log` and
`/tmp/contrl-birth-scoped-tsconfig.json`. `git diff --check` passed.

Exact inverse verifies all 15,855 bytes before and 26,324 bytes after the creator
are unchanged, including shared negative/ACK/event helpers, exported predicate,
nonbirth diagnostics and legacy consumers. Report
`/tmp/contrl-birth-outside-creator-inverse.json`, SHA256
`96c821414059642a132c03a45e7f192b5914e7954ff2e6c81b1d96fe7b15af3e`.
Creator postimage SHA256
`e132c38dfd3ebe5744947d7c1c469f61457974b9aa4a5248bb2c6b823caee46c`;
new test SHA256
`6a20733882bb9f1e2f5d9ed79ad966736d6b41818372edbdb1caca9e093aa160`.
Ledger blob `0d8965aed23e768886fba0074b19b2abd3fd5d67` and frozen requirements
are unchanged. No ledger credit, native/backend/GEN run or source publication.

Remaining limits: SDK persistence/reception responses are declared IO ports;
SQL triggers, immutable admission, actual mailbox/native/SMTP and legal authority
are not executed by this component test. Old shared/legacy UCI7 interpretation
is deliberately preserved under the bounded owner ruling. No urgent-task claim,
customer authority invention, stored-history repair or whole SC037/ACK01/H101
approval. The old held birth test/private proposals remain unread/unmodified.

Next: freeze the exact local source and obtain two OTHER independent source
finals, then hand the exact two technical postimages to ROOT under the retained
custody. ROOT decides any selective receiving/publication; this helper remains
paused after handoff. Shared memory and other agents' files remain untouched.
