#!/usr/bin/env python3
"""Compose the dedicated synthetic reading runner from the exact green Z03C source.

This command only writes a candidate Python file. The protected workflow owns
its input and every invocation or privileged operation of the resulting file.
"""

import argparse
import hashlib
from pathlib import Path
import re
import shlex
import textwrap

BASE_CONTROL_SHA256 = 'f94260d28863713f652c756efc55019016b0b250eeeacd064910cc297c5e1616'
CASES = {
    'fg': ('scripts/ediel-at-z06fg-supplier-acceptance-native.config.ts',
           'scripts/ediel-at-z06f-supplier-acceptance-native.test.ts',
           'F first case approval versions only its original structure; physical extra UD=false never changes customer identity',
           ['persisted']),
    'z10m': ('scripts/ediel-at-z10m-supplier-acceptance-native.config.ts',
             'scripts/ediel-at-z10m-supplier-acceptance-native.test.ts',
             'UTILTS readings bind the old meter to the Z04 baseline and the new meter to the Z10 version across the change minute',
             ['persisted', 'persisted', 'structural_err']),
}


FOLLOWUP_CONFIG = 'scripts/ediel-source-owner-native.config.ts'
FOLLOWUP_TEST = 'scripts/ediel-z06f-reading-followup-native.test.ts'
CASES['z06f-followup-own'] = (
    FOLLOWUP_CONFIG, FOLLOWUP_TEST,
    'actual F apply creates own pending expectation; accepted physical AES/MG/QTY220/DTM597 persist fulfills only that source without extra market request',
    ['persisted'],
)
for variant in ('register', 'meter', 'agency', 'date', 'quantity'):
    CASES[f'z06f-followup-{variant}'] = (
        FOLLOWUP_CONFIG, FOLLOWUP_TEST,
        f"actual misaligned or missing own reading ('{variant}') cannot fulfill F or borrow sibling evidence",
        ['unfulfilled'],
    )


def splice(source, start, end, replacement):
    if source.count(start) != 1 or source.count(end) != 1:
        raise ValueError('completed_reading_controller_slot_preimage_unknown')
    before, tail = source.split(start, maxsplit=1)
    _, after = tail.split(end, maxsplit=1)
    return before + replacement + end + after


