# Security model

Mandatory controls: authentication, scope authorization, tenant-bound resource
lookup, RLS, bounded payloads, unknown-field rejection, safe output DTOs,
idempotency, atomic state transitions, outbox delivery, audit evidence,
secret-free logs and replay-safe provider webhooks.

Sensitive identity/signature data must be minimized in APIs and logs. Raw
credentials and production customer payloads never enter project memory.
