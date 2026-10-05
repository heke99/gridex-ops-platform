# Mariam Z01 recovery evidence — 2026-09-03

## Production state observed before this patch

- Customer operation job: `17c57e37-ac29-4494-a7a0-43e7b8353563`
- Existing operation: `3a08a265-1ada-416c-8e5d-4f3895b26f18`
- Existing grid-owner data request: `e94e2cad-1f4e-4fd0-984e-867e6ec1527d`
- Existing outbound request: `89034769-b330-4cf6-aac6-e47020f1d6f3`
- Existing Ediel message: `f5a9602b-0813-44d7-bbf1-81b61dc9fa03`
- Receiver Ediel ID: `27700`
- Existing outbox row: `63378f1f-8418-4016-ac3f-e0582fbbdb29`

The canonical outbound persistence fix is already on `main`. The remaining customer-operation failure happened after the message/outbox had been created: a successful Z01 prepare tried to clear `customer_info_requests.blocker_details` with explicit `NULL`, while the database column is `jsonb NOT NULL`. That caused PostgreSQL `23502`, retried the same idempotent job up to its maximum attempts, and left stale `render_failed` presentation state despite the Ediel message being persisted.

This patch normalizes explicit `NULL` to the canonical empty JSON object at the database boundary, so all current and legacy writers obey the same contract. It also preserves structured PostgREST/database error details in RenderGateway instead of degrading them to `[object Object]`.

## Production send state

The Ediel outbox is currently fail-closed with `capability_not_ready`. This is not an SMTP failure. The latest configuration snapshot is v13 (`5f2bc44b-6a5e-4952-8d59-339cd1a735d1`, reason `ediel_route_profiles_changed`). The previous readiness check and production dry-run belong to the older snapshot, are stale, and the dry-run is expired.

Do not manually unlock `ediel_send_locks` or force capability flags. After this patch is merged and deployed, the correct production sequence is:

1. Generate a fresh production readiness check for the current configuration snapshot.
2. Generate a fresh production dry-run for that same snapshot.
3. Verify both are current/non-stale and have no blockers.
4. Use the canonical Ediel production transition to move the tenant back to `live`.
5. Let the normal Ediel outbox worker process the existing idempotent outbox row.
6. Verify `ediel_messages.message_sent_at`, `ediel_outbox.sent_at`, `outbound_requests.sent_at`, and the customer/grid-owner request projections against receiver `27700`.

No duplicate Z01, outbound request, grid-owner request, or customer operation should be created during recovery.
