"""Resolve only committed, source-checksummed declared replay substitutions.

No SQL runs here. Canonical migration hashes remain source identities; the
executed bytes and their hash are recorded separately for derived inputs.
"""
import hashlib,json,re,subprocess
from pathlib import PurePosixPath

PLANS=('scripts/gridex-aud-003-legacy-foundation.json','scripts/gridex-aud-003-legacy-foundation.additions.json')
DIGEST=re.compile(r'[a-f0-9]{64}')
VERSION=re.compile(r'\d{14}')

def _git(root,*args):
    return subprocess.check_output(['git',*args],cwd=root)

def _safe(path):
    if not isinstance(path,str) or not path or any(c in path for c in ('\0','\n','\r')):
        raise ValueError('unsafe_derived_replay_path')
    p=PurePosixPath(path)
    if p.is_absolute() or '..' in p.parts or str(p)!=path:
        raise ValueError('unsafe_derived_replay_path:'+path)
    return path

def _merge_derived(derived,incoming):
    # Existing additions deliberately enrich four declarations with
    # preserveSourceReplay. Keep that enrichment without replacing identities.
    for path,meta in incoming.items():
        path=_safe(path)
        if not isinstance(meta,dict):
            raise ValueError('invalid_derived_replay_descriptor:'+path)
        previous=derived.get(path,{})
        for key in ('source','sourceKind','artifactSha256','sourceSha256'):
            if key in previous and key in meta and previous[key]!=meta[key]:
                raise ValueError('conflicting_derived_replay_identity:'+path+':'+key)
        derived[path]={**previous,**meta}

def substitutions(root,revision,checksums,selected_names):
    derived={};declared=set();boundaries={}
    for plan_path in PLANS:
        exists=subprocess.run(['git','cat-file','-e',revision+':'+plan_path],cwd=root,
                              stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        if exists.returncode:continue
        plan=json.loads(_git(root,'show',revision+':'+plan_path))
        _merge_derived(derived,plan.get('derivedBootstrap') or {})
        declared.update(plan.get('foundation') or [])
        for row in plan.get('interleaved') or []:
            path=_safe(row.get('path'))
            if path in boundaries:raise ValueError('duplicate_derived_replay_boundary:'+path)
            after,before=str(row.get('afterLedgerVersion','')),str(row.get('beforeLedgerVersion',''))
            if not VERSION.fullmatch(after) or not VERSION.fullmatch(before) or after>=before:
                raise ValueError('invalid_derived_replay_boundary:'+path)
            boundaries[path]=(after,before);declared.add(path)
    result={}
    for path,meta in derived.items():
        path=_safe(path)
        source=meta.get('source')
        if not source or meta.get('sourceKind')=='verified_live_schema' or meta.get('preserveSourceReplay',False):
            continue
        source=_safe(source)
        if not source.startswith('migrations/') or len(PurePosixPath(source).parts)!=2:
            raise ValueError('derived_replay_source_must_be_migration:'+path)
        name=PurePosixPath(source).name
        if name not in selected_names:continue
        if path not in declared or not path.startswith('bootstrap/'):
            raise ValueError('undeclared_derived_replay_artifact:'+path)
        if name in result:raise ValueError('ambiguous_derived_replay_source:'+name)
        expected=checksums.get(name)
        if not expected or not DIGEST.fullmatch(expected):raise ValueError('unpinned_derived_replay_source:'+name)
        if meta.get('sourceSha256') is not None and meta['sourceSha256']!=expected:
            raise ValueError('derived_replay_original_source_pin_mismatch:'+name)
        original=_git(root,'show',revision+':supabase/'+source)
        if hashlib.sha256(original).hexdigest()!=expected:raise ValueError('derived_replay_original_source_checksum_mismatch:'+name)
        artifact_digest=meta.get('artifactSha256','')
        if not DIGEST.fullmatch(artifact_digest):raise ValueError('derived_replay_artifact_pin_required:'+path)
        artifact=_git(root,'show',revision+':supabase/'+path)
        if hashlib.sha256(artifact).hexdigest()!=artifact_digest:raise ValueError('derived_replay_artifact_checksum_mismatch:'+path)
        if path in boundaries:
            after,before=boundaries[path]
            if not VERSION.fullmatch(name[:14]) or not after<name[:14]<before:
                raise ValueError('derived_replay_source_not_at_declared_boundary:'+name)
            available={n[:14] for n in checksums if VERSION.fullmatch(n[:14])}
            if after not in available or before not in available:
                raise ValueError('derived_replay_boundary_source_missing:'+path)
            between={n for n in checksums if VERSION.fullmatch(n[:14]) and after<n[:14]<before}
            if between!={name}:
                raise ValueError('ambiguous_derived_replay_execution_order:'+path)
        result[name]={'sourcePath':'supabase/'+source,'sourceSha256':expected,
                      'executedSourcePath':'supabase/'+path,'executedSha256':artifact_digest,
                      'derivedBootstrapPath':path,'data':artifact,'original':original,
                      'ledgerClaim':'NONE: derived replay execution is not historical migration registration'}
    return result

def materialize(name,data,canonical_digest,inputs,originals,derived):
    selected=derived.get(name)
    target=inputs/name
    if selected is None:
        target.write_bytes(data)
        return {'name':name,'sha256':canonical_digest,'sourceSha256':canonical_digest,
                'executedSha256':canonical_digest,'path':str(target)}
    if data!=selected['original'] or canonical_digest!=selected['sourceSha256']:
        raise ValueError('derived_replay_selected_source_changed:'+name)
    originals.mkdir(exist_ok=True)
    original=originals/name;original.write_bytes(data)
    target.write_bytes(selected['data'])
    return {'name':name,'sha256':canonical_digest,'sourceSha256':canonical_digest,
            'executedSha256':selected['executedSha256'],'path':str(target),
            'originalSourcePath':str(original),'executedSourcePath':selected['executedSourcePath'],
            'derivedBootstrapPath':selected['derivedBootstrapPath'],'ledgerClaim':selected['ledgerClaim']}
