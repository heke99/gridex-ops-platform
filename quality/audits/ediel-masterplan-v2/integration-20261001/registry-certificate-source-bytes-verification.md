# Exact registry certificate source bytes

Four independent actual X509 regressions failed before the fix. XML parser scalar normalization and shared import `certificateSource` both collapsed PEM line boundaries. Both now preserve actual text/CDATA certificate content; the production X509 decoder derives DER SHA256, purpose expansion and validity from that content. Duplicate PEM fields and fingerprint conflicts still reject.

33/33 scoped XML/TXT/snapshot/certificate tests passed after the fix. Exact test names and red/green receipts are retained. Scoped native/test typecheck and owned lint passed. The public certificate fixture is generated synthetic self-signed material; no private key is retained or committed.

A new actual native suite covers source archive/DER custody, SMTP source revision with preserved old certificate/source history, held operational materialization, native route-version snapshot, bad fingerprint and current platform revocation. It seeds no valid certificate, approved/accepted private source, or ready state. The native suite has NOT RUN locally and must execute after root semantically integrates these narrow parser/producer changes into the same frozen candidate.

This addresses an internal parser/import defect and constructs a native combined consumer probe. It does not prove actual issuer/CRL trust, counterparty certificate scope, return path or production readiness, and does not approve any whole criterion.
