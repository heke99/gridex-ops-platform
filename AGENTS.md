<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Cursor Cloud specific instructions

Multi-repo workspace root: `/agent/repos/`. This app lives at `/agent/repos/gridex-ops-platform`.

- **Install:** `npm install` in this directory.
- **Env:** `.env.local` needs Supabase public URL/anon key and `SUPABASE_SERVICE_ROLE_KEY` for real auth/admin flows. `lib/env/supabasePublic.ts` supplies build-time placeholders during `next build` if vars are missing.
- **Local Supabase:** `supabase/config.toml` present; use `supabase start` when Docker/CLI are available.
- **Dev:** `npm run dev`. Use `PORT` when running multiple Next apps.
- **Checks:** `npm run lint` (warnings only at setup), `npm run typecheck`, `npm run ediel:rule-regression`, `npm run security:rbac` (RBAC audit may fail until admin routes are reviewed—pre-existing). `npm run build` succeeds with placeholder public Supabase env.
- **Tests:** No Jest/Playwright `test` script; use the `scripts/*` npm targets above.
