#!/usr/bin/env python3
"""Assemble new T5 packets from explicitly bound observations; never certify a campaign.

Usage: python3 -I packet.py evidence-directory NEW-output-directory classification.json
See README.md for the successor metadata contract. No network or runtime is invoked.
"""
import datetime as dt
import hashlib
import json
import math
import pathlib
import re
import sys

GROUPS = ('auth01', 'api01', 'api01-poa', 'event01', 'scan')
STATES = {'PASS', 'PARTIAL', 'FAIL', 'BLOCKED', 'NOT_RUN'}
SCOPES = {'SOURCE_ONLY', 'COMPONENT', 'SCENARIO'}


class PacketError(ValueError):
    pass


def require(condition, code):
    if not condition:
        raise PacketError(code)


def strict_json(value):
    def object_pairs(pairs):
        result = {}
        for key, item in pairs:
            require(key not in result, 'duplicate_json_key')
            result[key] = item
        return result

    def reject_constant(_):
        raise PacketError('nonfinite_json_number')

    def finite_float(value):
        number = float(value)
        require(math.isfinite(number), 'nonfinite_json_number')
        return number

    return json.loads(value, object_pairs_hook=object_pairs, parse_constant=reject_constant, parse_float=finite_float)


def text(value):
    return isinstance(value, str) and bool(value.strip())


def digest(value, size=64):
    return isinstance(value, str) and re.fullmatch(r'[0-9a-f]{' + str(size) + '}', value) is not None


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def relative_path(value):
    return (text(value) and not value.startswith('/') and '\\' not in value
            and all(part not in ('', '.', '..') for part in value.split('/')))


def evidence_file(directory, name):
    require(relative_path(name) and '/' not in name, 'invalid_evidence_filename')
    path = directory / name
    require(path.is_file() and not path.is_symlink(), 'evidence_file_unavailable')
    return path


def utc_time(value):
    require(text(value), 'missing_utc_time')
    stamp = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
    require(stamp.tzinfo is not None and stamp.utcoffset() == dt.timedelta(0), 'unqualified_utc_time')
    return stamp


def load_report(directory, group, binding):
    require(isinstance(binding, dict), 'missing_report_binding')
    path = evidence_file(directory, group + '-report.json')
    require(digest(binding.get('reportSha256')) and sha(path) == binding['reportSha256'], 'report_hash_mismatch')
    report = strict_json(path.read_text())
    require(isinstance(report, dict), 'invalid_report')
    for key, observed in (('sourceCommit', 'appCommit'), ('builtCommit', 'builtCommit'), ('replayCommit', 'replayCommit')):
        require(digest(report.get(observed), 40) and binding.get(key) == report[observed], 'source_identity_mismatch')
    require(text(binding.get('command')), 'missing_observed_command')
    require(text(binding.get('environmentId')) and text(binding.get('databaseIdentity')), 'missing_report_environment')
    require(utc_time(report['finishedAt']) >= utc_time(report['startedAt']), 'invalid_report_interval')
    require(type(report.get('runDirClean')) is bool and type(report.get('exitCode')) is int, 'missing_run_observation')
    require(text(report.get('scenarioFile')) and text(report.get('executionScope')), 'missing_execution_observation')
    log = evidence_file(directory, binding.get('logFile'))
    require(pathlib.Path(report['log']).name == log.name and digest(report.get('logSha256'))
            and sha(log) == report['logSha256'], 'log_hash_mismatch')
    schema = binding.get('schemaHash')
    require(isinstance(schema, dict) and text(schema.get('scope')) and digest(schema.get('fingerprint'))
            and digest(schema.get('evidenceSha256')), 'missing_schema_observation')
    schema_file = evidence_file(directory, schema.get('evidenceFile'))
    require(sha(schema_file) == schema['evidenceSha256'] and schema_file.read_text().strip() == schema['fingerprint'],
            'schema_hash_mismatch')
    harness = report.get('harness')
    require(isinstance(harness, dict) and 'gitCommitIfAny' in harness and isinstance(harness.get('files'), list)
            and bool(harness['files']), 'missing_harness_observation')
    require(harness['gitCommitIfAny'] is None or digest(harness['gitCommitIfAny'], 40), 'invalid_harness_commit')
    names = []
    for file in harness['files']:
        require(isinstance(file, dict) and relative_path(file.get('path')) and digest(file.get('sha256')), 'invalid_harness_file')
        names.append(file['path'])
    require(len(names) == len(set(names)), 'duplicate_harness_file')
    overlays = binding.get('overlayRefs')
    require(isinstance(overlays, list) and bool(overlays), 'missing_overlay_observation')
    for overlay in overlays:
        require(isinstance(overlay, dict) and text(overlay.get('kind')) and text(overlay.get('branch'))
                and isinstance(overlay.get('paths'), list) and bool(overlay['paths'])
                and all(text(p) and relative_path(p.rstrip('/')) for p in overlay['paths']), 'invalid_overlay_observation')
        require(digest(overlay.get('commit'), 40) or (overlay['kind'] == 'harness' and overlay.get('commit') is None),
                'invalid_overlay_commit')
    require(any(o['kind'] == 'harness' and o.get('commit') == harness['gitCommitIfAny'] for o in overlays),
            'overlay_harness_mismatch')
    require(isinstance(report.get('steps'), list) and isinstance(report.get('summary'), dict), 'missing_report_steps')
    for step in report['steps']:
        require(isinstance(step, dict) and text(step.get('name')) and step.get('status') in {'passed', 'failed', 'skipped'},
                'invalid_report_step')
        duration = step.get('durationMs')
        require(duration is None or (type(duration) in (int, float) and math.isfinite(duration) and duration >= 0),
                'invalid_step_duration')
    return report


