-- Complaint events on communication_logs previously overwrote bounced_at,
-- conflating bounces and spam complaints in reporting. Adds a dedicated
-- complaint timestamp. Additive and forward-only.

do $$
begin
  if to_regclass('public.communication_logs') is not null then
    alter table public.communication_logs
      add column if not exists complained_at timestamptz;
  end if;
end $$;
