#!/usr/bin/env python3
"""Assemble new T5 packets from explicitly bound observations; never certify a campaign.

Usage: python3 -I packet.py evidence-directory NEW-output-directory classification.json
       python3 -I packet.py --scan-final-archive FINAL.zip CONTEXT.json PRIVATE_NEEDLE_FILE NEW_PROOF_DIR
       python3 -I packet.py --verify-final-archive FINAL.zip MANIFEST.json RECEIPT.json EXPECTED_HANDOFF.json
See README.md for the successor metadata contract. No network or runtime is invoked.
"""
import datetime as dt
import hashlib
import io
import json
import math
import os
import pathlib
import re
import stat
import struct
import subprocess
import sys
import zipfile
import zlib

GROUPS = ('auth01', 'api01', 'api01-poa', 'event01', 'scan')
STATES = {'PASS', 'PARTIAL', 'FAIL', 'BLOCKED', 'NOT_RUN'}
SCOPES = {'SOURCE_ONLY', 'COMPONENT', 'SCENARIO'}
SCENARIO_PATTERN = r'(?:AUTH01\.0[1-6]|API01\.0[1-5]|EVENT01\.0[1-5])'


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


def qualify_pass_run(report, scenario):
    failed = [step for step in report['steps'] if step['status'] == 'failed']
    for step in failed:
        other_ids = re.findall(r'(?<![\w.])' + SCENARIO_PATTERN + r'(?![\w.])', step['name'])
        require(other_ids and scenario not in other_ids and not step['name'].rstrip().endswith('(suite)'),
                'unattributed_failure_cannot_pass')
    require(report['exitCode'] in (0, 1), 'abnormal_process_exit_cannot_pass')
    require(report['exitCode'] == 0 or bool(failed), 'unexplained_failed_exit_cannot_pass')
    if 'vitest' in report:
        runner = report['vitest']
        require(isinstance(runner, dict) and type(runner.get('success')) is bool, 'missing_runner_observation')
        count, suites = runner.get('numFailedTests'), runner.get('numFailedTestSuites')
        require(type(count) is int and type(suites) is int and count == len(failed)
                and (1 <= suites <= count if failed else suites == 0)
                and runner['success'] == (not failed), 'unexplained_runner_failure_cannot_pass')


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
        require(re.fullmatch(SCENARIO_PATTERN, scenario) is not None,
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
                qualify_pass_run(run, scenario)
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
            'runnerSummary': report.get('vitest'),
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


FINAL_SCOPE = 'FINAL_DELIVERY_ARTIFACT_BYTES_ONLY'
FINAL_IDS = tuple(f'{group}.{number:02d}' for group, count in (('AUTH01', 6), ('API01', 5), ('EVENT01', 5))
                  for number in range(1, count + 1))
FINAL_FILES = {scenario + '/status.json' for scenario in FINAL_IDS} | {'FINDINGS.md'}
FINAL_PATTERNS = {
    'jwt': r'\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}',
    'partner-token': r'\bgdxp_[0-9a-f]{7}\.[A-Za-z0-9_-]{20,}',
    'svix-secret': r'\bwhsec_[A-Za-z0-9+/=]{20,}',
    'sb-cookie': r'sb-[a-z0-9-]+-auth-token=',
}
FINAL_POLICY = {
    'schema': 'gridex-t5-final-secret-policy-v1', 'scope': FINAL_SCOPE, 'layout': 't5-status-17-v1',
    'encoding': 'utf8-sorted-json-newline-v1', 'needle': 'explicit-private-file-exact-bytes',
    'patterns': FINAL_PATTERNS, 'scanInputs': ['raw-zip', 'member-names', 'uncompressed-members', 'canonical-context'],
    'directoryEntries': 'canonical-empty-parents-only',
    'zipStructure': 'zip32-single-disk-contiguous-no-descriptors-v1',
    'compressedStreams': 'bounded-full-eof-actual-size-crc-no-trailing-v1',
    'maxArchiveBytes': 64 * 1024 * 1024, 'maxExpandedBytes': 256 * 1024 * 1024,
    'maxMemberBytes': 64 * 1024 * 1024, 'compressionMethods': [zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED],
}


def final_encoded(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False) + '\n').encode('utf-8')


