# Client performance

## Verdict

Client performance is `NOT_VERIFIED` at browser/runtime level. No production bundle report, Lighthouse trace, React profiler, RUM, route waterfall or Core Web Vitals dataset was available. No performance improvement is claimed.

## Source-level observations

| Flow/page | Problem/risk | Evidence | User impact | Priority | Recommended change | Measurement |
|---|---|---|---|---|---|---|
| Website application | Very large orchestration behind customer signup | Historical exact audit measured `lib/website/customerApplications.ts` above 8,400 lines; current path remains central | High change and regression risk; not proof of browser latency | Medium | Characterization tests, then split identity/pricing/legal/persistence/side effects one unit at a time | Server spans, query count, application p95 and failure rate |
| Customer portal bundle/sync | Large route sources and potentially broad payloads | Route source files ~14 KB each; actual response bytes unavailable | Possible slow first load and waterfalls | Medium | Measure resource-level payload and compare bundle endpoint versus parallel scoped fetches | HAR, response size, TTFB, query count |
| Website public contracts/quote | Large route sources | ~13 KB and ~12 KB route source files | Possible server complexity, not bundle proof | Medium | Profile dominant calls; avoid moving server logic client-side | Route p50/p95, trace, output bytes |
| Auth/session | Burst-like `/user` requests | Auth logs show many requests within seconds from server addresses | Extra latency, log volume and auth load | Medium/likely | Trace session resolution per render/request and deduplicate safe calls | Auth calls/navigation, cache scope, request waterfall |
| Admin tables | Potential excessive rows/rendering | Broad admin surface; no browser trace | Possible INP/memory issue | Unverified | Cursor pagination, virtualization only after measurement | React profiler, INP, heap, DOM nodes |
| Static/dynamic rendering | Cookies/session can force dynamic routes | Next.js App Router/auth architecture | Possible loss of caching | Unverified | Inventory dynamic functions and explicitly set cache policy | Build route output, cache headers, request traces |

## Required browser matrix

Roles: unauthenticated, customer, company admin, operations, read-only, platform admin. Test landing/login, website contracts/quote/application, customer portal, admin dashboards, network owners, contracts and large tables.

Record:

- route JavaScript and CSS bytes;
- LCP, INP and CLS;
- server TTFB and API waterfalls;
- serialized server-component payload size;
- hydration/main-thread long tasks;
- fetch count, duplicate auth/permission calls and response bytes;
- table rendering, pagination and memory behavior.

## Guardrails

Do not weaken RLS, share tenant-private caches, or add service-role browser paths for speed. Cache keys must include company, identity/permission context and immutable version/revision where relevant.