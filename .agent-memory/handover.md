# Handover — durable received-source evidence, not full source approval

Use codex/e035-durable-source-ledger-20260922 and its live PR. Base/accepted main eb2b8693130af8fa7976a93891b95973bc473b50, tree effc5600a2f09e3e21329451b65c10b25f51aa40. PR369 accepted receipt5768848443 supersedes old pre-merge notes; do not redo it.

Read checkpoint.json and quality/audits/ediel-masterplan-v2/e035-source-ledger/native-verification-20260922.md. Genuine migration20260922095911_ediel_received_source_ledger.sql and repeated generated contracts come from native35713214457/artifact10688076866. Every delivered blob was hash-checked locally; old public schema has no removed/changed definitions and generated types add only3RPCs. The vendor-fixed local image17.6.1.155 resolves the actual denied-EXECUTE server crash without disabling hints, ACL or RLS. Hosted projects are not upgraded.

Before publication qualification:5514/337 tests,105newSQL+62+84oldSQL,3old upgrade and20native checks passed. Root types/lint exposed BigInt literal syntax and duplicate temporary output copies. Candidate uses exact BigInt constructors; all preparation/output files are excluded and all normal tooling stays enabled. Ordinary actual-head CI and independent review are still required. Native success is not a final CI certificate.

Retain the actual runtime12 outcome tests and their mutation evidence35708172952; all business ACK/persistence/ingestion outcomes remain compared, excluding only the intended diagnostic surfaces. No full source/object/party approval is implemented. Keep flags closed and continue those real owners before timelines/supersession/E61/E62. PR310 paused/untouched; fullE035/F3/masterplan incomplete; no live actions.