def final_digest(value):
    return hashlib.sha256(value).hexdigest()


def final_path(value):
    path = pathlib.Path(value).absolute()
    require('..' not in path.parts and str(path.resolve()) == str(path)
            and not any(node.is_symlink() for node in (path, *path.parents)), 'final_noncanonical_or_symlink_path')
    return path


def final_read(path, limit, private=False):
    path = final_path(path)
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(descriptor)
        require(stat.S_ISREG(before.st_mode) and before.st_size <= limit, 'final_regular_file_or_size_required')
        require(not private or before.st_uid == os.getuid() and stat.S_IMODE(before.st_mode) == 0o600,
                'final_private_file_required')
        chunks, size = [], 0
        while size <= limit:
            chunk = os.read(descriptor, min(1024 * 1024, limit + 1 - size))
            if not chunk:
                break
            chunks.append(chunk)
            size += len(chunk)
        after = os.fstat(descriptor)
        keys = ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_ctime_ns')
        require(size <= limit and size == before.st_size and all(getattr(before, key) == getattr(after, key) for key in keys),
                'final_input_changed_or_too_large')
        return b''.join(chunks)
    finally:
        os.close(descriptor)


def final_outside_git(directory):
    directory = final_path(directory)
    require(directory.is_dir(), 'final_private_parent_required')
    environment = {'PATH': os.environ.get('PATH', '/usr/bin:/bin'), 'LC_ALL': 'C',
                   'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': os.devnull}
    for flag in ('--is-inside-work-tree', '--is-inside-git-dir'):
        result = subprocess.run(['git', '-C', str(directory), 'rev-parse', flag], env=environment,
                                capture_output=True, text=True, timeout=10)
        require(result.returncode == 0 and result.stdout.strip() == 'false'
                or result.returncode == 128 and 'not a git repository' in result.stderr.lower(), 'final_private_path_inside_git_or_unknown')


def final_context(value):
    keys = {'schema', 'campaignId', 'workerId', 'session', 'model', 'sourceCommit', 'sourceTree', 'builtCommit', 'buildId',
            'replayCommit', 'harnessCommit', 'harnessFiles', 'environmentId', 'databaseIdentity', 'schemaHash'}
    require(isinstance(value, dict) and set(value) == keys
            and value['schema'] == 'gridex-t5-final-archive-context-v1', 'final_context_schema_required')
    for key in ('campaignId', 'workerId', 'session', 'model', 'buildId', 'environmentId', 'databaseIdentity'):
        require(text(value[key]) and len(value[key]) <= 512 and all(ord(c) >= 32 for c in value[key]), 'final_context_identity_required')
    require('://' not in value['databaseIdentity'] and '@' not in value['databaseIdentity'], 'final_database_identifier_not_credentials')
    for key in ('sourceCommit', 'sourceTree', 'builtCommit', 'replayCommit'):
        require(digest(value[key], 40), 'final_context_commit_required')
    require(value['harnessCommit'] is None or digest(value['harnessCommit'], 40), 'final_context_harness_commit_invalid')
    files = value['harnessFiles']
    require(isinstance(files, list) and files and len(files) <= 256, 'final_context_harness_files_required')
    names = []
    for file in files:
        require(isinstance(file, dict) and set(file) == {'path', 'sha256'} and relative_path(file['path'])
                and len(file['path']) <= 1024 and all(ord(c) >= 32 for c in file['path']) and digest(file['sha256']),
                'final_context_harness_file_invalid')
        names.append(file['path'])
    require(len(names) == len(set(names)), 'final_context_duplicate_harness_file')
    schema = value['schemaHash']
    require(isinstance(schema, dict) and set(schema) == {'scope', 'fingerprint'} and text(schema['scope'])
            and len(schema['scope']) <= 4096 and all(ord(c) >= 32 for c in schema['scope'])
            and digest(schema['fingerprint']), 'final_context_schema_scope_required')
    return value


