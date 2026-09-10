#!/usr/bin/env python3
"""Run the fixed auth/membership PostgreSQL 17 fixture group."""
import argparse
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
COMMANDS = (
    ('python3', 'scripts/canonical-auth-email-selftest.py'),
    ('python3', 'scripts/canonical-poa-request-selftest.py', '--selection-only'),
    ('python3', 'scripts/canonical-poa-request-selftest.py'),
    ('python3', 'scripts/canonical-auth-invitation-chain-selftest.py', '--selection-only'),
    ('python3', 'scripts/canonical-auth-invitation-chain-selftest.py'),
    ('python3', 'scripts/canonical-membership-actor-fk-selftest.py'),
    ('python3', 'scripts/canonical-rbac-tenant-selftest.py'),
    ('python3', 'scripts/canonical-rbac-prefix-selection-selftest.py'),
    ('python3', 'scripts/canonical-rbac-prefix-selftest.py'),
    ('python3', 'scripts/canonical-saas-tenant-selftest.py'),
    ('python3', 'scripts/canonical-governance-selftest.py'),
    ('python3', 'scripts/canonical-operations-sync-selftest.py'),
    ('python3', 'scripts/invitation_token_prerequisite_selftest.py'),
    ('python3', 'scripts/canonical-import-admission-selftest.py'),
    ('python3', 'scripts/canonical-full-governance-source-selftest.py'),
)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    environment = {key: value for key, value in os.environ.items() if not key.startswith('PG')}
    for command in COMMANDS:
        print(' '.join(command), flush=True)
        if not args.dry_run:
            result = subprocess.run(command, cwd=ROOT, env=environment, check=False)
            if result.returncode:
                raise SystemExit(result.returncode)

if __name__ == '__main__':
    main()