def compose(template, suite):
    config, test, case, outcomes = CASES[suite]
    match = re.search(r"^          cat > .* <<'PY'\n(.*?)^          PY$", template, re.MULTILINE | re.DOTALL)
    if not match:
        raise ValueError('completed_reading_controller_template_missing')
    source = textwrap.dedent(match[1])
    if hashlib.sha256(source.encode()).hexdigest() != BASE_CONTROL_SHA256:
        raise ValueError('completed_reading_controller_template_hash_mismatch')

    # Keep the exact owned watchdog, mutual exclusion, time/NTP qualification,
    # rollback order, source inventory and restored-only evidence publication.
    source = source.replace('Z03C', 'COMPLETED_READING').replace('z03c', 'completed_reading')
    source = source.replace('completed_reading-supplier-boundary-native-evidence', 'completed_reading-native-evidence')
    source = source.replace('completed_reading-supplier-boundary-native-working', 'completed_reading-native-working')
    # A stale Date cannot qualify the clock. Ask for a fresh sample within
    # the donor's original attempt and monotonic limits before failing closed.
    stale_sample = "        if abs(time.time()-stamp)>30:raise RuntimeError('completed_reading_trusted_normal_reference_skew')"
    http_filter = '                if error.code not in {408,429,500,502,503,504} or attempt==3:raise'
    if source.count(stale_sample) != 1 or source.count(http_filter) != 1:
        raise ValueError('completed_reading_reference_preimage_unknown')
    source = source.replace(stale_sample, """        if abs(time.time()-stamp)>30:
            if attempt==3 or attempt>=deadline-time.monotonic():
                raise RuntimeError('completed_reading_trusted_normal_reference_skew')
            time.sleep(attempt)
            continue""")
    source = source.replace(http_filter, """                rate_limited=(error.code==403 and error.headers is not None
                    and bool(error.headers.get('Retry-After')))
                if (error.code not in {408,429,500,502,503,504} and not rate_limited) or attempt==3:raise""")
    admission = '''def require_reviewed_checkout(expected_head, environment):
    error='completed_reading_reviewed_owner_dispatch_required'
    repository='heke99/gridex-ops-platform'
    if not re.fullmatch('[0-9a-f]{40}',expected_head or ''):raise RuntimeError(error)
    if environment.get('GITHUB_REPOSITORY')!=repository or environment.get('GITHUB_ACTOR')!='heke99' or environment.get('GITHUB_TRIGGERING_ACTOR')!='heke99' or environment.get('GITHUB_RUN_ATTEMPT')!='1':raise RuntimeError(error)
    event_name=environment.get('GITHUB_EVENT_NAME')
    ref=environment.get('GITHUB_REF')
    if event_name=='workflow_dispatch':
        if ref!='refs/heads/main':raise RuntimeError(error)
        return
    review_branches={
        1269:'codex/gridex-ops-integrated-verification-20261124-0640',
        1270:'codex/gridex-ops-qualification-21e392e7',
    }
    if event_name!='pull_request' or ref not in {f'refs/pull/{number}/merge' for number in review_branches}:raise RuntimeError(error)
    event=json.loads(pathlib.Path(environment['GITHUB_EVENT_PATH']).read_text())
    pr=event['pull_request']; base=pr['base']; head=pr['head']
    number=pr['number']
    if number not in review_branches or ref!=f'refs/pull/{number}/merge':raise RuntimeError(error)
    if event['action']!='labeled' or pr['draft'] is not True or pr['state']!='open' or event['sender']['login']!='heke99' or pr['user']['login']!='heke99':raise RuntimeError(error)
    if base['ref']!='main' or base['repo']['full_name']!=repository or head['repo']['full_name']!=repository or head['ref']!=review_branches[number]:raise RuntimeError(error)
    if head['sha']!=expected_head or event['label']['name']!='e66-clock-'+expected_head:raise RuntimeError(error)
require_reviewed_checkout(os.environ.get('GRIDEX_COMPLETED_READING_EXPECTED_HEAD'),os.environ)
'''
    anchor = "head=call(['git','rev-parse','HEAD']);tree=call(['git','rev-parse','HEAD^{tree}'])"
    if source.count(anchor) != 1:
        raise ValueError('completed_reading_controller_admission_preimage_unknown')
    source = source.replace(anchor, admission + anchor)
    source = source.replace("call(['docker','ps','-q'])", "call(['docker','ps','-aq'])")
    source = source.replace("call(['docker','ps','--format','{{.Names}}'])", "call(['docker','ps','-a','--format','{{.Names}}'])")
    native = f'''        import secrets
        environment=dict(os.environ,GRIDEX_NATIVE_STATUS=str(status),GRIDEX_READING_CLOCK_CONTROL=str(state_path),
            GRIDEX_READING_CLOCK_CONTROLLER=str(pathlib.Path(__file__).resolve()),GRIDEX_READING_CLOCK_EVIDENCE=str(working),
            GRIDEX_COMPLETED_READING_SUITE={suite!r},GRIDEX_EDIEL_CASE_TEST_PASSWORD=secrets.token_urlsafe(32),
            SUPABASE_INTERNAL_IMAGE_REGISTRY='ghcr.io',DO_NOT_TRACK='1',SUPABASE_TELEMETRY_DISABLED='1')
        script=r\'''set -euo pipefail
source scripts/gridex-aud-003-clean-replay.sh > "$RUNNER_TEMP/completed_reading-bootstrap.log" 2>&1
supabase status -o json > "$GRIDEX_NATIVE_STATUS"
NODE_OPTIONS="$NODE_OPTIONS --require=$GITHUB_WORKSPACE/clock-driver/scripts/lib/native-clock-loopback-only.cjs" node node_modules/vitest/vitest.mjs run \\
  --config {config} {test} --testNamePattern {shlex.quote('^' + re.escape(case) + '$')} \\
  --reporter=default --reporter=junit --outputFile="$GRIDEX_READING_CLOCK_EVIDENCE/native-junit.xml" > "$GRIDEX_READING_CLOCK_EVIDENCE/native.log" 2>&1
\'''
'''
    source = splice(source, '        environment=dict(', '        # Child cannot execute bootstrap', native)
    verification = f'''            expected={case!r}
            failed=any(c.find('failure') is not None or c.find('error') is not None for c in tests)
            passed=[c.attrib.get('name','').split(' > ')[-1] for c in tests if c.find('skipped') is None]
            if failed or passed!=[expected]:raise RuntimeError('completed_reading_exact_passed_case_required')
            product=json.loads((working/'product-boundary-receipt.json').read_text())
            expected_outcomes={outcomes!r}
            if product['schema']!='completed_reading_native_v1' or product['suite']!={suite!r} or [s['outcome'] for s in product['sources']]!=expected_outcomes:raise RuntimeError('completed_reading_measured_sources_required')
'''
    source = splice(source, '            expected={\'C03-', "    stage='SOURCE_POSTIMAGE'", verification)
    source = source.replace("'ordinary_required_gates':'NOT_REPLACED'", f"'suite':{suite!r},'ordinary_required_gates':'NOT_REPLACED'")
    compile(source, '<completed-reading-owned-controller>', 'exec')
    return source


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--template', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--suite', required=True, choices=CASES)
    args = parser.parse_args()
    source = compose(args.template.read_text(), args.suite)
    with args.output.open('x') as file:
        file.write(source)


if __name__ == '__main__':
    main()
