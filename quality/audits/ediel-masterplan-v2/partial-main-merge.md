# Independent Ediel delivery from main

User requested merging independently deliverable work while deferring the database blocker. This branch starts at main eb9a25bc989c6de808903f41c2314d5465e9c07b. It copies the bounded Ediel protocol/UTILTS/DSN/SMTP implementation, six regression files and immutable specification from continuation 8c943b61b5d329045a7d1eec00bec002e406e337. PR310 ancestry, migrations, schema snapshot, generated types and replay machinery are excluded.

Main already contains the required inbound email columns, unrestricted match_status, outbox attempt fencing and delivery_uncertain status. Changed runtime paths are byte-identical to the reviewed continuation. The two unrelated PR310 Ediel changes (inboundRequestAutomation and testRunTransportMetadata) are not dependencies of this patch.

Fresh isolated verification: Node22 full Vitest 201 files / 1216 tests PASS; application TypeScript PASS; tests TypeScript PASS; immutable 33-file manifest, 121 rules and 231 acceptance contracts PASS; service-role ratchet 2399 <= 2402 PASS. Node24 full suite also passed. Independent scoped review found no missing database, runtime import or PR310 dependency.

These are local code/fixture checks, not live delivery or full masterplan certification. Existing main CI/staging failures and PR310 native replay/schema/type work are not resolved by this extraction. No database changes or external market messages were made. Original context/protocol/transport evidence retains its historical scope; the coverage register is not full implementation acceptance.