def final_no_secret(value, needle):
    require(needle not in value and not any(re.search(pattern.encode('ascii'), value) for pattern in FINAL_PATTERNS.values()),
            'final_artifact_secret_found')


def final_zip_ranges(raw, entries):
    # Do not let a permissive ZIP reader silently repair offsets, ignore gaps
    # or trust a shorter central-directory view of a compressed payload.
    position = raw.rfind(b'PK\x05\x06', max(0, len(raw) - 65557))
    end = None
    while position >= 0:
        if position + 22 <= len(raw):
            candidate = struct.unpack_from('<4s4H2IH', raw, position)
            if position + 22 + candidate[7] == len(raw):
                end = candidate
                break
        position = raw.rfind(b'PK\x05\x06', max(0, len(raw) - 65557), position)
    require(end is not None and end[1] == end[2] == 0 and end[3] == end[4] == len(entries)
            and end[5] != 0xffffffff and end[6] != 0xffffffff and end[6] + end[5] == position,
            'final_archive_end_or_catalog_invalid')
    catalog_start, catalog_end = end[6], position
    cursor, ranges, regions = catalog_start, {}, []

    def zip32_extra(extra):
        offset = 0
        while offset < len(extra):
            require(offset + 4 <= len(extra), 'final_archive_extra_invalid')
            kind, length = struct.unpack_from('<HH', extra, offset)
            offset += 4
            require(kind != 1 and offset + length <= len(extra), 'final_archive_zip64_or_extra_invalid')
            offset += length

    for entry in entries:
        require(cursor + 46 <= catalog_end, 'final_archive_catalog_range_invalid')
        central = struct.unpack_from('<4s6H3I5H2I', raw, cursor)
        name_length, extra_length, comment_length = central[10:13]
        next_cursor = cursor + 46 + name_length + extra_length + comment_length
        require(central[0] == b'PK\x01\x02' and next_cursor <= catalog_end and central[13] == 0
                and central[2] <= 20 and not central[3] & ~0x806
                and (central[4] == zipfile.ZIP_DEFLATED or not central[3] & 6), 'final_archive_zip32_profile_required')
        name = raw[cursor + 46:cursor + 46 + name_length]
        decoded = name.decode('utf-8' if central[3] & 0x800 else 'cp437')
        require(decoded == entry.filename and (central[3], central[4], central[7], central[8], central[9], central[16])
                == (entry.flag_bits, entry.compress_type, entry.CRC, entry.compress_size, entry.file_size, entry.header_offset),
                'final_archive_catalog_identity_mismatch')
        zip32_extra(raw[cursor + 46 + name_length:cursor + 46 + name_length + extra_length])
        local_offset = central[16]
        require(local_offset + 30 <= catalog_start, 'final_archive_local_range_invalid')
        local = struct.unpack_from('<4s5H3I2H', raw, local_offset)
        local_name_length, local_extra_length = local[9:11]
        data_start = local_offset + 30 + local_name_length + local_extra_length
        data_end = data_start + central[8]
        require(local[0] == b'PK\x03\x04' and data_start <= data_end <= catalog_start
                and local[1:9] == (central[2], central[3], central[4], central[5], central[6], central[7], central[8], central[9])
                and raw[local_offset + 30:local_offset + 30 + local_name_length] == name,
                'final_archive_local_catalog_mismatch')
        zip32_extra(raw[local_offset + 30 + local_name_length:data_start])
        ranges[entry.filename] = (data_start, data_end)
        regions.append((local_offset, data_end))
        cursor = next_cursor
    require(cursor == catalog_end, 'final_archive_catalog_length_mismatch')
    previous = 0
    for first, last in sorted(regions):
        require(first == previous, 'final_archive_unbound_or_overlapping_range')
        previous = last
    require(previous == catalog_start, 'final_archive_unbound_or_overlapping_range')
    return ranges


