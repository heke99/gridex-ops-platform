"""Reproduce scanner scope checks using only an isolated disposable fixture."""
from pathlib import Path
import json
import subprocess
import tempfile

root = Path(__file__).resolve().parents[4]
engine = '/tmp/gridex-api-review-node22/node_modules/.bin/node'
cases = []
with tempfile.TemporaryDirectory(prefix='variant-scope-', dir=Path(__file__).parent) as folder:
    fixture = Path(folder)
    (fixture / 'scripts').mkdir()
    (fixture / 'scripts/check.cjs').write_bytes(
        (root / 'scripts/check-n-plus-one-query-budget.cjs').read_bytes()
    )
    for name in ['app/api/v1', 'lib/customer-portal', 'lib/pricing', 'lib/website',
                 'lib/staff-api', 'lib/partner-api']:
        (fixture / name).mkdir(parents=True)
    code = "export async function fixture(){ for (const id of ['synthetic']) { await db.from('synthetic').select('*'); } }\n"
    for name, expected in [('lib/staff-api', 0), ('lib/partner-api', 0), ('lib/website', 1)]:
        source = fixture / name / 'probe.ts'
        source.write_text(code)
        result = subprocess.run([engine, str(fixture / 'scripts/check.cjs')],
                                capture_output=True, text=True)
        assert result.returncode == expected, (name, result.stdout, result.stderr)
        cases.append({'location': name, 'actual_exit': result.returncode,
                      'gate_output': result.stdout + result.stderr})
        source.unlink()
print(json.dumps({'passed': len(cases), 'cases': cases}, indent=2))
