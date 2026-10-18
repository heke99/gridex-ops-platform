# Customer-authorized fullmakt archive API supplement

Status: implemented source supplement, **not yet an active published API release**.
It depends on the unchanged archive/evidence implementation in PR828 source
`1e78dbbf7f16d1a144f205f5e58e1ce4d6ca0dba`. The active developer page, guides,
OpenAPI documents and immutable release remain with their existing writer until
positive bounded intake/handoff. This document is the concrete integration
contract for that intake. Do not advertise production availability from local tests.

## Authorization and request limits

Both new GET operations require all of:

- An active tenant API credential with **both** `customer_power_of_attorney.read`
  and `customer_documents.read`. Existing credential validation, tenant lifecycle,
  rate limiting and request audit remain in force.
- An already active portal-account binding resolved in strict read mode. Customer
  number, email, external ID or a verification reference alone cannot grant access.
- A cryptographically verified `x-gridex-customer-assertion`, signed by the tenant's
  configured customer identity provider, with matching subject, issuer/audience,
  short lifetime and a fresh replay-protected `jti`. Missing provider configuration
  returns503; an invalid/unverified proof returns403, including in report mode.
- The existing customer retention-access guard. It is checked before retrieval
  and again before the response is released.

Every HTTP request needs a fresh assertion. Reusing the discovery request's `jti`
for the download is refused. Follow429 `Retry-After` and rate-limit headers;
retries also need a fresh assertion. The two scopes are not newly granted by
installing this code. No anonymous verification lookup is provided.

Tenant keys and assertions stay on the website server. A browser link to the OPS
endpoint cannot replace the website's authenticated server proxy. The proxy must
recheck its logged-in customer and forward a newly issued matching assertion;
it must not expose an OPS API key or enable arbitrary-customer URL forwarding.

## Discover archived documents

`GET /api/v1/customer/powers-of-attorney/evidence?limit=50&cursor=...`

`limit` is an integer1–100, default50. Pagination uses an encrypted opaque cursor
bound to company, customer and resource. A cursor from another customer/resource
is invalid. Do not use database IDs, offsets or total counts. Each page reads at
most limit+1 POA rows and does not download/render/upload PDF files.

The response uses the existing JSON envelope and request/contract headers:

```json
{
  "data": [{
    "power_of_attorney_reference": "power_of_attorney_synthetic-document-reference-1234",
    "verification_reference": "poa_verification_synthetic-document-proof-12345678",
    "consent_status": "signed",
    "archive_status": "archived_unverified",
    "archived_sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "download_url": "/api/v1/customer/powers-of-attorney/evidence/poa_verification_synthetic-document-proof-12345678?format=pdf"
  }],
  "page": { "limit": 50, "offset": 0, "returned": 1, "has_more": false, "next_cursor": null },
  "request_id": "synthetic-request",
  "contract_schema_version": "2026-10-09.1"
}
```

These references/checksums are synthetic examples. The runtime version is supplied
by the normal representation wrapper; this supplement does not itself change
existing response schemas or pinned immutable releases.

| archive_status | Meaning |
| --- | --- |
| `missing` | No document path was saved. GET will not generate an original. |
| `incomplete_evidence` | A document exists but its stored verification reference is absent/unsupported. |
| `archived_unverified` | Stored archive path/hash/evidence metadata is consistent. Bytes have **not** been checked by discovery. |
| `unavailable` | Archive metadata, scope, evidence fingerprint or path is inconsistent. |

`archived_sha256` and `download_url` are null unless metadata qualifies. A stored
hash from discovery is not an independent checksum of a successful download.
No database UUID or private storage path is returned. `consent_status` describes
the retained record; it is not permission to activate supply or send the POA.
Expired/revoked historical originals may be downloadable if retention permits.

## Verify or download one existing original

`GET /api/v1/customer/powers-of-attorney/evidence/{verificationReference}`

The reference is a stored1–160-character URL-safe system identifier. It is not
an access token. The lookup always includes the resolved company and customer;
zero matches return404, multiple matches return409. IDs from the database cannot
be used as verification references.

Parameters:

| Parameter | Values | Behavior |
| --- | --- | --- |
| `format` | `json` (default), `pdf` | Return verification data or the exact PDF bytes. |
| `sha256` | 64 hexadecimal characters | Optional comparison with actual bytes; only valid with JSON. Case is normalized. |

Repeated/unknown parameters, invalid formats/hashes and oversized cursors return400.
No consent, archive or PDF write occurs on these GET paths. Assertion replay/audit
writes are security records, not document generation.

