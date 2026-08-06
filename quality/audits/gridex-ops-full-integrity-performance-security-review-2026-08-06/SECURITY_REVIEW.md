# Security review

## Confirmed strengths

- RLS enabled on every public table.
- No table grant to `anon`/`authenticated` without RLS.
- No `SECURITY DEFINER` executable by `anon`.
- Authenticated definers have pinned `search_path`; reviewed helpers enforce active identity/company state.
- Latest dev/main remediation separates platform-global operational reads from tenant administration.
- Edge Function `auto-delete-old-users` has JWT verification enabled.
- Current-tree search found no JWT-like literal beginning with a common HS256 prefix; service-role references were environment-variable usages rather than proven literals.

## Confirmed security/privacy findings

1. Cross-tenant `customer-documents` storage access/write (`GRIDEX-AUD-001`).
2. OTP validity window of 24 hours (`GRIDEX-AUD-005`).
3. Unprotected `main` and incomplete required checks (`GRIDEX-AUD-004`, `007`).
4. Auth/platform logs contain user IDs, names, email addresses and IP addresses; database logs can include full SQL (`GRIDEX-AUD-009`).
5. Migration provenance is incomplete, increasing unsafe deployment/recovery risk (`GRIDEX-AUD-003`).

## Threat surfaces reviewed

- tenant/user/role switching and inactive state;
- API clients, bearer keys, tenant references and idempotency;
- customer/contract/application/document direct-object references;
- service-role server modules and workers;
- storage buckets and signed/object paths;
- cron/webhooks/replay/signature handling;
- SQL/RPC/security-definer/search-path/grants;
- logs, audit data and request identifiers;
- OpenAPI/internal-field exposure and error envelopes;
- dependency/CI/supply-chain controls.

## Not verified

- Full Git history and fork secret scan.
- Vercel environment variables and token scopes.
- GitHub Actions token permissions/organization policy beyond repository workflow content.
- Branch protection rules for non-main release branches.
- External webhook signature/replay E2E.
- File upload malware/content-type/size scanning across all paths.
- Production CORS, CSP, HSTS, frame, referrer and permissions headers.
- Production rate limits and abuse controls.
- MFA/leaked-password production settings.
- Production storage policies/database schema.

## Required security release gates

- Protected `main`; required exact-head checks; no direct push.
- SAST, dependency audit, current-tree and history secret scans.
- Two-tenant database/API/storage/browser suites.
- API key rotation/revocation and webhook replay tests.
- Content/size/path validation for document uploads.
- Log redaction, retention and restricted access evidence.
- Non-production migration replay and production post-deploy authorization tests.