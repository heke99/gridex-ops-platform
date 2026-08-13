# Architecture

The application uses Next.js API/server boundaries over tenant-scoped Supabase access. Service-role workers own privileged asynchronous processing. Domain orchestration lives under `lib`; durable state, idempotency and tenant constraints live in Postgres. Ediel uses canonical rule packs, immutable messages/outbox rows and explicit correlation/state machines.
