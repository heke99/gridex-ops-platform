#!/usr/bin/env python3
"""Run rollback-only journal catalog controls after the complete whole-source proof.

Requires that proof's existing owned POST6D2 template on its fixed loopback
PostgreSQL 17 fixture. Does not create a substitute prefix or run on hosted data.
"""
import importlib.util
from pathlib import Path
import re
import sys

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    'journal_acl_whole_source', ROOT / 'scripts/canonical-full-governance-source-selftest.py')
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
import canonical_full_governance_sql as oracle


JOURNAL_CATALOG_MUTATIONS = (
    ("missing MAINTAIN", "revoke maintain on platform_session_revocations from anon;"),
    ("extra PUBLIC grant", "grant select on platform_session_revocations to public;"),
    ("extra grant option", "grant select on platform_session_revocations to authenticated with grant option;"),
    ("superseded owner-only ACL", "revoke all on platform_session_revocations from anon,authenticated,service_role;"),
    ("wrong owner", "alter table platform_session_revocations owner to authenticated;"),
    ("extra relation option", "alter table platform_session_revocations set (fillfactor=90);"),
    ("extra table comment", "comment on table platform_session_revocations is 'synthetic journal ACL control';"),
    ("extra column comment", "comment on column platform_session_revocations.reason is 'synthetic journal ACL control';"),
)


def journal_catalog_check_sql() -> str:
    # Reuse the complete published assertion without reconstructing its oracle.
    # check() emits this fixed delimiter; require exactly one whole named check.
    delimiter = 'select test_assert('
    ending = ", '6D2 journal exact owner/ACL/options/no source comments');"
    statements = [statement for statement in oracle.completion_shape_sql().split(delimiter)
                  if statement.rstrip().endswith(ending)]
    assert len(statements) == 1, 'EXACT_PUBLISHED_JOURNAL_CHECK_REQUIRED'
    return delimiter + statements[0]


def journal_catalog_negative_controls() -> None:
    # All mutations are rollback-only on an owned disposable post-6D2 clone.
    # The exact positive check runs before and after each primary-error rejection.
    fixture.reset_database(template=fixture.POST6D2_TEMPLATE)
    check_sql = journal_catalog_check_sql()
    fixture.psql_sql(check_sql)
    for name, mutation in JOURNAL_CATALOG_MUTATIONS:
        result = fixture.psql_sql("begin;\n" + mutation + "\n" + check_sql, expected="P0001")
        assert re.search(
            r"^psql:<stdin>:[0-9]+: ERROR:\s+P0001: FAIL: 6D2 journal exact owner/ACL/options/no source comments(?:\r?\n|$)",
            result.stderr,
            re.MULTILINE,
        ), (name, result.stderr)
        fixture.psql_sql(check_sql)
        print(f"PASS JOURNAL CATALOG negative control {name}; exact rejection and rollback verified")


if __name__ == '__main__':
    journal_catalog_negative_controls()