Before returning data, the reader requires the archive's company/POA/customer
binding, exact content-addressed path, bucket, stored verification number and
current evidence fingerprint. A former customer prefix is accepted only through
a bounded canonical merge chain whose tenant-scoped merge events prove that this
POA class moved. Arbitrary former prefixes, cycles, incomplete/ambiguous events
and foreign tenants fail closed.

The reader downloads at most one existing private object, rejects a size above
15MiB, computes SHA-256 from its actual bytes, compares it with metadata and the
content-addressed filename, and checks PDF structure. It rereads the POA source
binding and checks retention again after the download. Missing/changed/corrupted
originals return409 `poa_archive_unavailable`; no replacement is silently generated.

The JSON `data` includes the discovery fields plus:

```json
{
  "archive_integrity": "verified",
  "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "submitted_sha256_matches": null,
  "accepted_at": "2026-10-18T10:00:00Z",
  "accepted_at_source": "accepted_at",
  "signer_ip_address": "192.0.2.10",
  "signer_ip_source": "signer_reported",
  "capture_issues": [],
  "bankid_verified": false,
  "pdf_signature_validation": "not_performed"
}
```

`submitted_sha256_matches` is null if no comparison was requested, otherwise a
boolean. A false comparison still returns200 verification data: the stored
archive passed its own integrity checks but the submitted hash is different.
Use the returned boolean rather than interpreting HTTP200 as equality.

Acceptance time comes from the stored accepted_at, with signed_at as an explicit
fallback. `accepted_at_source` names that source. Missing time/IP stays null;
the API does not substitute the API server's address or the current time.
`capture_issues` reports `poa_acceptance_time_missing` and, for non-BankID consent,
`poa_signer_ip_missing` where applicable. An archived original can be intact while
its signer evidence is incomplete. The normal operational/legal send guards
still decide whether it can be used externally.

PDF mode returns `application/pdf`, a safe opaque filename, `private, no-store`,
`nosniff`, a server-issued request ID, contract/documentation/rate-limit headers,
`X-Gridex-Document-SHA256` and `X-Gridex-Verification-Reference`. No public signed
storage URL is created. Do not persist this response in a shared browser/CDN cache.

## What verification proves

The system verification number identifies the archived POA evidence. SHA-256
verification binds returned bytes to the stored archive and current captured
evidence. Neither establishes a third-party certificate, BankID identity or a
cryptographic signature embedded in the PDF.

`bankid_verified=true` is available only when the pre-existing evidence helper
recognizes a completed BankID record whose verification_source is server_callback.
A client-supplied method name is insufficient. This reader performs no BankID
operation and no PDF cryptographic-signature validation. A copied/uploaded legacy
original is not promoted into a verified electronic signature by archiving it.

## Publication and verification still required

The active contract writer must intake both paths, closed JSON schemas, PDF
headers/statuses, both scopes and examples into the normal versioned developer
page/OpenAPI/guide release. Existing responses and immutable releases must remain
compatible. Any later enrichment of Website/Partner/ordinary Customer DTOs needs
its own pinned-representation qualification; these two endpoints do not silently
change those older closed shapes.

Local tests exercise real rendering/private archive persistence, real signed
customer assertions/replay checks, mounted reader handlers, actual byte hashing,
tenant/customer denial and canonical merge evidence against declared synthetic
Supabase/auth/resolver/retention ports. They are not live RLS, native issuer,
provider delivery or Website acceptance-to-production proof.

Before release: two independent source reviews, active OpenAPI/contract gates,
types/lint/build, qualified PR828 schema/carrier delivery and normal serial merge.
After release: use the already authorized test application/customer for the real
archive→authorized API JSON/PDF→actual byte checksum round trip. Do not create a
duplicate application or send another signing email merely to test GET retrieval.

<!-- BEGIN POA ARCHIVE OPENAPI PATCH -->

## Machine-readable publication patch

This is an additive patch for the incumbent active Customer OpenAPI writer, not
a new immutable release. Merge paths and component schemas, retain existing
shared components, qualify the selected release/version and the runtime registry
in that writer’s normal turn. It does not replace the entire active document.

