#!/usr/bin/env python3
"""One-use exact-tree publication to PR310, never main or a database service.

The temporary publisher is removed through the connected GitHub API afterward.
The payload is a reviewed git diff, not generated code or a network download.
An independent complete tree hash binds every resulting source byte and mode.
"""
import base64
import gzip
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
BASE = 'dbb090ce19939c7735b012749155617d86a9e9fd'
BASE_TREE = '539a78fa8a5e95aecba6237e42287c5de1026006'
REVIEWED_TREE = '6ee9ef3ea0ff4178299c324f7ab9e277400d773e'
PATCH_SHA = '93c189db9a8864c6c9ae19163984f56bde220dcd7534f347a82f1377bebf27d6'
ENCODED_SHA = 'b29920c031f1d474fa5ec1a31e3c1729d892a21873d02f183e1f609ed415d000'
BRANCH = 'codex/gridex-parity-remediation-20260905'
TEMPORARY = ('.github/workflows/gridex-forward-publication.yml',
             'scripts/gridex-forward-publication.py',
             'scripts/gridex-forward-publication.patch.b64')
TESTS = ('canonical-ediel-customer-fk-admission-selftest.py',
         'canonical-residual-source-admission-selftest.py',
         'canonical-timestamp-frontier-selftest.py',
         'canonical-timestamp-retained-selftest.py',
         'canonical-timestamp-source-selftest.py',
         'canonical-residual-source-selftest.py',
         'canonical-owned-timestamp-selftest.py',
         'canonical-retained-input-provenance-selftest.py',
         'gridex-aud-003-clean-replay-selftest.py',
         'canonical-ediel-customer-fk-qualification.py')


def run(arguments, *, env=None, timeout=120):
    result = subprocess.run(arguments, cwd=ROOT, capture_output=True, text=True,
                            env=env, timeout=timeout)
    if result.returncode:
        raise RuntimeError('REVIEWED_PUBLICATION_COMMAND_FAILED')
    return result.stdout.strip()


def projection():
    tree = run(['git', 'write-tree'])
    with tempfile.TemporaryDirectory(prefix='gridex-forward-index-') as directory:
        environment = {**os.environ, 'GIT_INDEX_FILE': str(Path(directory)/'index')}
        run(['git', 'read-tree', tree], env=environment)
        run(['git', 'update-index', '--force-remove', '--', *TEMPORARY], env=environment)
        return run(['git', 'write-tree'], env=environment)


def decode_reviewed_patch():
    encoded = (ROOT/TEMPORARY[2]).read_bytes()
    if hashlib.sha256(encoded).hexdigest() != ENCODED_SHA:
        raise RuntimeError('EXACT_TRANSPORT_REQUIRED')
    # The connector's first upload duplicated exactly one encoded Z at offset
    # 1569. Both sides of that one-byte transport correction are independently
    # pinned; no source code or test expectation is rewritten by this operation.
    if encoded[1569:1570] != b'Z':
        raise RuntimeError('EXACT_TRANSPORT_BYTE_REQUIRED')
    encoded = encoded[:1569] + encoded[1570:]
    expected_blob = '6f76b6a0fd7136a0bbf871515b0454c18f569fbb'
    if hashlib.sha1(b'blob '+str(len(encoded)).encode()+b'\0'+encoded).hexdigest() != expected_blob:
        raise RuntimeError('CORRECTED_TRANSPORT_HASH_REQUIRED')
    payload = gzip.decompress(base64.b64decode(encoded.strip(), validate=True))
    if len(payload) != 25007 or hashlib.sha256(payload).hexdigest() != PATCH_SHA:
        raise RuntimeError('REVIEWED_PATCH_HASH_REQUIRED')
    return payload


