-- Stable source identity, original bytes/context and forbidden derived effects.
SELECT jsonb_build_object(
 'companies',(SELECT jsonb_agg(jsonb_build_object('id',id,'name',name,'status',status) ORDER BY id)
   FROM public.companies WHERE id IN('00000000-0000-4000-8000-00000000d080','00000000-0000-4000-8000-00000000d081')),
 'original',(SELECT jsonb_build_object('id',id,'company',company_id,'environment',environment,'direction',direction,
   'family',message_family,'code',message_code,'status',status,'raw',raw_payload,'received',message_received_at,
   'context',execution_context_snapshot,'application',application_reference,'sender',sender_ediel_id,'receiver',receiver_ediel_id,
   'rulePack',canonical_rule_pack_id,'profile',rule_profile_key,'profileVersion',rule_profile_version_id,'ruleChecksum',rule_pack_checksum)
   FROM public.ediel_messages WHERE id='00000000-0000-4000-8000-00000000d082'),
 'outbound',(SELECT count(*) FROM public.ediel_messages WHERE related_message_id='00000000-0000-4000-8000-00000000d082'),
 'outbox',(SELECT count(*) FROM public.ediel_outbox WHERE source_message_id='00000000-0000-4000-8000-00000000d082'),
 'supply',(SELECT count(*) FROM public.customer_supply_periods WHERE source_message_id='00000000-0000-4000-8000-00000000d082'),
 'meteringReceipts',(SELECT count(*) FROM gridex_utilts_binding.receipts WHERE source_message_id='00000000-0000-4000-8000-00000000d082')
);
