"""Prepare the bounded native fixture test; never modifies the source checkout."""
from pathlib import Path
import hashlib
import os
import shutil

out=Path(os.environ['RUNNER_TEMP'])
inputs={
 'pr310-cleanup-native-preflight.py':('cleanup-native-preflight.py','4fda803aff4e3a454e1c98fcb11af5d0d3a71cabaeec5cd464677ce0accde505'),
 'storage_owner_preflight.py':('storage_owner_preflight.py','c3c9df95cf6ba4b0b58af90094169c9d97f3b1870f06624192de657a74b86f08'),
 'pr310-native-final-guards.patch':('native-final-guards.patch','16da701b4842f52fb941033c0d8cb2584bbfffddc24dbf2fca1d2a52b6aca663'),
}
for name,(target,digest) in inputs.items():
 raw=(Path('.github')/name).read_bytes()
 assert hashlib.sha256(raw).hexdigest()==digest
 (out/target).write_bytes(raw)
p=out/'cleanup-native-preflight.py';raw=p.read_text()
replacements={
"report['phase']='ADAPTED_SUCCESS_AND_REPEAT'":"report['phase']='ADAPTED_EXPECTED_STATE_ADMISSION'",
"            expected=cleanup.expected_after(((baseline[0],baseline[1]),[]),list(cleanup.BASE_KEYS)+[cleanup.POLICY_KEY]+dependencies)[0]":"            keys=list(cleanup.BASE_KEYS)+[cleanup.POLICY_KEY]+dependencies\n            report['admissionCounts']=dict(dependencies=len(dependencies),uniqueDependencies=len(set(dependencies)),missingKeys=sum(k not in baseline[0] for k in keys),probeRowMatches=baseline[1].get(cleanup.TABLE)==[1,cleanup.ROW_HASH],dependencyPrefixMatches=all(k.startswith(tuple('dependency/policy '+cleanup.POLICY+' on table '+n+'/' for n in (cleanup.TABLE,cleanup.TABLE.removeprefix('public.')))) for k in dependencies))\n            expected=cleanup.expected_after(((baseline[0],baseline[1]),[]),keys)[0]\n            report['phase']='ADAPTED_REAL_CLI_SUCCESS'",
"            after=snapshot()":"            report['phase']='ADAPTED_COMPARE_FINAL_STATE'\n            after=snapshot()",
"            prefix.verify_entry(after[2][-1],path.name,SimpleNamespace(name=name,sql=candidate))":"            report['phase']='ADAPTED_VERIFY_REAL_LEDGER'\n            prefix.verify_entry(after[2][-1],path.name,SimpleNamespace(name=name,sql=candidate))\n            report['phase']='ADAPTED_REAL_CLI_REPEAT'",
"            report['failureCode']=error.args[0] if type(error) is ValueError and len(error.args)==1 and error.args[0] in known else 'UNCLASSIFIED'":"            known.update({'NATIVE_CLEANUP_EXACT_REMOVAL_REQUIRED','NATIVE_CLEANUP_UNRECOGNIZED_OBJECT_REQUIRED','NATIVE_EXECUTED_LEDGER_REQUIRED','NATIVE_EXECUTED_STATEMENTS_REQUIRED'})\n            report['failureCode']=error.args[0] if type(error) in (ValueError,prefix.PrefixError) and len(error.args)==1 and type(error.args[0]) is str and error.args[0] in known else 'UNCLASSIFIED'\n            report['failureKind']=type(error).__name__ if type(error) in (ValueError,prefix.PrefixError,TypeError,KeyError,AssertionError) else 'OTHER'",
}
for old,new in replacements.items():
 assert raw.count(old)==1
 raw=raw.replace(old,new)