def main():
    if os.environ.get('GITHUB_EVENT_NAME') != 'pull_request':
        raise RuntimeError('EXACT_PULL_REQUEST_EVENT_REQUIRED')
    event = json.loads(Path(os.environ['GITHUB_EVENT_PATH']).read_text())
    pr = event['pull_request']
    source = pr['head']['sha']
    if (event['number'] != 310 or pr['head']['ref'] != BRANCH
            or pr['head']['repo']['full_name'] != 'heke99/gridex-ops-platform'
            or os.environ.get('GITHUB_REPOSITORY') != 'heke99/gridex-ops-platform'
            or run(['git','rev-parse','HEAD']) != source
            or run(['git','rev-parse','HEAD^']) != BASE
            or run(['git','status','--porcelain']) or projection() != BASE_TREE):
        raise RuntimeError('EXACT_REVIEWED_BASE_REQUIRED')
    token = os.environ.get('GH_TOKEN')
    if not token:
        raise RuntimeError('AUTHORIZED_PUBLICATION_TOKEN_REQUIRED')
    authorization = base64.b64encode(('x-access-token:'+token).encode()).decode()
    git_auth = ['git','-c','credential.helper=', '-c',
                'http.https://github.com/.extraheader=AUTHORIZATION: basic '+authorization]
    remote = run([*git_auth,'ls-remote','origin','refs/heads/'+BRANCH])
    if remote.split()[0] != source:
        raise RuntimeError('SOURCE_BRANCH_MOVED')
    payload = decode_reviewed_patch()
    with tempfile.TemporaryDirectory(prefix='gridex-forward-patch-') as directory:
        path = Path(directory)/'source.patch'
        path.write_bytes(payload)
        run(['git','apply','--check','--index',str(path)])
        run(['git','apply','--index',str(path)])
    if projection() != REVIEWED_TREE:
        raise RuntimeError('REVIEWED_RESULT_TREE_REQUIRED')
    changed = run(['git','diff','--cached','--name-only']).splitlines()
    if len(changed) != 17 or any(p.startswith('.github/') for p in changed):
        raise RuntimeError('NON_WORKFLOW_DIFF_REQUIRED')
    run(['git','diff','--cached','--check'])
    environment = {k:v for k,v in os.environ.items() if k not in ('GH_TOKEN','GITHUB_TOKEN')}
    checks = []
    for test in TESTS:
        print('Verify '+test, flush=True)
        run(['python3','-B','scripts/'+test], env=environment, timeout=300)
        checks.append({'test':test,'result':'PASS'})
    run(['git','diff','--exit-code'])
    if projection() != REVIEWED_TREE:
        raise RuntimeError('POST_TEST_TREE_CHANGED')
    remote = run([*git_auth,'ls-remote','origin','refs/heads/'+BRANCH])
    if remote.split()[0] != source:
        raise RuntimeError('SOURCE_BRANCH_MOVED')
    run(['git','-c','user.name=github-actions[bot]',
         '-c','user.email=41898282+github-actions[bot]@users.noreply.github.com',
         'commit','--no-gpg-sign','-m',
         'fix(db): integrate native-qualified Ediel customer-company forward migration'])
    commit = run(['git','rev-parse','HEAD'])
    run([*git_auth,'push','origin','HEAD:refs/heads/'+BRANCH])
    if run([*git_auth,'ls-remote','origin','refs/heads/'+BRANCH]).split()[0] != commit:
        raise RuntimeError('PUBLISHED_HEAD_READBACK_FAILED')
    receipt = {'sourceCommit':source,'originalBase':BASE,'codeCommit':commit,
               'reviewedCodeTree':REVIEWED_TREE,'patchSha256':PATCH_SHA,
               'filesChanged':changed,'checks':checks,'productionModified':False,
               'mainChanged':False,'fullReplayAccepted':False}
    (Path(os.environ['RUNNER_TEMP'])/'gridex-forward-publication-receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
    print(json.dumps(receipt,sort_keys=True),flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('FAIL exact reviewed publication; no acceptance or force-push fallback',flush=True)
        raise SystemExit(1) from None
