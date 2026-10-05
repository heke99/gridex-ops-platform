# IMP04 minimum source carry

**APPROVE_IMP04_SOURCE_CARRY** for SC055#5580f8e36d9, SC021#5525f7a2d83 and SC022#55457873898 against actual maincf395da8.

Only three production files change ebd→cf: testing/selftest.ts corrects simulated PRODAT/UTILTS UNT counts and exports builders; utilts.ts changes only outbound UTILTS draft absent sender/receiver subaddresses from invented UTILTS to null; inbound-mail/smokeTests.ts exports sampleParseTests and corrects a static PRODAT UNT7→6. Existing SQL/native fixture/config/generated/capture inputs remain unchanged.

SC055 directly processes an existing EDIFACT ACK through actual qualifier/protected reads/current writers/own case transition. It invokes no changed draft/simulation/smoke function. SC021 processes actual Z14 denial into prescribed CONTRL/APERAK; generic imports may reach utilts.ts, but this PRODAT/ACK path does not invoke its changed outbound UTILTS builder. SC022 plans/registers/reads source expectations and creates/reads operator overdue tasks, with no draft/simulation/smoke invocation. The21 selected direct caller/source/writer/harness paths were each verified byte-identical to507 andebd; unchanged parser/validator behavior is retained.

Each candidate still differs from507 by precisely three owned paths and only its own PASSED scenario row. Committed checkpoints retain earlier independent whole approval and finite ports. SC022 acceptance/SMTP/source/positive ACK authority are declared finite inputs, not new native/live authority; prior whole four-case approval is preserved. No new whole review, behavior/native/full/capture or workflow execution is performed.

Root owns current head/main, exact merge-tree/source/ledger preservation, current gates and merge. After558, its independent test/checkpoint/SC055 row alone does not change SC021 consumers; preserve actual main and add only SC021. No owner source/tests/coverage/shared memory edited.

Machine receipt SHA256 `fdf8b090e35067e63903d0dd8e26d4864d140e0e9917422405db24ce5346baf6`.
