# Architecture Map

This file is a living map. Keep it updated when major files, modules or flows change.

## Main domains

### Admin / SaaS platform

Likely areas:

- app/admin
- app/admin/companies
- app/admin/ediel
- app/admin/customers
- app/admin/work-queue
- app/admin/settings
- server actions related to company/tenant/customer operations

### Customer operations

Likely areas:

- customers
- customer_sites
- metering_points
- powers_of_attorney
- supplier_switch_requests
- supplier_switch_events
- customer_internal_notes
- communication logs
- onboarding events

### Ediel operations

Likely areas:

- lib/ediel
- app/admin/ediel
- Ediel messages
- Ediel actor settings
- Ediel route profiles
- Ediel send/receive flows
- Edifact parser/builders
- ACK generation
- APERAK/CONTRL/UTILTS_ERR generation
- mailbox polling
- encryption/S/MIME/CMS handling
- inbound decryption

### Routing and transport

Likely areas:

- route decision engine
- SMTP senders
- IMAP/mailbox polling
- communication routes
- Ediel actor settings
- route profiles
- encryption certificate handling
- decryption private certificate handling

### Billing/import operations

Likely areas:

- billing underlays
- billing exports
- meter/metering values
- BRP/eSett file uploads
- import batches
- parsed rows
- validation errors
- customer/site/metering point matching
- platform usage pricing
- platform usage events
- platform billing reports

### Database

Likely areas:

- supabase migrations
- SQL files
- RLS policies
- RPC functions
- audit triggers
- tenant-safe views

## Important architectural rule

Do not assume file names blindly. Use this map as guidance, then inspect the actual files before changing code.