def matched_steps(report, scenario):
    pattern = r'(?<![\w.])' + re.escape(scenario) + r'(?![\w.])'
    return [s for s in report['steps'] if re.search(pattern, s['name'])]


def observed_run(group, report, binding, directory):
    return {'group': group, 'command': binding['command'], 'sourceCommit': report['appCommit'],
            'builtCommit': report['builtCommit'], 'replayCommit': report['replayCommit'],
            'environmentId': binding['environmentId'], 'databaseIdentity': binding['databaseIdentity'],
            'harnessCommit': report['harness']['gitCommitIfAny'], 'harnessSource': report['harness'],
            'overlayRefs': binding['overlayRefs'], 'schemaHash': binding['schemaHash'],
            'schemaValidation': 'FINGERPRINT_FILE_ONLY', 'startedAtUtc': report['startedAt'],
            'finishedAtUtc': report['finishedAt'], 'reportSha256': sha(directory / (group + '-report.json')),
            'vitestLogSha256': report['logSha256']}


def assemble(directory, output, classification):
    require(directory.is_dir() and not output.exists(), 'new_output_directory_required')
    require(isinstance(classification, dict) and isinstance(classification.get('_meta'), dict), 'missing_metadata')
    meta = classification['_meta']
    for key in ('workerId', 'session', 'model', 'campaignId', 'cleanupReceipt'):
        require(text(meta.get(key)), 'missing_' + key)
    require(digest(meta.get('baselineCommit'), 40), 'invalid_baseline_commit')
    require(isinstance(meta.get('clockModel'), dict) and isinstance(meta.get('versions'), dict), 'missing_environment_metadata')
    utc_time(meta.get('heartbeatAtUtc'))
    bindings = meta.get('reportBindings')
    require(isinstance(bindings, dict) and set(bindings) == set(GROUPS), 'missing_report_bindings')
    reports = {group: load_report(directory, group, bindings[group]) for group in GROUPS}
    receipts = {}
    for group in GROUPS:
        path = directory / (group + '-report.receipts.jsonl')
        require(not path.is_symlink(), 'symlink_receipts_refused')
        receipts[group] = [strict_json(line) for line in path.read_text().splitlines() if line.strip()] if path.is_file() else []
        require(all(isinstance(row, dict) for row in receipts[group]), 'invalid_receipt')
    evidence = [{'file': p.name, 'sha256': sha(p)} for p in sorted(directory.iterdir()) if p.is_file() and not p.is_symlink()]
    packets = {}
    for scenario, case in classification.items():
        if scenario == '_meta':
            continue
        require(re.fullmatch(r'(?:AUTH01\.0[1-6]|API01\.0[1-5]|EVENT01\.0[1-5])', scenario) is not None,
                'unknown_scenario_id')
        require(isinstance(case, dict) and case.get('state') in STATES and case.get('evidenceScope') in SCOPES,
                'invalid_classification_scope')
        require(case.get('proposedState') is None or case['proposedState'] in STATES, 'invalid_proposed_state')
        for key in ('scope', 'oracle', 'nextAction'):
            require(text(case.get(key)), 'missing_case_' + key)
        for key in ('substitutions', 'notVerified', 'findingsIds'):
            require(isinstance(case.get(key, []), list) and all(text(v) for v in case.get(key, [])), 'invalid_case_list')
        group = 'api01-poa' if scenario == 'API01.03' else {'AUTH01': 'auth01', 'API01': 'api01', 'EVENT01': 'event01'}[scenario.split('.')[0]]
        report, binding = reports[group], bindings[group]
        require(case.get('appliesToCommit') == report['builtCommit'], 'classification_build_mismatch')
        steps = matched_steps(report, scenario)
        runs = [(group, report)]
        extra = []
        if scenario == 'AUTH01.06':
            extra = matched_steps(reports['scan'], scenario)
            runs.append(('scan', reports['scan']))
        promoted = case['state'] == 'PASS' or case.get('proposedState') == 'PASS'
        if promoted:
            require(case['evidenceScope'] == 'SCENARIO' and not case.get('notVerified') and not case.get('blocker'),
                    'incomplete_evidence_cannot_pass')
            require(bool(steps) and (scenario != 'AUTH01.06' or bool(extra)), 'missing_pass_steps')
            require(all(s['status'] == 'passed' for s in steps + extra), 'nonpassing_case_steps')
            if scenario == 'AUTH01.06':
                scan, scan_binding = reports['scan'], bindings['scan']
                require(scan['builtCommit'] == report['builtCommit'] and scan['replayCommit'] == report['replayCommit']
                        and scan_binding['environmentId'] == binding['environmentId']
                        and scan_binding['databaseIdentity'] == binding['databaseIdentity']
                        and scan_binding['schemaHash']['fingerprint'] == binding['schemaHash']['fingerprint'],
                        'scan_target_epoch_mismatch')
                require(all(utc_time(scan['startedAt']) >= utc_time(reports[name]['finishedAt'])
                            for name in GROUPS if name != 'scan'), 'scan_precedes_required_reports')
            for _, run in runs:
                require(run['executionScope'] == 'ISOLATED_NATIVE' and run['runDirClean'], 'unqualified_pass_scope')
                require(not any(s['status'] == 'failed' and s['name'].rstrip().endswith('(suite)') for s in run['steps']),
                        'suite_failure_cannot_pass')
        steps += extra
        observed = observed_run(group, report, binding, directory)
        packets[scenario] = {
            'scenarioId': scenario, 'workerId': meta['workerId'], 'session': meta['session'], 'model': meta['model'],
            'campaignId': meta['campaignId'], 'baselineCommit': meta['baselineCommit'],
            **observed, 'appCommit': report['builtCommit'],
            'appCommitNote': 'builtCommit from runtime report; no application-source-equivalence assertion',
            'sourceBuildDiffer': report['appCommit'] != report['builtCommit'],
            'sourceReplayDiffer': report['appCommit'] != report['replayCommit'],
            'clockModel': meta['clockModel'], 'versions': meta['versions'],
            'state': case['state'], 'proposedState': case.get('proposedState'),
            'evidenceScope': case['evidenceScope'], 'scope': case['scope'], 'appliesToCommit': case['appliesToCommit'],
            'executionScope': report['executionScope'], 'runExitCode': report['exitCode'],
            'scenarioFile': report['scenarioFile'], 'runDirClean': report['runDirClean'], 'scenarioSummary': report['summary'],
            'steps': [{'name': s['name'], 'status': s['status'],
                       'durationMs': None if s.get('durationMs') is None else round(s['durationMs'])} for s in steps],
            'relatedSteps': [{'name': s['name'], 'status': s['status']} for s in report['steps'] if 'SETUP' in s['name']],
            'skipped': [s['name'] for s in steps if s['status'] == 'skipped'],
            'evidenceRefs': {'privateDir': str(directory), 'files': evidence,
                             'reportSha256': observed['reportSha256'], 'vitestLogSha256': report['logSha256']},
            'receipts': [r for name, _ in runs for r in receipts[name]
                         if r.get('scenarioId') == scenario or (group == 'event01' and r.get('scenarioId') == 'SETUP')],
            'additionalRuns': [observed_run('scan', reports['scan'], bindings['scan'], directory)] if scenario == 'AUTH01.06' else [],
            'oracle': case['oracle'], 'substitutions': case.get('substitutions', []), 'notVerified': case.get('notVerified', []),
            'findingsIds': case.get('findingsIds', []), 'blocker': case.get('blocker'), 'nextAction': case['nextAction'],
            'review': case.get('review'), 'cleanupReceipt': meta['cleanupReceipt'], 'heartbeatAtUtc': meta['heartbeatAtUtc'],
            'assemblyOnly': True, 'campaignApproval': False,
        }
    require(bool(packets), 'empty_classification')
    # Every row and artifact is checked before creating any output. Existing
    # historical packets are never overwritten, including an existing empty dir.
    output.mkdir(parents=True, exist_ok=False)
    for scenario, packet in packets.items():
        target = output / scenario
        target.mkdir()
        with (target / 'status.json').open('x') as file:
            json.dump(packet, file, ensure_ascii=False, indent=2, allow_nan=False)
            file.write('\n')
        print(scenario, packet['state'])


def main():
    try:
        require(len(sys.argv) == 4, 'expected_evidence_output_classification')
        directory, output, source = (pathlib.Path(p) for p in sys.argv[1:])
        assemble(directory, output, strict_json(source.read_text()))
        return 0
    except (OSError, ValueError, TypeError, KeyError) as error:
        # Do not echo evidence contents or arbitrary input values on failure.
        print('packet_refused: ' + (str(error) if isinstance(error, PacketError) else 'invalid_input_or_io'), file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
