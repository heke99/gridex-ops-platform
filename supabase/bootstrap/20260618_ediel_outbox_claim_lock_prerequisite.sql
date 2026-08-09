-- Derived clean-replay prerequisite from checksum-pinned concurrency source.
-- Restores only the Ediel outbox claim-lock fields consumed by the canonical
-- 20260618200000 queue hardening before it creates lock indexes/functions.
do $$
begin
  if to_regclass('public.ediel_outbox') is not null then
    alter table public.ediel_outbox
      add column if not exists locked_at timestamptz,
      add column if not exists locked_by text,
      add column if not exists send_attempt_count integer not null default 0,
      add column if not exists current_send_attempt_id uuid;
  end if;
end $$;
