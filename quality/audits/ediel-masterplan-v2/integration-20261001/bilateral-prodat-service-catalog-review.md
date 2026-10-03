# Bilateral PRODAT shared-catalog service-client review

Reviewed source snapshot: `0373d6d05dfad1e3eefd5121171dc5a22d58821c`.

The exact-head full-E2E smoke job `110243479995` failed the RBAC audit because `app/admin/ediel/bilateral-prodat-sources/page.tsx` was absent from the explicit reviewed-service-client set.

The page (Git blob `46f5a3e913675614909118c213b0634715294ab1`) first calls `requireAdminPageAccess` with communication.read, contracts.read and metering.read, then explicitly requires the server-derived company and all three current context permissions before any query. This explicit check applies even when the shared guard returns a platform-admin context. Points and enabled agreements use the cookie SSR client with company_id selected by the authenticated server context.

Its sole service query selects only id, guide_version and guide_revision from the shared PRODAT/electricity active-or-transition 26.A revision3 catalogue. It reads no tenant original, legal issuer or customer content and performs no write. Caller-supplied search parameters do not select company or catalogue authority. Selecting a catalogue entry does not qualify a bilateral source.

The shared guard (Git blob `2850dcc28d699c593a7acabd95bb986080998a37`) obtains the authenticated user and canonical database tenant context. The page and native domain gates remain unchanged. Ordinary permission resolvers can retain an existing platform-admin positive path; this review does not claim that every returned read permission necessarily comes from a company-bound user override. The native bilateral reviewer separately requires actual own membership and explicit company-bound review authority.

The implementation adds only this exact reviewed page to `reviewedServiceClientFiles`, with the above narrow reason. The rest of the audit, all runtime permissions, SSR queries and native source/reviewer/issuer gates are unchanged.

This is a concrete source review plus the observed failing audit receipt. The updated audit must still execute on its new exact commit; it is not native, HTTP, interactive-browser or whole-original-ID approval.

