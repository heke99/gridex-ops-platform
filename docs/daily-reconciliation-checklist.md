# Daily Reconciliation Checklist (Production)

Primary tooling already exists: `supabase/sql/checks/production_consistency_checks.sql`
(10 checks) is rendered daily on `/admin/system-health` ("Avstämningar
(produktion)") via `lib/ops/reconciliation.ts`, and the system-health cron runs
nightly at 02:35. This checklist adds the operational routine plus manual SQL
for gaps not yet covered by the view.

## Daily routine (first weeks: every morning)

1. Open `/admin/system-health` — every reconciliation row must be zero or have
   a written explanation.
2. Review queues: `/admin/work-queue`, `/admin/website-applications` (failed/
   partial), `/admin/messages` (blocked/failed), needs_review lists.
3. Run the additional SQL below for anything the view does not cover.

## Covered by production_consistency_checks.sql (run as-is)

1. Active contracts without customer or site
2. Active contracts whose site lacks an SE price area
3. Active contracts without a price snapshot
4. Open switches whose site lacks metering point/grid owner
5. Invoice export run/item count mismatches
6. Sent invoice export items missing provider GUID
7. Duplicate billing underlays per contract/period
8. Duplicate active pricing runs per underlay
9. Invoice export retry backlog
10. Provider events stuck unprocessed

## Additional manual checks (SQL; all read-only, bounded)

```sql
-- A) Application chain gaps: application done but customer/contract missing
select id, company_id, status, customer_id, contract_id, error_stage
from website_customer_applications
where status in ('processed','partial','repaired')
  and (customer_id is null or contract_id is null)
order by created_at desc limit 100;

-- B) Customer without any site / site without metering point (per tenant)
select c.company_id, c.id as customer_id
from customers c
left join customer_sites s on s.customer_id = c.id
where c.status = 'active' and s.id is null limit 100;

-- C) Contract exists but no legal acceptance
select ct.company_id, ct.id as contract_id
from customer_contracts ct
left join customer_legal_acceptances la
  on la.company_id = ct.company_id and la.contract_id = ct.id
where ct.source_type like 'website%' and la.id is null
  and ct.created_at > now() - interval '7 days' limit 100;

-- D) POA missing where legal acceptance of power_of_attorney exists
select la.company_id, la.customer_id
from customer_legal_acceptances la
left join powers_of_attorney poa
  on poa.company_id = la.company_id and poa.customer_id = la.customer_id
where la.acceptance_type = 'power_of_attorney' and poa.id is null
  and la.accepted_at > now() - interval '7 days' limit 100;

-- E) Email queued > 1h but never sent / duplicate provider sends
select id, company_id, status, attempts, created_at from tenant_email_outbox
where status in ('queued','processing','delivery_uncertain')
  and created_at < now() - interval '1 hour' limit 100;

-- F) Ediel outbound never dispatched (not blocked, older than 1h)
select id, company_id, status, created_at from ediel_outbox
where status in ('prepared','queued','sending','delivery_uncertain')
  and created_at < now() - interval '1 hour' limit 100;

-- G) Missing ACK past SLA (also surfaced by the SLA monitor)
select id, company_id, created_at from ediel_messages
where direction = 'outbound' and status = 'sent'
  and (contrl_status = 'pending' or aperak_status = 'pending')
  and ack_due_at < now() limit 100;

-- H) Inbound stored but never processed
select id, processing_status, created_at from inbound_email_messages
where processing_status not in ('done','manual_review','ignored')
  and created_at < now() - interval '2 hours' limit 100;

-- I) Manual request past due without response
select id, company_id, status, due_at from grid_owner_information_requests
where status in ('manual_email_sent','waiting_manual_response')
  and due_at is not null and due_at < now() limit 100;

-- J) Duplicate metering values (should be impossible — unique index)
select company_id, metering_point_id, period_start, period_end, count(*)
from metering_values
group by 1,2,3,4 having count(*) > 1 limit 50;

-- K) Live tenant with readiness blockers / missing production route
select c.id, c.name from companies c
where c.live_ediel_enabled = true
  and not exists (
    select 1 from ediel_route_profiles p
    where p.company_id = c.id and p.environment = 'production'
      and coalesce(p.is_enabled, true) = true
  ) limit 50;

-- L) Orphans: rows with NULL company_id in tenant tables
select 'customers' as t, count(*) from customers where company_id is null
union all select 'customer_sites', count(*) from customer_sites where company_id is null
union all select 'customer_contracts', count(*) from customer_contracts where company_id is null
union all select 'ediel_messages', count(*) from ediel_messages
  where company_id is null and created_at < now() - interval '1 day';
-- (inbound_email_messages may legitimately hold company_id NULL pre-resolution)
```

## Escalation

Non-zero results: check `docs/incident-response-runbook.md` for the matching
incident type. Log every non-zero finding + explanation in the ops channel.
Portal-vs-OPS mismatch reports from customers → treat as potential isolation
issue until proven a display bug.
