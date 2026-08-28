-- Canonical Ediel deadline authority.
--
-- Normative Swedish market timing is source-controlled in
-- lib/ediel/rulebook/deadlinePolicy.ts and derived from Svensk
-- Elmarknadshandbok 26A. These historical DB tables are retained for audit,
-- provenance and migration evidence only; runtime must not read them as rule
-- authorities.

begin;

do $$
begin
  if to_regclass('public.ediel_business_deadline_rules') is not null then
    update public.ediel_business_deadline_rules
       set is_active = false,
           metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
             'authority', 'evidence_only',
             'canonical_runtime_owner', 'lib/ediel/rulebook/deadlinePolicy.ts',
             'demoted_at', '2026-08-28'
           ),
           updated_at = now()
     where is_active = true;

    execute 'comment on table public.ediel_business_deadline_rules is ''Historical Ediel deadline evidence/projection only. Normative runtime authority: lib/ediel/rulebook/deadlinePolicy.ts.''';
  end if;

  if to_regclass('public.market_process_policies') is not null then
    -- The only active runtime consumer was SupplierSwitchScheduler. Z03 timing
    -- now comes from the canonical handbook policy, so supplier-switch policy
    -- rows remain history but cannot be selected as active normative rules.
    update public.market_process_policies
       set is_active = false,
           updated_at = now()
     where process_code = 'supplier_switch'
       and is_active = true;

    execute 'comment on table public.market_process_policies is ''Historical/application process policy evidence. Ediel supplier-switch timing is canonical source-controlled policy and must not be redefined here.''';
  end if;
end $$;

commit;
