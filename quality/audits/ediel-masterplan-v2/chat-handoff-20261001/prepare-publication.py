import hashlib
import json
import pathlib
import subprocess
import sys

root = pathlib.Path(__file__).resolve().parents[4]
out = root.parent / 'publication-staging'
out.mkdir(exist_ok=True)
def git(*args):
    return subprocess.check_output(['git', '-C', str(root), *args], text=True).strip()
assert not git('status', '--porcelain'), 'Publication source must be committed and clean'
source = git('rev-parse', 'HEAD')
source_tree = git('rev-parse', 'HEAD^{tree}')
parents = git('show', '-s', '--format=%P', 'HEAD').split()
base = 'c8f666d9bf61f84816c2f295dc44442167f0b75a'
owner_head = '3c7342c64c83b705e85c18f300705166a1732ad6'
bootstrap_parent = sys.argv[1] if len(sys.argv) > 1 else base
expected_target = sys.argv[2] if len(sys.argv) > 2 else ''
target = 'refs/heads/codex/ediel-composed-rules-20261001'
checkpoints = json.loads(pathlib.Path(sys.argv[3]).read_text()) if len(sys.argv) > 3 else []
allowed_checkpoints = {
    'refs/heads/wip/ack-private-technical-chain-134600-checkpoint-20261001',
    'refs/heads/codex/ediel-intake-terminal-authority-wip-20261001',
    'refs/heads/codex/ediel-original-intake-native-wip-20261001',
}
assert len({c['targetRef'] for c in checkpoints}) == len(checkpoints)
for c in checkpoints:
    assert c['targetRef'] in allowed_checkpoints and c['sourceRef'] == c['targetRef']
    assert c['expectedTarget'] == ''
    assert git('rev-parse', c['sourceRef']) == c['source']
    assert git('rev-parse', c['source']+'^{tree}') == c['tree']
    assert git('show', '-s', '--format=%P', c['source']).split() == c['sourceParents']
bundle = out / 'source.bundle'
subprocess.run(['git', '-C', str(root), 'bundle', 'create', str(bundle), target,
    *[c['sourceRef'] for c in checkpoints], '^'+base, '^'+owner_head], check=True)
required = [base, owner_head, '536cdc16fcae4b7bb073229540f7e6718ca7e78d',
    'bba3163741c513a94938c63ffe88cf6089be78d1', '0023ee685fd25e0f21a9c7ef2a4e3bfae3de24e2',
    '056d6505d27cc5b8d26356de9c42b3c3544c92a6', '823606064a9a908ab6d94b848ef36fb1103525a0']
manifest = dict(repository='heke99/gridex-ops-platform', source=source, tree=source_tree,
    sourceParents=parents, sourceRef=target, targetRef=target, expectedTarget=expected_target,
    bootstrapParent=bootstrap_parent, prerequisites=[base, owner_head], requiredAncestors=required,
    bundleBytes=bundle.stat().st_size, bundleSha256=hashlib.sha256(bundle.read_bytes()).hexdigest(), checkpointBranches=checkpoints,
    scope='Exact codephase commit publication only; no final acceptance, production, main merge or traffic')
