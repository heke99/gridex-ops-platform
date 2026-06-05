# Mailbox Polling and Idempotency

## Polling

Shared Ediel mailbox should be polled automatically approximately every 5 minutes per environment.

Manual import/sync button may exist for superadmin/debug, but normal operations should be automatic.

## Locking

Polling must use safe locking:

- prevent overlapping poll jobs
- detect stale locks
- release lock after completion/failure
- log poll run result

## Dedupe

Inbound messages must be deduplicated using stable identifiers such as:

- mailbox_message_id
- message-id header
- UNB interchange reference
- BGM reference
- transaction reference
- sender/receiver/date combination where needed

Do not create duplicate ediel_messages or duplicate ACKs for same inbound message.

## Retry behavior

Failed messages should support:

- retry count
- last error
- next retry time
- dead-letter state
- manual review state

Do not infinitely retry without status.

## Polling UI

Superadmin should see:

- last poll time
- next expected poll
- mailbox status
- number of messages imported
- number of failures
- unresolved count
- stale lock warning
- retry/dead-letter count

Tenant users should normally not see mailbox details. They should see business status only.
