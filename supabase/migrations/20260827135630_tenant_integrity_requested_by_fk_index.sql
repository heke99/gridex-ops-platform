create index if not exists tenant_integrity_runs_requested_by_idx
  on public.tenant_integrity_audit_runs(requested_by)
  where requested_by is not null;
