# Backup & Restore Checklist

## Backups (verify before launch)

- [ ] Supabase automated daily backups enabled on the production project
- [ ] Point-in-time recovery (PITR) enabled (paid tier) — target RPO ≤ 2 min
- [ ] Storage buckets included in backup strategy (`GRID_OWNER_AGREEMENTS_BUCKET`,
      invoice/document buckets) — verify bucket replication/export policy
- [ ] Secrets inventory stored in the team password manager (env checklist doc
      lists names, never values)
- [ ] A restore test has been performed on a scratch project. Keep the SQL
      results and the isolated database and Storage verification receipt.

## What must be restorable

- Postgres database (all tenant/customer/legal/Ediel/billing data)
- Storage objects (POA PDFs, invoice documents, agreement uploads)
- Environment variables (Vercel project settings — export a copy)

## Isolated database and Storage restore verification

1. Pick the backup checkpoint and record its snapshot ID, capture time, and the
   checksums of the database and object backup artifacts. Use the protected
   manifest captured with that checkpoint. Select the exact cohort of archived
   originals before the restore starts. Record the locked billing input and
   invoice export IDs and row checksums from that same checkpoint.
2. Restore the database and the Storage backup into separate scratch services.
   Keep the source environment running normally. Disable outbound destinations,
   workers, and cron in scratch. Restore object metadata as well as content. For
   the file-backed Storage service, preserve the extended attributes needed by
   the backend. In the isolated restore test the correct file bytes without
   those attributes still gave HTTP 500.
3. Read each expected archive reference and its stored SHA-256 from the restored
   database. Read back the selected locked billing input, the invoice export
   rows, and their saved checksums and compare them with the checkpoint. Treat
   billing row checksums and archive byte checksums as separate evidence.
4. With scratch-only credentials, read each object through the restored Storage
   service. Require an authenticated full-object HTTP `200`. Record the observed
   media type and length from that read and export the exact response body into
   a private local directory. For Ediel mail use the original MIME bytes. Keep
   the database and Storage observations independent from the expected manifest.
5. Run the offline check below before accepting the archive cohort. Preserve the
   selected snapshot ID, verifier revision, SQL results, and aggregate receipt
   in the recovery record. Any missing or inconsistent result leaves the restore
   unverified. A qualified recovery exercise requires the exact backup artifacts
   from the selected checkpoint and a successful read from the restored Storage
   service.

Use a private directory on a Linux host with `/proc` available and no other
writers. Put these three UTF-8 JSON receipts in that directory. Each receipt
has the same `snapshotId` and a non-empty `objects` array with exactly one entry
per opaque `objectId` in the selected cohort. IDs use 1–128 ASCII letters,
digits, underscores, or hyphens. Keep these IDs separate from file names and
Storage keys.

| Receipt | Source | Object fields in addition to `objectId` |
| --- | --- | --- |
| `snapshot.json` | Protected manifest from the backup checkpoint | `sha256`, `byteLength`, `contentType` |
| `database.json` | Independently read restored archive rows | `sha256` of the archived object from the row |
| `storage.json` | Independently read restored Storage objects | `status`, `byteLength`, `contentType`, `fileName` for the saved response body |

Use lowercase hexadecimal SHA-256 values and exact media-type strings. Give
objects distinct, flat file names such as `object-01.bin` in the same directory
as the receipts. Use standalone regular files. The verifier reads at most 1 MiB per JSON
receipt and 50 MiB per object in line with the repository's local Storage limit.
It checks the exact cohort, receipt metadata, and SHA-256 of streamed bytes. Run
it with the directory's canonical absolute path and the selected snapshot ID.

```sh
node scripts/verify-restore-archive-manifest.cjs /srv/restore-evidence/run-01 backup-01
```

Exit code `0` reports the verified object count. Exit code `1` reports an
unverified result with a fixed reason code. The command reads only local files
and prints no object IDs, paths, hashes, or bytes. Keep the private inputs out of
shared logs and build artifacts. [Storage download reference](https://supabase.com/docs/guides/storage/management/download-objects) · [Platform restore reference](https://supabase.com/docs/guides/self-hosting/restore-from-platform)

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
