-- lib/ediel/inboundCases.ts (EdielInboundCaseRow), app/admin/ediel actions and
-- the PRODAT object batch owner (20261001083359, 20261001092757) read and write
-- review columns on public.ediel_inbound_cases that no migration ever created:
-- creating an inbound case failed in PostgREST (schema cache: match_confidence)
-- and gridex_prodat_object_batch.* failed at runtime on row_case.review_decision.
--
-- Add exactly those columns. Existing rows keep their payload; family/code are
-- taken from their own Ediel message, parsed/proposed facts default to empty
-- objects, and no review/application fact is invented for them.
BEGIN;
DO $pre$BEGIN
 IF to_regclass('public.ediel_inbound_cases') IS NULL OR EXISTS(SELECT FROM information_schema.columns
  WHERE table_schema='public' AND table_name='ediel_inbound_cases' AND column_name IN('message_family','match_confidence','review_decision'))
 THEN RAISE EXCEPTION 'ediel_inbound_cases_review_columns_predecessor_required';END IF;
END$pre$;
ALTER TABLE public.ediel_inbound_cases
 ADD COLUMN message_family text,
 ADD COLUMN message_code text,
 ADD COLUMN transaction_type text,
 ADD COLUMN match_confidence numeric(5,2),
 ADD COLUMN parsed_customer jsonb NOT NULL DEFAULT '{}'::jsonb,
 ADD COLUMN parsed_site jsonb NOT NULL DEFAULT '{}'::jsonb,
 ADD COLUMN parsed_metering_point jsonb NOT NULL DEFAULT '{}'::jsonb,
 ADD COLUMN parsed_contract jsonb NOT NULL DEFAULT '{}'::jsonb,
 ADD COLUMN parsed_production jsonb NOT NULL DEFAULT '{}'::jsonb,
 ADD COLUMN proposed_action jsonb NOT NULL DEFAULT '{}'::jsonb,
 ADD COLUMN review_decision jsonb,
 ADD COLUMN reviewed_by uuid REFERENCES auth.users(id),
 ADD COLUMN reviewed_at timestamptz,
 ADD COLUMN applied_at timestamptz,
 ADD COLUMN failure_reason text;
UPDATE public.ediel_inbound_cases c SET message_family=m.message_family,message_code=m.message_code
 FROM public.ediel_messages m WHERE m.id=c.ediel_message_id AND m.company_id IS NOT DISTINCT FROM c.company_id;
ALTER TABLE public.ediel_inbound_cases
 ADD CONSTRAINT ediel_inbound_cases_match_confidence_range CHECK (match_confidence IS NULL OR match_confidence BETWEEN 0 AND 100),
 ADD CONSTRAINT ediel_inbound_cases_review_pair CHECK ((reviewed_at IS NULL)=(reviewed_by IS NULL));
CREATE INDEX idx_ediel_inbound_cases_reviewed_by ON public.ediel_inbound_cases(reviewed_by) WHERE reviewed_by IS NOT NULL;
COMMIT;
