# F4/T04 — retrievable S/MIME transport evidence

Independent continuation after PR317. PR310 remains paused and unchanged; this change imports no PR310 migration, generated type, replay machinery, grant, schema snapshot or reference-source package.

## Confirmed gap

The existing S/MIME path built the exact outer RFC822 MIME bytes but persisted only a temporary `smtp-smime://<message>/<encrypted-hash-prefix>` reference. The payload snapshot retained route/certificate metadata, while no private object was guaranteed to contain the exact bytes submitted to SMTP. Snapshot insert errors were also not surfaced by that helper.

## Correction

`sendEdielEmail` now treats raw S/MIME as an evidence-bearing transport. Before `transporter.sendMail` it calls the S/MIME archive binder. The binder:

- decodes the CMS body and derives the same encrypted-payload SHA-256 prefix used by the immediately preceding transport snapshot;
- requires exactly one matching `smime_enveloped` snapshot, so a missing/ambiguous snapshot blocks submission instead of silently sending;
- uploads the exact outer RFC822 bytes to the existing private `ediel-files` bucket with `message/rfc822`;
- downloads the object again and verifies byte equality plus SHA-256 before proceeding;
- preserves the snapshot's route/certificate metadata and adds RFC Message-ID, exact MIME hash/byte length, full encrypted-payload hash, bucket/path and verification state;
- replaces the temporary pseudo-reference with `storage://ediel-files/...` using an optimistic reference fence;
- removes the uploaded object and fails closed if readback or snapshot binding fails.

The storage bucket already exists in the repository schema as private and permits `message/rfc822`; no schema change is introduced here. Non-S/MIME raw MIME paths are not routed through this archive guard.

## Verification contract

Focused tests cover exact-byte upload/readback, deterministic binding to the existing route/certificate snapshot, missing snapshot, upload failure, readback mismatch and snapshot-update failure. A separate SMTP-boundary test asserts zero `sendMail` calls when archival fails, proves archive-before-SMTP ordering on success, and confirms other raw MIME modes are not accidentally forced through the S/MIME path.

Normal repository CI on the exact PR head remains authoritative for TypeScript, full tests, build, browser and release gates. These tests mock Supabase Storage/SMTP; they do not claim a live production storage write, external SMTP delivery, certificate-chain validation or full masterplan/F7 certification.
