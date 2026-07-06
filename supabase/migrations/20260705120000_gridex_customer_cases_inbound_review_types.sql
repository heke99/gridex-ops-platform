-- Align customer_cases.case_type CHECK with the values the inbound Ediel
-- business state machine writes (Workstream D of the flow consolidation audit).
--
-- lib/ediel/flows/inboundBusinessStateMachine.ts inserts customer_cases rows
-- with case_type = 'business_rejection' | 'technical_rejection' |
-- 'metering_values_error' (negative APERAK/CONTRL/UTILTS ERR) and — after the
-- Z05 semantics fix — 'supplier_switch_review'. None of these were allowed by
-- customer_cases_type_check, so every such insert failed at the DB layer and
-- the operator never saw a case for a rejected message.
--
-- Repo convention: drop-and-recreate the CHECK with the full value set.
-- Existing data always satisfies the wider constraint. Forward-only.

do $$
begin
  if to_regclass('public.customer_cases') is null then
    return;
  end if;

  alter table public.customer_cases drop constraint if exists customer_cases_type_check;
  alter table public.customer_cases
    add constraint customer_cases_type_check
    check (case_type in (
      'withdrawal',
      'rejected_customer',
      'onboarding_aborted',
      'supplier_switch_aborted',
      'sales_misunderstanding',
      'dual_invoice_concern',
      'binding_period_too_long',
      'incorrect_identity',
      'incorrect_site_data',
      'missing_authorization',
      'credit_risk',
      'technical_blocker',
      'business_rejection',
      'technical_rejection',
      'metering_values_error',
      'supplier_switch_review',
      'other'
    ));
end $$;
