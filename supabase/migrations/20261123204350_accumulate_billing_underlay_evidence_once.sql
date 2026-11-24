-- Apply the E66 month owner and record its migration in the same transaction.
SET lock_timeout = '5s';
SET statement_timeout = '60s';
DO $gridex_e66_month_owner$
BEGIN
DO $migration$
DECLARE f record; output text;
 declaration constant text := $old$rows_basis jsonb:='[]';$old$;
 array_declaration constant text := $new$rows_basis jsonb[]:='{}';$new$;
 concatenate constant text := $old$rows_basis:=rows_basis||jsonb_build_array(basis||jsonb_build_object('revisionNumber',n.revision_number,'supplyPeriodId',sp.id));$old$;
 append_element constant text := $new$rows_basis:=array_append(rows_basis,basis||jsonb_build_object('revisionNumber',n.revision_number,'supplyPeriodId',sp.id));$new$;
 values_member constant text := $old$'values',rows_basis,'supply'$old$;
 converted_member constant text := $new$'values',to_jsonb(rows_basis),'supply'$new$;
BEGIN
 SELECT p.oid,p.prosrc,pg_get_functiondef(p.oid) AS definition,to_jsonb(p)-'prosrc' AS metadata
 INTO STRICT f FROM pg_proc p
 WHERE p.oid=to_regprocedure('public.gridex_store_billing_underlay(uuid,jsonb,jsonb,uuid)');
 IF encode(sha256(convert_to(f.prosrc,'UTF8')),'hex') IS DISTINCT FROM
      'ba59faf05e9c807608147eca6b6c36cbac8ec84ab18974e19dd3477c3c15e7f5'
  OR (length(f.prosrc)-length(replace(f.prosrc,declaration,'')))/length(declaration)<>1
  OR (length(f.prosrc)-length(replace(f.prosrc,concatenate,'')))/length(concatenate)<>1
  OR (length(f.prosrc)-length(replace(f.prosrc,values_member,'')))/length(values_member)<>1
 THEN RAISE EXCEPTION 'billing_underlay_array_predecessor_changed'; END IF;
 output:=replace(replace(replace(f.prosrc,declaration,array_declaration),concatenate,append_element),values_member,converted_member);
 EXECUTE replace(f.definition,f.prosrc,output);
 IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=f.oid) IS DISTINCT FROM f.metadata
  OR (SELECT p.prosrc FROM pg_proc p WHERE p.oid=f.oid) IS DISTINCT FROM output
 THEN RAISE EXCEPTION 'billing_underlay_array_metadata_changed'; END IF;
END
$migration$;
END
$gridex_e66_month_owner$;
RESET statement_timeout;
RESET lock_timeout;
