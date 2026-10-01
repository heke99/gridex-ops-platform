# Platform access command completion receipt

Source: `lib/admin/platformUserAccess.ts`, shared by current platform user role/override actions. Actual existing canonical SQL (`20260802203000_canonical_runtime_consistency_hardening.sql`:713–718) returns boolean changed, target_user_id, action and state. The server wrapper previously accepted every object, including an empty object, array, another user or another action, and therefore could report unverified action success if the RPC response were malformed.

Actual exported-wrapper boundary RED: six rejected receipts resolved successfully; two valid receipts passed. GREEN:9/9 on Node22, including all six malformed/unbound results, both real change and legitimate no-op shapes, and canonical upper-case UUID input. The wrapper now verifies exact requested user/action plus boolean outcome; server UUID normalization preserves valid upper-case identifiers. Scoped ESLint passes. These tests substitute only the outer Supabase RPC boundary; they establish neither SQL effects, native ACL nor live identity-provider acceptance. No SQL, grants, auth mutation or remote message was added.

T52/U04 receive this bounded outcome guard only. Full platform role/reset/key issuance, current SQL authority and actual browser/native effects retain their separate qualification requirements.
