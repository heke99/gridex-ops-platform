from pathlib import Path
import hashlib
import json


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected one match for {old!r}, got {count}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')


replace_once(
    'lib/ediel/prodat/prodatMessageSupportRegistry.ts',
    '    hasEngineBuilder,\n',
    '    hasEngineBuilder: hasBuilder,\n',
)

replace_once(
    'lib/ediel/flows/inboundBusinessStateMachine.ts',
    "  if (outcome === 'supplier_switch_completed') return 'Leveransförändringen är mottagen.'\n",
    "  if (['supplier_switch_completed'].includes(outcome)) return 'Leveransförändringen är mottagen.'\n",
)

migration_dir = Path('supabase/migrations')
new_migrations = [
    '20260822010000_prodat_26a_semantic_hardening.sql',
    '20260822011000_supplier_switch_transport_ack_guard.sql',
    '20260822011100_supplier_switch_z04_confirmed_alias_guard.sql',
    '20260822012000_supplier_switch_effective_date_guard.sql',
]

additions_path = Path('scripts/migration-history-manifest.additions.json')
additions = json.loads(additions_path.read_text(encoding='utf-8'))
files = additions.setdefault('files', {})
for name in new_migrations:
    data = (migration_dir / name).read_bytes()
    files[name] = hashlib.sha256(data).hexdigest()
additions_path.write_text(json.dumps(additions, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')

types_manifest_path = Path('scripts/supabase-types-manifest.json')
types_manifest = json.loads(types_manifest_path.read_text(encoding='utf-8'))
generated_path = Path(types_manifest['generated_types'])
types_manifest['sha256'] = hashlib.sha256(generated_path.read_bytes()).hexdigest()
types_manifest['latest_migration'] = new_migrations[-1]
types_manifest_path.write_text(json.dumps(types_manifest, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
