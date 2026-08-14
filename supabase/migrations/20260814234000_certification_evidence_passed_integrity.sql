-- Fail closed on approved production evidence even for service-role writers.
-- Runtime expiry remains dynamic in application readiness; this constraint
-- protects the immutable structural requirements of a passed evidence row.

begin;

alter table public.ediel_certification_evidence
  add constraint ediel_certification_evidence_passed_integrity_check
  check (
    status <> 'passed'
    or (
      nullif(btrim(external_reference), '') is not null
      and nullif(btrim(evidence_document_reference), '') is not null
      and tested_at is not null
      and approved_by is not null
      and approved_at is not null
      and tested_at <= approved_at
      and (valid_until is null or valid_until > tested_at)
    )
  ) not valid;

alter table public.ediel_certification_evidence
  validate constraint ediel_certification_evidence_passed_integrity_check;

comment on constraint ediel_certification_evidence_passed_integrity_check
  on public.ediel_certification_evidence
  is 'Passed production evidence must be traceable, tested, explicitly approved, and temporally coherent.';

commit;
