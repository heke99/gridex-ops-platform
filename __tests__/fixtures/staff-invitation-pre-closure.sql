-- Verbatim declaration from failed native artifact11304103137,
-- rem002-schema-snapshot/schema.sql at remote2f2b86e7. No staff runtime columns.
-- Declaration SHA256c457c78774df3cbf624cead526b59ee2f594ac4d7016b4f628e3fa65ce1c82dd.
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

ALTER TABLE ONLY public.company_invitations
    ADD CONSTRAINT company_invitations_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.company_invitations
    ADD CONSTRAINT company_invitations_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX company_invitations_company_idempotency_key ON public.company_invitations USING btree (company_id, idempotency_key) WHERE (idempotency_key IS NOT NULL);

ALTER TABLE public.company_invitations ENABLE ROW LEVEL SECURITY;
