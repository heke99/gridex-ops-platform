#!/usr/bin/env python3
"""Private TERM02.03 observations. Ciphertext is never producer authentication.

Only the authenticated GitHub artifact plus independently expected bindings
qualify retrieval. All outputs retain HOLD; this is not whole acceptance.
"""
import argparse
import datetime as dt
from decimal import Decimal, InvalidOperation
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import tempfile
import zipfile
from zoneinfo import ZoneInfo

REPOSITORY = 'heke99/gridex-ops-platform'
WORKFLOW = '.github/workflows/t2-term-disposable.yml'
SCHEMA = 'gridex-t2-term0203-business-evidence-v1'
MAX_PLAINTEXT = 1048576
MAX_CIPHER = MAX_PLAINTEXT + 8192
MAX_ARCHIVE = 2 * MAX_CIPHER
PROOF_NAME = 'term0203-v1.private.json'
CIPHER_NAME = 't2-business-evidence.cms'
MANIFEST_NAME = 't2-business-evidence-manifest.json'
EXPORT_DIRECTORY = 't2-business-evidence-export'
BINDING_KEYS = ('sourceCommit', 'sourceTree', 'githubRunId', 'githubRunAttempt', 'githubJobId',
                'githubJob', 'assignmentSha256', 'materialsSha256', 'materialSpecificationSha256',
                'environmentId', 'billingMonth', 'recipientCertificateSha256')


def require(ok, code):
    if not ok:
        raise ValueError(code)


def sha(raw): return hashlib.sha256(raw).hexdigest()


