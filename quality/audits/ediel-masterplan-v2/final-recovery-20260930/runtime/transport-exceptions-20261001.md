# TR09 source-owned temporary reserve implementation

This package supplies prospective implementation and bounded local evidence.
It does not establish a real external incident, approval, counterparty agreement,
TLS relay verification, CA registration, CRL retrieval result or production activation.
The full masterplan remains unqualified until every literal requirement has its
own evidence on the same frozen native/browser/CI candidate.

## Primary source

T 24A revision 6 original was retrieved read-only from
https://www.ediel.se/Portal/Document/3314. Original bytes: 1,124,807;
SHA256: 5204d4514774b04b8eedb039e1f4799ed447c7fef14554577935e2d7bd93f951.
That hash matches the frozen normative source. Pages 20 (§3.1), 42 (A.2)
and 44 (A.3.2.1) were read directly from those bytes.

| Source case | Required conditions | Retained protection |
|---|---|---|
| Temporary encryption failure | Actual temporary system/encryption incident original, exact scoped approval and limited duration/attempt count | Mandatory TLS on the complete path; valid verified TLS certificate |
| Completed certificate search finds none | Actual completed X.500 search result without recipient certificate; no active recipient authority silently ignored | Mandatory TLS and administrator alarm; expired/revoked certificates cannot become valid |
| CRL refresh fails | Every actual URI CDP of the current certificate chain attempted unsuccessfully; exact nearest prior cached signed CRLs from the active protected authority | Current recipient/CA dates, PKIX and registered recipient set; real CRL signature and revocation checks; administrator alarm |

Unknown/non-URI CDP adapters, delta/indirect/critical CRL extensions and any
missing or changed facts are held. There is no exception for disabling TLS.
Only CRL expiry is relaxed in the third specific case; time is never rewound.

## Owner and consumers

The CLI-created forward migration
20261001000609_ediel_source_owned_temporary_transport_exceptions.sql creates
an unseeded NOLOGIN qualified source publisher, immutable incident/approval
originals, append-only revocations, attempt-bound deviation events and durable
administrator alarms. Service/authenticated callers cannot publish source facts
or write private tables. Ordinary transport does not receive publisher membership.

The SMTP parameter temporarySecurityExceptionId is only a selector. A private
fresh read binds the actual current actor/member/grants, company/environment,
legal sender/receiver, route, original hash, exact case, validity and source digests.
Application capabilities are frozen, WeakMap-issued and non-clonable. Current
native prepare/enter independently reread all facts; failure rolls back that
stage's predecessor journal writes. Concurrent grant, namespace, route and
revocation changes are fenced by actual PostgreSQL locks.

Both the generic and source-owned Z08 journals run their existing owner first.
An accepted immutable journal replay remains receipt-first and does not need a
new exception or enter SMTP. Fresh production PRODAT plaintext requires a real
private approval even if an old route-level allow flag is set. An approved reserve
does not change that route configuration.

Source-specific plaintext uses a bounded singlepart packaging choice. The actual
nodemailer consumer retains requireTLS and rejectUnauthorized and now explicitly
requires TLSv1.2. Prior CRL handling is scoped to the exact asynchronous certificate
consumer and exact protected authority, CRL originals and actual CDP set.
Alarms are separately readable only by a current scoped communication writer.

## Validation boundaries

- Application/cryptography/journal regression: 44/44 unit tests passed. Earlier
  source/CRL positive tests were observed failing before implementation.
- Real local OpenSSL generated synthetic CA, recipients, signed expired/current/
  revoked CRLs and exercised signatures, chain dates, actual CDPs and isolated
  opaque ingress. Ordinary stale-CRL/revocation controls also remain green.
- Focused embedded PostgreSQL: 23/23 checks passed over an explicitly bounded
  synthetic schema and synthetic predecessor/issuer originals, using the actual
  company permission resolver. They prove private ACLs, current revocation,
  exact cases, rollback of predecessor stage effects, attempt budgets,
  immutability and durable alarm mechanics. They are not full Supabase replay.
- App TypeScript passed with a 4 GiB heap; targeted ESLint has no errors/warnings.
  Scripts TypeScript has no new-package diagnostics; the old source-owner
  fixture on this branch's 68147a4f base has the four-argument call already
  repaired by integration in 7362d82a. This branch does not overwrite that fix.
- The new ordinary native suite scripts/ediel-transport-exception-native.test.ts
  constructs genuine local signed contract/archive/POA/canonical Z03 through
  the shared actual helper, then exercises real SQL owners, HTTP clients,
  dispatch, journal, alarm and no-resend replay. It was not run locally:
  Docker/socket/PostgreSQL CLI and required kernel capabilities are unavailable.
  Its issuer/TLS/counterparty originals remain explicitly synthetic mechanics
  fixtures and never constitute external approval.

Native inclusion, authentic clean/upgrade artifacts, exact-head CI and the final
same-candidate qualification are integration responsibilities. No schema/types/
fingerprints were hand-written here, and no hosted database or SMTP/market traffic
was accessed.
