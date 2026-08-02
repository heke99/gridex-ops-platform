# Quarantine report

Execution status: **NOT EXECUTED**

| Population | Count | Required decision |
|---|---:|---|
| `ediel_test_runs.company_id IS NULL` | 153 | determine tenant from authoritative relation or quarantine without assignment |
| duplicate active Ediel profile groups | 1 | select canonical profile explicitly; retire others with audit |
| prepared/live production state without snapshot | 1 | block production, capture current configuration through an authorized command, rerun readiness |

Quarantine must preserve original payload, source table/id, reason code, timestamps and reviewer. Deletion or “first tenant” fallback is forbidden.
