"""Finite private proof/transport controls; never native or whole acceptance."""
import copy
import datetime as dt
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest import mock
import zipfile
import io

spec = importlib.util.spec_from_file_location('business_evidence', Path(__file__).with_name('business-evidence.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def uid(n):
    return '00000000-0000-4000-8000-' + str(n).zfill(12)


def fixture():
    h = 'a' * 64
    start = dt.datetime(2027, 1, 31, 23, tzinfo=dt.timezone.utc)
    instant = lambda value: value.isoformat(timespec='milliseconds').replace('+00:00', 'Z')
    values = [dict(id=uid(1000+i), periodStart=instant(start+dt.timedelta(hours=i)),
                   periodEnd=instant(start+dt.timedelta(hours=i+1)), quantityKwh='0',
                   sourceMessageId=uid(10), supplyPeriodId=uid(5), billingStatus='billable', billingGateStatus='eligible')
              for i in range(28*24)]
    lines = [dict(id=uid(20+i), lineType='fixed_fee', description=code, quantity='1', unit='sek_month',
                  unitPriceExVat=amount, amountExVatOre=ore, vatRate='25', vatOre=vat,
                  amountIncVatOre=str(int(ore)+int(vat)), sortOrder=i, componentCode=code)
             for i, (code, amount, ore, vat) in enumerate([('monthly_fee', '39', '3900', '975'), ('invoice_fee', '19', '1900', '475')])]
    invoice_lines = [dict(lineType=x['lineType'], description=x['description'], quantity=x['quantity'], unit=x['unit'],
                          unitPriceExVat=x['unitPriceExVat'], amountExVatOre=x['amountExVatOre'], vatOre=x['vatOre'],
                          amountIncVatOre=x['amountIncVatOre'], componentCode=x['componentCode']) for x in lines]
    totals = dict(totalExVatOre='5800', vatOre='1450', totalIncVatOre='7250')
    actor = dict(submittedByUserId=uid(100), reviewedByUserId=uid(101))
    effects = dict(
        regulatedSource=dict(artifactId=uid(3), groundId=uid(4), sourceSha256=h, scopeSha256=h,
                             archiveStatus='archived', reviewStatus='authorized', **actor),
        receivedOriginals=[dict(messageId=uid(9), inboundEmailMessageId=uid(109), messageCode='Z04', rawSha256=h),
                           dict(messageId=uid(10), inboundEmailMessageId=uid(110), messageCode='E66', rawSha256=h)],
        normalizedValues=values, normalizedValuesSha256=module.canonical_sha256(values),
        supply=dict(supplyPeriodId=uid(5), qualified=True, sourceMessageId=uid(9), payloadSha256=h,
                    marketStateVersion=1, marketStartAt=instant(start), marketEndAt=None, groundId=uid(4), groundSourceSha256=h),
        underlay=dict(id=uid(6), status='validated', readinessStatus='ready', sourceBasisSha256=h, exactTotalKwh='0',
                      finalizedAt=instant(start), supplyPeriodId=uid(5), supplyCurrent=True),
        pricing=dict(id=uid(7), status='locked', lockedAt=instant(start), **totals, lines=lines,
                     linesSha256=module.canonical_sha256(lines)),
        invoice=dict(id=uid(8), status='draft', invoiceExportItemId=uid(11), calculationSnapshotSha256=h,
                     **totals, lines=invoice_lines, linesSha256=module.canonical_sha256(invoice_lines)),
        export=dict(id=uid(11), provider='nordfin', environment='test', status='pending', runStatus='draft',
                    approvalStatus='pending_review', attemptCount=0, sentAt=None, exportFileId=None, providerInvoiceId=None, companyAttemptCount=0))
    return dict(schema='gridex-t2-term0203-business-evidence-v1', scenarioId='TERM02.03',
                state='APP_PATH_AND_STORED_EFFECTS_OBSERVED_NOT_WHOLE_ACCEPTANCE', wholeScenarioPass=False,
                legalAcceptance='NOT_PROVEN_SYNTHETIC_ISSUER', wholeAcceptance='HOLD', sourceCommit='1'*40, sourceTree='2'*40,
                githubRunId=1, githubRunAttempt=1, githubJobId=10, githubJob='term', assignmentSha256='3'*64,
                materialsSha256='4'*64, materialSpecificationSha256='5'*64, environmentId='finite-component',
                billingMonth='2027-02', recipientCertificateSha256='6'*64, companyId=uid(1), customerId=uid(2),
                contractId=uid(12), meteringPointId=uid(13),
                networkSource=dict(artifactId=uid(14), registryVersionId=uid(15), sourceSha256=h, claimsSha256=h,
                                   archiveStatus='archived', reviewStatus='authorized', **actor), effects=effects)


class SchemaControls(unittest.TestCase):
    def test_complete_actual_shape_and_all_expected_bindings(self):
        proof = fixture()
        module.validate_evidence(proof, module.expected_bindings(proof))

    def test_each_binding_mismatch_is_rejected(self):
        proof = fixture()
        for key in module.BINDING_KEYS:
            with self.subTest(key=key):
                expected = module.expected_bindings(proof)
                expected[key] = expected[key] + 1 if type(expected[key]) is int else expected[key] + 'x'
                with self.assertRaises(ValueError):
                    module.validate_evidence(proof, expected)

    def test_unknown_duplicate_and_nonstandard_json_rejected(self):
        for raw in (b'{"schema":1,"schema":2}', b'{"value":NaN}', b'\xef\xbb\xbf{}'):
            with self.assertRaises(ValueError):
                module.strict_json(raw)
        proof = fixture()
        proof['effects']['pricing']['unexpected'] = 'secret'
        with self.assertRaises(ValueError):
            module.validate_evidence(proof, module.expected_bindings(proof))

    def test_zero_interval_and_hash_and_correlation_fail_closed(self):
        for change in ('tiny', 'hash', 'supply', 'reviewer', 'coverage', 'acceptance'):
            with self.subTest(change=change):
                proof = fixture()
                if change == 'tiny':
                    proof['effects']['normalizedValues'][0]['quantityKwh'] = '1e-1000'
                    proof['effects']['normalizedValuesSha256'] = module.canonical_sha256(proof['effects']['normalizedValues'])
                elif change == 'hash': proof['effects']['normalizedValuesSha256'] = '0'*64
                elif change == 'supply': proof['effects']['underlay']['supplyPeriodId'] = uid(999)
                elif change == 'reviewer': proof['networkSource']['reviewedByUserId'] = proof['networkSource']['submittedByUserId']
                elif change == 'coverage':
                    proof['effects']['normalizedValues'].pop()
                    proof['effects']['normalizedValuesSha256'] = module.canonical_sha256(proof['effects']['normalizedValues'])
                else: proof['wholeScenarioPass'] = True
                with self.assertRaises(ValueError):
                    module.validate_evidence(proof, module.expected_bindings(proof))


class CryptoAndFiles(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.home = Path(cls.temp.name)
        cls.key, cls.cert = cls.home/'key.pem', cls.home/'cert.pem'
        subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
                        '-subj', '/CN=finite-component-only', '-keyout', str(cls.key), '-out', str(cls.cert)],
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        cls.key.chmod(0o600)
        cls.cert.chmod(0o600)

    @classmethod
    def tearDownClass(cls): cls.temp.cleanup()

    def test_actual_cms_roundtrip_tamper_and_exclusive_private_output(self):
        raw = module.canonical_bytes(fixture())
        cipher = module.encrypt(raw, self.cert)
        self.assertEqual(module.decrypt(cipher, self.key), raw)
        broken = bytearray(cipher); broken[-1] ^= 1
        with self.assertRaises(ValueError): module.decrypt(bytes(broken), self.key)
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)/'proof.private.json'
            module.write_private(path, raw)
            self.assertEqual(module.read_private(path), raw)
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            with self.assertRaises((ValueError, FileExistsError)): module.write_private(path, raw)
            path.chmod(0o644)
            with self.assertRaises(ValueError): module.read_private(path)

    def test_symlink_oversize_and_zip_paths_denied(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp)/'target'; module.write_private(target, b'{}')
            link = Path(tmp)/'link'; link.symlink_to(target)
            with self.assertRaises(ValueError): module.read_private(link)
            with self.assertRaises(ValueError): module.strict_json(b' '*(module.MAX_PLAINTEXT+1))
        for name in ('../proof.cms', '/proof.cms', 'private.json'):
            archive = io.BytesIO()
            with zipfile.ZipFile(archive, 'w') as zipped: zipped.writestr(name, b'{}')
            with self.assertRaises(ValueError): module.unpack_artifact(archive.getvalue())

    def test_actual_owned_0755_assignment_parent_without_weakening_private_outputs(self):
        with tempfile.TemporaryDirectory() as tmp:
            parent = Path(tmp)
            assignment = parent/'t2-admission.json'
            module.write_private(assignment, b'{"sourceCommit":"finite-input"}')
            parent.chmod(0o755)  # Actual workflow location: RUNNER_TEMP/t2-admission.json.
            self.assertEqual(module.read_private(assignment), b'{"sourceCommit":"finite-input"}')
            # Private business/output creation still requires exactly0700.
            with self.assertRaises(ValueError): module.write_private(parent/'output.private.json', b'{}')
            with self.assertRaises(ValueError): module.private_parent(assignment)
            for mode in (0o775, 0o777):
                parent.chmod(mode)
                with self.subTest(mode=mode), self.assertRaises(ValueError): module.read_private(assignment)
            parent.chmod(0o755); assignment.chmod(0o644)
            with self.assertRaises(ValueError): module.read_private(assignment)
            parent.chmod(0o700)

    def artifact_fixture(self):
        proof = fixture()
        proof['recipientCertificateSha256'] = module.sha(self.cert.read_bytes())
        expected = module.expected_bindings(proof)
        raw = module.canonical_bytes(proof)
        cipher = module.encrypt(raw, self.cert)
        manifest = dict(schema='gridex-t2-business-evidence-manifest-v1', state='SEALED_OBSERVATIONS_NOT_WHOLE_ACCEPTANCE',
                        wholeScenarioPass=False, plaintextSha256=module.sha(raw), ciphertextSha256=module.sha(cipher), bindings=expected)
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, 'w') as zipped:
            zipped.writestr(module.EXPORT_DIRECTORY+'/'+module.CIPHER_NAME, cipher)
            zipped.writestr(module.EXPORT_DIRECTORY+'/'+module.MANIFEST_NAME, module.canonical_bytes(manifest))
            zipped.writestr('t2-safe-receipt.json', module.canonical_bytes(dict(
                schema='gridex-t2-safe-runtime-summary-v1', runId=1, runAttempt=1, sourceCommit=proof['sourceCommit'],
                qualification='QUALIFIED', qualificationScope='RUNTIME_INFRASTRUCTURE_SOURCE_BUILD_REPLAY_ENDPOINTS_ONLY',
                wholeScenarioPass=False, cleanup='COMPLETE', actorQualification='AUTH_TENANT_OBSERVED_LICENSE_NOT_GATED',
                scenario='pilot-term0203', scenarioExitCode=0, assertions=dict(passed=1, failed=0, skipped=0, total=1),
                wholeScenarioAcceptance='HOLD_INDEPENDENT_EFFECT_REVIEW_REQUIRED')))
        zipped = archive.getvalue()
        metadata = {
            'actions/runs/1': dict(id=1, head_sha=proof['sourceCommit'], run_attempt=1, event='workflow_dispatch', path=module.WORKFLOW),
            'git/commits/'+proof['sourceCommit']: dict(sha=proof['sourceCommit'], tree=dict(sha=proof['sourceTree'])),
            'actions/runs/1/attempts/1/jobs?per_page=100&page=1': dict(total_count=1, jobs=[dict(name='term', id=10,
                       run_id=1, run_attempt=1, head_sha=proof['sourceCommit'], status='completed')]),
            'actions/artifacts/99': dict(id=99, expired=False, name='t2-safe-receipt-1', size_in_bytes=len(zipped),
                                        workflow_run=dict(id=1, head_sha=proof['sourceCommit']), digest='sha256:'+module.sha(zipped)),
        }
        return raw, expected, zipped, metadata

    def test_real_cipher_zip_consumption_with_authenticated_metadata_seam(self):
        raw, expected, archive, metadata = self.artifact_fixture()
        actual = module.command
        def command(argv, *args, **kwargs):
            if argv[:2] == ['gh', 'api']:
                self.assertEqual(argv[2], 'repos/'+module.REPOSITORY+'/actions/artifacts/99/zip')
                return archive
            return actual(argv, *args, **kwargs)
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(module, 'api', side_effect=lambda path: metadata[path]), \
                mock.patch.object(module, 'command', side_effect=command):
            output = Path(tmp)/'recovered.private.json'
            module.read_artifact(99, expected, self.key, output)
            self.assertEqual(module.read_private(output), raw)
            sidecar = json.loads(module.read_private(Path(str(output)+'.runtime-receipt.private.json')))
            self.assertEqual(sidecar['cleanup'], 'COMPLETE')
            self.assertFalse(json.loads(raw)['wholeScenarioPass'])

    def test_wrong_run_tree_job_artifact_and_digest_never_recover_plaintext(self):
        raw, expected, archive, baseline = self.artifact_fixture()
        actual = module.command
        for change in ('run', 'tree', 'job', 'artifact', 'digest'):
            with self.subTest(change=change), tempfile.TemporaryDirectory() as tmp:
                metadata = copy.deepcopy(baseline)
                if change == 'run': metadata['actions/runs/1']['head_sha'] = 'f'*40
                elif change == 'tree': metadata['git/commits/'+expected['sourceCommit']]['tree']['sha'] = 'f'*40
                elif change == 'job': metadata['actions/runs/1/attempts/1/jobs?per_page=100&page=1']['jobs'][0]['id'] = 999
                elif change == 'artifact': metadata['actions/artifacts/99']['workflow_run']['id'] = 999
                else: metadata['actions/artifacts/99']['digest'] = 'sha256:'+'f'*64
                def command(argv, *args, **kwargs):
                    if argv[:2] == ['gh', 'api']: return archive
                    return actual(argv, *args, **kwargs)
                output = Path(tmp)/'recovered.private.json'
                with mock.patch.object(module, 'api', side_effect=lambda path: metadata[path]), \
                        mock.patch.object(module, 'command', side_effect=command), self.assertRaises(ValueError):
                    module.read_artifact(99, expected, self.key, output)
                self.assertFalse(output.exists())

    def test_missing_scenario_is_explicit_hold_and_existing_attempt_not_overwritten(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp); directory.chmod(0o755)  # Real RUNNER_TEMP can be traversable.
            with mock.patch.dict(os.environ, RUNNER_TEMP=tmp, SIM_HOME=tmp+'/runtime'):
                module.seal()
                manifest = json.loads((directory/module.EXPORT_DIRECTORY/module.MANIFEST_NAME).read_bytes())
                self.assertEqual(manifest['state'], 'HOLD_NO_BUSINESS_EVIDENCE')
                self.assertFalse(manifest['wholeScenarioPass'])
                self.assertFalse((directory/module.EXPORT_DIRECTORY/module.CIPHER_NAME).exists())
                with self.assertRaises(FileExistsError): module.seal()

    def test_actual_sealer_exports_only_ciphertext_and_allowlisted_manifest(self):
        proof = fixture()
        proof['recipientCertificateSha256'] = module.sha(self.cert.read_bytes())
        expected = module.expected_bindings(proof)
        raw = module.canonical_bytes(proof)
        with tempfile.TemporaryDirectory() as tmp:
            runner = Path(tmp); home = runner/'runtime'; home.mkdir(mode=0o700)
            source = home/'business-evidence'; source.mkdir(mode=0o700)
            module.write_private(source/module.PROOF_NAME, raw)
            with mock.patch.dict(os.environ, RUNNER_TEMP=tmp, SIM_HOME=str(home)), \
                    mock.patch.object(module, 'authenticated_context', return_value=(expected, home, self.cert.read_bytes())):
                module.seal()
            exported = runner/module.EXPORT_DIRECTORY
            self.assertEqual({x.name for x in exported.iterdir()}, {module.CIPHER_NAME, module.MANIFEST_NAME})
            cipher = module.read_private(exported/module.CIPHER_NAME, module.MAX_CIPHER)
            manifest = module.strict_json(module.read_private(exported/module.MANIFEST_NAME))
            self.assertEqual(manifest['bindings'], expected)
            self.assertEqual(manifest['plaintextSha256'], module.sha(raw))
            self.assertEqual(manifest['ciphertextSha256'], module.sha(cipher))
            self.assertTrue(b'"environmentId":"finite-component"' not in cipher, 'private plaintext present')
            self.assertEqual(module.decrypt(cipher, self.key), raw)
            self.assertFalse(manifest['wholeScenarioPass'])

    def test_wrong_recipient_and_unapproved_algorithms_are_rejected(self):
        raw = module.canonical_bytes(fixture())
        cipher = module.encrypt(raw, self.cert)
        with tempfile.TemporaryDirectory() as tmp:
            key = Path(tmp)/'other.pem'
            subprocess.run(['openssl', 'genpkey', '-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:2048', '-out', str(key)],
                           check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            key.chmod(0o600)
            with self.assertRaises(ValueError): module.decrypt(cipher, key)
        unapproved = subprocess.run(['openssl', 'cms', '-encrypt', '-binary', '-aes-128-cbc', '-outform', 'DER',
                                      '-recip', str(self.cert)], input=raw, capture_output=True, check=True).stdout
        with self.assertRaises(ValueError): module.decrypt(unapproved, self.key)


if __name__ == '__main__': unittest.main()
