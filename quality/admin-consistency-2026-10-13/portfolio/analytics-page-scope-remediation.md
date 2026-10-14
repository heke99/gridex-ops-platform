# Canonical selected-company analytics reads

Fixed the five handed-off analytics entry points: overview, forecast, reports, deviations and CSV export. They previously checked canonical admin permission but loaded the company returned by a separate operational membership selection.

The additive `resolveAdminSelectedCompanyReadScope` helper uses the canonical guard's company directly. Explicit null means no selected company and never falls back to another membership. Platform users retain selected-company analytics rather than receiving a global aggregate. Legacy contexts that have no canonical company field retain their previous fallback. Existing global tenant-read helper signatures and behavior remain unchanged.

The selected scope now drives stored metrics, live fallback, growth, filter options, breakdowns, forecasts, deviations and CSV rows. Canonically authorized reads also remain available if an unrelated legacy membership lookup is unavailable, because that lookup is no longer called.

The new runtime suite renders all four pages and exercises the export route. It reproduced **21 failures / 2 passes** before changes, then passed **23 / 23**. Five targeted suites passed **47 tests**, including the frozen four operational pages, central tenant scope, dashboard and portfolio scope regressions. ESLint and diff checks passed. No migration, type artifact or live database changes.
