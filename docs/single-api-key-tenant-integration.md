# Gridex server-side API credential

Current contract: **2026-10-01.1** (release candidate)

Paired release 2026-10-01.1 adds required nullable `author_reference` to customer
support messages. It is the saved opaque `support_staff_` reference, or null for
customer messages and unknown historical staff authors. Strict2026-09-30.3
response clients must update that model; request paths/scopes are unchanged.
Prior immutable releases remain available.

A production integration uses `GRIDEX_API_KEY` only from a trusted backend. Gridex derives the organization, permissions and integration context from that credential. Do not expose the key in browser JavaScript, mobile applications, analytics payloads or client-visible environment variables.

See `/developers/customer-portal-api#authentication` for the current integration flow.
