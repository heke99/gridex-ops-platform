"""Read-only F3 inventory. Equality is not behavioral or release acceptance."""
from pathlib import Path
import json
import re
import hashlib
import sys

root = Path(sys.argv[1]).resolve()
source_path = root / 'lib/ediel/prodat/prodat26AFieldMatrix.ts'
frozen_path = root / 'docs/ediel/masterplan-v2/registers/prodat_fields.json'
source = source_path.read_text(encoding='utf-8')
frozen_rows = json.loads(frozen_path.read_text(encoding='utf-8'))
code_match = re.search(r'PRODAT_26A_MESSAGE_CODES = \[(.*?)\]', source)
if not code_match:
    raise SystemExit('Message-code declaration not found; no inventory produced')
codes = re.findall(r"'([^']+)'", code_match.group(1))
rows = []
for line in source.splitlines():
    if not re.match(r"\s*\{fieldNumber:'", line):
        continue
    def scalar(key):
        match = re.search(rf"\b{key}:'([^']*)'", line)
        return match.group(1) if match else None
    usage_match = re.search(r'requirements:\[(.*?)\]', line)
    if not usage_match:
        raise SystemExit('Unrecognized descriptor format; review parser before counting')
    usage = re.findall(r"'([^']+)'", usage_match.group(1))
    if len(usage) != len(codes):
        raise SystemExit('Requirement-vector length mismatch')
    rows.append({'field': scalar('fieldNumber'), 'field_key': scalar('fieldKey'),
                 'runtime_path': scalar('segmentPath'), 'usage': dict(zip(codes, usage))})
actual = {row['field']: row for row in rows if row['field'].isdigit()}
expected = {str(row['field']): row for row in frozen_rows}
if len(rows) != len({row['field'] for row in rows}):
    raise SystemExit('Duplicate runtime field descriptor')
if len(expected) != len(frozen_rows):
    raise SystemExit('Duplicate frozen field descriptor')
missing, extra = sorted(expected.keys() - actual.keys()), sorted(actual.keys() - expected.keys())
differences = [{'field': field, 'code': code, 'runtime': actual[field]['usage'].get(code),
                'frozen': expected[field]['usage'].get(code)}
               for field in sorted(actual.keys() & expected.keys()) for code in codes
               if actual[field]['usage'].get(code) != expected[field]['usage'].get(code)]
families = []
for family in sorted({row['runtime_path'][:3] for row in actual.values()}):
    fields = [field for field, row in actual.items() if row['runtime_path'][:3] == family]
    families.append({'family': family, 'numeric_fields': len(fields), 'fields': fields})
result = {'scope': 'IDENTITY_AND_BASE_USAGE_EQUALITY_ONLY_NOT_RUNTIME_ACCEPTANCE',
          'inputs': [{'path': str(p.relative_to(root)), 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()}
                     for p in [source_path, frozen_path]],
          'numeric_fields': len(actual), 'frozen_numeric_fields': len(expected),
          'parent_descriptors': [row['field'] for row in rows if not row['field'].isdigit()],
          'message_codes': codes, 'compared_base_usage_cells': len(actual.keys() & expected.keys()) * len(codes),
          'missing_fields': missing, 'extra_fields': extra, 'usage_differences': differences,
          'families': families, 'full_F3': 'NOT_COMPLETE', 'full_masterplan': 'NOT_COMPLETE'}
print(json.dumps(result, ensure_ascii=False, indent=2))
if missing or extra or differences:
    raise SystemExit(1)
