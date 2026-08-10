insert into public.gridex_data_retention_policies (
  data_category, retention_days, action, notes
)
values
  ('legal_audit', 3650, 'archive', 'Legal acceptance, signature and power-of-attorney evidence is archived; never handled as disposable telemetry.'),
  ('security_audit', 1095, 'archive', 'Authentication, authorization and security audit evidence is archived for investigation and compliance.'),
  ('technical_telemetry', 395, 'delete', 'Non-authoritative technical metrics may be deleted after the operational investigation window.'),
  ('ediel_polling', 395, 'delete', 'Polling execution telemetry may be deleted; canonical EDIEL messages and raw market evidence follow their separate archive policy.'),
  ('cron_executions', 395, 'delete', 'Completed scheduler execution telemetry may be deleted after the operational investigation window.'),
  ('customer_notifications', 730, 'archive', 'Customer-visible notification history is archived separately from short-lived request telemetry.'),
  ('readiness_checks', 395, 'delete', 'Recomputable readiness execution telemetry may be deleted; signed launch evidence is retained separately.')
on conflict (data_category) do update set
  retention_days = excluded.retention_days,
  action = excluded.action,
  notes = excluded.notes,
  updated_at = now();
