# Gridex server-side API credential

Current contract: **2026-10-09.1**

You do not need to match the latest documentation revision exactly to use a supported API version. See [docs/api-compatibility-policy.md](api-compatibility-policy.md).

A production integration uses `GRIDEX_API_KEY` only from a trusted backend. Gridex derives the organization, permissions and integration context from that credential. Do not expose the key in browser JavaScript, mobile applications, analytics payloads or client-visible environment variables.

See `/developers/customer-portal-api#authentication` for the current integration flow.
