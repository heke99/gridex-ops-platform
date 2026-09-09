#!/usr/bin/env python3
"""Database-free selection, order and provenance checks for the RBAC prefix."""
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
RUNNER = ROOT / 'scripts/canonical-rbac-prefix-selftest.py'
AUTH_SELECTION = ROOT / 'scripts/canonical-auth-email-selftest.py'
INVITATION_SELECTION = ROOT / 'scripts/canonical-auth-invitation-chain-selftest.py'
ORDER = ROOT / 'scripts/gridex-aud-003-foundation-order.json'
ADDITIONS = ROOT / 'scripts/gridex-aud-003-legacy-foundation.additions.json'
CORE = ROOT / 'supabase/migrations/01_db1_schema_repair_core_helpers_and_canonical_tables.sql'
FINAL = ROOT / 'supabase/migrations/20260908120000_preserve_gridex_user_has_role_key.sql'
SOURCES = (
    'migrations/20260520_batch_6e_rbac_tenant_stats_whitelabel.sql',
    'migrations/20260520_batch_6e_fix_rbac_backfill_security.sql',
    'migrations/20260520_batch_6e_hard_platform_roles_only.sql',
)
BOUNDARY = 'bootstrap/20260527_company_memberships_role_key_foundation.sql'
DERIVED = 'bootstrap/20260520_companies_support_email_foundation.sql'
PROFILE_PREREQUISITE = 'bootstrap/20260519_user_profiles_active_company_foundation.sql'
PROFILE_SOURCE = 'migrations/20260519_saas_ui_tenant_admin.sql'
AUTH_SOURCE = 'migrations/20260519_auth_callback_email_reset_sync.sql'
AUTH_NORMALIZE = 'migrations/20260520_user_profiles_auth_action_constraint_hardfix.sql'
AUTH_TEMPLATE = 'migrations/20260519_auth_email_templates_invite_reset_sync.sql'
PROFILE_FOUNDATION = 'bootstrap/20260519_user_profiles_foundation.sql'


def function(text, name='gridex_user_has_role_key'):
    start = text.index(f'create or replace function public.{name}(')
    return text[start:text.index('\n$$;', start) + 4]