manifest_text = json.dumps(manifest, indent=2)+'\n'
(out/'manifest.json').write_text(manifest_text)
manifest_hash = hashlib.sha256(manifest_text.encode()).hexdigest()
script = '''import hashlib,json,os,pathlib,subprocess
def run(*args):
    result=subprocess.run(['git','-c','core.hooksPath=/dev/null',*args],check=True,capture_output=True,text=True)
    return result.stdout.strip()
assert os.environ['GITHUB_REPOSITORY']=='heke99/gridex-ops-platform'
assert os.environ['GITHUB_EVENT_NAME']=='push'
assert os.environ['GITHUB_REF']=='refs/heads/codex/ediel-history-publication-20261001'
directory=pathlib.Path('quality/audits/ediel-masterplan-v2/history-publication')
raw=(directory/'manifest.json').read_bytes()
assert hashlib.sha256(raw).hexdigest()==MANIFEST_HASH
m=json.loads(raw)
assert m['source']==SOURCE and m['tree']==TREE
assert m['targetRef']=='refs/heads/codex/ediel-composed-rules-20261001'
assert run('rev-parse','HEAD')==os.environ['GITHUB_SHA']
assert run('show','-s','--format=%P','HEAD')==m['bootstrapParent']
bundle=directory/'source.bundle'
assert bundle.stat().st_size==m['bundleBytes']
assert hashlib.sha256(bundle.read_bytes()).hexdigest()==m['bundleSha256']
expected_heads=[m['source']+' '+m['sourceRef']]+[c['source']+' '+c['sourceRef'] for c in m['checkpointBranches']]
assert sorted(run('bundle','list-heads',str(bundle)).splitlines())==sorted(expected_heads)
for prerequisite in m['prerequisites']:
    run('fetch','--no-tags','--no-recurse-submodules','origin',prerequisite)
run('bundle','verify',str(bundle))
run('fetch','--no-tags','--no-recurse-submodules',str(bundle),m['sourceRef']+':refs/remotes/publication/source')
assert run('rev-parse','refs/remotes/publication/source')==m['source']
assert run('rev-parse',m['source']+'^{tree}')==m['tree']
assert run('show','-s','--format=%P',m['source']).split()==m['sourceParents']
for ancestor in m['requiredAncestors']:
    run('merge-base','--is-ancestor',ancestor,m['source'])
run('fsck','--connectivity-only','--no-dangling',m['source'])
for i,c in enumerate(m['checkpointBranches']):
    assert c['sourceRef']==c['targetRef'] and c['expectedTarget']==''
    assert c['targetRef'] in CHECKPOINT_REFS
    run('fetch','--no-tags','--no-recurse-submodules',str(bundle),c['sourceRef']+':refs/remotes/publication/checkpoint-'+str(i))
    assert run('rev-parse',c['source']+'^{tree}')==c['tree']
    assert run('show','-s','--format=%P',c['source']).split()==c['sourceParents']
    for ancestor in m['requiredAncestors']:
        run('merge-base','--is-ancestor',ancestor,c['source'])
    run('fsck','--connectivity-only','--no-dangling',c['source'])
def remote_head(entry):
    lines=run('ls-remote','--heads','origin',entry['targetRef']).splitlines()
    assert len(lines)<=1
    if not lines:return ''
    sha,ref=lines[0].split()
    assert ref==entry['targetRef']
    return sha
entries=[m]+m['checkpointBranches']
for entry in entries:
    assert remote_head(entry)==entry['expectedTarget'],'Target changed; refuse publication'
    if entry['expectedTarget']:
        run('merge-base','--is-ancestor',entry['expectedTarget'],entry['source'])
# Normal push only. A divergent concurrent writer is rejected by Git.
run('push','--atomic','--porcelain','origin',*[entry['source']+':'+entry['targetRef'] for entry in entries])
for entry in entries:
    assert remote_head(entry)==entry['source']
print(json.dumps({'publishedHead':m['source'],'tree':m['tree'],'sourceParents':m['sourceParents'],
    'bundleSha256':m['bundleSha256'],'scope':m['scope']}))
'''
script=script.replace('MANIFEST_HASH',repr(manifest_hash)).replace('SOURCE',repr(source)).replace('TREE',repr(source_tree)).replace('CHECKPOINT_REFS',repr(sorted(allowed_checkpoints)))
workflow='''name: Publish preserved Ediel codephase commits
on:
  push:
    branches: [codex/ediel-history-publication-20261001]
permissions:
  contents: write
concurrency:
  group: ediel-isolated-history-publication-20261001
  cancel-in-progress: false
jobs:
  publish:
    if: github.repository == 'heke99/gridex-ops-platform' && github.ref == 'refs/heads/codex/ediel-history-publication-20261001'
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683
        with:
          ref: ${{ github.sha }}
          fetch-depth: 0
          submodules: false
          lfs: false
      - name: Verify immutable objects and publish exact isolated source
        shell: bash
        run: |
          set -euo pipefail
          python3 - <<'PY'
'''
workflow+='\n'.join('          '+line for line in script.splitlines())+'\n          PY\n'
(out/'workflow.yml').write_text(workflow)
print(json.dumps({'head':source,'tree':source_tree,'bundleBytes':manifest['bundleBytes'],
    'bundleSha256':manifest['bundleSha256'],'manifestSha256':manifest_hash,'sourceParents':parents}))
