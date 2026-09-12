-- Frozen regression fixture from supabase/schema.sql at commit 0a0f40684f8e7cfb7a269e660f6c6fb1e821e71a.
-- Historical table before reconstruction; never a canonical schema artifact.
CREATE TABLE public.company_invitations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid NOT NULL,
    email text NOT NULL,
    role text,
    role_id uuid,
    status text DEFAULT 'pending'::text NOT NULL,
    invitation_token text,
    expires_at timestamp with time zone,
    accepted_at timestamp with time zone,
    cancelled_at timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid,
    idempotency_key text,
    CONSTRAINT company_invitations_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'sending'::text, 'sent'::text, 'delivery_uncertain'::text, 'accepted'::text, 'revoked'::text, 'expired'::text, 'invitation_revoked'::text, 'invited'::text, 'failed'::text])))
);
