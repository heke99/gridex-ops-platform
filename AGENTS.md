<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Cursor Cloud specific instructions

### Architecture

Single Next.js 16 app (App Router) + Supabase (PostgreSQL, Auth, Storage). No monorepo, no Docker Compose, no separate microservices. Deployed on Vercel in production.

### Starting Services

1. **Docker daemon** must be running first: `sudo dockerd &` (wait ~10s for startup)
2. **Supabase local stack**: `npx supabase start` — provides PostgreSQL, Auth, Storage, Realtime, Studio at `http://127.0.0.1:54321`
3. **Next.js dev server**: `npm run dev` — runs on port 3000

### Environment Variables

Create `.env.local` with Supabase credentials from `npx supabase status -o env`:
- `NEXT_PUBLIC_SUPABASE_URL` → API_URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` → ANON_KEY
- `SUPABASE_SERVICE_ROLE_KEY` → SERVICE_ROLE_KEY

### Key Commands

| Task | Command |
|------|---------|
| Dev server | `npm run dev` |
| Lint | `npm run lint` (ESLint, 0 errors expected) |
| Build | `npm run build` |
| Supabase start | `npx supabase start` |
| Supabase status | `npx supabase status` |

### Known Gotchas

- **Migration ordering**: The `supabase/migrations/` directory has files with `20260501*` prefixes (reconciliation scripts) that must run BEFORE the date-based migrations. The `config.toml` currently has `[db.migrations] enabled = false` because migrations require manual ordering. After `supabase start`, apply them via `docker exec -i supabase_db_gridex-ops-platform psql -U postgres -d postgres < migration_file.sql`.
- **admin_users table**: Referenced in some SQL functions/views but never created in migrations. Some reconciliation scripts (`db2b`, `db3`) will emit errors about this table — these are non-blocking for app functionality.
- **Test user creation**: Use Supabase Auth API directly: `curl -X POST 'http://127.0.0.1:54321/auth/v1/signup' -H 'apikey: <ANON_KEY>' -H 'Content-Type: application/json' -d '{"email":"...","password":"..."}'`
- **Docker in this environment**: Requires `fuse-overlayfs` storage driver and `iptables-legacy`. The Docker socket needs `chmod 666 /var/run/docker.sock` after daemon start.
