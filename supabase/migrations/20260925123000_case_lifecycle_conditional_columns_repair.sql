-- The 20260520 case migration conditionally extended relations that a clean
-- install created later. Restore those columns without rewriting that history.
BEGIN;
ALTER TABLE public.customer_contracts
 ADD COLUMN IF NOT EXISTS is_distance_agreement boolean NOT NULL DEFAULT false,
 ADD COLUMN IF NOT EXISTS withdrawal_information_sent_at timestamptz,
 ADD COLUMN IF NOT EXISTS withdrawal_deadline_at timestamptz,
 ADD COLUMN IF NOT EXISTS billing_blocked_by_case_id uuid;
CREATE INDEX IF NOT EXISTS customer_contracts_withdrawal_idx
 ON public.customer_contracts(company_id,withdrawal_deadline_at,status);

ALTER TABLE public.billing_underlays
 ADD COLUMN IF NOT EXISTS billing_blocked_by_case_id uuid;
CREATE INDEX IF NOT EXISTS billing_underlays_case_block_idx
 ON public.billing_underlays(company_id,billing_blocked_by_case_id);

ALTER TABLE public.partner_exports
 ADD COLUMN IF NOT EXISTS customer_case_id uuid;
CREATE INDEX IF NOT EXISTS partner_exports_customer_case_idx
 ON public.partner_exports(company_id,customer_case_id);
COMMIT;
