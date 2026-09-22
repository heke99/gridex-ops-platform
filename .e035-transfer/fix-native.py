from pathlib import Path
import json
p=Path('scripts/ediel-source-owner-native.test.ts')
s=p.read_text().replace('outbound:id(11),reviewer:id(12)}','outbound:id(11),reviewer:id(12),route:id(13),routeProfile:id(14)}')
needle='  INSERT INTO public.ediel_messages(id,company_id,customer_id,site_id,metering_point_id,environment,direction,message_standard,message_family,message_code,status,raw_payload,parsed_payload,message_sent_at,application_reference,canonical_rule_pack_id,rule_profile_key,rule_profile_version_id,rule_profile_version,rule_pack_checksum,rule_pack_snapshot)'
replacement="""  INSERT INTO public.communication_routes(id,company_id,route_name,grid_owner_id,environment_type,is_active)
  VALUES(${p('route')},${p('company')},'Isolated synthetic native route',${p('grid')},'test',true);
  INSERT INTO public.ediel_route_profiles(id,company_id,communication_route_id,route_name,environment,message_standard,sender_ediel_id,receiver_ediel_id,application_reference,is_enabled)
  VALUES(${p('routeProfile')},${p('company')},${p('route')},'Isolated synthetic native profile','test','edifact','54321','12345','23-DDQ-PRODAT',true);
  INSERT INTO public.ediel_messages(id,company_id,customer_id,site_id,metering_point_id,environment,direction,message_standard,message_family,message_code,status,raw_payload,parsed_payload,message_sent_at,application_reference,communication_route_id,route_profile_id,source_operation_id,canonical_rule_pack_id,rule_profile_key,rule_profile_version_id,rule_profile_version,rule_pack_checksum,rule_pack_snapshot)"""
assert needle in s
s=s.replace(needle,replacement).replace("'{}',clock_timestamp(),'23-DDQ-PRODAT',pack.id,profile.profile_key", "'{}',clock_timestamp(),'23-DDQ-PRODAT',${p('route')},${p('routeProfile')},${p('switch')},pack.id,profile.profile_key")
p.write_text(s)
p=Path('app/admin/ediel/structure-actions.ts');s=p.read_text();s=s.replace('||!confirmed||replacement!==null',"||!confirmed||form.getAll('replacesSourceMessageId').length>1||replacement!==null");p.write_text(s)
p=Path('scripts/supabase-types-manifest.json');data=json.loads(p.read_text());data.update(generated_at='2026-09-22T22:16:28Z',generated_with='supabase-cli-2.101.0-empty-replay-typegen-run35791176951',latest_migration='20260922205926_ediel_reviewed_structural_source.sql',latest_migration_schema_effect='Private structural-review owner guards and existing UTILTS persistence body/check constraints; actual empty replay native run35791176951 generated identical public types. Seven new native fixtures failed canonical route requirements; this typegen receipt is NOT business acceptance.');p.write_text(json.dumps(data,indent=2)+'\n')
