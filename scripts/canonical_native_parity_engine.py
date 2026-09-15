"""Qualify the unchanged production parity engine on actual native SQL drift.

The original selftest SQL runs on two owned empty clones. Its actual captured
catalogs cross a private psql seam into the unmodified production Node engine;
no external database address or production schema is accepted. All twenty
original drift expectations must be detected. This is comparator qualification,
not approval of application schema differences or generated types.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile

ROOT=Path(__file__).resolve().parents[1]
PINS={
 'scripts/gridex-db-parity-selftest.sh':'3acc5aba9aeecc27fefcdeeebf1073664be796fd875d20b9384ff5399a1a8ff0',
 'scripts/gridex-db-parity.cjs':'600617533d86ad3a91ae5d08b3a94a9408a4c793c95ed654d17fb1f2baf61aea',
 'scripts/sql/gridex-db-parity-introspect.sql':'99b5c602223153dac69cf3266babfcffce80c889dc5375ad625c18e24fb255b0',
 'scripts/gridex-schema-document.cjs':'503915487e96c5d8678a14411deae94bc13b38ae9b70bff3b668577f05007e42',
}
CLONES=('gridex_native_timestamp_original','gridex_native_timestamp_candidate')


def retain():
    raw={}
    for name,digest in PINS.items():
        path=ROOT/name
        if path.is_symlink() or path.resolve()!=path or hashlib.sha256(path.read_bytes()).hexdigest()!=digest:
            raise ValueError('NATIVE_PARITY_ENGINE_SOURCE_REQUIRED')
        raw[name]=path.read_text()
    source=raw['scripts/gridex-db-parity-selftest.sh']
    blocks=re.findall(r"<<'SQL'\n(.*?)\nSQL\n",source,re.S)
    enum=re.findall(r'psql "\$CANON_URL" -X -q -v ON_ERROR_STOP=1 -c "([^"]+)"',source)
    expected=re.findall(r'^expect "([^"]+)"\s+"([^"]+)"$',source,re.M)
    query=raw['scripts/sql/gridex-db-parity-introspect.sql']
    if len(blocks)!=2 or len(enum)!=1 or len(expected)!=20 or query.count(":'schemas'")!=1:
        raise ValueError('NATIVE_PARITY_ENGINE_PROGRAM_REQUIRED')
    return dict(base=blocks[0],drift=blocks[1],enum=enum[0],expected=expected,
                query=query.replace(":'schemas'","'{public}'"),sources=dict(PINS))


def run_engine(left,right,retained):
    if retained!=retain():
        raise ValueError('NATIVE_PARITY_ENGINE_RETAINED_REQUIRED')
    with tempfile.TemporaryDirectory(prefix='gridex-native-parity-engine-') as directory:
        work=Path(directory)
        for name,document in (('canonical',left),('target',right)):
            path=work/(name+'.json');path.touch(mode=0o600)
            path.write_text(json.dumps(document))
        # The production engine still invokes its unchanged introspection path.
        # Only its psql subprocess result is supplied from already-executed native
        # SQL. Reject any changed command/URL/options instead of silently faking it.
        shim=work/'psql'
        shim.write_text('''#!/usr/bin/env node
const fs=require('node:fs');const path=require('node:path');
const args=process.argv.slice(2);
const names=['canonical','target'];
const name=names.find(n=>args[0]==='postgresql://fixture/'+n);
const expected=[args[0],'-X','-At','-v','ON_ERROR_STOP=1','-v','schemas={public}','-f',process.env.GRIDEX_PARITY_QUERY];
if(!name||JSON.stringify(args)!==JSON.stringify(expected))process.exit(93);
process.stdout.write(fs.readFileSync(path.join(__dirname,name+'.json')));
''')
        shim.chmod(0o700)
        result=subprocess.run(['node',str(ROOT/'scripts/gridex-db-parity.cjs'),
            '--canonical','postgresql://fixture/canonical','--target','postgresql://fixture/target',
            '--mode','blocking','--no-ignore'],capture_output=True,timeout=60,
            env={'PATH':directory+os.pathsep+os.environ.get('PATH',''),
                 'GRIDEX_PARITY_QUERY':str(ROOT/'scripts/sql/gridex-db-parity-introspect.sql')})
        if len(result.stdout)+len(result.stderr)>2_000_000:
            raise ValueError('NATIVE_PARITY_ENGINE_OUTPUT_REQUIRED')
        return result.returncode,(result.stdout+result.stderr).decode('utf-8')


def snapshot(target):
    from canonical_native_timestamp_runtime import native_snapshot
    return native_snapshot(target)


def admit(runner,retained_forward,parent):
    # Reuse the real-chain admission, including post-cleanup actual schema
    # comparison and exact actor/view/final-SQL receipts. No caller boolean
    # substitutes for the owned Runner and its retained CLI files/ledger.
    from canonical_native_application_typegen import admit as admit_chain
    admit_chain(runner,retained_forward,parent)


def execute(runner,retained_forward,parent):
    if 'nativeParityEngineQualification' in parent:
        raise ValueError('NATIVE_PARITY_ENGINE_ONCE_REQUIRED')
    retained=retain()
    admit(runner,retained_forward,parent)
    before=snapshot(runner.target)
    created=[]
    try:
        for name in CLONES:
            runner.target.assert_native_owned()
            runner.target.reset(name)
            created.append(name)
            runner.target.sql(name,retained['base'],'native_parity_base')
        def capture(name):
            return json.loads(runner.target.sql(name,retained['query'],'native_parity_catalog'))
        left,right=(capture(name) for name in CLONES)
        code,_=run_engine(left,right,retained)
        if code!=0:
            raise ValueError('NATIVE_PARITY_ENGINE_IDENTICAL_REQUIRED')
        runner.target.sql(CLONES[1],retained['drift'],'native_parity_drift')
        runner.target.sql(CLONES[0],retained['enum'],'native_parity_enum')
        left,right=(capture(name) for name in CLONES)
        code,output=run_engine(left,right,retained)
        if code!=1 or any(expected not in output for _,expected in retained['expected']):
            raise ValueError('NATIVE_PARITY_ENGINE_DRIFT_DETECTION_REQUIRED')
    finally:
        # Attempt disposal of both owned identities even if one drop fails.
        failures=[]
        for name in reversed(created):
            try:runner.target.drop_clone(name)
            except BaseException as error:failures.append(error)
        if failures:
            raise ValueError('NATIVE_PARITY_ENGINE_CLONE_DISPOSAL_REQUIRED') from None
    runner.unchanged()
    if snapshot(runner.target)!=before:
        raise ValueError('NATIVE_PARITY_ENGINE_PARENT_PRESERVATION_REQUIRED')
    admit(runner,retained_forward,parent)
    receipt=expected_receipt()
    parent['nativeParityEngineQualification']=receipt
    return receipt


def expected_receipt():
    retained=retain()
    return dict(scope='ACTUAL_NATIVE_SQL_PRODUCTION_PARITY_ENGINE_NOT_SCHEMA_ACCEPTANCE',
        verified=True,sources=dict(PINS),identicalCatalogsAccepted=True,
        injectedDriftRejected=True,driftCases=[name for name,_ in retained['expected']],
        ownedClonesDisposed=True,parentCatalogRowsProviderEventsAndLedgerPreserved=True,
        schemaAccepted=False,generatedTypesVerified=False)


def validate_receipt(receipt):
    if type(receipt) is not dict or receipt!=expected_receipt():
        raise ValueError('NATIVE_PARITY_ENGINE_RECEIPT_REQUIRED')
    return receipt
