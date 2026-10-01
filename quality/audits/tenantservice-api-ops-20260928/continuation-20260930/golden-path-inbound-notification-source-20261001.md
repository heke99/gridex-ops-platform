# Golden-path inbound notification source gate, 2026-10-01

## Outcome and scope

The first VERIFY failure was a stale source-location predicate. The legacy inbound owner now awaits the atomic adapter; it no longer contains the old direct enqueue name. The corrected gate follows the current facade → legacy owner → awaited atomic adapter → canonical public RPC → private migration-owned lifecycle transition → required queued notification job → canonical worker branch.

The assertion text is preserved exactly: `Ediel business outcomes enqueue lifecycle notifications behind the canonical inbound facade`. Its public-facade gate remains in place. No application, RPC implementation, migration, generated schema, workflow, permission, memory or provider behavior is changed by this four-file packet.

This is a source-regression correction. It is not SQL execution, native acceptance, an Auth/tenant exercise, provider delivery, or closure of an original T/U/P requirement. The full golden-path command passing below proves its source checks can reach their terminal marker locally; it does not promote all masterpoints to verified.

## Authentic failure and source comparison

The independently supplied CI receipt identifies run `36843544066`, job `110308120669`, checkout `4b699b7db45b8a4098e7da7e0ed122b8ea80b113` at `09:34:02.2595402Z`, and the first failure at `09:35:30.5648260Z`. The job wrapper invokes `scripts/gridex-customer-application-continuation-regression.cjs`; its failed constant is the assertion above.

The isolated correction checkout is `0778df202b8b46d4ae92a51ffcc24cc25176edaa`, tree `61964676807b680d8133496c4b9cd6bd68cc444a`. The previous predicate evaluates `facade.includes('applyLegacyInboundBusinessStateMachine') = true`, `legacy.includes('enqueueCustomerLifecycleNotification') = false`, and therefore rejects the current chain. Adding the obsolete name in a comment incorrectly rescues broken chains.

The actual public schema wrapper is identical in the earlier `0cf30cce687f7dfc76094fe51201ca14ab0a117c` schema and the current authentic schema. The earlier schema SHA256 is `f467e8d8ccd1e88f74c4909875faaebf90fc6d3da19d978e0febfdb6688aef10` (6,042,365 bytes); current schema SHA256 is `ac510feadf9cd4b7cc5009e92f92b54c5ea5209732c426a83558859b8cdfd39a` (6,058,507 bytes). The wrapper body SHA256 is `cbdd544d8d8bf4c2b43e96ddc2d0cbdf55e4b9c791f59da7e3a7505098a37abf`. Private implementation bodies are correctly inspected in their owned migrations rather than invented in the public schema.

## What the gate qualifies

The helper uses the existing TypeScript parser to inspect active imports, named exported functions, actual awaited calls, the exact accepted/rejected boolean branch, source/actor arguments, RPC error propagation and the returned atomic receipt. The worker check binds the actual job case to the awaited canonical dispatcher and stored company/customer arguments. It does not execute these production modules.

For SQL, the helper extracts the unique named function bodies, strips comments while retaining quoted literals, and tokenizes whitespace independently. It verifies the public wrapper's private delegation; accepted/rejected event/template derivation; the non-ignored required lifecycle call; independent template validation; the existing fresh/replay branch's queued `dispatch_lifecycle_notification` INSERT and stored returned job ID; and absence of exception swallowing in these required-intent owners. A comment containing an INSERT does not count as persistence.

These are bounded structural checks of the active owners and finite mutations. They are not a general SQL parser, proof of arbitrary future control flow, live catalog-patch qualification, queue transaction execution, or full inbound-outcome coverage. Supply activation has its separate atomic welcome owner; unmatched/customer-information review corridors remain separately qualified work.

| Active source | SHA256 |
| --- | --- |
| `lib/ediel/flows/inboundBusinessStateMachine.ts` | `1293776d8a5db37ae218519d24eb31de9b3a4a5f94ce99250c15d5dc5af66295` |
| `lib/ediel/flows/inboundBusinessStateMachineLegacy.ts` | `968d6e76c9e65007de2327d6f05e111a695740cdb302ee1786efe6bd35515c48` |
| `lib/ediel/flows/inboundSwitchLifecycleAtomic.ts` | `d434b003ef0907f905d1f4d429fb20f1cbd4ff0e72f059dd7e4dee6c84c4fed2` |
| `supabase/migrations/20261001000738_inbound_switch_lifecycle_required_intent_atomic.sql` | `5c309521fe72ebd7da57b4e2ea0bdb1b6b07e1a1a6a7aafc336cd8ae10eb3e90` |
| `supabase/migrations/20260930230204_customer_operation_lifecycle_intent_atomic.sql` | `bb067ddf9b4756182b73ace766d3657408defcbb1e17d72e86cb6043600a45bb` |

## Genuine RED and final gates

