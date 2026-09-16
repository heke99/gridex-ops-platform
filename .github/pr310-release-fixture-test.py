import json
import os
from pathlib import Path
import tempfile
import unittest
from contextlib import ExitStack
from unittest.mock import patch
import canonical_native_release_verify as m

# Explicit timestamps keep synthetic fixtures independent of filesystem write-clock
# granularity. The production verifier and its exact freshness rule are unchanged.
START_NS=1_700_000_000_000_000_000
ARTIFACT_NS=START_NS+1_000_000_000
NOW_NS=ARTIFACT_NS+1_000_000_000
ARTIFACTS=('artifacts/native-supabase-lifecycle.json',
 'artifacts/native-full-schema-reference-diff.json',
 'artifacts/native-application-database.types.candidate.ts')

RAW=b'export type Json = string | null\nexport type Database = { public: { Tables: { companies: { Row: { id:string } } } Functions: { resolve_ediel_timeseries_product_511: {} } } }\n'
class Tests(unittest.TestCase):
 def write_fixture(self,root,path,raw,*,mtime_ns=ARTIFACT_NS):
  target=root/path;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(raw)
  os.utime(target,ns=(mtime_ns,mtime_ns))
  self.assertEqual(target.stat().st_mtime_ns,mtime_ns)
 def fixture(self,root):
  report=dict(outcome='NATIVE_SELECTED_CHAIN_EXECUTED_NOT_FULL_ACCEPTANCE',cliVersion='2.101.0',cleanupVerified=True,
   privateWorkspaceRemoved=True,historicalPrivateInputsDisposed=True,nativeLedgerVerified=True,historicalGridexSourcesExecuted=True,
   nativeFinalSql=dict(verified=True,checks=[dict(source=p,sourceSha256=h,verified=True,catalogAndRowsPreserved=True,ledgerUnchanged=True) for p,h in m.PINS.items()]),
   nativeParityEngineQualification={},nativeApplicationTypeCandidate=dict(genuineCliTypegenExecuted=True,repeatEqual=True,
    schemaRowsProviderEventsAndLedgerPreserved=True,exported=True,candidateSha256=m.types.sha(RAW),candidateBytes=len(RAW),nullabilityOverrideSha256=m.types.OVERRIDE_SHA))
  import canonical_added_nonunique_index_decisions as nonunique
  report[nonunique.KEY]=nonunique.expected_receipt()
  report['historicalTimestampTail']={'fixture':'complete native source units'}
  diff={'sections':{},'nativeFinalSql':report['nativeFinalSql'],'historicalTimestampTail':report['historicalTimestampTail'],'addedNonuniqueIndexWitness':report['addedNonuniqueIndexWitness']}
  for key in (*m.decisions.WITNESSES,'changedFunctionBehaviorWitness'):
   if key!='nativeFinalSql':report[key]=diff[key]={'fixture':key}
  report['nativeSchemaReferenceComparison']={**diff,'counts':{}};report['nativeSchemaReferenceComparison'].pop('sections')
  files={'artifacts/native-supabase-lifecycle.json':json.dumps(report).encode(),
   'artifacts/native-full-schema-reference-diff.json':json.dumps(diff).encode(),
   'artifacts/native-application-database.types.candidate.ts':RAW,'supabase/database.types.ts':RAW,
   'scripts/supabase-types-manifest.json':json.dumps(dict(generated_types='supabase/database.types.ts',latest_migration='20260915181448_fixture.sql',sha256=m.types.sha(RAW))).encode(),
   'supabase/migrations/20260915181448_fixture.sql':b''}
  for path,raw in files.items():
   self.write_fixture(root,path,raw)
  return report,diff
 def invoke(self,root,start,*,schema=True,dump=True):
  import canonical_changed_function_witness as functions
  with ExitStack() as stack:
   stack.enter_context(patch.object(m.time,'time_ns',return_value=NOW_NS))
   stack.enter_context(patch.object(m.actors,'_complete'))
   stack.enter_context(patch.object(m,'retain_forward'))
   stack.enter_context(patch('canonical_native_dump_verify.validate',side_effect=None if dump else ValueError('NATIVE_DUMP_EXACT_COMPARISON_REQUIRED')))
   stack.enter_context(patch.object(m,'FORWARD_SOURCES',()))
   stack.enter_context(patch.object(m.parity,'validate_receipt'))
   stack.enter_context(patch.object(m.decisions,'verify',return_value=dict(schemaAccepted=schema,unsupported=[] if schema else [dict(section='columns',change='added')])) )
   for module in (*m.decisions.WITNESSES.values(),functions):stack.enter_context(patch.object(module,'validate_execution_receipt'))
   return m.verify(root,started_ns=start)
 def test_success_requires_real_bound_committed_bytes_and_manifest(self):
  with tempfile.TemporaryDirectory() as directory:
   root=Path(directory);start=START_NS;self.fixture(root)
   result=self.invoke(root,start)
   self.assertTrue(result['completeReplayVerified']);self.assertTrue(result['generatedTypesVerified'])
   self.assertFalse(result['productionModified'])
 def test_stale_artifacts_and_invalid_invocation_rejected(self):
  with tempfile.TemporaryDirectory() as directory:
   root=Path(directory);self.fixture(root)
   with self.assertRaisesRegex(ValueError,'NATIVE_RELEASE_FRESH_ARTIFACT_REQUIRED'):self.invoke(root,ARTIFACT_NS+1)
   for start in (0,True,NOW_NS+1):
    with self.assertRaisesRegex(ValueError,'NATIVE_RELEASE_INVOCATION_REQUIRED'):self.invoke(root,start)
 def test_cleanup_source_decisions_and_actual_witness_binding_are_required(self):
  for defect in ('cleanup','summary','witness','candidate','manifest','committed','decisions','dump','tail','nonunique'):
   with self.subTest(defect=defect),tempfile.TemporaryDirectory() as directory:
    root=Path(directory);start=START_NS;report,diff=self.fixture(root)
    if defect=='cleanup':report['cleanupVerified']=False
    if defect=='summary':report['nativeSchemaReferenceComparison']['extra']=True
    if defect=='witness':report['changedIndexSourceWitness']={}
    if defect=='tail':report['historicalTimestampTail']={}
    if defect=='nonunique':report['addedNonuniqueIndexWitness']={}
    if defect=='candidate':report['nativeApplicationTypeCandidate']['candidateSha256']='0'*64
    if defect=='manifest':
     p=root/'scripts/supabase-types-manifest.json';j=json.loads(p.read_bytes());j['latest_migration']='older.sql';p.write_text(json.dumps(j))
    if defect=='committed':(root/'supabase/database.types.ts').write_bytes(RAW+b'\n')
    self.write_fixture(root,'artifacts/native-supabase-lifecycle.json',json.dumps(report).encode())
    expected={'cleanup':'NATIVE_RELEASE_COMPLETE_OWNED_REPLAY_REQUIRED',
     'summary':'NATIVE_RELEASE_COMPARISON_BINDING_REQUIRED',
     'witness':'NATIVE_RELEASE_WITNESS_BINDING_REQUIRED',
     'tail':'NATIVE_RELEASE_WITNESS_BINDING_REQUIRED',
     'nonunique':'NATIVE_RELEASE_WITNESS_BINDING_REQUIRED',
     'candidate':'NATIVE_RELEASE_TYPEGEN_RECEIPT_REQUIRED',
     'manifest':'NATIVE_RELEASE_COMMITTED_TYPES_REQUIRED',
     'committed':'NATIVE_RELEASE_COMMITTED_TYPES_REQUIRED',
     'decisions':'NATIVE_RELEASE_SOURCE_DECISIONS_REQUIRED',
     'dump':'NATIVE_DUMP_EXACT_COMPARISON_REQUIRED'}[defect]
    with self.assertRaisesRegex(ValueError,expected):self.invoke(root,start,schema=defect!='decisions',dump=defect!='dump')
 def test_symlinked_artifact_rejected(self):
  with tempfile.TemporaryDirectory() as directory:
   root=Path(directory);start=START_NS;self.fixture(root)
   p=root/'artifacts/native-application-database.types.candidate.ts';p.unlink();p.symlink_to(root/'supabase/database.types.ts')
   with self.assertRaisesRegex(ValueError,'NATIVE_RELEASE_FRESH_ARTIFACT_REQUIRED'):self.invoke(root,start)
 def test_every_artifact_obeys_exact_freshness_boundary(self):
  for name in ARTIFACTS:
   for offset in (-1,0,1):
    with self.subTest(artifact=name,offset=offset),tempfile.TemporaryDirectory() as directory:
     root=Path(directory);self.fixture(root)
     self.write_fixture(root,name,(root/name).read_bytes(),mtime_ns=START_NS+offset)
     if offset<0:
      with self.assertRaisesRegex(ValueError,'NATIVE_RELEASE_FRESH_ARTIFACT_REQUIRED'):
       self.invoke(root,START_NS)
     else:
      self.assertTrue(self.invoke(root,START_NS)['generatedTypesVerified'])
if __name__=='__main__':unittest.main()
