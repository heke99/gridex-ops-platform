# UTILTS NAD SVK identity shape (bounded UG-122-24)

Skill routing: project spec-to-code compliance, systematic debugging, TDD, code-review and verification-before-completion govern source trace, RED/GREEN, diff and final evidence. Supabase/Postgres guidance applies only to the unchanged native DB owner; Vercel deployment guidance applies after merge. UI, performance and agent delegation are not triggered by this field guard; no parallel code author.

Source: U 25-A-3 annex 1 p.122, annex C UG-122-24. If SG2/NAD/C082/1131 is SVK, 3039 is a five-digit Ediel ID. The independent 3055=9/305 GS1 check-digit branch is **not** implemented or accepted by this receipt. Field 207 is NAD+MS, 208 NAD+MR.

Code owner: `applyUtiltsHeaderGuide` in `lib/ediel/utiltsEngine.ts`, following the canonical effective-date selection. The existing incoming processor `processInboundUtiltsMessage` supplies tenant/company and actor context to the existing `gridex_persist_utilts_consumption_v1` owner; `ediel_ack_transaction_results` stores a guide-rejected IDE, and canonical ACK emits field208 negative APERAK. No new actor or tenant scope, DB migration, outbound sender or transport gate is introduced.

RED: a complete E66 with actual E19 and a six-digit/letter SVK party ID returned UTILTS_ERR instead of guide rejection. GREEN: both MS and MR reject malformed values at their own field/ERC42; missing MS is ERC41; original five-digit parties still reach E19. The real processor mock checks persisted RPC disposition, ACK draft and zero meter/billing/completion. Native clean-replay test checks tenant-bound row, no series and no consumption on the actual processor; CI execution pending. This is not a claim that an identity shape confers a legal actor mandate or that the GS1 profile is complete.

Status: specified, implemented, locally tested. Exact-head native/ordinary CI, review, merge and same-SHA deployment pending. Ediel market traffic remains unactivated. Field203 temporal identity/ERC42, positive LOC+175 owner, E035 historical `complete:false` and retention/deletion, remaining F3C and whole F0–F7 gates remain open. PR310 paused.
