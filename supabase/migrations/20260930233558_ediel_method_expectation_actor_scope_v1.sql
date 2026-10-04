-- Forward correction: watcher registration/expiry uses the same SEND permission
-- union as actual provider entry. Observation remains a preparation action.
-- No original migration, source receipt or frozen timer basis is rewritten.
BEGIN;
DO $$
DECLARE body text;needle text;replacement text;
BEGIN
 SELECT pg_get_functiondef('gridex_method_expectations.mutate_v1(jsonb)'::regprocedure) INTO body;
 needle:=$old$public.gridex_actor_has_company_permission(actor,c,CASE WHEN action='read' THEN 'communication.read' WHEN action='register' THEN 'communication.send' ELSE 'communication.write' END) IS NOT TRUE$old$;
 replacement:=$new$(CASE WHEN action='read' THEN public.gridex_actor_has_company_permission(actor,c,'communication.read')
   WHEN action IN('register','expire') THEN (public.gridex_actor_has_company_permission(actor,c,'ediel.send') OR public.gridex_actor_has_company_permission(actor,c,'communication.send'))
   ELSE public.gridex_actor_has_company_permission(actor,c,'communication.write') END) IS NOT TRUE$new$;
 IF strpos(body,needle)=0 THEN RAISE EXCEPTION 'ediel_method_expectation_actor_owner_contract_changed';END IF;
 EXECUTE replace(body,needle,replacement);

 SELECT pg_get_functiondef('gridex_method_expectations.compatible_v1(jsonb,jsonb,jsonb)'::regprocedure) INTO body;
 needle:=$old$b->>'subtype' NOT IN('F','G')$old$;
 IF strpos(body,needle)=0 THEN RAISE EXCEPTION 'ediel_method_expectation_subtype_owner_contract_changed';END IF;
 EXECUTE replace(body,needle,$new$(b->>'subtype' IN('F','G')) IS NOT TRUE$new$);
END $$;
COMMIT;
