-- Restore the primary supplier fields required by the unchanged public actor
-- profile producer. Original definitions: 20260521_actor_testing_go_live_module;
-- authority boundary: 20260802170000_canonical_security_convergence.
-- Expand-only: keep all existing definitions, values and function/ACL metadata.
-- Unknown BRP/eSett status stays missing. No inferred identity, contact,
-- certification, production admission, or rewrite of reviewed legal data.
BEGIN;

ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS market_role text NULL;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS brp_name text NULL;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS brp_status text NULL DEFAULT 'missing';
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS esett_status text NULL DEFAULT 'missing';
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS technical_contact_name text NULL;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS technical_contact_email text NULL;

COMMIT;
