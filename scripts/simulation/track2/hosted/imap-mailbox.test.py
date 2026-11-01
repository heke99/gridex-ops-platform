#!/usr/bin/env python3
"""Confined tests: mocked Docker/ports, real OpenSSL; no server or native DB."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import ssl
import stat
import tempfile
import types
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('mailbox', Path(__file__).with_name('imap-mailbox.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
CID = 'a' * 64
IID = 'sha256:' + 'b' * 64


class MailboxTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.home = Path(self.tmp.name)
        self.home.chmod(0o700)
        self.cfg = {'image': m.IMAGE, 'containerName': 'sim-t2-unit-pilot-mailbox',
                    'ports': {'smtps': 55110, 'imaps': 55111}, 'mailboxAddress': 'pilot@t2.sim.invalid'}
        self.a = {'projectId': 'sim-t2-unit', 'sourceCommit': 'c' * 40, 'environmentId': 'unit-private',
                  'pilotMailbox': self.cfg, 'ports': {'original': 55101},
                  'sourceFiles': {'scripts/simulation/track2/hosted/imap-mailbox.py': m.sha(Path(m.__file__))}}
        self.helper = types.SimpleNamespace(
            authenticate=lambda operation: (self.a, self.home, self.home / 'app'),
            validate_attempt=lambda *args: None,
            owned_cgroup=lambda *args: Path('/sys/fs/cgroup/owned'),
            read_text=lambda path: '0::/owned', digest=lambda path: 'd' * 64,
            load_private=lambda path: {'assignment': 'd' * 64},
            daemon_identity=lambda **kwargs: None, docker_resources=lambda project: [],
            inventory=lambda *args: [])
        self.commands = []
        self.data = self.container()
        self.original_run = m.run
        self.addCleanup(patch.stopall)
        patch.dict(os.environ, {'SIM_RUNTIME_ASSIGNMENT_FILE': '/private/assignment.json'}, clear=False).start()

    def container(self):
        return {'Id': CID, 'Name': '/' + self.cfg['containerName'], 'Created': '2026-11-01T01:00:00Z', 'Image': IID,
                'Config': {'Image': m.IMAGE, 'Labels': {m.LABEL: 'sim-t2-unit'}},
                'HostConfig': {'NetworkMode': 'bridge', 'PortBindings': {
                    '3465/tcp': [{'HostIp': '127.0.0.1', 'HostPort': '55110'}],
                    '3993/tcp': [{'HostIp': '127.0.0.1', 'HostPort': '55111'}]}},
                'Mounts': [{'Type': 'bind', 'Source': str(self.home / 'pilot-mailbox/server.p12'),
                            'Destination': '/t2/server.p12', 'RW': False}], 'State': {'Running': True},
                'NetworkSettings': {'Ports': {'3465/tcp': [{'HostIp': '127.0.0.1', 'HostPort': '55110'}],
                                              '3993/tcp': [{'HostIp': '127.0.0.1', 'HostPort': '55111'}]}}}

    def fake_run(self, argv, **kwargs):
        if argv[0] != 'docker':
            return self.original_run(argv, **kwargs)
        self.commands.append(argv)
        if argv[1:3] == ['image', 'inspect']:
            return json.dumps([{'Id': IID, 'RepoDigests': [m.IMAGE], 'Os': 'linux', 'Architecture': 'amd64'}])
        if argv[1] == 'create':
            Path(argv[argv.index('--cidfile') + 1]).write_text(CID)
            return CID
        if argv[1] == 'inspect':
            return json.dumps([self.data])
        return ''

    def confined(self):
        patch.object(m, 'run', side_effect=self.fake_run).start()
        patch.object(m.socket, 'socket').start()
        patch.object(m, 'tls_auth').start()
        patch.dict(os.environ, {'NODE_EXTRA_CA_CERTS': ''}).start()

    def test_admission_failure_never_reaches_resource_or_crypto(self):
        self.helper.read_text = lambda path: '0::/foreign'
        with patch.object(m, 'run') as command, patch.object(m.socket, 'socket') as socket:
            with self.assertRaisesRegex(ValueError, 'outside-owned-cgroup'):
                m.start(self.helper)
            command.assert_not_called()
            socket.assert_not_called()
        self.assertFalse((self.home / 'pilot-mailbox').exists())

    def test_assignment_rejects_image_ports_address_and_source_tampering(self):
        for field, value in [('image', 'greenmail/standalone:latest'), ('mailboxAddress', 'real@example.com'),
                             ('ports', {'smtps': 55101, 'imaps': 55111}), ('ports', {'smtps': 55111, 'imaps': 55111})]:
            with self.subTest(field=field, value=value):
                old = self.cfg[field]
                self.cfg[field] = value
                with self.assertRaises(ValueError):
                    m.admission(self.helper)
                self.cfg[field] = old
        self.a['sourceFiles'] = {}
        with self.assertRaisesRegex(ValueError, 'source-unbound'):
            m.admission(self.helper)

    def test_capacity_failure_before_pull_certificates_or_port_bind(self):
        def reject(**kwargs):
            self.assertTrue(kwargs['capacity'])
            raise ValueError('capacity-hold')
        self.helper.daemon_identity = reject
        with patch.object(m, 'certificates') as certificates, patch.object(m, 'run') as command, patch.object(m.socket, 'socket') as socket:
            with self.assertRaisesRegex(ValueError, 'capacity-hold'):
                m.start(self.helper)
            certificates.assert_not_called()
            command.assert_not_called()
            socket.assert_not_called()

    def test_root_cannot_start_a_root_mail_container(self):
        with patch.object(m.os, 'getuid', return_value=0), patch.object(m, 'run') as command:
            with self.assertRaisesRegex(ValueError, 'nonroot-owner-required'):
                m.start(self.helper)
            command.assert_not_called()

    def test_actual_openssl_san_ca_pkcs12_and_private_modes(self):
        directory = self.home / 'certs'
        directory.mkdir(mode=0o700)
        m.certificates(directory, 'private-unit-password')
        for host, flag in [('localhost', '-verify_hostname'), ('127.0.0.1', '-verify_ip')]:
            self.original_run(['openssl', 'verify', '-CAfile', str(directory / 'ca.pem'), flag, host, str(directory / 'server.pem')])
        self.original_run(['openssl', 'pkcs12', '-in', str(directory / 'server.p12'), '-passin',
                           'file:' + str(directory / 'keystore.password'), '-noout'])
        with self.assertRaises(ValueError):
            self.original_run(['openssl', 'verify', '-CAfile', str(directory / 'ca.pem'), '-verify_hostname', 'foreign.invalid', str(directory / 'server.pem')])
        for path in directory.iterdir():
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
        prior = self.home / 'prior-ca.pem'
        prior.write_bytes((directory / 'ca.pem').read_bytes())
        merged = m.merge_ca(directory, str(prior))
        self.assertTrue(merged.read_bytes().startswith(prior.read_bytes()))
        self.assertEqual(merged.read_text().count('BEGIN CERTIFICATE'), 2)
        context = ssl.create_default_context(cafile=str(merged))
        self.assertTrue(context.check_hostname)
        self.assertEqual(context.verify_mode, ssl.CERT_REQUIRED)

    def test_both_protocols_receive_verified_tls_context(self):
        directory = self.home / 'certs'
        directory.mkdir(mode=0o700)
        m.certificates(directory, 'unit-password')
        with patch.object(m.smtplib, 'SMTP_SSL') as smtp, patch.object(m.imaplib, 'IMAP4_SSL') as imap:
            imap.return_value.__enter__.return_value.login.return_value = ('OK', [])
            m.tls_auth(self.cfg, 'unit-synthetic-secret', directory / 'ca.pem')
            for factory, key in ((smtp, 'context'), (imap, 'ssl_context')):
                context = factory.call_args.kwargs[key]
                self.assertTrue(context.check_hostname)
                self.assertEqual(context.verify_mode, ssl.CERT_REQUIRED)
                self.assertGreaterEqual(context.minimum_version, ssl.TLSVersion.TLSv1_2)

    def test_success_descriptor_exact_resource_private_credentials_no_secret_argv(self):
        self.confined()
        descriptor_path = m.start(self.helper)
        descriptor = m.load(descriptor_path)
        directory = descriptor_path.parent
        receipt = m.load(directory / 'resource.json')
        self.assertEqual(descriptor['state'], 'SERVICE_READY')
        self.assertEqual(descriptor['resourceReceiptSha256'], m.sha(directory / 'resource.json'))
        self.assertEqual(receipt['id'], CID)
        self.assertEqual(receipt['imageId'], IID)
        self.assertEqual(receipt['assignmentSha256'], 'd' * 64)
        self.assertEqual(descriptor['smtp']['password'], descriptor['imap']['password'])
        self.assertTrue(descriptor['smtp']['secure'] and descriptor['imap']['secure'])
        argv_text = json.dumps(self.commands)
        self.assertNotIn(descriptor['smtp']['password'], argv_text)
        self.assertNotIn((directory / 'keystore.password').read_text().strip(), argv_text)
        env = (directory / 'container.env').read_text()
        self.assertIn('-Dgreenmail.tls.keystore.file=/t2/server.p12', env)
        self.assertNotIn('auth.disabled', env)
        self.assertNotIn('setup.test.all', env)
        self.assertTrue((directory / 'intent.json').exists())
        for path in directory.iterdir():
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
        with self.assertRaises(FileExistsError):
            m.start(self.helper)  # ambiguous/reused startup never retried

    def test_foreign_inspect_binding_or_mount_never_ready_or_started(self):
        self.confined()
        self.data['HostConfig']['PortBindings']['3465/tcp'][0]['HostIp'] = '0.0.0.0'
        with self.assertRaisesRegex(ValueError, 'bindings-invalid'):
            m.start(self.helper)
        self.assertFalse((self.home / 'pilot-mailbox/descriptor.json').exists())
        self.assertTrue((self.home / 'pilot-mailbox/container.id').exists())
        self.assertFalse(any(c[1] in ('start', 'rm', 'stop') for c in self.commands))

    def test_foreign_image_and_birth_identity_rejected(self):
        mount = self.home / 'pilot-mailbox/server.p12'
        mount.parent.mkdir(mode=0o700)
        mount.write_text('unit')
        self.assertEqual(m.validate_container(self.data, self.cfg, self.a['projectId'], IID, mount)['id'], CID)
        for mutate in [lambda d: d.update(Image='sha256:' + 'f' * 64),
                       lambda d: d.update(Created=''),
                       lambda d: d['Config']['Labels'].update({m.LABEL: 'foreign'}),
                       lambda d: d['Mounts'][0].update(RW=True),
                       lambda d: d['NetworkSettings']['Ports']['3993/tcp'][0].update(HostIp='0.0.0.0')]:
            data = copy.deepcopy(self.data)
            mutate(data)
            with self.assertRaises(ValueError):
                m.validate_container(data, self.cfg, self.a['projectId'], IID, mount)

    def test_partial_start_preserves_receipt_and_does_not_claim_ready(self):
        self.confined()
        before = self.fake_run
        def fail_start(argv, **kwargs):
            if argv[:2] == ['docker', 'start']:
                raise ValueError('mailbox-command-failed')
            return before(argv, **kwargs)
        m.run.side_effect = fail_start
        with self.assertRaisesRegex(ValueError, 'mailbox-command-failed'):
            m.start(self.helper)
        directory = self.home / 'pilot-mailbox'
        self.assertEqual(m.load(directory / 'resource.json')['id'], CID)
        self.assertFalse((directory / 'descriptor.json').exists())

    def test_lost_create_response_keeps_intent_and_id_without_retry(self):
        self.confined()
        before = self.fake_run
        def lost_response(argv, **kwargs):
            result = before(argv, **kwargs)
            if argv[:2] == ['docker', 'create']:
                raise ValueError('mailbox-command-failed')
            return result
        m.run.side_effect = lost_response
        with self.assertRaisesRegex(ValueError, 'mailbox-command-failed'):
            m.start(self.helper)
        directory = self.home / 'pilot-mailbox'
        self.assertTrue((directory / 'intent.json').exists())
        self.assertEqual((directory / 'container.id').read_text(), CID)
        self.assertFalse((directory / 'descriptor.json').exists())
        self.assertEqual(sum(c[1] == 'create' for c in self.commands), 1)
        with self.assertRaises(FileExistsError):
            m.start(self.helper)
        self.assertEqual(sum(c[1] == 'create' for c in self.commands), 1)

    def test_admission_expiry_during_readiness_cannot_produce_descriptor(self):
        self.confined()
        calls = 0
        def authenticate(operation):
            nonlocal calls
            calls += 1
            if calls == 2:
                raise ValueError('assignment-expired')
            return self.a, self.home, self.home / 'app'
        self.helper.authenticate = authenticate
        with self.assertRaisesRegex(ValueError, 'assignment-expired'):
            m.start(self.helper)
        self.assertTrue((self.home / 'pilot-mailbox/resource.json').exists())
        self.assertFalse((self.home / 'pilot-mailbox/descriptor.json').exists())

    def test_birth_tampering_after_start_cannot_produce_descriptor(self):
        self.confined()
        before = self.fake_run
        def mutate_start(argv, **kwargs):
            result = before(argv, **kwargs)
            if argv[:2] == ['docker', 'start']:
                self.data['Created'] = '2026-11-01T02:00:00Z'
            return result
        m.run.side_effect = mutate_start
        with self.assertRaisesRegex(ValueError, 'mailbox-not-running'):
            m.start(self.helper)
        self.assertFalse((self.home / 'pilot-mailbox/descriptor.json').exists())

    def test_ca_symlink_and_public_credentials_rejected(self):
        target = self.home / 'target.pem'
        target.write_text('unit')
        target.chmod(0o644)
        linked = self.home / 'linked.pem'
        linked.symlink_to(target)
        with self.assertRaisesRegex(ValueError, 'prior-node-ca-invalid'):
            m.merge_ca(self.home, str(linked))
        with self.assertRaisesRegex(ValueError, 'private-file-required'):
            m.private_file(target)

    def test_cli_errors_are_fixed_and_never_print_secret_exception(self):
        with (patch.object(m, 'start', side_effect=ValueError('PRIVATE-SECRET-MUST-NOT-PRINT')),
              patch('sys.argv', ['imap-mailbox.py', 'start']), patch('builtins.print') as output):
            self.assertEqual(m.main(), 1)
            self.assertNotIn('PRIVATE-SECRET', str(output.call_args))


if __name__ == '__main__':
    unittest.main()
