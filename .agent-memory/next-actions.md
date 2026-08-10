# Next actions

Updated: 2026-08-10

1. Restore this source on the real Git repository and record the checked 40-character HEAD in `.agent-memory/checkpoint.json` only on that same commit.
2. Run the required GitHub workflow, including clean empty-database replay, and retain its artifacts.
3. Verify staging and production Supabase parity before applying any forward migrations there.
4. Enable Supabase Auth leaked-password protection if password login is enabled.
5. Deploy the exact verified commit, prove Git/CI/Vercel SHA equality, then run tenant smoke/isolation/webhook checks.
6. Capture production p50/p95/p99 with DB, compute and external-dependency timings.
7. Change campaign status to `COMPLETE` only when every item above has evidence.
