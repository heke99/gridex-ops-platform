"""Explicit, digest-bound amendment after the original candidate is reconstructed.
Temporary preparation only; old production tests and migration history stay intact.
"""
import hashlib,json,pathlib
root=pathlib.Path.cwd(); changed=[]
def amend(rel, old, new):
    path=root/rel; text=path.read_text()
    assert text.count(old)==1, 'unexpected amendment input: '+rel
    path.write_text(text.replace(old,new)); changed.append(rel)
amend('.e035-tools/prepare_native.py',
"    run(['psql',URL,'-X','-v','ON_ERROR_STOP=1','-f','scripts/manual-inbound-tenant-graph-regression.sql'])",
"""    # The unchanged PR369 clean-upgrade probe requires no existing reserved
    # receipt keys. Remove ONLY this helper's operational fixtures through the
    # real DELETE path; the new immutable history must survive the cleanup.
    # Do not delete the company: provisioning creates protected published legal
    # texts. The owned disposable stack teardown cleans the complete database.
    check('native-fixture-cleanup-is-exact',sql(f\"SELECT count(*) FROM public.ediel_messages WHERE company_id='{company}';\")=='3')
    sql(f\"DELETE FROM public.ediel_messages WHERE company_id='{company}';\")
    check('native-fixture-delete-retains-durable-sources',sql(f\"SELECT count(*) FROM gridex_received_sources.sources WHERE company_id='{company}';\")=='2')
    check('native-fixture-delete-retains-linked-assessments',sql(f\"SELECT count(*) FROM gridex_received_sources.validation_assessments WHERE company_id='{company}';\")=='2')
    check('old-upgrade-fixtures-have-clean-operational-input',sql(\"SELECT count(*) FROM public.ediel_messages WHERE execution_context_snapshot ? 'receivedProdatContext';\")=='0')
    run(['psql',URL,'-X','-v','ON_ERROR_STOP=1','-f','scripts/manual-inbound-tenant-graph-regression.sql'])""")
amend('scripts/ediel-source-ledger-regression.sql',
"ELSE EXECUTE format('%s %s gridex_received_sources.%I',command,CASE WHEN command='DELETE' THEN 'FROM' ELSE 'TABLE' END,tab); END IF;",
"ELSE EXECUTE format('%s %s gridex_received_sources.%I%s',command,CASE WHEN command='DELETE' THEN 'FROM' ELSE 'TABLE' END,tab,CASE WHEN command='TRUNCATE' THEN ' CASCADE' ELSE '' END); END IF;")
amend('quality/audits/ediel-masterplan-v2/e035-source-ledger/forward-ledger.sql.template',
"  pack:=facts->'rulePackEvidence';\n  IF pack IS DISTINCT FROM 'null'::jsonb THEN",
"""  pack:=facts->'rulePackEvidence';
  IF facts->>'applicationDecision'='accepted' AND (pack IS NULL OR pack='null'::jsonb) THEN
    RAISE EXCEPTION 'received_validation_rule_evidence_unavailable' USING ERRCODE='23514';
  END IF;
  IF pack IS DISTINCT FROM 'null'::jsonb THEN""")
amend('scripts/ediel-source-ledger-regression.sql',
"ARRAY['company','environment','hash','approval','object','party','reason','rule-version']",
"ARRAY['company','environment','hash','approval','object','party','reason','rule-version','accepted-without-rule-version']")
amend('scripts/ediel-source-ledger-regression.sql',
"  IF mode='rule-version' THEN altered:=jsonb_set(altered,'{rulePackEvidence}','{\"sourceHash\":\"unknown\"}'); END IF;",
"  IF mode='rule-version' THEN altered:=jsonb_set(altered,'{rulePackEvidence}','{\"sourceHash\":\"unknown\"}'); END IF;\n  IF mode='accepted-without-rule-version' THEN altered:=jsonb_set(altered,'{applicationDecision}','\"accepted\"'); END IF;")
manifest=root/'.e035-tools/input-manifest.json'; data=json.loads(manifest.read_text())
for f in data['files']:
    if f['path'] in changed: f['sha256']=hashlib.sha256((root/f['path']).read_bytes()).hexdigest()
manifest.write_text(json.dumps(data,indent=2)+'\n')
prov=root/'.e035-tools/provenance.json'; p=json.loads(prov.read_text());p['amendment_r1']={'sha256':hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest(),'first_run':35706199237,'first_artifact':10684747327,'first_failure':'committed native fixtures interfered with unchanged PR369 clean upgrade; tests not weakened','changed_files':sorted(set(changed))};p['amendment_r2']={'previous_run':35707430401,'previous_artifact':10685096430,'fix':'remove only owned operational messages, retain synthetic company and published legal texts; no production legal or source guards changed'};p['files']=data['files'];prov.write_text(json.dumps(p,indent=2)+'\n')
print('Applied digest-bound r1/r2 amendment:',sorted(set(changed)))