The unchanged historical child, SHA256 `3a25fb660a7051f21e133ba6c2db5d7f2d105eaedc3019bb8b02231309ad688e`, was retained privately and run directly against this checkout. It exits 1 with only the unchanged notification assertion failing. Private log SHA256: `4849640d35eb911041a132429c17fe6fee1d3d09d787360aadea97e13d0b212d`.

Before implementation, the actual child executed through a controlled read-only filesystem/process boundary reproduced 26 genuine assertion failures: two valid current/formatting controls wrongly rejected, and 24 broken active chains wrongly accepted when supplied the obsolete-comment bait. The first exploratory run had one nonunique adapter mutation; it was corrected and the entire 26-case baseline rerun before implementation. The setup-failure run is excluded. Corrected genuine RED log SHA256: `da1d7857461068be3ba110f33a8ce1f65cbe576b40c168c067691d583cd297c3`.

Further test-first control-flow review reproduced four genuine failures (missing accepted branch, swallowed inbound fault, optional false job write, wrong worker company), then an independent inverted-branch failure. The initial four-case exploratory run had one nonunique branch mutation; that run is excluded and all four were rerun genuinely before their correction. Four-case RED log SHA256: `267e1f0127e1f16e242749e98e8ce5c735a76161f6c2aa85afcc15b27c80b467`; inverted-branch RED log SHA256: `1d053a0fbe1bdf1093912bc089be7289085dc9a1e9674c18566d0145284245f5`.

The final suite contains **35 distinct cases: 2 positive controls and 33 mutations**. All original business assertions remain; four additional argument mutations directly exercise source/actor binding validators. Tests execute the real child gate and helper; only read-only source inputs and `process.exit` are controlled. They do not mock a PASS result or invoke application/SQL/Auth/provider owners.

| Final local gate | Actual outcome and UTC interval |
| --- | --- |
| Node22 mutation suite | 35/35 PASS, no skip/todo/cancel; `2026-10-01T10:09:30.375633Z`–`10:09:48.250985Z`; TAP duration 17,738.125509 ms |
| Full remaining-masterpoints golden-path wrapper | exit 0, terminal `GRIDEX REMAINING MASTERPOINTS GOLDEN PATH: PASS`; `10:09:48.251196Z`–`10:09:54.857392Z` |
| `node --check` on all three CJS files | 3/3 exit 0; `10:09:54.857749Z`–`10:09:55.218696Z` |
| Scoped `git diff --check` | exit 0 at `10:09:55.227379Z` |

The clock comes from `datetime.now(timezone.utc)` before/after the actual subprocesses, not a local Vitest/TAP clock. The three source hashes matched before and after all final gates. CJS files are excluded by the repository ESLint configuration; no ESLint coverage is claimed for these files.

Final private mutation log SHA256: `0f8520602606245df9959081347e097d99874abbcc93ddb4def889026d107f32`. Final private parent log SHA256: `2c09fc671e7322c39b4303da2491673e4050af2e282cfb90946db3b554ed82b7`. Detailed UTC/hash receipt is retained outside the repository as `golden-chain-final-gate-receipt-20261001.json`.

Reproduce from the repository using the installed Node22 binary (ordinary `node` is appropriate only when its version is 22):

```sh
NODE_OPTIONS=--max-old-space-size=1536 /tmp/ediel-toolchain/node_modules/node/bin/node --test scripts/customer-application-inbound-notification-source-20261001.test.cjs
NODE_OPTIONS=--max-old-space-size=1536 /tmp/ediel-toolchain/node_modules/node/bin/node scripts/gridex-remaining-masterpoints-golden-path-regression.cjs
```

## Four-file packet

| Owned file | SHA256 | Git blob | Bytes |
| --- | --- | --- | ---: |
| `scripts/gridex-customer-application-continuation-regression.cjs` | `140236b91f635035350536168b36f213898b1299a7b930c76d4fc7aa26ed4bc3` | `eceb4ca4273a76ffd8c020920a7f85bea2b72808` | 10036 |
| `scripts/lib/customer-application-inbound-notification-source-20261001.cjs` | `70f8583a7022a7a70a375063319a7b855e0f777718e8e7f861448a5e3842dd49` | `7b7b18246682769a5463e0ffce948765b4878079` | 12767 |
| `scripts/customer-application-inbound-notification-source-20261001.test.cjs` | `78b81506ca1b752c233ed929ecca23cd9d17f43fa0ee3fdece91b2be11b94e25` | `70f3feb1058b33d235a33f9dc06a7d2232b317d0` | 12166 |
| This unique report | Included by exact SHA/blob/bytes in the external four-file manifest; no self-referential report hash | — | — |

Independent rerun/publication remain root-owned. All original 75 rows, whole OPS action denominator, real SQL/native/browser/provider qualification and downstream pipeline acceptance retain their prior explicit status; this packet does not close them.