def main():
    order = json.loads(ORDER.read_text())['foundation']
    additions = json.loads(ADDITIONS.read_text())
    boundary = order.index(BOUNDARY)
    assert order[boundary + 1:boundary + 4] == list(SOURCES), order[boundary:boundary + 5]
    assert all(order.count(source) == 1 for source in SOURCES)
    assert all(additions['foundation'].count(source) == 1 for source in SOURCES)
    assert order.index(AUTH_SOURCE) == order.index(PROFILE_FOUNDATION) + 1
    assert order.index(AUTH_NORMALIZE) == order.index(AUTH_SOURCE) + 1
    assert order.index(AUTH_TEMPLATE) == order.index(AUTH_NORMALIZE) + 1
    assert order.index(PROFILE_PREREQUISITE) == order.index(AUTH_TEMPLATE) + 1
    assert order[boundary - 1] == PROFILE_SOURCE
    assert order[boundary - 2] == 'migrations/20260909120100_canonical_invitation_status_index_reconstruction.sql'
    assert order[boundary - 3] == 'migrations/20260909120000_canonical_role_permission_uniqueness_reconstruction.sql'
    assert order[boundary - 4] == 'bootstrap/20260523_rbac_permission_helpers_foundation.sql'
    assert order.count(PROFILE_SOURCE) == additions['foundation'].count(PROFILE_SOURCE) == 1
    profile_meta = additions['derivedBootstrap'][PROFILE_PREREQUISITE]
    assert profile_meta['source'] == PROFILE_SOURCE
    assert profile_meta['artifactSha256'] == 'ac6341a482ef9b9a912522a8874f6bcbd8df73ea6e4a4896d4d1d6d589830e23'
    assert profile_meta['artifactSha256'] == hashlib.sha256((ROOT / 'supabase' / PROFILE_PREREQUISITE).read_bytes()).hexdigest()
    assert profile_meta.get('preserveSourceReplay') is True
    derived = additions['derivedBootstrap'][DERIVED]
    assert derived['source'] == SOURCES[0]
    assert derived.get('preserveSourceReplay') is True

    assert FINAL.is_file(), FINAL
    final_text = FINAL.read_text()
    assert function(final_text) == function(CORE.read_text())
    assert 'alter function public.gridex_user_has_role_key(text) security invoker;' in final_text
    assert ('alter function public.gridex_user_has_role_key(text)\n'
            '  set search_path = public, auth, extensions;') in final_text
    assert ('revoke all on function public.gridex_user_has_role_key(text) from public, anon;'
            in final_text)
    assert ('grant execute on function public.gridex_user_has_role_key(text) to authenticated, service_role;'
            in final_text)
    manifest = json.loads((ROOT / 'scripts/migration-history-manifest.json').read_text())
    assert manifest['files'][FINAL.name] == hashlib.sha256(FINAL.read_bytes()).hexdigest()

    emitted = subprocess.run(
        ['python3', str(RUNNER), '--emit'], cwd=ROOT, text=True,
        capture_output=True, check=False)
    assert emitted.returncode == 0, emitted.stderr
    expected_prefix = order[:boundary + 1]
    observed = [line.removeprefix('-- RBAC_PREFIX_FILE_BEGIN ') for line in
                emitted.stdout.splitlines() if line.startswith('-- RBAC_PREFIX_FILE_BEGIN ')]
    assert observed == expected_prefix, observed
    assert emitted.stdout.count('-- RBAC_MANAGED_BOOTSTRAP_BEGIN') == 1
    for source in SOURCES:
        assert emitted.stdout.count(f'-- RBAC_SOURCE_FILE_BEGIN {source}') == 2, source
    assert emitted.stdout.count(f'-- RBAC_FINAL_HELPER_BEGIN migrations/{FINAL.name}') == 1
    assert emitted.stdout.rindex('-- RBAC_FINAL_HELPER_BEGIN') > emitted.stdout.rindex(
        f'-- RBAC_SOURCE_FILE_BEGIN {SOURCES[-1]}')
    assert '-- RBAC_POLICY_TARGETS_PRESENT=25' in emitted.stdout
    assert '-- RBAC_POLICY_TARGETS_ABSENT=4: power_of_attorneys,meter_readings,files,attachments' in emitted.stdout
    assert "attgenerated='s'" in emitted.stdout
    assert 'least(email_confirmed_at, phone_confirmed_at)' in emitted.stdout.lower()
    assert 'create temporary table rbac_prefix_baseline as' in emitted.stdout
    assert "status='onboarding',country_code=''" in emitted.stdout
    assert "set status=''" not in emitted.stdout
    assert 'alter table companies drop constraint companies_operating_environment_check;' not in emitted.stdout
    assert 'b.company_count + 2' in emitted.stdout
    assert 'b.membership_count + 7' in emitted.stdout

    auth_selection = subprocess.run(
        ['python3', str(AUTH_SELECTION), '--selection-only'], cwd=ROOT,
        text=True, capture_output=True, check=False)
    assert auth_selection.returncode == 0, auth_selection.stderr
    assert auth_selection.stdout.strip() == (
        'PASS: complete auth source selected before profile normalization')

    invitation_selection = subprocess.run(
        ['python3', str(INVITATION_SELECTION), '--selection-only'], cwd=ROOT,
        text=True, capture_output=True, check=False)
    assert invitation_selection.returncode == 0, invitation_selection.stderr
    assert invitation_selection.stdout.strip() == (
        'PASS: template selected after auth prerequisites; later policy hardening remains selected')

    accounting = subprocess.run(
        ['python3', 'scripts/gridex-replay-input-accounting.py'], cwd=ROOT,
        text=True, capture_output=True, check=False)
    account = json.loads(accounting.stdout)
    assert account['status'] != 'INVALID_INPUT_CONTRACT' and not account['errors'], account
    by_path = {item['path']: item for item in account['migrations']}
    for source in SOURCES:
        assert by_path[source]['classification'] == 'FULL_FILE_SELECTED', by_path[source]
    assert by_path[f'migrations/{FINAL.name}']['classification'] == 'FULL_FILE_SELECTED'
    assert by_path[PROFILE_SOURCE]['classification'] == 'FULL_FILE_SELECTED'
    timestamped = sorted(path.name for path in (ROOT / 'supabase/migrations').iterdir()
                         if path.name[:14].isdigit() and path.suffix == '.sql')
    assert FINAL.name in timestamped
    assert 'gridex_user_has_role_key' not in (ROOT / 'supabase/migrations/20260909120000_canonical_role_permission_uniqueness_reconstruction.sql').read_text()

    repair = 'migrations/20260909120000_canonical_role_permission_uniqueness_reconstruction.sql'
    index_repair = 'migrations/20260909120100_canonical_invitation_status_index_reconstruction.sql'
    assert order.count(index_repair) == additions['foundation'].count(index_repair) == 1
    assert by_path[index_repair]['classification'] == 'FULL_FILE_SELECTED'
    assert manifest['files'][Path(index_repair).name] == hashlib.sha256((ROOT / 'supabase' / index_repair).read_bytes()).hexdigest()
    assert order.count(repair) == additions['foundation'].count(repair) == 1
    assert by_path[repair]['classification'] == 'FULL_FILE_SELECTED'
    assert manifest['files'][Path(repair).name] == hashlib.sha256((ROOT / 'supabase' / repair).read_bytes()).hexdigest()
    contact = additions['derivedBootstrap']['bootstrap/20260519_companies_primary_contact_email_foundation.sql']
    assert contact['source'] == 'migrations/20260519_final_saas_hardening.sql'
    assert contact['artifactSha256'] == '9a3be1644f22fb0ea8c3f08cf96d942a8fa645f4b3ae7038e78acaf0346c2c23'
    saas = subprocess.run(['python3', 'scripts/canonical-saas-tenant-selftest.py', '--emit'], cwd=ROOT, text=True, capture_output=True, check=False)
    assert saas.returncode == 0, saas.stderr
    observed_saas = [line.removeprefix('-- SAAS_PREFIX_FILE_BEGIN ') for line in saas.stdout.splitlines() if line.startswith('-- SAAS_PREFIX_FILE_BEGIN ')]
    assert observed_saas == order[:order.index(PROFILE_SOURCE)]
    assert saas.stdout.index('-- SAAS_PREFIX_FILE_BEGIN ' + repair) < saas.stdout.index('-- SAAS_SOURCE_BEGIN')
    canonical = saas.stdout.split('-- REDUCED BRANCH ONLY:', 1)[0]
    assert canonical.count((ROOT / 'supabase' / PROFILE_SOURCE).read_text()) == 4
    assert 'canonical second SaaS exact grant multiset stable' in canonical
    assert 'real cleanup removes only forbidden legacy admin grant' in canonical
    assert canonical.index('-- SAAS_REAL_HARD_PLATFORM_CLEANUP') > canonical.rindex('-- SAAS_SOURCE_BEGIN')
    for case in ('is_system_present','is_system_absent','missing_guarded','roles_only','permissions_only','missing_role_permissions','legacy_missing_unique','legacy_index_collision'):
        assert '-- REDUCED BRANCH ONLY: ' + case + ';' in saas.stdout
    for case in ('missing','matching','dirty','conflicting','conflicting_index'):
        assert '-- REDUCED RECONSTRUCTION CASE: ' + case in saas.stdout

    for case in ('missing','matching','legacy','conflicting','replacement_failure'):
        assert '-- REDUCED INDEX RECONSTRUCTION CASE: ' + case in saas.stdout

    group = (ROOT / 'scripts/canonical-auth-membership-group.py').read_text()
    assert "('python3', 'scripts/canonical-rbac-prefix-selection-selftest.py')" in group
    assert "('python3', 'scripts/canonical-rbac-prefix-selftest.py')" in group
    print('PASS: canonical RBAC prefix selection, order, provenance and emit')


if __name__ == '__main__':
    main()
