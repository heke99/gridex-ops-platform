-- Clean up duplicate inbound links in Ediel system-test runs.
-- This does not delete ediel_messages history. It only removes duplicate rows from
-- the run-link table so one test step does not show the same inbound business
-- message multiple times after IMAP retries/re-imports.

with ranked_links as (
  select
    link.id,
    row_number() over (
      partition by
        link.test_run_id,
        link.step_no,
        msg.direction,
        msg.message_family,
        coalesce(msg.message_code, ''),
        coalesce(msg.sender_ediel_id, ''),
        coalesce(msg.receiver_ediel_id, '')
      order by
        case when msg.status in ('failed', 'cancelled') then 1 else 0 end asc,
        msg.created_at desc,
        link.created_at desc
    ) as duplicate_rank
  from public.ediel_test_run_messages link
  join public.ediel_messages msg on msg.id = link.ediel_message_id
  where msg.direction = 'inbound'
    and link.step_no is not null
)
delete from public.ediel_test_run_messages link
using ranked_links ranked
where link.id = ranked.id
  and ranked.duplicate_rank > 1;
