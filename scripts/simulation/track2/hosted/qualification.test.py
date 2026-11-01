#!/usr/bin/env python3
"""Offline contracts. No sockets, Docker, network, fixtures, replay or build."""
import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import unittest

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("qualify", HERE / "qualify-runtime.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class Contracts(unittest.TestCase):
    def setUp(self):
        self.observation = {"driver": "overlay2", "effectiveRAMBytes": 8 * module.GIB,
                            "dockerRootFreeBytes": 15 * module.GIB, "dockerRootDir": "/owned/docker",
                            "rootNamespaceVerified": True, "daemonId": "synthetic-test-daemon",
                            "socketIdentity": {"device": 1, "inode": 2}, "cpuQuota": "400000 100000"}

    def test_exact_capacity_boundaries(self):
        for driver, minimum in module.DRIVERS.items():
            with self.subTest(driver=driver):
                self.observation.update(driver=driver, dockerRootFreeBytes=minimum)
                self.assertEqual(module.capacity_errors(self.observation), [])
                self.observation['dockerRootFreeBytes'] -= 1
                self.assertIn('insufficient-or-unknown-docker-root-free', module.capacity_errors(self.observation))

    def test_unknown_driver_is_hold(self):
        self.observation['driver'] = 'overlay'
        self.assertIn('unknown-driver', module.capacity_errors(self.observation))

    def test_ram_is_effective_and_strict(self):
        for value in [True, None, '8589934592', 8 * module.GIB - 1, float('inf')]:
            with self.subTest(value=value):
                self.observation['effectiveRAMBytes'] = value
                self.assertIn('insufficient-or-unknown-ram', module.capacity_errors(self.observation))

    def test_free_space_is_strict(self):
        for value in [True, None, '20000000000', -1, float('nan')]:
            self.observation['dockerRootFreeBytes'] = value
            self.assertIn('insufficient-or-unknown-docker-root-free', module.capacity_errors(self.observation))

    def test_host_filesystem_is_not_docker_namespace(self):
        self.observation['rootNamespaceVerified'] = False
        self.assertIn('docker-root-namespace-unverified', module.capacity_errors(self.observation))

    def test_required_identity_and_cpu(self):
        for key in ['socketIdentity', 'daemonId', 'cpuQuota']:
            observation = copy.deepcopy(self.observation)
            observation.pop(key)
            self.assertTrue(module.capacity_errors(observation))

    def test_capacity_does_not_admit(self):
        profile = json.loads((HERE / 'profile.requirements.json').read_text())
        self.assertEqual(module.capacity_errors(self.observation), [])
        self.assertIn('native-admission-not-implemented', module.admission_errors(profile))
        profile.update(state='ACTIVE', provisioned=True)
        self.assertIn('profile-must-not-claim-active-or-provisioned', module.admission_errors(profile))

    def test_no_argument_admission_is_hold(self):
        result = subprocess.run(['python3', '-B', str(HERE / 'qualify-runtime.py')], capture_output=True, text=True)
        self.assertEqual(result.returncode, 78)
        self.assertEqual(json.loads(result.stdout)['state'], 'HOLD')

    def test_prepare_never_falls_through_to_start(self):
        result = subprocess.run(['bash', str(HERE / 'prepare.sh')], capture_output=True, text=True)
        self.assertEqual(result.returncode, 78)
        self.assertIn('not admitted', result.stderr)

    def test_cleanup_does_not_claim_resources_removed(self):
        result = subprocess.run(['bash', str(HERE / 'cleanup.sh')], capture_output=True, text=True)
        self.assertEqual(result.returncode, 78)
        self.assertIn('no resources were removed', result.stderr)


if __name__ == '__main__':
    unittest.main(verbosity=2)
