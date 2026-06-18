# Address intake and grid-owner resolver hardening patch

Only changed or added files are included.

## Purpose

- Make `customer_sites` the only operational source for anläggningsadress.
- Treat tenant/manual/website/customer-portal data as candidates, never as verified grid-owner data.
- Prevent billing-address fallback, mixed facility/metering identifiers and direct grid-owner creation from the customer card.
- Add address provenance, history, conflict handling, resolver invalidation and automatic requeueing.
