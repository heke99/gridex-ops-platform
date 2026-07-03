# Backup & Restore Checklist

## Backups (verify before launch)

- [ ] Supabase automated daily backups enabled on the production project
- [ ] Point-in-time recovery (PITR) enabled (paid tier) — target RPO ≤ 2 min
- [ ] Storage buckets included in backup strategy (`GRID_OWNER_AGREEMENTS_BUCKET`,
      invoice/document buckets) — verify bucket replication/export policy
- [ ] Secrets inventory stored in the team password manager (env checklist doc
      lists names, never values)
- [ ] A restore test has been performed at least once on a scratch project
      (restore latest backup → run `production_consistency_checks.sql`)

## What must be restorable

- Postgres database (all tenant/customer/legal/Ediel/billing data)
- Storage objects (POA PDFs, invoice documents, agreement uploads)
- Environment variables (Vercel project settings — export a copy)

## Restore procedure (database)

1. Freeze: pause all tenants' production sending
   (`pauseProductionSendingAction`) and disable cron (Vercel cron off or rotate
   `CRON_SECRET`) — prevents dispatch during the inconsistent window.
2. Restore via Supabase PITR/backup into the production project (or a new
   project + repoint `SUPABASE_*` envs).
3. Run `supabase/sql/checks/production_consistency_checks.sql` and
   `/admin/system-health` — resolve every non-zero check.
4. Reconcile external state BEFORE re-enabling dispatch:
   - `tenant_email_outbox` / `manual_email_outbox`: rows in
     `processing`/`sending`/`queued` — check Resend by idempotency key; mark
     already-delivered rows `sent` manually.
   - `ediel_outbox`: rows in `sending`/`queued` — verify against counterparty
     ACKs / sent interchange references; supersede rather than resend when unsure.
   - `invoice_export_items`: verify provider GUIDs before allowing the retry
     cron; sent-invoice protection triggers prevent double-send but verify.
   - `inbound_processing_jobs`: stale `processing` rows will be reclaimed
     automatically (SKIP LOCKED stale reclaim).
5. Re-enable cron, then resume tenant production sending one tenant at a time.

## What must NOT be resent/reprocessed after restore without review

- Emails in `delivery_uncertain` (may already be delivered)
- Ediel outbound with unknown ACK state (duplicate PRODAT/UTILTS to market)
- Invoice exports whose provider status is unknown
- POA documents (POA must remain exactly-once per customer/contract scope)

## Audit/legal data

`audit_logs`, `customer_legal_acceptances`, `powers_of_attorney`,
`power_of_attorney_events`, `contract_price_snapshots` (immutability-protected)
are legal evidence — never truncate/rewrite during recovery; restore-and-merge
requires explicit sign-off.
