# Published CI correction: actual 0778 outcome, 2026-10-01

Source #422 head `0778df202b8b46d4ae92a51ffcc24cc25176edaa`, tree `61964676807b680d8133496c4b9cd6bd68cc444a`; actual Actions checkout `4b699b7db45b8a4098e7da7e0ed122b8ea80b113` has that same tree and parents pinned `ae56ee0a1e0e8adbce9d5f4d92da75cdcb8010c8` plus published0778. Root published non-force over0cf to existing draft422; main and pinned418 stayed unchanged. No main/production/provider/customer/key/market/#310/#421 action.

OPS run36843544066 completedFAIL09:41:50Z. All four job checkouts were actually observed. Terminal safe receipt SHA256 `0e3ec1675d09a7aabdf07f9638f8735d7e9fce2841f2a4049a6a60d361e120e4`; it supersedes the earlier incorrectly grouped receipt. No raw private log, command error text or artifact locator is persisted here.

| Actual job | Terminal outcome | Evidence |
| --- | --- | --- |
| quality-release-gates110308120086 | PASS09:41:50Z | 7624/527 ordinary unit tests; full build passed |
| upgrade-backup-restore110308120446 | PASS09:41:08Z | current restore09:36:58.7644528Z; pinned-old rollback ALL_PASS09:39:12.9559695Z; fresh-old backfill8/8 PASS09:41:03.8922258Z |
| clean-migration-replay110308120604 | FAIL09:38:06Z | corrected manual-mail6PASS, then later sourcebinding3 afterEach FAIL, stage lifecycle_cleanup_companies/P0001 |
| verify110308120669 | FAIL09:35:32Z | customer-application continuation gate still demands enqueueCustomerLifecycleNotification inside legacy TS source family |

Corrected pinned-old low-role denial passed09:38:51.7448227Z; unchanged current command/replay/revoked-permission passed09:38:51.7449231Z; post-proof no persisted effects passed09:38:53.7581759Z. These are genuine native outcomes for the correction, not the earlier local pure oracle.

Native suites before the first lifecycle cleanup failure: manual-mail6, webhook6, residual queues14, provider/customer queues10, Ediel resume7, contract authority1 and operation lifecycle atomic5 all terminalPASS. Manual-mail six individual business/rollback/concurrency markers and full6 summary were observed. Controlled EmailProvider.sendEmail does not prove real physical provider delivery.

Sourcebinding3 had real body checkpoints at09:37:41.4551240Z,09:37:42.2835151Z,09:37:43.1267064Z, respectively. Each terminal test still failed in afterEach. The first checkpoint proves its declared durable decision/title replay/quiet tenant assertions; the second its concurrent cancelled replay; the third its late statement rollback with legacy whole-graph atomicity explicitly false. No terminalPASS, Auth/permission qualification or whole-graph atomicity is inferred. Raw primary P0001 identity is NOT_AVAILABLE in retained artifacts; local source reproduction is required before a fix. Later agreement/native/source-owner/address/inbound/support/OPS/notes/billing/browser steps were NOT_REACHED.

Clean artifact11152512775 (four ZIP members: three generated outputs and one private log), ZIP SHA256 `7172caa152d967ec577798771d1e4882c4e6490022c4ac48a28d7dc0f7f105f9`, genuine CLI2.101.0. Three actual generated files are BYTE IDENTICAL to tracked31: types `818eb0348504188591c5a9e6b56d478da6460e627c9c5feeef60a10b7b53aa76`, schema `ac510feadf9cd4b7cc5009e92f92b54c5ea5209732c426a83558859b8cdfd39a`, fingerprint file `b3794be13195176a55ee9b6b2c320bc7e200b0568cd20e425c4891d178660c2a`; semantic fingerprint `0613283535f1749839eac5545ef4c0afbb0781ba214f9c2abf1db8c7bbc1c08d`,13 categories. Latest actual applied forward remains20261001050658_inbound_switch_current_legal_transport_binding.sql. No generated hand edit or new SQL in this correction wave.

FullE2E run36843544076 terminalSUCCESS09:37:26Z means smoke/coverage/PR certificate PASS; full tests, real-customer staging, runtime staging and nightly certificate were SKIPPED. It does not prove those skipped corridors. Tenant, Ediel and public browser workflow success are separately observed.

Next exact action: qualify the stale TS-location golden gate against the actual required atomic notification chain, and reproduce/fix sourcebinding cleanup with preserved production legal immutability. Future account and purchase work remains separately isolated at exact0778 and explicitly RECONSTRUCTED; lost unpublished source was not recovered. Genuine CLI2.101.0 allocated20261001094820 and20261001094830, no hosted/project application. Root remains sole index/freezer/non-force publisher. All75 original T01–T55/U01–U20 plus P0–P8 remain OPEN.
