#!/usr/bin/env python3
"""Read-only Git/JSON/hash qualification; no test or owner branch mutations."""
import datetime,hashlib,json,pathlib,re,subprocess
ROOT=pathlib.Path('/workspace/agent-review-checkouts/sc001-sc002-sc018-sc056-current-main')
OUT=pathlib.Path('/workspace/agent-review-checkpoints')
MAIN='a8c991c1672d97cb03486a15ca34a16d1b2814e3'
OLD_MAIN='f86a0c5d94811b552f4224fcb73a375d053606d0'
COVERAGE='quality/audits/ediel-masterplan-v2/coverage.json'
def git(*args):return subprocess.check_output(['git',*args],cwd=ROOT)
def blob(ref,path):return git('show',ref+':'+path)
def sha(data):return hashlib.sha256(data).hexdigest()
def flatten(data):return {r['id']:r for s in ('rules','acceptance_contracts') for r in data[s]}
def body(source,name):
 matches=list(re.finditer(r'CREATE(?: OR REPLACE)? FUNCTION '+re.escape(name)+r'\(',source));assert len(matches)==1,(name,len(matches))
 tail=source[matches[0].start():];delimiter=re.search(r'\bAS\s+(\$[^$]*\$)',tail);assert delimiter,name
 return tail[delimiter.end():tail.index(delimiter.group(1),delimiter.end())].strip().encode()