def final_expand(compressed, entry, remaining):
    limit = min(FINAL_POLICY['maxMemberBytes'], remaining)
    require(limit >= 0, 'final_archive_actual_expansion_limit')
    if entry.compress_type == zipfile.ZIP_STORED:
        require(len(compressed) <= limit, 'final_archive_actual_expansion_limit')
        value = compressed
    else:
        decoder = zlib.decompressobj(-15)
        value = decoder.decompress(compressed, limit + 1)
        require(len(value) <= limit, 'final_archive_actual_expansion_limit')
        require(decoder.eof and not decoder.unused_data and not decoder.unconsumed_tail,
                'final_archive_deflate_incomplete_or_trailing')
    require(len(value) == entry.file_size and zlib.crc32(value) & 0xffffffff == entry.CRC,
            'final_archive_actual_size_or_crc_mismatch')
    return value


def final_members(raw, needle=None):
    if needle is not None:
        final_no_secret(raw, needle)
    records, names, total = [], set(), 0
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            entries = archive.infolist()
            require(len(entries) <= 33, 'final_archive_member_limit')
            for entry in entries:
                name = entry.filename
                require(name == entry.orig_filename and name not in names and relative_path(name.rstrip('/')),
                        'final_archive_duplicate_or_unsafe_path')
                names.add(name)
                require(not entry.flag_bits & 1 and entry.compress_type in FINAL_POLICY['compressionMethods'],
                        'final_archive_encrypted_or_unsupported')
                kind = stat.S_IFMT(entry.external_attr >> 16)
                if entry.is_dir():
                    require(name in {scenario + '/' for scenario in FINAL_IDS} and kind in (0, stat.S_IFDIR)
                            and entry.file_size == 0 and entry.CRC == 0
                            and entry.compress_size == (0 if entry.compress_type == zipfile.ZIP_STORED else 2),
                            'final_archive_directory_invalid')
                    continue
                require(name in FINAL_FILES and kind in (0, stat.S_IFREG) and not entry.external_attr & 0x10,
                        'final_archive_layout_or_special_file')
                require(0 <= entry.file_size <= FINAL_POLICY['maxMemberBytes'], 'final_archive_member_expansion_limit')
                total += entry.file_size
                require(total <= FINAL_POLICY['maxExpandedBytes'], 'final_archive_total_expansion_limit')
            require({entry.filename for entry in entries if not entry.is_dir()} == FINAL_FILES, 'final_archive_missing_files')
            ranges = final_zip_ranges(raw, entries)
            actual_total = 0
            for entry in sorted(entries, key=lambda item: item.filename):
                first, last = ranges[entry.filename]
                value = final_expand(raw[first:last], entry, FINAL_POLICY['maxExpandedBytes'] - actual_total)
                actual_total += len(value)
                if entry.is_dir():
                    require(not value, 'final_archive_directory_invalid')
                    continue
                if needle is not None:
                    final_no_secret(entry.filename.encode('utf-8'), needle)
                    final_no_secret(value, needle)
                records.append({'path': entry.filename, 'bytes': len(value), 'sha256': final_digest(value)})
    except (zipfile.BadZipFile, zlib.error, RuntimeError, NotImplementedError, OverflowError):
        raise PacketError('final_archive_invalid') from None
    return records


