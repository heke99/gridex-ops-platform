-- FINDINGS F100 (reality simulation 2026-10-23): production Ediel transport requires S/MIME for every message
-- family (lib/ediel/config.ts evaluateProductionTransportSecurity: production_smime_required), but the registry
-- route materializer and the technical ACK route materializer wrote encryption_mode 'none' for every family but
-- PRODAT. Every production UTILTS file and every technical reply (CONTRL/APERAK) to a UTILTS file was therefore
-- held in the outbox with production_smime_required (all 174 active production UTILTS profiles in production).
-- The materializers now write 'smime' in the production lane. Existing active production profiles without
-- encryption are aligned once here; route-profile readiness then binds the receiver certificate. Nothing is
-- loosened: an unencrypted profile was never sendable in production, and an S/MIME profile still needs an active,
-- valid, scope-matching receiver certificate. A profile with a decided unencrypted exception
-- (allow_unencrypted_production) is left alone. Each changed row keeps metadata.f100_encryption_from for audit.
UPDATE public.ediel_route_profiles
   SET encryption_mode = 'smime',
       metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('f100_encryption_from', coalesce(encryption_mode, 'null')),
       updated_at = now()
 WHERE environment = 'production'
   AND is_active
   AND coalesce(lower(encryption_mode), 'none') = 'none'
   AND allow_unencrypted_production IS NOT TRUE;
