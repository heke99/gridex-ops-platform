# Elklart demo continuation

Goal: continue PR1048 with a supply-aware portfolio reading the ordinary OPS data, keeping prepared examples separate.

Architecture: server-rendered, authenticated demo route. A server-only fixture manifest binds the five example profiles to exact customer and metering-point IDs. Read through the user's RLS client and explicit company filters. The existing prepared purchase profile remains a demo assumption. No writes to Ediel, billing or production.

Skill routing: using-superpowers, writing-plans/executing-plans, test-driven-development, Supabase, verification-before-completion. Requesting-code-review for two independent final readers. Browser test the rendered page. Skip broad audit, performance, AWS, AI, email and schema generation: no such changes. Conditional deployment skills if dedicated environments become available.

- [x] Test supply-aware interval calculation: actual versus planned start, exclusive end, DST, corrected current readings, missing readings, overlapping rows, tenant/customer binding.
- [x] Implement bounded RLS loader and validated exact-ID manifest; never fall back to examples on an operational failure.
- [x] Add separately labelled OPS-data page with date, area, interval drill-down, ordinary customer links, day energy totals and data refresh timestamps.
- [x] Verify targeted tests, TypeScript, lint and browser rendering; two independent reviews; record unresolved infrastructure gates.

Infrastructure inventory: OPS main f23c1dc0c, source PR1048 head266537758; portal PR66 head8069791. No dedicated demo project found among either relevant Supabase account's projects or Vercel project search 'demo'. Existing staging is not assumed disposable. Full provisioning, fixture intake, test recipients, reset snapshot and two actual end-to-end rehearsals require identified isolated deployments. Ask for existing projects while continuing implementation. Do not claim the synthetic or adapter tests certify these external flows.
