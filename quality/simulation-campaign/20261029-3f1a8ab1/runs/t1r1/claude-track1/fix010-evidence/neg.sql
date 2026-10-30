SELECT 'NEG wrong_tenant', pg_temp.try(gen_random_uuid(), array(SELECT id FROM ids WHERE rn=1));
SELECT 'NEG other_company_real', pg_temp.try((SELECT id FROM companies WHERE id<>:C ORDER BY id LIMIT 1), array(SELECT id FROM ids WHERE rn=1));
SELECT 'NEG unknown_id', pg_temp.try(:C, ARRAY[gen_random_uuid()]);
SELECT 'NEG null_id', pg_temp.try(:C, ARRAY[NULL::uuid]);
SAVEPOINT dec;
SET LOCAL ROLE postgres;ALTER TABLE ediel_messages DISABLE TRIGGER USER;
UPDATE ediel_messages m SET raw_payload=regexp_replace(m.raw_payload,'(QTY\+[0-9A-Z]+:)[0-9.]+','\11..5','g')
 FROM normalized_metering_values n WHERE n.company_id=:C AND n.id=(SELECT id FROM ids WHERE rn=1) AND m.id=n.source_message_id;
ALTER TABLE ediel_messages ENABLE TRIGGER USER;
SELECT 'NEG invalid_decimal', pg_temp.try(:C, array(SELECT id FROM ids WHERE rn=1));
ROLLBACK TO SAVEPOINT dec;
SELECT 'NEG valid_after_restore', pg_temp.try(:C, array(SELECT id FROM ids WHERE rn=1));
