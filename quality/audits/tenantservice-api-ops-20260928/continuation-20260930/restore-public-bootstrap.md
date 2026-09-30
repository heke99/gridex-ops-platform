# Restore public-namespace bootstrap

Actual published506/tree607 upgrade job110129164101 reached `TENANTSERVICE_RESTORE_LOCAL_ADMIN_AUTHORITY_PASS`, then failed the genuine PostgreSQL archive stream with `schema "public" does not exist`. Artifact11130415570 ZIP SHA256bf3b150bd4b22bfea2956369e4efeb532371a1ef19153f7d47b6e4472369d867 contains the sanitized failure. This is a native restore failure, not a stub acceptance result.

The next candidate retains template0's original initdb public namespace. It verifies that namespace exists and that there are zero non-system relations before restoring. The matching PostgreSQL17 archive relies on that namespace for original owner/ACL/application records. The bounded vendor-admin guard, archive ownership/ACL records, single-transaction restore and existing archive filtering remain intact.

The actual extracted Bash bootstrap was executed with controlled psql/archive processes: old source1 failure/2 passes; corrected source3/3 passes. Existing seven local-admin tests and two restore-wrapper tests also pass, total12/12. Bash syntax and scoped lint pass. These controlled-process results do not establish successful native backup/restore. Next exact-candidate upgrade CI must execute the genuine archive, then original data/Auth/catalog/owner/ACL comparisons and rollback/incident qualifications before T49/T55 can be accepted.
