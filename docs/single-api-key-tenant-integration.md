# Gridex server-side API credential

Current documentation: **2026-10-22.1**. Default response contract: **2026-10-09.1**.

An API credential and its scopes authorize a supported V1 integration. No comparison with the latest documentation revision is an admission condition. Website/customer scopes do not implicitly grant Staff access; Staff requires its explicit scopes and signed staff identity. OPS may pin a supported response profile on this credential without changing the tenant's request headers.

You do not need to match the latest documentation revision exactly to use a supported API version. See [docs/api-compatibility-policy.md](api-compatibility-policy.md).

A production integration uses `GRIDEX_API_KEY` only from a trusted backend. Gridex derives the organization, permissions and integration context from that credential. Do not expose the key in browser JavaScript, mobile applications, analytics payloads or client-visible environment variables.

See `/developers/customer-portal-api#authentication` for the current integration flow.
