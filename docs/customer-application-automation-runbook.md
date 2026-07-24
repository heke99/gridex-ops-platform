# Customer application automation runbook

## Canonical ownership

After `POST /api/v1/website/customer-applications` returns `accepted`, OPS owns the remaining process. The tenant must not create a competing grid-owner request, Z01, Z03, legal e-mail or webhook retry.

The API transaction creates or links the customer graph, legal evidence, workflow and exactly one `customer_application_continuation` job. The API returns after the durable handoff.

## Main state flow

```text
canonical_data_committed
→ initial_notifications_pending
→ initial_notifications_queued
→ facility_information_check
  → waiting_for_facility_response
  → waiting_for_customer_data_response
  → switch_request_queued
→ waiting_for_switch_response
→ switch_confirmed
→ completed
```

Blocking paths use `facility_information_required`, `switch_blocked` or `manual_review`. Waiting states are not automatically replayed by reconciliation because their own inbound mail/Ediel handlers own the continuation.

## Workers and cron

The existing customer-operations cron now performs:

1. continuation reconciliation;
2. customer-operation job claiming;
3. facility/Ediel follow-up processing;
4. POA expiry and stuck intent checks already present in the route.

Required configuration:

- `CUSTOMER_OPERATION_CRON_SECRET` or `CRON_SECRET`;
- valid `GRIDEX_AUTOMATION_USER_ID` backed by `auth.users`;
- service-role credentials;
- verified tenant sender and mandatory e-mail templates/rules;
- manual operations mailbox and grid-owner contacts where manual facility lookup is used;
- production Ediel route/certificates for Z01/Z03.

Go-live readiness treats missing mandatory automation dependencies as blockers.

## Retry and replay

- Queue claims remain atomic through PostgreSQL `FOR UPDATE SKIP LOCKED`.
- A workflow has one permanent continuation row.
- Lifecycle e-mails are first represented by a durable `dispatch_lifecycle_notification` job, then by `communication_logs` and `tenant_email_outbox`.
- Provider retries never create duplicate customer, contract, e-mail, switch or webhook records because permanent idempotency keys are reused.
- Reconciliation only requeues stalled active states. It deliberately excludes legitimate waiting states.
- Admin can use **Återkö automation** on the website-application detail page. The action requeues the same continuation row and is blocked while the worker is already running or after terminal completion/cancellation.

## Manual review

A network-owner response or Ediel business outcome that cannot be applied safely transitions the same workflow to `manual_review`. Operations should inspect:

- workflow state and next action;
- immutable workflow events;
- continuation/lifecycle jobs and latest error;
- grid-owner request and inbound response;
- supplier-switch request and APERAK/Z04 outcome.

After correcting the underlying data, use the existing completion action or safely requeue the continuation. Never create a separate workflow manually.

## Deployment order

1. Stop or temporarily pause the customer-operation cron.
2. Run `scripts/customer-application-continuation-backfill-readiness.sql` and review `unsafe_to_replay` / `manual_review_required` rows.
3. Apply Supabase migration `20260724210000_customer_application_continuation_orchestrator.sql`.
4. Deploy application code.
5. Run the migration integrity and regression commands listed in the implementation report.
6. Verify go-live readiness for each production tenant.
7. Re-enable cron and monitor continuation jobs, lifecycle notification jobs and dead-letter/manual-review rows.
8. Execute a staging flow through tenant application → facility lookup/Z01 → Z03 → APERAK/Z04 → active supply → welcome notification.

## Incident checks

```sql
select id,company_id,workflow_id,status,attempts,max_attempts,last_error_code,last_error_message,updated_at
from public.customer_operation_jobs
where job_type in ('customer_application_continuation','dispatch_lifecycle_notification')
  and status in ('failed','blocked','delivery_uncertain','needs_review')
order by updated_at asc;
```

```sql
select w.id,w.company_id,w.customer_application_id,w.state,w.next_action,w.last_transition_at,w.updated_at
from public.customer_application_workflows w
where w.state not in ('completed','cancelled','failed')
  and w.updated_at < now() - interval '30 minutes'
order by w.updated_at asc;
```

Do not log or export raw application payloads, signer identity, POA evidence or personal identity numbers during incident handling.
