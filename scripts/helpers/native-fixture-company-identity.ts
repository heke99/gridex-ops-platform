// Local native-fixture allocation only. Production identity constraints stay authoritative.
import {isValidSwedishOrganizationNumber} from '../../e2e/production/helpers/swedish-organization-number.mjs'

/** Apply the original synthetic legal fields once and return the actual stored
 * organisation number. Only the exact occupied-company-org constraint permits
 * trying the next supplied valid candidate; every other SQL failure propagates. */
export function nativeFixtureCompanyIdentitySql(companyId:string,organizationNumbers:readonly string[]):string{
 if(!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(companyId))throw Error('native_fixture_company_uuid_required')
 if(organizationNumbers.length===0||organizationNumbers.length>32||organizationNumbers.some(value=>!isValidSwedishOrganizationNumber(value))){
  throw Error('native_fixture_company_valid_org_candidates_required')
 }
 const candidates=organizationNumbers.map(value=>`'${value.replace(/\D/g,'')}'`).join(',')
 return `BEGIN;
 DO $native_fixture_company_org$
 DECLARE candidate text;assigned boolean:=false;violated_constraint text;violated_table text;violated_schema text;
 BEGIN
  FOREACH candidate IN ARRAY ARRAY[${candidates}]::text[] LOOP
   BEGIN
    UPDATE public.companies SET legal_name='Synthetic Archive AB',org_number=candidate,
      address_line_1='Testgatan 1',postal_code='123 45',city='Teststad',country_code='SE',
      support_email='service@example.invalid',phone='0101234567',website='https://example.invalid'
     WHERE id='${companyId}'::uuid;
    IF NOT FOUND THEN RAISE EXCEPTION 'native_fixture_company_required';END IF;
    assigned:=true;EXIT;
   EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS violated_constraint=CONSTRAINT_NAME,violated_table=TABLE_NAME,violated_schema=SCHEMA_NAME;
    IF violated_constraint IS DISTINCT FROM 'ux_companies_normalized_org'
      OR violated_table IS DISTINCT FROM 'companies' OR violated_schema IS DISTINCT FROM 'public' THEN RAISE;END IF;
   END;
  END LOOP;
  IF NOT assigned THEN RAISE EXCEPTION 'native_fixture_company_org_candidates_exhausted';END IF;
 END $native_fixture_company_org$;
 SELECT to_jsonb(org_number) FROM public.companies WHERE id='${companyId}'::uuid;
 COMMIT;`
}
