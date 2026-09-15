# Skill routing — Ediel masterplan v2

Task scope: implement supplied Ediel specification on top of PR310, preserving the ongoing replay work.

Activated: using-superpowers (routing); writing-plans/executing-plans (ordered repair batches); spec-to-code-compliance (independent bounded call-chain audits); dispatching-parallel-agents (separate protocol, inbound transport, and UTILTS/context domains); quality-playbook (reuse existing quality contracts; no replacement audit framework); systematic-debugging/TDD (reproduce confirmed divergences); fp-check/code-review (refute findings against callers and specification); Supabase (read-only live catalog); requesting-code-review and verification-before-completion (review and actual test evidence).

Conditional: forward-migration/PostgreSQL, tenant threat model, property-based tests and variant analysis when expanding those specific changes; Next.js guides/UI/performance skills only if rendering or measured performance changes.

Not activated for this bounded first repair batch: brainstorming (user supplied precise behavior); worktrees (fresh isolated clone/branch); install-hooks (not requested); writing-skills (no skill changes); UI/accessibility/React optimization (no UI edits); supply-chain remediation (no package changes); SQL optimization (no measured bottleneck). Existing dependency lockfile retained. Full repository security scanning, CodeQL/Semgrep, formal syntax certification and the entire 231-contract E2E suite are not represented as completed by these targeted checks.

Original package hashes are preserved. Source data remains documentation, never imported as runtime authority. Catalog observations do not prove RLS policy behavior.