assert git('status','--porcelain')==b''
assert git('rev-parse','HEAD').decode().strip()==MAIN
main_coverage=json.loads(blob(MAIN,COVERAGE));main_rows=flatten(main_coverage)
assert len(main_rows)==352
schema=blob(MAIN,'supabase/schema.sql').decode()
gates=json.loads((OUT/'sc001-sc002-sc018-sc056-a8c991c1-github-gates.json').read_text())
mandatory={'pr-certificate','quality-release-gates','upgrade-migration-replay','clean-migration-replay','verify','browser-public','smoke','coverage','targeted-regressions'}
explanations={
 'lib/ediel/core/runtimeDecision.ts':'Native selected Z14/E66 enter the unchanged accepted success branch. Changes attach failureDisposition and PRODAT internal_review to existing policy/evidence failure branches, retaining manual_review and only independently qualified negative responses; they create no source, grant, positive ACK or send authority.',
 'lib/ediel/flows/utiltsDataRequest.part-1.ts':'Optional TN correlation now receives the already resolved own point. Public selected Z03/Z13 origination does not invoke this link entry. Selected native E66 explicitly supplies actual transaction/point matches to consumption preparation and persistence without linkInboundUtiltsMessageCanonically.',
 'lib/ediel/matching.ts':'TN qualifier parsing, limit2 ambiguity rejection and same-point fallback are inside findMatchingGridOwnerDataRequest. None of the selected order/manual/incident entries or original selected native flow invokes that matcher; explicit qualified native matches remain unchanged. No tenant filter or authority was removed.',
 'lib/ediel/inboundCases.ts':'Only the non-structural inbound case wrapper now explicitly passes inbound/outbound direction to register validation. Selected order generation uses separate outbound renderers. Native service Z14 uses canonical runtime/permission transition and E66 uses explicit consumption preparation, without this wrapper.',
 'lib/ediel/rulebook/prodatRegisterPolicy.ts':'Optional direction is forwarded only by validateProdatRegisterPayload. Existing default validation remains when callers omit it; inbound X/D-false ignore policy is selected by the changed case wrapper. Selected public origination/native canonical runtime and incident owners do not acquire authority from ignored fields.',
 'lib/ediel/security/outboundRecipientCertificate.ts':'Signed Subject/SAN email must match actual smtpTo in the required S/MIME certificate set. Original selected native send explicitly uses smtpMimeMode nodemailer-attachment; transport dispatch branches to certificate resolution only for ediel-smime-enveloped. Public selected tests stop at finite queue/finalizer ports. No old proof is extended to S/MIME.',
 'lib/ediel/services/authorization.ts':'The selected Z13 preparation and customer-card manual bridge reach this boundary. Membership/profile/permission queries, exact predicates, await ordering and original rejection messages are byte-preserved. Only two Error constructors become EdielExecutionFailure security_quarantine; it extends Error and messages remain the strings asserted by selected denial tests. Valid calls return as before; invalid calls still throw before source/RPC/intent/queue effects. No selected caller catches and converts these errors to a national negative or authorization.',
 'lib/inbound-mail/canonicalInboundAckStatusUpdater.ts':'Positive inbound ACK request updates now exclude already confirmed/business_response_received requests. Selected native SC056 creates and sends an original outbound positive APERAK through canonical kernel/atomic SQL; it never consumes an inbound ACK through this updater. Public incident POST/GET owners are unchanged.',
 'lib/inbound-mail/inboundStatusUpdater.ts':'The same positive inbound ACK status guard is applied to legacy safe updates; unresolved intake adds mailbox_message_id. Selected public order/manual/incident entries and selected native explicit received-source/ACK owners invoke neither changed update branch. Prior original/archive/ACK effects remain owned by unchanged source SQL.',
 'scripts/helpers/ediel-normal-switch-native-fixture.ts':'SC001 original normal-Z03 native setup now allocates at most32 deterministic valid organization candidates through a separate helper instead of a random candidate. It writes the same synthetic company legal/contact fields, returns the actual stored number and uses it downstream. Only an exact occupied companies.normalized-org unique violation retries; other failures propagate. This changes disposable seed preparation and prevents fixture collisions; no original native run is relabelled as this fixture execution.',
 'scripts/helpers/native-fixture-company-identity.ts':'New SC001 disposable fixture dependency validates company UUID and1..32 valid organization candidates, updates only that company with the original synthetic legal/contact fields, retries only ux_companies_normalized_org on public.companies and throws on missing/exhausted/other errors. No production source/tenant authority is altered.',
 'e2e/production/helpers/swedish-organization-number.mjs':'Existing unchanged helper becomes a new literal fixture dependency. It computes deterministic559-prefix synthetic numbers and validates the original Luhn/third-digit rules. It supplies candidate values only; no legal/market authority is inferred.',
 'supabase/migrations/20261005020000_ediel_production_contract_ack_confirmation.sql':'New immutable private confirmation table/trigger fires after aperak_status UPDATE but returns unless accepted outbound PRODAT Z09 with current own bound production event. Selected Z03/Z13/UTILTS E66/outbound APERAK messages cannot pass the Z09 family/code predicate, so no new confirmation/table/authority effect occurs in these witnesses. All selected SQL bodies and metadata outside the explicitly read schema delta remain unchanged.',
 'supabase/migrations/20261005004623_customer_contact_version_conflict_http409.sql':'Only the exact known contact-change stale-version exception changes40001 toPT409, with whole pg_proc metadata/source hashes checked. Selected customer-card manual request does not call contact mutation; selected normal/native supplier origination and incident owners do not call it. Source ownership and writes are unchanged.',
 'supabase/migrations/20261005010327_customer_identity_version_conflict_http409.sql':'Only exact known identity-decision stale-version exception changes40001 toPT409; existing definer/approval/takeover/staff actor boundaries are hash/metadata-preserved. These selected entries do not decide identity changes. No selected relation/grant/ACK function is replaced.',
 'supabase/schema.sql':'Current complete snapshot differs from old f86 by the private P08 confirmation function/table/constraints/triggers/RLS/ACL plus exactly the two staff exception codes above. Extracted11 supplier/service and19 manual/incident selected bodies retain their original installed0796 hashes. Complete schema equality to0796 and current installed-schema execution are not claimed.',
 'supabase/schema.fingerprint.json':'Current committed fingerprint differs with the main P08/staff prefix. Merge adopts it byte-exact from current main. This review does not regenerate, borrow, reinterpret or claim a fresh capture.',
 'scripts/ediel-source-owner-native.config.ts':'Only SC003/005 service-native suite was added sincef86; all prior selections remain. Original0796 selected witnesses retain original run/job/config provenance. No old result is relabelled as the expanded current suite.',
 '.github/workflows/full-e2e.yml':'Main changed workflow remains byte-exact in both proposed merge trees. Original0796 artifact provenance is unchanged and bounded to that run; it does not certify new full-E2E workflow execution. Exact owner-head checks are read separately from actual check-runs API.',
}
for pr,head,owned,pair,old_record in [
 (557,'7e00e5a50b3eef141e7eb54c53bb2f05f3a44087',{'SC-001','SC-002'},'sc001-sc002','sc001-sc002-current-main-carry-7e00-independent-receipt.json'),
 (560,'0ad71de342f1f59ef140525622c3c1d8bc38c699',{'SC-018','SC-056'},'sc018-sc056','sc018-sc056-pr560-0ad-minimum-carry-receipt.json')]:
 packet='quality/audits/ediel-masterplan-v2/'+pair+'/'
 previous=json.loads((OUT/old_record).read_text())
 inputs=previous['candidate_inputs'] if pr==557 else previous['inputQualification']['inputs']
 comparisons=[]
 for row in inputs:
  path=row['path'];expected=row.get('candidate_sha256',row.get('currentSha256'))
  assert sha(blob(head,path))==expected,(pr,path)
  comparisons.append({'path':path,'headSha256':expected,'mainSha256':sha(blob(MAIN,path)) if subprocess.run(['git','cat-file','-e',MAIN+':'+path],cwd=ROOT,stderr=subprocess.DEVNULL).returncode==0 else None})
 original=json.loads(blob(head,packet+'independent-receipt.json'))
 bodies=original['qualification']['sqlOwnerBodies'] if pr==557 else original['sourceQualification']['ownerBodies']
 owners=[]
 for row in bodies:
  name=row.get('function',row.get('name'));expected=row.get('sha256',row.get('installedNativeBodySha256'));actual=sha(body(schema,name))
  assert actual==expected,(pr,name,actual,expected)
  owners.append({'name':name,'retainedInstalledBodySha256':expected,'mainBodySha256':actual,'equal':True})
 assert len(owners)==(11 if pr==557 else 19)
 owner=json.loads(blob(head,packet+'verification-receipt.json'))
 envelope=owner['nativeReuse'].get('staticLiteralEnvelope',owner['nativeReuse'].get('staticEnvelope'))
 paths=set(envelope['files']) if 'files'in envelope else {x['path'] for x in envelope['allHashes']}
 delta=set(git('diff','--name-only',OLD_MAIN,MAIN).decode().splitlines())
 intersection=sorted(paths&delta)
 selected=list(intersection)
 if pr==557:selected+=['scripts/helpers/native-fixture-company-identity.ts','e2e/production/helpers/swedish-organization-number.mjs']
 selected+=['supabase/migrations/20261005020000_ediel_production_contract_ack_confirmation.sql','supabase/migrations/20261005004623_customer_contact_version_conflict_http409.sql','supabase/migrations/20261005010327_customer_identity_version_conflict_http409.sql','supabase/schema.sql','supabase/schema.fingerprint.json','scripts/ediel-source-owner-native.config.ts','.github/workflows/full-e2e.yml']
 effects=[{'path':p,'mainSha256':sha(blob(MAIN,p)),'previousMainSha256':sha(blob(OLD_MAIN,p)) if subprocess.run(['git','cat-file','-e',OLD_MAIN+':'+p],cwd=ROOT,stderr=subprocess.DEVNULL).returncode==0 else None,'effectQualification':explanations[p]} for p in selected]
 merge=subprocess.run(['git','merge-tree','--write-tree',MAIN,head],cwd=ROOT,capture_output=True)
 assert merge.returncode==0,merge.stdout.decode();tree=merge.stdout.decode().splitlines()[0]
 merged=json.loads(blob(tree,COVERAGE));merged_rows=flatten(merged);head_rows=flatten(json.loads(blob(head,COVERAGE)))
 assert set(main_rows)==set(merged_rows)
 assert all(merged_rows[k]==main_rows[k] for k in main_rows if k not in owned)
 assert all(merged_rows[k]==head_rows[k] for k in owned)
 assert all(merged[k]==main_coverage[k] for k in main_coverage if k not in ('rules','acceptance_contracts'))
 changed=git('diff','--name-only',MAIN,tree).decode().splitlines()
 assert all(p==COVERAGE or p.startswith(packet) or p.startswith('__tests__/ediel-sc-') or p in ['scripts/ediel-sc-018-manual-service-context-sql-regression.mjs','scripts/test-ediel-sc-018-056-service-incident.cjs'] for p in changed)
 assert git('diff','--name-only',MAIN,tree,'--','app','lib','supabase','.github','scripts/helpers','scripts/ediel-source-owner-native.config.ts')==b''
 assert all(subprocess.run(['git','cat-file','-e',tree+':'+p],cwd=ROOT,stderr=subprocess.DEVNULL).returncode==0 for k in owned for p in merged_rows[k]['evidence'])
 api=gates[str(pr)];assert api['pr']['head']==head
 jobs=[j for j in api['checks'] if j['name'] in mandatory]
 assert len(jobs)==9 and {j['name'] for j in jobs}==mandatory
 assert all(j['status']=='completed'and j['conclusion']=='success'for j in jobs)
 assert api['status']['state']=='success'and all(s['state']=='success'for s in api['status']['statuses'])
 assert sha(blob(head,packet+'independent-review.md'))==sha((OUT/(pair+'-independent-review.md')).read_bytes())
 assert sha(blob(head,packet+'independent-receipt.json'))==sha((OUT/(pair+'-independent-receipt.json')).read_bytes())
 receipt={'schema':'gridex-masterplan-minimum-current-main-carry/v1','reviewedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'reviewer':'/root/sc001_sc002_sc018_sc056_carry','pr':pr,'head':head,'headTree':git('rev-parse',head+'^{tree}').decode().strip(),'actualMain':MAIN,'mainTree':git('rev-parse',MAIN+'^{tree}').decode().strip(),'previousMain':OLD_MAIN,'mergeTree':tree,'verdicts':{k:'APPROVE_BOUNDED_CURRENT_MAIN_SOURCE_CARRY'for k in sorted(owned)},'priorCarryRecord':{'path':str(OUT/old_record),'sha256':sha((OUT/old_record).read_bytes())},'originalWholeRecord':{'reviewPath':packet+'independent-review.md','reviewSha256':sha(blob(head,packet+'independent-review.md')),'receiptPath':packet+'independent-receipt.json','receiptSha256':sha(blob(head,packet+'independent-receipt.json'))},'headInputsStillExact':comparisons,'selectedSqlOwners':owners,'previousDeclaredStaticEnvelopeIntersection':intersection,'changedSourceEffects':effects,'mergeUnion':{'all352IdsPreserved':True,'all350ForeignParsedRowsIncludingEvidenceExactlyMain':True,'own2RowsExactlyOwnerHead':True,'topLevelMetadataExactlyMain':True,'ownEvidencePathsExist':True,'completeAppLibSqlSchemaConfigWorkflowAndHelperTreeExactlyMain':True,'changedPathsAgainstMain':changed,'mainApprovedRowMarkers':sum(r['status']in('VERIFIED','PASSED')for r in main_rows.values()),'mergedApprovedRowMarkers':sum(r['status']in('VERIFIED','PASSED')for r in merged_rows.values())},'actualOwnerHeadGates':api,'provenance':{'originalNativeProducer':'0796a57181657d0c2b55dc4437f3ad5c6c8d88c3','sameDeclaredFinitePortsAndOriginalLimits':True,'SC056UniqueNativePassAccounting':'5PASS1 intentional phaseSKIP plus1PASS5 unselected phaseSKIP; six unique native passes, not one zero-skip run'if pr==560 else None,'freshNativeCurrentSchemaCaptureOrExternalExecutionClaim':False,'newTestsRun':0,'wholeNativeOrBroadReruns':0,'sourceOwnerOrCoverageMutations':0},'limits':['Qualification is exactmain/ownerhead read-only source carry within original whole approval finite ports, not full current native replay or external authority.','API base SHA is historical507 despite baseRef main; actual main is independently Git/API qualifieda8c991c1.','Old owner-head CI is allgreen; no new integration-tree CI execution is claimed. Root owns actual head/main freshness, publication, current gates and merge.'],'skillRouting':{'activated':['using-superpowers','differential-review','verification-before-completion'],'reason':'Surgical changed source/SQL/effect carry and exact Git/API gate verification; no production modification.','skipped':'No performance/UI/new feature/debugging/test implementation or broad audit triggers.'}}
 path=OUT/(pair+'-main-a8c991c1-minimum-carry-receipt.json');assert not path.exists();path.write_text(json.dumps(receipt,indent=2,ensure_ascii=False)+'\n')
 print(json.dumps({'pr':pr,'receipt':str(path),'sha256':sha(path.read_bytes()),'mergeTree':tree,'foreignRowsPreserved':350,'selectedSqlOwnersExact':len(owners),'headChecksGreen':len(jobs)}))
