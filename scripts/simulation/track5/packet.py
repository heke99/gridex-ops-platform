#!/usr/bin/env python3
"""Skriver spår 5:s säkra paket (status.json per scenario-ID) från slutkörningens rapporter.

Användning: python3 -I packet.py <evidenskatalog> <paketkatalog> <klassning.json>
Klassningen (state, blocker, nextAction, findingsIds, substitutions, notVerified per ID) sätts av arbetarsessionen;
skriptet räknar bara stegutfall och hashar evidensen. Inga råloggar eller hemligheter kopieras in i paketet.
"""
import hashlib
import json
import pathlib
import sys

ev, out, cls_path = (pathlib.Path(p) for p in sys.argv[1:4])
cls = json.loads(cls_path.read_text())
meta = cls.pop('_meta')

def sha(p: pathlib.Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()

reports = {name: json.loads((ev / f'{name}-report.json').read_text()) for name in ('auth01', 'api01', 'api01-poa', 'event01')}
receipts = {}
for name in ('auth01', 'api01', 'api01-poa', 'event01'):
    f = ev / f'{name}-report.receipts.jsonl'
    receipts[name] = [json.loads(l) for l in f.read_text().splitlines() if l.strip()] if f.exists() else []
evidence_files = sorted(p for p in ev.iterdir() if p.is_file())
evidence = [{'file': p.name, 'sha256': sha(p)} for p in evidence_files]

for scenario_id, c in cls.items():
    group = 'api01-poa' if scenario_id == 'API01.03' else {'AUTH01': 'auth01', 'API01': 'api01', 'EVENT01': 'event01'}[scenario_id.split('.')[0]]
    rep = reports[group]
    steps = [s for s in rep['steps'] if f' {scenario_id} ' in f" {s['name']} "]
    related = [s for s in rep['steps'] if s['name'].split(' webhooks ')[-1].startswith('SETUP')] if group == 'event01' else []
    status = {
        'scenarioId': scenario_id,
        'workerId': 'claude-track5',
        'session': meta['session'],
        'model': meta['model'],
        'campaignId': '20261029-3f1a8ab1',
        'baselineCommit': '1c0c088cb4ed66d0dd8b3e34c9606019342a1a56',
        'appCommit': rep['builtCommit'],
        'appCommitNote': 'byggd app = bas + endast harness under scripts/simulation/track5 (ingen appkod ändrad)',
        'overlayRefs': [{'kind': 'harness', 'branch': 'claude/sim-20261029-track5', 'commit': rep['appCommit'],
                         'paths': ['scripts/simulation/track5/**']}],
        'environmentId': meta['environmentId'],
        'databaseIdentity': meta['databaseIdentity'],
        'schemaHash': meta['schemaHash'],
        'clockModel': meta['clockModel'],
        'versions': meta['versions'],
        'startedAtUtc': rep['startedAt'],
        'finishedAtUtc': rep['finishedAt'],
        'state': c['state'],
        'executionScope': rep['executionScope'],
        'command': f"SIM_HOME=$SIM_HOME RUN_DIR=$RUN_DIR SIM_REPORT=<evidens>/{group}-report.json bash scripts/simulation/track5/run.sh scenarios/{group}.test.ts",
        'scenarioFile': rep['scenarioFile'],
        'steps': [{'name': s['name'], 'status': s['status'], 'durationMs': round(s['durationMs'])} for s in steps],
        'relatedSteps': [{'name': s['name'], 'status': s['status']} for s in related],
        'skipped': [s['name'] for s in steps if s['status'] == 'skipped'],
        'scenarioSummary': rep['summary'],
        'runDirClean': rep['runDirClean'],
        'evidenceRefs': {'privateDir': meta['evidenceDir'], 'files': evidence,
                         'reportSha256': sha(ev / f'{group}-report.json'), 'vitestLogSha256': rep['logSha256']},
        'receipts': [r for r in receipts[group] if r.get('scenarioId') == scenario_id or (group == 'event01' and r.get('scenarioId') == 'SETUP')],
        'oracle': c['oracle'],
        'substitutions': c.get('substitutions', []),
        'notVerified': c.get('notVerified', []),
        'findingsIds': c.get('findingsIds', []),
        'blocker': c.get('blocker'),
        'nextAction': c['nextAction'],
        'review': c.get('review'),
        'cleanupReceipt': meta['cleanupReceipt'],
        'heartbeatAtUtc': meta['heartbeatAtUtc'],
    }
    d = out / scenario_id
    d.mkdir(parents=True, exist_ok=True)
    (d / 'status.json').write_text(json.dumps(status, ensure_ascii=False, indent=2) + '\n')
    print(scenario_id, c['state'], [s['status'] for s in steps])