```json
{
  "paths": {
    "/api/v1/customer/powers-of-attorney/evidence": {
      "get": {
        "security": [
          {
            "bearerAuth": []
          },
          {
            "legacyApiKeyAuth": []
          }
        ],
        "x-required-scopes": [
          "customer_power_of_attorney.read",
          "customer_documents.read"
        ],
        "x-scope-combination": "allOf",
        "x-idempotency-required": false,
        "x-customer-assertion-required": true,
        "x-customer-binding-required": "portal_account",
        "parameters": [
          {
            "$ref": "#/components/parameters/RequestId"
          },
          {
            "name": "x-gridex-customer-portal-user-id",
            "in": "header",
            "required": false,
            "description": "Send this header or the other linked user header. Its opaque value must match the verified customer assertion subject; both, if sent, must agree.",
            "schema": {
              "type": "string",
              "minLength": 1
            }
          },
          {
            "name": "x-gridex-auth-user-id",
            "in": "header",
            "required": false,
            "description": "Send this header or the other linked user header. Its opaque value must match the verified customer assertion subject; both, if sent, must agree.",
            "schema": {
              "type": "string",
              "minLength": 1
            }
          },
          {
            "name": "x-gridex-customer-assertion",
            "in": "header",
            "required": true,
            "description": "Fresh verified customer assertion required even for report-mode/unconfigured providers; issuer/audience/subject/lifetime/replay validated. Send one linked portal/auth user header matching its subject.",
            "schema": {
              "type": "string",
              "minLength": 1,
              "maxLength": 8192
            }
          },
          {
            "name": "limit",
            "in": "query",
            "schema": {
              "type": "integer",
              "minimum": 1,
              "maximum": 100,
              "default": 50
            }
          },
          {
            "name": "cursor",
            "in": "query",
            "schema": {
              "type": "string",
              "maxLength": 2048
            },
            "description": "Opaque company/customer/resource-bound keyset cursor."
          }
        ],
        "operationId": "getCustomerPoaArchiveEvidence",
        "summary": "Discover this authenticated customer’s retained POA archives",
        "responses": {
          "400": {
            "$ref": "#/components/responses/BadRequest"
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          },
          "403": {
            "$ref": "#/components/responses/Forbidden"
          },
          "409": {
            "$ref": "#/components/responses/Conflict"
          },
          "410": {
            "$ref": "#/components/responses/Gone"
          },
          "422": {
            "$ref": "#/components/responses/Unprocessable"
          },
          "429": {
            "$ref": "#/components/responses/RateLimited"
          },
          "500": {
            "$ref": "#/components/responses/InternalError"
          },
          "503": {
            "$ref": "#/components/responses/ServiceUnavailable"
          },
          "200": {
            "description": "Stored archive metadata; bytes are not verified by discovery.",
            "headers": {
              "X-Gridex-Contract-Version": {
                "$ref": "#/components/headers/GridexContractVersion"
              },
              "X-Gridex-Documentation-Version": {
                "$ref": "#/components/headers/GridexDocumentationVersion"
              },
              "X-Request-ID": {
                "$ref": "#/components/headers/RequestId"
              },
              "X-RateLimit-Limit": {
                "$ref": "#/components/headers/RateLimitLimit"
              },
              "X-RateLimit-Remaining": {
                "$ref": "#/components/headers/RateLimitRemaining"
              },
              "X-RateLimit-Reset": {
                "$ref": "#/components/headers/RateLimitReset"
              }
            },
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/CustomerPoaArchiveListEnvelope"
                }
              }
            }
          }
        },
        "description": "Supply at least one linked x-gridex-customer-portal-user-id or x-gridex-auth-user-id matching the verified assertion subject. Opaque external-account subjects are supported. If both headers are supplied, their resolved values must be identical. Customer identifiers alone are insufficient."
      }
    },
    "/api/v1/customer/powers-of-attorney/evidence/{verificationReference}": {
      "get": {
        "security": [
          {
            "bearerAuth": []
          },
          {
            "legacyApiKeyAuth": []
          }
        ],
        "x-required-scopes": [
          "customer_power_of_attorney.read",
          "customer_documents.read"
        ],
        "x-scope-combination": "allOf",
        "x-idempotency-required": false,
        "x-customer-assertion-required": true,
        "x-customer-binding-required": "portal_account",
        "parameters": [
          {
            "$ref": "#/components/parameters/RequestId"
          },
          {
            "name": "x-gridex-customer-portal-user-id",
            "in": "header",
            "required": false,
            "description": "Send this header or the other linked user header. Its opaque value must match the verified customer assertion subject; both, if sent, must agree.",
            "schema": {
              "type": "string",
              "minLength": 1
            }
          },
          {
            "name": "x-gridex-auth-user-id",
            "in": "header",
            "required": false,
            "description": "Send this header or the other linked user header. Its opaque value must match the verified customer assertion subject; both, if sent, must agree.",
            "schema": {
              "type": "string",
              "minLength": 1
            }
          },
          {
            "name": "x-gridex-customer-assertion",
            "in": "header",
            "required": true,
            "description": "Fresh verified customer assertion required even for report-mode/unconfigured providers; issuer/audience/subject/lifetime/replay validated. Send one linked portal/auth user header matching its subject.",
            "schema": {
              "type": "string",
              "minLength": 1,
              "maxLength": 8192
            }
          },
          {
            "name": "verificationReference",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string",
              "minLength": 1,
              "maxLength": 160,
              "pattern": "^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$"
            },
            "description": "Stored opaque verification identifier; database UUIDs are refused. It is not authorization."
          },
          {
            "name": "format",
            "in": "query",
            "schema": {
              "type": "string",
              "enum": [
                "json",
                "pdf"
              ],
              "default": "json"
            }
          },
          {
            "name": "sha256",
            "in": "query",
            "schema": {
              "type": "string",
              "pattern": "^[a-fA-F0-9]{64}$"
            },
            "description": "JSON only: compare supplied hash with actual original bytes."
          }
        ],
        "operationId": "getCustomerPoaArchiveDocument",
        "summary": "Verify or download an existing customer-authorized POA original",
        "responses": {
          "400": {
            "$ref": "#/components/responses/BadRequest"
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          },
          "403": {
            "$ref": "#/components/responses/Forbidden"
          },
          "409": {
            "$ref": "#/components/responses/Conflict"
          },
          "410": {
            "$ref": "#/components/responses/Gone"
          },
          "422": {
            "$ref": "#/components/responses/Unprocessable"
          },
          "429": {
            "$ref": "#/components/responses/RateLimited"
          },
          "500": {
            "$ref": "#/components/responses/InternalError"
          },
          "503": {
            "$ref": "#/components/responses/ServiceUnavailable"
          },
          "404": {
            "description": "No matching POA for the resolved company/customer.",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/ErrorEnvelope"
                }
              }
            }
          },
          "200": {
            "description": "Existing private original passed byte/evidence/ownership checks. JSON sha256 comparison is a boolean, not implied by HTTP200.",
            "headers": {
              "X-Gridex-Contract-Version": {
                "$ref": "#/components/headers/GridexContractVersion"
              },
              "X-Gridex-Documentation-Version": {
                "$ref": "#/components/headers/GridexDocumentationVersion"
              },
              "X-Request-ID": {
                "$ref": "#/components/headers/RequestId"
              },
              "X-RateLimit-Limit": {
                "$ref": "#/components/headers/RateLimitLimit"
              },
              "X-RateLimit-Remaining": {
                "$ref": "#/components/headers/RateLimitRemaining"
              },
              "X-RateLimit-Reset": {
                "$ref": "#/components/headers/RateLimitReset"
              },
              "Cache-Control": {
                "schema": {
                  "type": "string"
                },
                "description": "private, no-store for PDF; no-store for JSON"
              },
              "X-Content-Type-Options": {
                "schema": {
                  "type": "string",
                  "const": "nosniff"
                },
                "description": "PDF only"
              },
              "Content-Disposition": {
                "schema": {
                  "type": "string"
                },
                "description": "PDF only; safe opaque attachment filename"
              },
              "X-Gridex-Document-SHA256": {
                "schema": {
                  "type": "string",
                  "pattern": "^[a-f0-9]{64}$"
                },
                "description": "PDF only; actual returned byte hash"
              },
              "X-Gridex-Verification-Reference": {
                "schema": {
                  "type": "string"
                },
                "description": "PDF only; stored verification reference"
              }
            },
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/CustomerPoaArchiveVerificationEnvelope"
                }
              },
              "application/pdf": {
                "schema": {
                  "type": "string",
                  "format": "binary"
                }
              }
            }
          }
        },
        "description": "Supply at least one linked x-gridex-customer-portal-user-id or x-gridex-auth-user-id matching the verified assertion subject. Opaque external-account subjects are supported. If both headers are supplied, their resolved values must be identical. Customer identifiers alone are insufficient."
      }
    }
  },
  "components": {
    "schemas": {
      "CustomerPoaArchiveSummary": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "power_of_attorney_reference",
          "verification_reference",
          "consent_status",
          "archive_status",
          "archived_sha256",
          "download_url"
        ],
        "properties": {
          "power_of_attorney_reference": {
            "type": "string"
          },
          "verification_reference": {
            "type": [
              "string",
              "null"
            ]
          },
          "consent_status": {
            "type": [
              "string",
              "null"
            ]
          },
          "archive_status": {
            "type": "string",
            "enum": [
              "missing",
              "incomplete_evidence",
              "archived_unverified",
              "unavailable"
            ]
          },
          "archived_sha256": {
            "type": [
              "string",
              "null"
            ],
            "pattern": "^[a-f0-9]{64}$"
          },
          "download_url": {
            "type": [
              "string",
              "null"
            ],
            "pattern": "^/api/v1/customer/powers-of-attorney/evidence/"
          }
        }
      },
      "CustomerPoaArchiveVerification": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "power_of_attorney_reference",
          "verification_reference",
          "consent_status",
          "archive_status",
          "archived_sha256",
          "download_url",
          "archive_integrity",
          "sha256",
          "submitted_sha256_matches",
          "accepted_at",
          "accepted_at_source",
          "signer_ip_address",
          "signer_ip_source",
          "capture_issues",
          "bankid_verified",
          "pdf_signature_validation",
          "legal_text_version",
          "signed_scopes"
        ],
        "properties": {
          "power_of_attorney_reference": {
            "type": "string"
          },
          "verification_reference": {
            "type": [
              "string",
              "null"
            ]
          },
          "consent_status": {
            "type": [
              "string",
              "null"
            ]
          },
          "archive_status": {
            "type": "string",
            "enum": [
              "missing",
              "incomplete_evidence",
              "archived_unverified",
              "unavailable"
            ]
          },
          "archived_sha256": {
            "type": [
              "string",
              "null"
            ],
            "pattern": "^[a-f0-9]{64}$"
          },
          "download_url": {
            "type": [
              "string",
              "null"
            ],
            "pattern": "^/api/v1/customer/powers-of-attorney/evidence/"
          },
          "archive_integrity": {
            "type": "string",
            "const": "verified"
          },
          "sha256": {
            "type": "string",
            "pattern": "^[a-f0-9]{64}$"
          },
          "submitted_sha256_matches": {
            "type": [
              "boolean",
              "null"
            ]
          },
          "accepted_at": {
            "type": [
              "string",
              "null"
            ],
            "format": "date-time"
          },
          "accepted_at_source": {
            "type": [
              "string",
              "null"
            ],
            "enum": [
              "accepted_at",
              "signed_at",
              null
            ]
          },
          "signer_ip_address": {
            "type": [
              "string",
              "null"
            ]
          },
          "signer_ip_source": {
            "type": [
              "string",
              "null"
            ],
            "enum": [
              "signer_reported",
              null
            ]
          },
          "capture_issues": {
            "type": "array",
            "items": {
              "type": "string",
              "enum": [
                "poa_acceptance_time_missing",
                "poa_signer_ip_missing"
              ]
            }
          },
          "bankid_verified": {
            "type": "boolean"
          },
          "pdf_signature_validation": {
            "type": "string",
            "const": "not_performed"
          },
          "legal_text_version": {
            "type": [
              "string",
              "null"
            ]
          },
          "signed_scopes": {
            "type": "array",
            "items": {
              "type": "string"
            }
          }
        }
      },
      "CustomerPoaArchiveListEnvelope": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "data",
          "page",
          "request_id",
          "contract_schema_version"
        ],
        "properties": {
          "data": {
            "type": "array",
            "maxItems": 100,
            "items": {
              "$ref": "#/components/schemas/CustomerPoaArchiveSummary"
            }
          },
          "page": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "limit",
              "offset",
              "returned",
              "has_more",
              "next_cursor"
            ],
            "properties": {
              "limit": {
                "type": "integer",
                "minimum": 1,
                "maximum": 100
              },
              "offset": {
                "type": "integer",
                "const": 0
              },
              "returned": {
                "type": "integer",
                "minimum": 0,
                "maximum": 100
              },
              "has_more": {
                "type": "boolean"
              },
              "next_cursor": {
                "type": [
                  "string",
                  "null"
                ]
              }
            }
          },
          "request_id": {
            "type": "string"
          },
          "contract_schema_version": {
            "type": "string",
            "const": "2026-10-09.1"
          }
        }
      },
      "CustomerPoaArchiveVerificationEnvelope": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "data",
          "request_id",
          "contract_schema_version"
        ],
        "properties": {
          "data": {
            "$ref": "#/components/schemas/CustomerPoaArchiveVerification"
          },
          "request_id": {
            "type": "string"
          },
          "contract_schema_version": {
            "type": "string",
            "const": "2026-10-09.1"
          }
        }
      }
    }
  }
}
```
<!-- END POA ARCHIVE OPENAPI PATCH -->