def final_publish(directory, manifest, receipt):
    directory = final_path(directory)
    require(not directory.exists(), 'final_new_proof_directory_required')
    final_outside_git(directory.parent)
    directory.mkdir(mode=0o700)
    directory_identity = directory.stat()
    created, complete = [], False
    try:
        for name, value in (('manifest.json', manifest), ('receipt.json', receipt)):
            path = directory / name
            descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            info = os.fstat(descriptor)
            created.append((path, info.st_dev, info.st_ino))
            with os.fdopen(descriptor, 'wb') as file:
                file.write(value)
                file.flush()
                os.fsync(file.fileno())
        complete = True
    finally:
        if not complete:
            # Only this invocation's newly created exact files may be removed.
            for path, device, inode in reversed(created):
                try:
                    info = path.lstat()
                    if (info.st_dev, info.st_ino) == (device, inode):
                        path.unlink()
                except OSError:
                    pass
            try:
                info = directory.lstat()
                if (info.st_dev, info.st_ino) == (directory_identity.st_dev, directory_identity.st_ino):
                    directory.rmdir()
            except OSError:
                pass


def scan_final_archive(archive_path, context_path, needle_path, output):
    output = final_path(output)
    require(not output.exists(), 'final_new_proof_directory_required')
    final_outside_git(output.parent)
    needle_path = final_path(needle_path)
    final_outside_git(needle_path.parent)
    needle = final_read(needle_path, 8192, private=True)
    if needle.endswith(b'\n'):
        needle = needle[:-1]
    require(16 <= len(needle) <= 8192 and all(33 <= byte <= 126 for byte in needle), 'final_private_needle_invalid')
    context = final_context(strict_json(final_read(context_path, 65536).decode('utf-8')))
    final_no_secret(final_encoded(context), needle)
    raw = final_read(archive_path, FINAL_POLICY['maxArchiveBytes'])
    records = final_members(raw, needle)
    context_sha, policy_sha = final_digest(final_encoded(context)), final_digest(final_encoded(FINAL_POLICY))
    manifest = final_encoded({'schema': 'gridex-t5-final-archive-manifest-v1', 'scope': FINAL_SCOPE,
                              'archiveSha256': final_digest(raw), 'archiveBytes': len(raw), 'contextSha256': context_sha,
                              'context': context, 'policySha256': policy_sha, 'files': records})
    receipt = final_encoded({'schema': 'gridex-t5-final-archive-scan-v1', 'scope': FINAL_SCOPE, 'artifactScan': 'CLEAN',
                             'archiveSha256': final_digest(raw), 'manifestSha256': final_digest(manifest),
                             'contextSha256': context_sha, 'scannerSourceSha256': sha(pathlib.Path(__file__)),
                             'policySha256': policy_sha, 'scannedAtUtc': dt.datetime.now(dt.timezone.utc).isoformat(),
                             'fileCount': len(records), 'uncompressedBytes': sum(file['bytes'] for file in records),
                             'matchCount': 0, 'campaignApproval': False, 'nativeApproval': False, 'browserApproval': False})
    final_publish(output, manifest, receipt)
    print(json.dumps({'scope': FINAL_SCOPE, 'artifactScan': 'CLEAN', 'archiveSha256': final_digest(raw),
                      'manifestSha256': final_digest(manifest), 'receiptSha256': final_digest(receipt), 'campaignApproval': False}))


