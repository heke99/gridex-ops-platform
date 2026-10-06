\set ON_ERROR_STOP on
-- Run against a disposable replay database. No authority or business rows are
-- created: this tests the actual bounded SQL decoder, not a second parser.
BEGIN;
DO $regression$
DECLARE
 header text := 'UNB+UNOC:3+11111:14+22222:14+261006:1200+INTERCHANGE-17''UNH+MESSAGE-19+PRODAT:D:96B:UN:SVK''BGM+Z06+BGM-23+9''NAD+FR+11111:160:SVK''NAD+DO+22222:160:SVK''';
 first_register text := 'LIN+1++735999999999999999:::9''DTM+157:202611010000:203''CCI++Z13''CAV+E34''RFF+LI:ORIGINAL-29''NAD+UD+1234567890:SE2:260++SYNTHETIC CUSTOMER+TEST ROAD+TEST++12345+SE''';
 repeat_register text := 'LIN+2++735999999999999999:::9''CCI++Z13''CAV+E34''';
 single_wire text;
 repeat_wire text;
 single_result jsonb;
 repeat_result jsonb;
 held_result jsonb;
 failures text[] := ARRAY[]::text[];
BEGIN
 single_wire := header || first_register || 'UNT+12+MESSAGE-19''UNZ+1+INTERCHANGE-17''';
 repeat_wire := header || first_register || repeat_register || 'UNT+15+MESSAGE-19''UNZ+1+INTERCHANGE-17''';
 single_result := gridex_customer_life_events.wire_partition_v1(single_wire);
 repeat_result := gridex_customer_life_events.wire_partition_v1(repeat_wire);
 IF single_result->>'interchange' IS DISTINCT FROM 'INTERCHANGE-17'
 OR single_result->>'messageReference' IS DISTINCT FROM 'MESSAGE-19'
 OR single_result->>'unh' IS DISTINCT FROM 'MESSAGE-19'
 OR single_result->>'bgmId' IS DISTINCT FROM 'BGM-23'
 OR single_result->>'code' IS DISTINCT FROM 'Z06'
 OR single_result->>'legalSender' IS DISTINCT FROM '11111'
 OR single_result->>'legalReceiver' IS DISTINCT FROM '22222' THEN
  failures := array_append(failures, 'physical_header_projection');
 END IF;
 IF jsonb_typeof(single_result#>'{objects,0,lineIndexes}') IS DISTINCT FROM 'array'
 OR single_result#>'{objects,0,lineIndexes}' IS DISTINCT FROM '[5]'::jsonb
 OR jsonb_typeof(single_result#>'{objects,0,body}') IS DISTINCT FROM 'array'
 OR jsonb_array_length(single_result->'objects') IS DISTINCT FROM 1 THEN
  failures := array_append(failures, 'single_register_partition');
 END IF;
 IF repeat_result#>'{objects,0,lineIndexes}' IS DISTINCT FROM '[5,11]'::jsonb
 OR jsonb_typeof(repeat_result#>'{objects,0,body}') IS DISTINCT FROM 'array'
 OR jsonb_array_length(repeat_result->'objects') IS DISTINCT FROM 1
 OR repeat_result#>>'{objects,0,li}' IS DISTINCT FROM 'ORIGINAL-29'
 OR repeat_result#>>'{objects,0,projectionHeld}' = 'true' THEN
  failures := array_append(failures, 'repeated_register_array_partition');
 ELSE
  IF jsonb_array_length(repeat_result#>'{objects,0,body}') IS DISTINCT FROM 7
  OR repeat_result#>'{objects,0,body}' IS DISTINCT FROM
     (single_result#>'{objects,0,body}') || '[{"tag":"CCI","elements":[["CCI"],[""],["Z13"]]},{"tag":"CAV","elements":[["CAV"],["E34"]]}]'::jsonb THEN
   failures := array_append(failures, 'ordered_complete_register_body');
  END IF;
 END IF;
 held_result := gridex_customer_life_events.wire_partition_v1(
  header || first_register || repeat_register || 'RFF+LI:FOREIGN-ORIGINAL''UNT+16+MESSAGE-19''UNZ+1+INTERCHANGE-17''');
 IF held_result#>>'{objects,0,projectionHeld}' IS DISTINCT FROM 'true'
 OR gridex_customer_life_events.wire_v1(
  header || first_register || repeat_register || 'RFF+LI:FOREIGN-ORIGINAL''UNT+16+MESSAGE-19''UNZ+1+INTERCHANGE-17''') IS NOT NULL THEN
  failures := array_append(failures, 'conflicting_sibling_stays_held');
 END IF;
 IF gridex_customer_life_events.wire_partition_v1(left(single_wire,length(single_wire)-1)) IS NOT NULL
 OR gridex_customer_life_events.wire_partition_v1(replace(single_wire,'BGM+Z06+BGM-23+9''','BGM+Z06+BGM-23+9''BGM+Z06+OTHER+9''')) IS NOT NULL
 OR gridex_customer_life_events.wire_v1(replace(single_wire,':::9',':::UNKNOWN')) IS NOT NULL THEN
  failures := array_append(failures, 'malformed_or_unqualified_source_refused');
 END IF;
 IF cardinality(failures)>0 THEN
  RAISE EXCEPTION 'customer_wire_partition_regression: %', array_to_string(failures, ',');
 END IF;
 RAISE NOTICE 'customer_wire_partition_regression: six decoder contracts PASS';
END $regression$;
ROLLBACK;