def canonical_bytes(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode('utf-8')


def canonical_sha256(value): return sha(canonical_bytes(value))


def strict_json(raw):
    require(isinstance(raw, bytes) and 0 < len(raw) <= MAX_PLAINTEXT, 'json-size')
    def pairs(items):
        out = {}
        for key, value in items:
            require(key not in out, 'duplicate-json-key')
            out[key] = value
        return out
    def constant(_): raise ValueError('nonstandard-json')
    try:
        return json.loads(raw.decode('utf-8', errors='strict'), object_pairs_hook=pairs, parse_constant=constant)
    except (UnicodeError, json.JSONDecodeError, RecursionError):
        raise ValueError('invalid-json') from None


def private_parent(path):
    p = Path(path)
    require(p.is_absolute() and p.resolve() == p and not p.is_symlink(), 'private-path')
    parent = p.parent.stat()
    require(stat.S_ISDIR(parent.st_mode) and parent.st_uid == os.getuid()
            and stat.S_IMODE(parent.st_mode) == 0o700, 'private-parent')
    return p


def read_private(path, limit=MAX_PLAINTEXT):
    p = private_parent(path)
    fd = os.open(p, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        info = os.fstat(fd)
        require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid()
                and stat.S_IMODE(info.st_mode) == 0o600 and 0 < info.st_size <= limit, 'private-file')
        with os.fdopen(fd, 'rb', closefd=False) as stream: raw = stream.read(limit+1)
        require(0 < len(raw) <= limit, 'private-file-size')
        return raw
    finally: os.close(fd)


def write_private(path, raw):
    p = private_parent(path)
    require(isinstance(raw, bytes) and 0 < len(raw) <= MAX_CIPHER, 'private-output-size')
    fd = os.open(p, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as stream: stream.write(raw)


def command(argv, raw=None, maximum=MAX_ARCHIVE):
    result = subprocess.run(argv, input=raw, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    require(result.returncode == 0 and len(result.stdout) <= maximum, 'external-command-refused')
    return result.stdout


def api(path):
    return strict_json(command(['gh', 'api', 'repos/'+REPOSITORY+'/'+path], maximum=MAX_PLAINTEXT))


def instant(value):
    require(isinstance(value, str) and re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z', value), 'instant-shape')
    try: return dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError: raise ValueError('invalid-instant') from None


def literal(value): return ('literal', value)
def nullable(kind): return ('nullable', kind)
def array(kind, minimum, maximum): return ('array', kind, minimum, maximum)


ACTORS = dict(submittedByUserId='uuid', reviewedByUserId='uuid')
TOTALS = dict(totalExVatOre='ore', vatOre='ore', totalIncVatOre='ore')
SCHEMAS = {
    'NetworkSource': dict(artifactId='uuid', registryVersionId='uuid', sourceSha256='sha256', claimsSha256='sha256',
                          archiveStatus=literal('archived'), reviewStatus=literal('authorized'), **ACTORS),
    'RegulatedSource': dict(artifactId='uuid', groundId='uuid', sourceSha256='sha256', scopeSha256='sha256',
                            archiveStatus=literal('archived'), reviewStatus=literal('authorized'), **ACTORS),
    'Original': dict(messageId='uuid', inboundEmailMessageId='uuid', messageCode=('enum', ('Z04', 'E66')), rawSha256='sha256'),
    'Normalized': dict(id='uuid', periodStart='instant', periodEnd='instant', quantityKwh='decimal', sourceMessageId='uuid',
                       supplyPeriodId='uuid', billingStatus=literal('billable'), billingGateStatus=literal('eligible')),
    'Supply': dict(supplyPeriodId='uuid', qualified=literal(True), sourceMessageId='uuid', payloadSha256='sha256',
                   marketStateVersion='positive', marketStartAt='instant', marketEndAt=nullable('instant'),
                   groundId='uuid', groundSourceSha256='sha256'),
    'Underlay': dict(id='uuid', status=literal('validated'), readinessStatus=literal('ready'), sourceBasisSha256='sha256',
                     exactTotalKwh='decimal', finalizedAt='instant', supplyPeriodId='uuid', supplyCurrent=literal(True)),
    'StoredPricingLine': dict(id='uuid', lineType='text128', description='text1000empty', quantity=nullable('decimal'),
                              unit=nullable('text128empty'), unitPriceExVat=nullable('decimal'), amountExVatOre='ore',
                              vatRate='decimal', vatOre='ore', amountIncVatOre='ore', sortOrder='integer', componentCode=nullable('text128')),
    'StoredInvoiceLine': dict(lineType='text128', description='text1000empty', quantity=nullable('decimal'),
                              unit=nullable('text128empty'), unitPriceExVat=nullable('decimal'), amountExVatOre='ore',
                              vatOre='ore', amountIncVatOre='ore', componentCode=nullable('text128')),
    'Pricing': dict(id='uuid', status=literal('locked'), lockedAt='instant', **TOTALS,
                    lines=array('StoredPricingLine', 1, 32), linesSha256='sha256'),
    'Invoice': dict(id='uuid', status=literal('draft'), invoiceExportItemId='uuid', calculationSnapshotSha256='sha256',
                    **TOTALS, lines=array('StoredInvoiceLine', 1, 32), linesSha256='sha256'),
    'Export': dict(id='uuid', provider=literal('nordfin'), environment=literal('test'), status=literal('pending'),
                   runStatus=literal('draft'), approvalStatus=literal('pending_review'), attemptCount=literal(0),
                   sentAt=literal(None), exportFileId=literal(None), providerInvoiceId=literal(None), companyAttemptCount=literal(0)),
    'Effects': dict(regulatedSource='RegulatedSource', receivedOriginals=array('Original', 2, 128),
                    normalizedValues=array('Normalized', 1, 1000), normalizedValuesSha256='sha256', supply='Supply',
                    underlay='Underlay', pricing='Pricing', invoice='Invoice', export='Export'),
    'Root': dict(schema=literal(SCHEMA), scenarioId=literal('TERM02.03'),
                 state=literal('APP_PATH_AND_STORED_EFFECTS_OBSERVED_NOT_WHOLE_ACCEPTANCE'), wholeScenarioPass=literal(False),
                 legalAcceptance=literal('NOT_PROVEN_SYNTHETIC_ISSUER'), wholeAcceptance=literal('HOLD'),
                 sourceCommit='sha1', sourceTree='sha1', githubRunId='positive', githubRunAttempt=literal(1),
                 githubJobId='positive', githubJob=literal('term'), assignmentSha256='sha256', materialsSha256='sha256',
                 materialSpecificationSha256='sha256', environmentId='text256', billingMonth='month',
                 recipientCertificateSha256='sha256', companyId='uuid', customerId='uuid', contractId='uuid',
                 meteringPointId='uuid', networkSource='NetworkSource', effects='Effects'),
}


def validate(value, kind):
    if isinstance(kind, tuple):
        tag = kind[0]
        if tag == 'literal': require(type(value) is type(kind[1]) and value == kind[1], 'literal-value')
        elif tag == 'nullable':
            if value is not None: validate(value, kind[1])
        elif tag == 'array':
            require(isinstance(value, list) and kind[2] <= len(value) <= kind[3], 'array-size')
            for item in value: validate(item, kind[1])
        elif tag == 'enum': require(value in kind[1] and isinstance(value, str), 'enum-value')
        else: raise ValueError('unsupported-schema')
    elif kind in SCHEMAS:
        fields = SCHEMAS[kind]
        require(isinstance(value, dict) and set(value) == set(fields), 'exact-object-fields')
        # These objects form canonical cross-language hashed arrays.
        if kind in ('Normalized', 'StoredPricingLine', 'StoredInvoiceLine'):
            require(list(value) == list(fields), 'canonical-object-key-order')
        for key, spec in fields.items(): validate(value[key], spec)
    elif kind in ('positive', 'integer'):
        require(type(value) is int and abs(value) <= 9007199254740991 and (kind != 'positive' or value > 0), 'safe-integer')
    elif kind == 'instant': instant(value)
    else:
        require(isinstance(value, str), 'string-required')
        if kind == 'uuid': require(re.fullmatch(r'[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}', value), 'uuid')
        elif kind in ('sha1', 'sha256'): require(re.fullmatch('[0-9a-f]{'+('40' if kind == 'sha1' else '64')+'}', value), 'digest')
        elif kind == 'ore': require(re.fullmatch(r'(?:0|-?[1-9]\d{0,79})', value), 'integer-ore')
        elif kind == 'decimal':
            require(len(value) <= 128 and re.fullmatch(r'-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?', value), 'decimal-text')
            try: require(Decimal(value).is_finite(), 'nonfinite-decimal')
            except InvalidOperation: raise ValueError('invalid-decimal') from None
        elif kind == 'month':
            require(re.fullmatch(r'\d{4}-(?:0[1-9]|1[0-2])', value) and 1 <= int(value[:4]) <= 9998, 'billing-month')
        elif kind.startswith('text'):
            limit = int(re.search(r'\d+', kind)[0]); minimum = 0 if kind.endswith('empty') else 1
            require(minimum <= len(value) <= limit, 'text-size')
        else: raise ValueError('unsupported-primitive')


def expected_bindings(proof): return {key: proof[key] for key in BINDING_KEYS}


def validate_evidence(proof, expected):
    validate(proof, 'Root')
    require(set(expected) == set(BINDING_KEYS), 'expected-binding-fields')
    for key in BINDING_KEYS:
        require(type(proof[key]) is type(expected[key]) and proof[key] == expected[key], 'independent-binding-mismatch')
    e = proof['effects']; supply = e['supply']; underlay = e['underlay']
    for reviewed in (proof['networkSource'], e['regulatedSource']):
        require(reviewed['submittedByUserId'] != reviewed['reviewedByUserId'], 'independent-reviewer')
    originals = e['receivedOriginals']; values = e['normalizedValues']
    require(originals[0]['messageCode'] == 'Z04' and all(x['messageCode'] == 'E66' for x in originals[1:]), 'original-sequence')
    for key in ('messageId', 'inboundEmailMessageId'):
        require(len({x[key] for x in originals}) == len(originals), 'duplicate-original')
    require(len({x['id'] for x in values}) == len(values), 'duplicate-normalized-value')
    require(supply['sourceMessageId'] == originals[0]['messageId'] and supply['payloadSha256'] == originals[0]['rawSha256']
            and supply['groundId'] == e['regulatedSource']['groundId']
            and supply['groundSourceSha256'] == e['regulatedSource']['sourceSha256'], 'supply-source-correlation')
    require(underlay['supplyPeriodId'] == supply['supplyPeriodId'] and Decimal(underlay['exactTotalKwh']) == 0, 'underlay-correlation')
    year, month = map(int, proof['billingMonth'].split('-'))
    start = dt.datetime(year, month, 1, tzinfo=ZoneInfo('Europe/Stockholm')).astimezone(dt.timezone.utc)
    end = dt.datetime(year+(month == 12), month % 12+1, 1, tzinfo=ZoneInfo('Europe/Stockholm')).astimezone(dt.timezone.utc)
    require(instant(values[0]['periodStart']) == start and instant(values[-1]['periodEnd']) == end, 'full-month-coverage')
    e66 = {x['messageId'] for x in originals[1:]}
    previous = start
    for value in values:
        left, right = instant(value['periodStart']), instant(value['periodEnd'])
        require(left == previous and right-left == dt.timedelta(hours=1) and Decimal(value['quantityKwh']) == 0
                and value['sourceMessageId'] in e66 and value['supplyPeriodId'] == supply['supplyPeriodId'], 'zero-hour-correlation')
        previous = right
    require(canonical_sha256(values) == e['normalizedValuesSha256'], 'normalized-hash')
    for rows in (e['pricing'], e['invoice']):
        require(canonical_sha256(rows['lines']) == rows['linesSha256'], 'line-hash')
        for line in rows['lines']:
            require(int(line['amountExVatOre'])+int(line['vatOre']) == int(line['amountIncVatOre']), 'line-totals')
        for total, field in (('totalExVatOre', 'amountExVatOre'), ('vatOre', 'vatOre'), ('totalIncVatOre', 'amountIncVatOre')):
            require(sum(int(line[field]) for line in rows['lines']) == int(rows[total]), 'stored-totals')
    require(all(e['pricing'][key] == e['invoice'][key] for key in TOTALS), 'invoice-pricing-totals')
    require(e['invoice']['invoiceExportItemId'] == e['export']['id'], 'invoice-export-correlation')
    require(len(canonical_bytes(proof)) <= MAX_PLAINTEXT, 'evidence-size')
    return proof


def algorithms(cipher):
    structure = command(['openssl', 'asn1parse', '-inform', 'DER'], cipher, maximum=MAX_ARCHIVE*4).decode('ascii')
    objects = re.findall(r'^\s*\d+:d=\d+\s+hl=\d+\s+l=\s*\d+\s+prim:\s+OBJECT\s+:(\S+)\s*$', structure, re.M)
    require(objects.count('id-smime-ct-authEnvelopedData') == 1 and objects.count('rsaesOaep') == 1
            and objects.count('mgf1') == 1 and objects.count('sha256') == 2 and objects.count('aes-256-gcm') == 1
            and 'rsaEncryption' not in objects, 'cms-algorithms')


def encrypt(raw, certificate):
    require(0 < len(raw) <= MAX_PLAINTEXT, 'evidence-size')
    read_private(certificate, 16384)
    command(['openssl', 'x509', '-in', str(certificate), '-checkend', '600', '-noout'])
    command(['openssl', 'verify', '-CAfile', str(certificate), str(certificate)])
    cipher = command(['openssl', 'cms', '-encrypt', '-binary', '-aes-256-gcm', '-outform', 'DER',
                      '-recip', str(certificate), '-keyopt', 'rsa_padding_mode:oaep', '-keyopt', 'rsa_oaep_md:sha256',
                      '-keyopt', 'rsa_mgf1_md:sha256'], raw, MAX_CIPHER)
    algorithms(cipher)
    return cipher


def decrypt(cipher, key):
    require(0 < len(cipher) <= MAX_CIPHER, 'cipher-size')
    read_private(key, 16384)
    algorithms(cipher)
    return command(['openssl', 'cms', '-decrypt', '-binary', '-inform', 'DER', '-inkey', str(key)], cipher, MAX_PLAINTEXT)


def qualifier():
    spec = importlib.util.spec_from_file_location('t2_business_qualifier', Path(__file__).with_name('qualify-runtime.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def github_job(expected, running):
    run_id, attempt = expected['githubRunId'], expected['githubRunAttempt']
    validate(run_id, 'positive'); validate(attempt, literal(1))
    validate(expected['sourceCommit'], 'sha1'); validate(expected['sourceTree'], 'sha1')
    run = api('actions/runs/'+str(run_id))
    require(run['id'] == run_id and run['head_sha'] == expected['sourceCommit'] and run['run_attempt'] == attempt
            and run['event'] == 'workflow_dispatch' and run['path'] == WORKFLOW, 'github-run-binding')
    commit = api('git/commits/'+expected['sourceCommit'])
    require(commit['sha'] == expected['sourceCommit'] and commit['tree']['sha'] == expected['sourceTree'], 'actual-source-tree')
    page, jobs = 1, []
    while True:
        require(page <= 10, 'github-job-pages')
        result = api(f'actions/runs/{run_id}/attempts/{attempt}/jobs?per_page=100&page={page}')
        jobs.extend(result['jobs'])
        if len(jobs) >= result['total_count']: break
        require(result['jobs'], 'incomplete-job-list'); page += 1
    selected = [x for x in jobs if x['name'] == 'term' and x['run_id'] == run_id and x['run_attempt'] == attempt
                and x['head_sha'] == expected['sourceCommit']]
    require(len(selected) == 1 and selected[0]['status'] == ('in_progress' if running else 'completed'), 'actual-term-job')
    if 'githubJobId' in expected: require(selected[0]['id'] == expected['githubJobId'], 'actual-term-job-id')
    validate(selected[0]['id'], 'positive')
    return selected[0]['id']


def authenticated_context(operation):
    # Authenticate the established exact signature/custody/run contract; no new
    # resource allocation or substitute local admission is performed here.
    module = qualifier()
    a, home, app = module.authenticate(operation)
    raw = read_private(os.environ['SIM_RUNTIME_ASSIGNMENT_FILE'], 65536)
    require(strict_json(raw) == a, 'assignment-json-binding')
    profile_path = Path(__file__).with_name('profile.requirements.json')
    profile_raw = profile_path.read_bytes()
    require(a['sourceFiles']['scripts/simulation/track2/hosted/profile.requirements.json'] == sha(profile_raw), 'recipient-source-profile')
    profile = strict_json(profile_raw)
    certificate = profile['bootstrapRecipientCertificate'].encode('utf-8')
    certificate_sha = sha(certificate)
    require(certificate_sha == profile['bootstrapRecipientCertificateSHA256']
            == a['pilotTerm0203']['businessEvidenceRecipientCertificateSHA256'], 'signed-evidence-recipient')
    material_raw = read_private(os.environ['SIM_TERM0203_MATERIALS_FILE'], 131072)
    packet = strict_json(material_raw)
    require(packet['assignmentSha256'] == sha(raw) and packet['sourceCommit'] == a['sourceCommit']
            and packet['environmentId'] == a['environmentId'], 'material-context-binding')
    require(module.typed_material_specification(packet['specification'])
            == a['pilotTerm0203']['materialSpecificationSha256'], 'material-specification-hash')
    require(os.environ.get('GITHUB_JOB') == 'term', 'actual-job-context')
    expected = dict(sourceCommit=a['sourceCommit'], sourceTree=a['sourceTree'], githubRunId=a['github']['runId'],
                    githubRunAttempt=a['github']['runAttempt'], githubJob='term', assignmentSha256=sha(raw),
                    materialsSha256=sha(material_raw), materialSpecificationSha256=a['pilotTerm0203']['materialSpecificationSha256'],
                    environmentId=a['environmentId'], billingMonth=packet['specification']['billingMonth'],
                    recipientCertificateSha256=certificate_sha)
    expected['githubJobId'] = github_job(expected, running=True)
    return expected, Path(home), certificate


def seal():
    # The workflow always reaches cleanup even if this step fails. Absence does
    # not turn an earlier refused/failed business scenario into success.
    runner = Path(os.environ['RUNNER_TEMP'])
    require(runner.is_absolute() and runner.resolve() == runner and runner.is_dir()
            and runner.stat().st_uid == os.getuid(), 'actual-runner-output-directory')
    temporary = runner/EXPORT_DIRECTORY
    temporary.mkdir(mode=0o700)  # Exclusive; a previous attempt is never replaced.
    private_parent(temporary/'check')
    proof_path = Path(os.environ['SIM_HOME'])/'business-evidence'/PROOF_NAME
    require(proof_path.resolve() == proof_path and not proof_path.is_symlink(), 'private-proof-path')
    if not proof_path.exists():
        write_private(temporary/MANIFEST_NAME, canonical_bytes(dict(schema='gridex-t2-business-evidence-manifest-v1',
                      state='HOLD_NO_BUSINESS_EVIDENCE', wholeScenarioPass=False)))
        return
    expected, _home, certificate = authenticated_context('down')
    raw = read_private(proof_path)
    validate_evidence(strict_json(raw), expected)
    with tempfile.TemporaryDirectory(dir=temporary) as name:
        cert = Path(name)/'recipient.pem'; write_private(cert, certificate)
        cipher = encrypt(raw, cert)
    write_private(temporary/CIPHER_NAME, cipher)
    manifest = dict(schema='gridex-t2-business-evidence-manifest-v1', state='SEALED_OBSERVATIONS_NOT_WHOLE_ACCEPTANCE',
                    wholeScenarioPass=False, plaintextSha256=sha(raw), ciphertextSha256=sha(cipher), bindings=expected)
    write_private(temporary/MANIFEST_NAME, canonical_bytes(manifest))


def unpack_artifact(raw):
    require(0 < len(raw) <= MAX_ARCHIVE, 'artifact-size')
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        infos = archive.infolist()
        require(len(infos) == 3 and {x.filename for x in infos}
                == {EXPORT_DIRECTORY+'/'+CIPHER_NAME, EXPORT_DIRECTORY+'/'+MANIFEST_NAME, 't2-safe-receipt.json'}, 'artifact-paths')
        require(sum(x.file_size for x in infos) <= MAX_ARCHIVE, 'artifact-expanded-size')
        for item in infos:
            require(not item.is_dir() and not stat.S_ISLNK(item.external_attr >> 16) and not item.flag_bits & 1
                    and 0 < item.file_size <= MAX_CIPHER, 'artifact-entry')
        return {Path(item.filename).name: archive.read(item) for item in infos}


def read_artifact(artifact_id, expected, key, output):
    require(type(artifact_id) is int and artifact_id > 0 and set(expected) == set(BINDING_KEYS), 'reader-input')
    # Establish actual repository/run/job before downloading or trusting CMS.
    github_job(expected, running=False)
    artifact = api('actions/artifacts/'+str(artifact_id))
    require(artifact['id'] == artifact_id and artifact['expired'] is False
            and artifact['name'] == 't2-safe-receipt-'+str(expected['githubRunId'])
            and artifact['workflow_run']['id'] == expected['githubRunId']
            and artifact['workflow_run']['head_sha'] == expected['sourceCommit']
            and type(artifact['size_in_bytes']) is int and 0 < artifact['size_in_bytes'] <= MAX_ARCHIVE, 'artifact-producer-binding')
    archive = command(['gh', 'api', 'repos/'+REPOSITORY+'/actions/artifacts/'+str(artifact_id)+'/zip'], maximum=MAX_ARCHIVE)
    # New GitHub artifacts provide a digest; bind it when present. Retrieval via
    # authenticated numeric artifact ID remains mandatory even without it.
    if artifact.get('digest') is not None: require(artifact['digest'] == 'sha256:'+sha(archive), 'artifact-service-digest')
    files = unpack_artifact(archive)
    safe = strict_json(files['t2-safe-receipt.json'])
    required_safe = {'schema', 'runId', 'runAttempt', 'sourceCommit', 'qualification', 'qualificationScope',
                     'wholeScenarioPass', 'cleanup', 'actorQualification', 'scenario', 'scenarioExitCode',
                     'assertions', 'wholeScenarioAcceptance'}
    optional_safe = {'installedLedgerSHA256', 'installedLedgerRows', 'buildManifestSHA256', 'replayLogSHA256',
                     'buildLogSHA256', 'resourceIdentitySHA256', 'actorReceiptCount', 'actorIntents', 'actorReceiptsSHA256', 'lifecycle'}
    require(isinstance(safe, dict) and required_safe <= set(safe) <= required_safe | optional_safe
            and safe['schema'] == 'gridex-t2-safe-runtime-summary-v1'
            and type(safe['runId']) is int and safe['runId'] == expected['githubRunId']
            and type(safe['runAttempt']) is int and safe['runAttempt'] == expected['githubRunAttempt']
            and safe['sourceCommit'] == expected['sourceCommit'] and safe['wholeScenarioPass'] is False
            and safe['wholeScenarioAcceptance'] == 'HOLD_INDEPENDENT_EFFECT_REVIEW_REQUIRED', 'runtime-receipt-binding')
    manifest = strict_json(files[MANIFEST_NAME])
    require(set(manifest) == {'schema', 'state', 'wholeScenarioPass', 'plaintextSha256', 'ciphertextSha256', 'bindings'}
            and manifest['schema'] == 'gridex-t2-business-evidence-manifest-v1'
            and manifest['state'] == 'SEALED_OBSERVATIONS_NOT_WHOLE_ACCEPTANCE'
            and manifest['wholeScenarioPass'] is False and manifest['bindings'] == expected, 'manifest-binding')
    require(manifest['ciphertextSha256'] == sha(files[CIPHER_NAME]), 'ciphertext-hash')
    raw = decrypt(files[CIPHER_NAME], key)
    require(manifest['plaintextSha256'] == sha(raw), 'plaintext-hash')
    validate_evidence(strict_json(raw), expected)
    # Preserve the later cleanup/terminal receipt alongside the earlier sealed
    # observations. Recovery also supports failure analysis; neither becomes PASS.
    sidecar = Path(str(output)+'.runtime-receipt.private.json')
    private_parent(output); private_parent(sidecar)
    require(not Path(output).exists() and not sidecar.exists(), 'reader-output-already-exists')
    write_private(output, raw)
    write_private(sidecar, files['t2-safe-receipt.json'])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    operation = parser.add_mutually_exclusive_group(required=True)
    operation.add_argument('--job-context', action='store_true')
    operation.add_argument('--seal', action='store_true')
    operation.add_argument('--read-artifact', type=int)
    parser.add_argument('--expected'); parser.add_argument('--key'); parser.add_argument('--output')
    args = parser.parse_args()
    try:
        if args.job_context:
            expected, _home, _certificate = authenticated_context('run')
            print(json.dumps(dict(jobId=expected['githubJobId'], job='term')))
        elif args.seal: seal()
        else:
            require(args.expected and args.key and args.output, 'reader-input')
            expected = strict_json(read_private(args.expected, 65536))
            read_artifact(args.read_artifact, expected, Path(args.key), Path(args.output))
            print('Private observed evidence recovered; independent effect review required; whole acceptance HOLD')
        return 0
    except (ValueError, OSError, KeyError, TypeError, zipfile.BadZipFile):
        print('HOLD: business evidence unavailable or unqualified; no whole acceptance', file=__import__('sys').stderr)
        return 78


if __name__ == '__main__': raise SystemExit(main())
