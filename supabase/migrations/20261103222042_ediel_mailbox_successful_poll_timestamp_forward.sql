begin;

-- Successful poll completion records this separately from poll attempts.
-- Existing rows intentionally remain NULL; no historical success is inferred.
alter table public.ediel_mailboxes
  add column if not exists last_successful_poll_at timestamptz;

notify pgrst, 'reload schema';

commit;
