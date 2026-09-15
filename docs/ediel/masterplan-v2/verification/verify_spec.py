#!/usr/bin/env python3
"""Kontrollerar dokumentpaketets registerintegritet, INTE Gridex eller EDIFACT.
Kör med Python 3.10+: python verification/verify_spec.py
Inga nätanrop, databasändringar eller externa beroenden.
"""
from __future__ import annotations
import json, hashlib, sys
from pathlib import Path
from datetime import datetime, timezone
B=Path(__file__).resolve().parents[1]; R=B/'registers'
checks=[]
def load(n): return json.loads((R/f'{n}.json').read_text(encoding='utf-8'))
def check(name,ok,detail=''):
    checks.append({'check':name,'pass':bool(ok),'detail':detail})
def unique(rows,key,name):
    ids=[r[key] for r in rows]
    check(name,len(ids)==len(set(ids)) and all(ids), f'{len(ids)} poster')
try:
    rules=load('rules'); cases=load('prodat_message_cases'); fields=load('prodat_fields')
    conds=load('prodat_conditional_cells'); tests=load('acceptance_tests')
    caps=load('utilts_capabilities'); sources=load('source_manifest')
    rule_ids={r['id'] for r in rules}; test_ids={t['id'] for t in tests}
    for name,key in [('rules','id'),('prodat_message_cases','id'),('prodat_fields','field'),
      ('prodat_conditional_cells','id'),('utilts_capabilities','id'),('utilts_application_fields','id'),
      ('utilts_guide_checks','id'),('timers','id'),('state_transitions','id'),('callsite_contracts','id'),
      ('open_evidence_gates','id'),('acceptance_tests','id')]:unique(load(name),key,f'unika nycklar: {name}')
    msgset={'Z01','Z02','Z03','Z04','Z05','Z06','Z08','Z09','Z10','Z13','Z14','Z15','Z18'}
    check('alla PRODAT-fält har 13 funktionskolumner',all(set(f['usage'])==msgset for f in fields))
    check('74 numeriska fält och 3 separata föräldragrupper',len(fields)==74 and len(load('prodat_parent_groups'))==3 and all(f['field'].isdigit() for f in fields))
    expected={(f['field'],m) for f in fields for m,use in f['usage'].items() if use=='D'}
    actual={(c['field'],c['message']) for c in conds}
    check('varje numerisk D-cell har exakt ett villkor',expected==actual and len(actual)==len(conds),f'{len(actual)} villkor; saknas {sorted(expected-actual)}; extra {sorted(actual-expected)}')
    check('regelkort har villkor, båda utfall, källa och ansvar',all(all(r.get(k) for k in ['condition','on_pass','on_failure','source','callsite_owner','activation_gate']) for r in rules))
    check('alla regelkort har ett acceptanskontrakt',all(r['test_id'] in test_ids for r in rules))
    check('alla PRODAT-fall har ett acceptanskontrakt',all(r['test_id'] in test_ids for r in cases))
    missing={rid for n in ['state_transitions','callsite_contracts','acceptance_tests'] for r in load(n) for rid in r.get('rule_ids',[]) if rid not in rule_ids}
    check('alla interna regelreferenser kan lösas',not missing,','.join(sorted(missing)))
    check('inga systemtester felaktigt markerade genomförda',all(t['execution_status']=='Inte körd mot systemet' and not t['evidence'] for t in tests))
    check('rätt roll/appref för PRODAT',all(c['application_reference']==('23-DGI-PRODAT' if c['operating_role']=='ESCO' else '23-DDQ-PRODAT') for c in cases))
    check('ESCO:s operativa utgående PRODAT är endast Z13/Z18',all(c['code'] in {'Z13','Z18'} for c in cases if c['operating_role']=='ESCO' and c['direction']=='outbound'))
    check('inga felaktiga Z13C eller Z14C fall',not any(c['code'] in {'Z13','Z14'} and c['subtype']=='C' for c in cases))
    check('PRODAT CCI-locator använder inte UTILTS-egenskapens 7037',all('7037' not in f['locator'] for f in fields))
    check('S07:s båda supplier-riktningar specificerade',{'inbound','outbound'}<={c['direction'] for c in caps if c['code']=='S07' and c['role']=='SUPPLIER'})
    check('tidigare 62 fynd är bevarade',len(load('prior_findings_62')['items'])==62)
    check('sju uttryckliga öppna bevisgrindar',len(load('open_evidence_gates'))==7 and all(g['status']=='Öppen' for g in load('open_evidence_gates')))
    check('källmanifest har dokumenthash och sidantal',all(len(s['sha256'])==64 and s['pages']>0 and s['filename'].endswith('.pdf') for s in sources))
    required=['MASTERMASTERPLAN_v2.md','annex/A_Regelkort.md','annex/B_PRODAT_falt_och_villkor.md',
      'annex/C_UTILTS_applikationsfalt_och_kodkontroller.md','annex/D_Acceptanskontrakt.md',
      'annex/E_Tidigare_62_granskningspunkter.md','contracts/ediel-execution.ts']
    check('alla huvudbilagor finns',all((B/p).is_file() and (B/p).stat().st_size>0 for p in required))
except (KeyError,ValueError,TypeError,OSError) as exc:
    check('registerinläsning',False,f'{type(exc).__name__}: {exc}')
result={'checked_at':datetime.now(timezone.utc).isoformat(),'scope':'Enbart integritet och korsreferenser i specifikationspaketet',
 'application_tested':False,'edifact_conformance_tested':False,'production_readiness_asserted':False,
 'passed':all(c['pass'] for c in checks),'checks':checks}
out=B/'verification/spec_integrity_result.json';out.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'passed':result['passed'],'checks':len(checks),'failed':[c for c in checks if not c['pass']],'result':str(out)},ensure_ascii=False,indent=2))
sys.exit(0 if result['passed'] else 1)
