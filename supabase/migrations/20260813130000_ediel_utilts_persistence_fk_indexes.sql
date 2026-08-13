begin;

create index if not exists ediel_ack_transaction_results_persisted_series_idx
  on public.ediel_ack_transaction_results(persisted_series_id)
  where persisted_series_id is not null;

create index if not exists meter_reading_series_supersedes_idx
  on public.meter_reading_series(supersedes_series_id)
  where supersedes_series_id is not null;

commit;
