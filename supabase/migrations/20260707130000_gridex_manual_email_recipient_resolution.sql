-- Manual grid-owner e-mail recipient resolution metadata.
--
-- manual_email_outbox previously stored only to_email/from_email/reply_to with
-- no record of WHY a recipient was chosen. Production incident follow-up needs
-- to distinguish: real_grid_owner_contact | safe_recipient_override |
-- manual_override | missing_contact, the actual grid-owner contact address,
-- the contact source row, environment and whether a production send used a
-- safe/internal override. Additive and forward-only.

do $$
begin
  if to_regclass('public.manual_email_outbox') is not null then
    alter table public.manual_email_outbox
      add column if not exists recipient_resolution jsonb;
    comment on column public.manual_email_outbox.recipient_resolution is
      'Recipient resolution evidence: resolution_mode (real_grid_owner_contact|safe_recipient_override|manual_override|missing_contact), selected_to_email, actual_grid_owner_contact_email, contact source table/id, contact_verified, environment, reason, production_safe_override_warning, externally_sendable.';
  end if;
end $$;
