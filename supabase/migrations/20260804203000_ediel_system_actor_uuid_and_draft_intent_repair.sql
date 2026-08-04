-- UUID provenance columns represent real users only. Automated EDIEL workers
-- keep those columns null and record their system identity in structured
-- validation/audit metadata instead of using string sentinels such as 'system'.
-- Also repair legacy draft intents that are already known to violate the hard
-- facility identity gate so the five-minute resume sweep stops retrying them.

begin;

comment on column public.ediel_message_intents.created_by is
  'Optional real user UUID. Null means the intent was created by an automated system process; system provenance belongs in payload/validation metadata.';
comment on column public.ediel_message_intents.updated_by is
  'Optional real user UUID. Null means the latest transition was performed by an automated system process; never store text sentinels in this UUID column.';
comment on column public.ediel_messages.created_by is
  'Optional real user UUID. Automated EDIEL creation is represented by null plus message metadata.';
comment on column public.ediel_messages.updated_by is
  'Optional real user UUID. Automated EDIEL updates are represented by null plus event/audit metadata.';

with malformed_drafts as (
  select intent.id
  from public.ediel_message_intents intent
  where intent.validation_status = 'draft'
    and intent.direction = 'outbound'
    and intent.ediel_message_id is null
    and intent.outbox_status = 'not_queued'
    and intent.business_process in ('customer_masterdata','supplier_switch')
    and nullif(btrim(intent.facility_id),'') is null
    and nullif(btrim(intent.metering_point_id),'') is null
)
update public.ediel_message_intents intent
set
  validation_status = 'blocked',
  blocking_reasons = jsonb_build_array(jsonb_build_object(
    'code','facility_or_metering_point_missing',
    'message','Anläggnings-ID/mätpunkts-ID saknas. Intent blockeras – begär anläggningsuppgifter från nätägaren innan meddelandet kan förberedas.',
    'severity','block',
    'details',jsonb_build_object(
      'required_admin_action','request_facility_information',
      'repaired_by','ediel_system_actor_uuid_and_draft_intent_repair'
    )
  )),
  validation_result = coalesce(intent.validation_result,'{}'::jsonb)
    || jsonb_build_object(
      'ok',false,
      'status','blocked',
      'checkedAt',now(),
      'source','ediel_system_actor_uuid_and_draft_intent_repair',
      'system_actor','database_migration'
    ),
  updated_at = now()
from malformed_drafts repair
where intent.id = repair.id;

commit;