def verify_final_archive(archive_path, manifest_path, receipt_path, handoff_path):
    keys = {'archiveSha256', 'manifestSha256', 'receiptSha256', 'contextSha256', 'scannerSourceSha256', 'policySha256'}
    handoff = strict_json(final_read(handoff_path, 65536).decode('utf-8'))
    require(isinstance(handoff, dict) and set(handoff) == keys | {'schema'}
            and handoff['schema'] == 'gridex-t5-final-archive-handoff-v1'
            and all(digest(handoff[key]) for key in keys), 'final_independent_handoff_required')
    require(handoff['scannerSourceSha256'] == sha(pathlib.Path(__file__))
            and handoff['policySha256'] == final_digest(final_encoded(FINAL_POLICY)), 'final_handoff_source_or_policy_mismatch')
    raw = final_read(archive_path, FINAL_POLICY['maxArchiveBytes'])
    manifest_raw, receipt_raw = final_read(manifest_path, 262144), final_read(receipt_path, 65536)
    require(final_digest(raw) == handoff['archiveSha256'] and final_digest(manifest_raw) == handoff['manifestSha256']
            and final_digest(receipt_raw) == handoff['receiptSha256'], 'final_delivery_hash_mismatch')
    manifest, receipt = strict_json(manifest_raw.decode('utf-8')), strict_json(receipt_raw.decode('utf-8'))
    manifest_keys = {'schema', 'scope', 'archiveSha256', 'archiveBytes', 'contextSha256', 'context', 'policySha256', 'files'}
    require(isinstance(manifest, dict) and set(manifest) == manifest_keys
            and manifest['schema'] == 'gridex-t5-final-archive-manifest-v1' and manifest['scope'] == FINAL_SCOPE,
            'final_manifest_schema_invalid')
    context = final_context(manifest['context'])
    require(manifest['contextSha256'] == final_digest(final_encoded(context)) == handoff['contextSha256']
            and manifest['policySha256'] == handoff['policySha256'] and manifest['archiveSha256'] == handoff['archiveSha256']
            and type(manifest['archiveBytes']) is int and manifest['archiveBytes'] == len(raw), 'final_manifest_binding_mismatch')
    files = manifest['files']
    require(isinstance(files, list) and all(isinstance(file, dict) and set(file) == {'path', 'bytes', 'sha256'}
            and type(file['bytes']) is int and file['bytes'] >= 0 and digest(file['sha256']) for file in files)
            and files == final_members(raw), 'final_manifest_file_set_mismatch')
    receipt_keys = {'schema', 'scope', 'artifactScan', 'archiveSha256', 'manifestSha256', 'contextSha256', 'scannerSourceSha256',
                    'policySha256', 'scannedAtUtc', 'fileCount', 'uncompressedBytes', 'matchCount',
                    'campaignApproval', 'nativeApproval', 'browserApproval'}
    require(isinstance(receipt, dict) and set(receipt) == receipt_keys and receipt['schema'] == 'gridex-t5-final-archive-scan-v1'
            and receipt['scope'] == FINAL_SCOPE and receipt['artifactScan'] == 'CLEAN', 'final_receipt_schema_invalid')
    require(all(receipt[key] == handoff[key] for key in keys - {'receiptSha256'})
            and type(receipt['fileCount']) is int and receipt['fileCount'] == len(files)
            and type(receipt['uncompressedBytes']) is int and receipt['uncompressedBytes'] == sum(file['bytes'] for file in files)
            and type(receipt['matchCount']) is int and receipt['matchCount'] == 0
            and all(receipt[key] is False for key in ('campaignApproval', 'nativeApproval', 'browserApproval')), 'final_receipt_binding_mismatch')
    utc_time(receipt['scannedAtUtc'])
    print(json.dumps({'scope': FINAL_SCOPE, 'integrityVerified': True, 'archiveSha256': handoff['archiveSha256'],
                      'campaignApproval': False, 'nativeApproval': False, 'browserApproval': False}))


def main():
    try:
        if len(sys.argv) > 1 and sys.argv[1] == '--scan-final-archive':
            require(len(sys.argv) == 6, 'expected_archive_context_private_needle_new_proof')
            scan_final_archive(*sys.argv[2:])
            return 0
        if len(sys.argv) > 1 and sys.argv[1] == '--verify-final-archive':
            require(len(sys.argv) == 6, 'expected_archive_manifest_receipt_handoff')
            verify_final_archive(*sys.argv[2:])
            return 0
        require(len(sys.argv) == 4, 'expected_evidence_output_classification')
        directory, output, source = (pathlib.Path(p) for p in sys.argv[1:])
        assemble(directory, output, strict_json(source.read_text()))
        return 0
    except (OSError, ValueError, TypeError, KeyError, subprocess.SubprocessError) as error:
        # Do not echo evidence contents or arbitrary input values on failure.
        print('packet_refused: ' + (str(error) if isinstance(error, PacketError) else 'invalid_input_or_io'), file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
