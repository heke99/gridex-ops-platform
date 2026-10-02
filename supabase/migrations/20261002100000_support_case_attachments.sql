-- Tenantservice: private support-case attachments with quarantine.
--
-- Every file starts as 'quarantined' in a private bucket. Only after the content inspection
-- passes (real file type from magic bytes, allow-listed types, no active PDF content, size
-- limit) is it 'released'. Customers only ever see released files that staff or they themselves
-- attached as customer-visible. Rejected files stay recorded (no silent loss) but are never
-- served. Forward-only; deletes nothing.
BEGIN;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('support-case-attachments', 'support-case-attachments', false, 10485760,
        ARRAY['application/pdf', 'image/png', 'image/jpeg']::text[])
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE TABLE public.customer_case_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL,
  customer_case_id uuid NOT NULL,
  public_reference text NOT NULL UNIQUE CHECK (public_reference ~ '^support_attachment_[A-Za-z0-9_-]{16,64}$'),
  file_name text NOT NULL CHECK (length(file_name) BETWEEN 1 AND 160),
  declared_mime_type text,
  detected_mime_type text CHECK (detected_mime_type IS NULL OR detected_mime_type IN ('application/pdf', 'image/png', 'image/jpeg')),
  byte_size integer NOT NULL CHECK (byte_size BETWEEN 1 AND 10485760),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  storage_path text NOT NULL UNIQUE,
  visibility text NOT NULL CHECK (visibility IN ('customer', 'internal')),
  uploaded_by_kind text NOT NULL CHECK (uploaded_by_kind IN ('customer', 'staff')),
  uploaded_by_user_id uuid,
  api_client_id uuid,
  scan_status text NOT NULL DEFAULT 'quarantined' CHECK (scan_status IN ('quarantined', 'released', 'rejected')),
  scan_reason text,
  scanned_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_case_attachments_release_needs_type CHECK (scan_status <> 'released' OR detected_mime_type IS NOT NULL),
  CONSTRAINT customer_case_attachments_customer_upload_visible CHECK (uploaded_by_kind <> 'customer' OR visibility = 'customer'),
  -- Same composite ownership as customer_case_events: case, company and customer must agree.
  CONSTRAINT customer_case_attachments_case_owner_fk FOREIGN KEY (customer_case_id, company_id, customer_id)
    REFERENCES public.customer_cases(id, company_id, customer_id) ON DELETE CASCADE,
  CONSTRAINT customer_case_attachments_company_customer_fkey FOREIGN KEY (company_id, customer_id)
    REFERENCES public.customers(company_id, id)
);

COMMENT ON TABLE public.customer_case_attachments IS
  'Support-case attachments. Files start quarantined; only released files are ever served. Content inspection, not antivirus.';

CREATE INDEX customer_case_attachments_case_idx
  ON public.customer_case_attachments (company_id, customer_case_id, created_at);
CREATE INDEX customer_case_attachments_customer_day_idx
  ON public.customer_case_attachments (company_id, customer_id, created_at);

ALTER TABLE public.customer_case_attachments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.customer_case_attachments FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.customer_case_attachments TO service_role;

INSERT INTO public.platform_table_classification(table_name, kind, rationale, null_company_meaning, classified_by)
VALUES ('customer_case_attachments', 'tenant',
  'Tenant-owned support-case attachment metadata (files in private bucket support-case-attachments). Service-role-only access with RLS enabled.',
  NULL, 'migration:support_case_attachments')
ON CONFLICT (table_name) DO UPDATE SET
  kind = EXCLUDED.kind, rationale = EXCLUDED.rationale, null_company_meaning = EXCLUDED.null_company_meaning,
  classified_by = EXCLUDED.classified_by, classified_at = now();

COMMIT;
