# Remaining UI candidates — 2026-10-05

The user asked whether more parts could be examined. A read-only source review identified these candidates beyond the completed customer/daily-admin rounds. This inventory does not include new browser verification or implementation.

| Priority | Area | Source evidence | Recommended simplification |
| --- | --- | --- | --- |
| 1 | Customer information requests | `app/admin/customer-info-requests/page.tsx`: three creation forms rendered together; separate request, authorization-scope and permission lists | Choose creation task with a select; expandable form; compact summaries while keeping process blockers/next steps visible |
| 2 | Facility requests | `app/admin/facility-requests/page.tsx`: each manual request shows both a sent-marker form and a received-data form; six-column queue | Short request summary; select/expand the required step; responsive queue |
| 3 | Metering | `app/admin/metering/{page.tsx,_components.tsx}`: eight summary cards, permanent 420 px ingestion panel, per-request action form, eight-column values table | Compact summary, expandable ingestion/status details, grouped mobile values |
| 4 | Outbound | `app/admin/outbound/page.tsx`: several summary grids, wide filter grid, per-request quick status actions plus full status form and fixed side panel | Keep current state/next step visible; consolidate secondary actions; expandable editor and technical metadata |
| 5 | Messages and events | `app/admin/messages/page.tsx`: six visible filters plus repeated quick-filter links; `app/admin/events/page.tsx`: several filters and six-column history | Search and common filters first, additional filters in disclosure; compact mobile history |
| 6 | Pricing and campaigns | `app/admin/pricing/page.tsx`: seven navigation cards plus permanent component-creation form and rule list | Group/select subpages; expandable creation; concise rule summaries retaining readiness warnings |
| 7 | Users and integration settings | `app/admin/users/page.tsx`: reset/confirmation/delete actions per row; `app/admin/billing/integrations/page.tsx`: provider selection, controls, configuration, logs and exports on one page | One primary row action plus menu; separate configuration and history with expandable details, retaining existing confirmations and dispatch limits |

Analytics/reporting and customer-login setup are also available for a later round. The first three recommendations follow the customer-to-facility-to-metering workflow and have concrete large forms/tables in the current UI. Any implementation should preserve existing scope/permission checks, action semantics, fields, URL state and visible errors/blockers as in the completed rounds.