assert hashlib.sha256(raw.encode()).hexdigest()=='55da6f25a1feb9e7b36d5081fd3db2bf6a3649a503722ed5f46c3ae95319c09a'
replacements={
'    original = cleanup.program().sql':"    candidate = cleanup.program().sql\n    original = candidate.replace(OPEN,b'').replace(CLOSE,b'')",
'    candidate = OPEN + LOCK + CLOSE + original[len(LOCK):]':"    if candidate != OPEN + LOCK + CLOSE + original[len(LOCK):]:\n        raise ValueError('EXACT_COMPILED_PROGRAM_REQUIRED')",
'            baseline=snapshot();oid=sql(':"            report['phase']='NATIVE_STORAGE_OWNER_DIFFERENTIAL'\n            import storage_owner_preflight\n            report['storageOwnerQualification']=storage_owner_preflight.qualify(ROOT,sql,native,snapshot,migrations)\n            baseline=snapshot();oid=sql(",
"            known.update({'NATIVE_CLEANUP_EXACT_REMOVAL_REQUIRED'":"            known.update({'STORAGE_SOURCE_REQUIRED','STORAGE_OWNER_CONTRACT_REQUIRED','STORAGE_PROVIDER_OWNER_REQUIRED','STORAGE_ROLE_REQUIRED','STORAGE_CLI_FILE_REQUIRED','STORAGE_GUARD_REQUIRED','STORAGE_FAILURE_CONTROL_REQUIRED','STORAGE_ROLLBACK_REQUIRED','STORAGE_PREIMAGE_REQUIRED','STORAGE_EXACT_EFFECT_REQUIRED','STORAGE_OWNER_DIFFERENTIAL_REQUIRED','STORAGE_REPEAT_REQUIRED','STORAGE_NEGATIVE_OWNER_OR_ROLE_REQUIRED','STORAGE_NEGATIVE_ROLLBACK_REQUIRED','NATIVE_CLEANUP_EXACT_REMOVAL_REQUIRED'",
}
for old,new in replacements.items():
 assert raw.count(old)==1
 raw=raw.replace(old,new)
assert hashlib.sha256(raw.encode()).hexdigest()=='53d0e6ab0fd9057b78dc175218d522a89ef4352f47ff159e16e5327280c280fc'
old="'ON_ERROR_STOP=1','--single-transaction'"
assert raw.count(old)==1
raw=raw.replace(old,"'ON_ERROR_STOP=1','-v','VERBOSITY=verbose','--single-transaction'")
old="                raise ValueError('OWNED_COMMAND_FAILED')"
assert raw.count(old)==1
raw=raw.replace(old,"                report['psqlSqlstates']=[s.decode() for s in re.findall(rb'ERROR: +([A-Z0-9]{5}):',result.stderr)]\n"+old)
compile(raw,'fixed_native_preflight','exec');p.write_text(raw)
p=out/'storage_owner_preflight.py';s=p.read_text()
for old,new in {
'    original_source=':"    print('STORAGE_PREFLIGHT_SOURCE_ADMISSION',flush=True)\n    original_source=",
'    owner=sql(':"    print('STORAGE_PREFLIGHT_PROVIDER_OWNER',flush=True)\n    owner=sql(",
"    sql('CREATE TABLE public.roles": "    print('STORAGE_PREFLIGHT_LEGACY_FIXTURE',flush=True)\n    sql('CREATE TABLE public.roles",
'    before=snapshot()':"    print('STORAGE_PREFLIGHT_BASELINE',flush=True)\n    before=snapshot()",
'        path,name=create(raw)':"        print('STORAGE_PREFLIGHT_'+label,flush=True)\n        path,name=create(raw)",
'    path,name=create(program.sql);':"    print('STORAGE_PREFLIGHT_REAL_SUCCESS',flush=True)\n    path,name=create(program.sql);",
'    after=snapshot()':"    print('STORAGE_PREFLIGHT_EXACT_DELTA',flush=True)\n    after=snapshot()",
'    prefix.verify_entry(':"    print('STORAGE_PREFLIGHT_LEDGER',flush=True)\n    prefix.verify_entry(",
"    if sql('SELECT to_json(('+old": "    print('STORAGE_PREFLIGHT_POSTCONDITION',flush=True)\n    if sql('SELECT to_json(('+old",
"    native('migration','up','--local')": "    print('STORAGE_PREFLIGHT_REPEAT',flush=True)\n    native('migration','up','--local')",
"        if sql('BEGIN; '": "        print('STORAGE_PREFLIGHT_'+label,flush=True)\n        if sql('BEGIN; '",
}.items():
 assert s.count(old)==1
 s=s.replace(old,new)
assert hashlib.sha256(s.encode()).hexdigest()=='480dedcb37f37c3ad68ae8acf4c46509904ca300c919b94685c8240efac7ae1f'
compile(s,'fixed_storage_preflight','exec');p.write_text(s)
