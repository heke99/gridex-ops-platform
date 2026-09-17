# Active work plan — 2026-09-17

1. Active: finish F1-C calendar/immutability correction through exact-head CI and
   review, then merge. Source tests pass; completion awaits that real CI.
2. Reconcile/supersede stale319 without importing generic APERAK16-B assertions.
3. Next independent F3 item: reconcile CCI/CAV fields and exact value components
   against the immutable source field register; reproduce before fixing, follow
   callers and consumers, retain golden/negative cases and run complete CI.
4. Continue remaining independent F1–F6 acceptance work with bounded named tasks.

Do not label an entire phase finished from a small regression suite. Source/TGT,
real rights and release proofs stay separate. PR310 is PAUSED and can only resume
on explicit instruction using its existing saved recovery checkpoint.
