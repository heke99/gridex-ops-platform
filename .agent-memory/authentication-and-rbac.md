# Authentication and RBAC

Website integration routes authenticate via integration API clients and
explicit scopes in `lib/integrations/apiAuth.ts`. The API key is server-side
tenant identity; public request payloads must not contain trusted tenant IDs.

Admin and service-role code must preserve company scoping and existing RBAC
guards. UI visibility is not authorization.
