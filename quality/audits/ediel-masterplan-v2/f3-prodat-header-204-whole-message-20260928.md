# F3 PRODAT header 204: bounded whole-message rejection

## Source and ownership

P26.A r3 §2.2 p.16 (`permission-ack-source-20260920/original-relevant-pages.txt`) marks BGM/1225 field 204 optional for all PRODAT codes. If supplied, `9` means original and `5` replacement. P-APERAK 16.B p.90 defines BGM/1225 `27` for an exceptional whole-message rejection and `34` for a processed message; pp.91–103 describe ERC42, field reference and original BGM correlation. This is the existing P-17/ACK-02/ACK-10 header and final response boundary. The frozen register and source are unchanged.

## Reproduced defect and bounded correction

A complete Z04 with two objects, valid own quantities and `BGM+Z04+D+7+AB` already produced canonical header field 204/ERC42, but the actual inbound consumer continued to actor, facility, case and business adapters; the response had BGM34. The shared physical-header qualification now recognizes invalid supplied 204, requires the same typed source evidence in the response and routes the early rejection before those adapters. A caller-created field error, foreign UNH evidence or positive response cannot claim the exception. Missing 204 and supplied `9`/`5` stay valid.

Local focused consumer tests: 150/150 in five files; source ACK script 64/64; app, tests and scripts TypeScript checks pass; scoped ESLint has no errors (one pre-existing unused variable warning in the inbound file). The new native Z04 variant uses an isolated tenant and legal actor, persisted route/profile, ACK/outbox, zero case/switch/supply rows and identical retry. Native replay, exact-head CI, schema/type parity, final diff review and merge remain pending at this checkpoint.

This is partial implementation and local verification for ACK-02/ACK-10 and their acceptance contracts, not formal acceptance of either whole contract or F3. Field 203/IDE505 historical uniqueness, positive LOC+175, E035 history/retention, full grammar and later phase gates remain open. No staging, TGT/AGT, counterparty or live Ediel traffic is authorized by this change; market activation stays held.
