# Bounded UTILTS header 509 role code list

Source: U annex 1 p.123, C UG-123-5. Supplied SG2/NAD/3035 subordinate role is one of DDK, DDQ, DDX, DEA, DEC, DER, DGG, DGI, EZ, MDR, PQ. DGG is only applicable to traffic with an ancillary-service supplier; this validator merely recognizes the code and confers no actor mandate or capability. It does not decide which role is required by a specific message/tenant profile.

Owner/path: `applyUtiltsHeaderGuide` in `lib/ediel/utiltsEngine.ts` checks supplied header NAD before any IDE functional pass; it does not inspect transaction SG5 NAD. `processInboundUtiltsMessage` consumes the canonical decision; the unchanged tenant-bound `gridex_persist_utilts_consumption_v1` persists each IDE disposition in `ediel_ack_transaction_results`, and canonical ACK projects field509 negative APERAK. The native test uses a synthetic tenant and local database, not a live legal mandate, route or market send.

RED: complete E66 with real E19 and `NAD+BAD` returned UTILTS_ERR. GREEN: field509/ERC42 negative APERAK before E19, all eleven listed supplied codes do not generate field509, actual processor mock asserts RPC/disposition/ACK and no meter/billing/completion. Native clean-replay case asserts tenant-bound stored rejection and zero series/consumption; CI pending. Missing role, required role by profile, temporal document identity, actor entitlement, GS1 check digits and positive LOC+175 are **not** accepted here.

Status: specified, implemented and locally tested (25 UTILTS suites 298/298, app/test/script types and scoped lint); native, ordinary exact-head CI, review, merge and deployment pending. Ediel market traffic disabled. E035 historical `complete:false` and retention/deletion, F3C-02/04/05/06/07 whole closure and all other phase gates remain open. PR310 untouched.

Skill routing: project spec-to-code, systematic debugging, TDD, code review and verification-before-completion for source/RED/consumer/CI; Supabase/Postgres only for unchanged native owner, Vercel deployment after merge. UI, performance and agent delegation are not implicated.
