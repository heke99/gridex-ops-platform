#!/usr/bin/env python3
"""Regenerates chain/vendor/ from the reality harness (read-only git access).

  python3 chain/vendor-sync.py /path/to/clone-with-the-commits

Origin of every vendored file: claude/gifted-hamilton-vss1hj @ 2711f86287fd77da12e48aa5fd26a695f4a51426 (same path under
chain/vendor/). Imports that resolve to a file that exists at the T4 base (1c0c088c) are rewritten to the '@/' alias; imports
between vendored files stay relative (the tree is mirrored). Each file gets '// @ts-nocheck' and an eslint-disable so
`npm run typecheck:scripts` and lint do not judge copied code written against another app version. The PATCHES table is the
complete list of edits made to the copies (everything else is byte-identical)."""
import os, re, subprocess, sys

REPO = sys.argv[1] if len(sys.argv) > 1 else '/home/user/gridex-ops-platform'
SRC = '2711f86287fd77da12e48aa5fd26a695f4a51426'
BASE = '1c0c088cb4ed66d0dd8b3e34c9606019342a1a56'
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'vendor')

FILES = [
  'scripts/helpers/live-chain-fixture.ts', 'scripts/helpers/live-chain-wire.ts',
  'scripts/helpers/reality/inboundProdatWire.ts', 'scripts/helpers/reality/rejectsWire.ts',
  'scripts/reality/simulators/edifactMailParts.ts', 'scripts/reality/simulators/gridOwner.ts',
  'scripts/reality/simulators/gridOwnerProfile.ts', 'scripts/reality/simulators/gridOwnerWire.ts',
  'scripts/reality/simulators/platformMailbox.ts', 'scripts/reality/simulators/smimeUnwrap.ts',
]

# (file, old, new) - each `old` must occur exactly once.
PATCHES = [
  ('scripts/helpers/live-chain-fixture.ts', "?? 'http://127.0.0.1:3100'", "?? 'http://127.0.0.1:3104'"),
  ('scripts/helpers/live-chain-fixture.ts', "  smtpsPort: 3465,\n  imapsPort: 3993,", "  smtpsPort: Number(process.env.T4_SMTPS_PORT ?? 55425),\n  imapsPort: Number(process.env.T4_IMAPS_PORT ?? 55426),"),
  # the shared mailbox is due for polling every minute instead of every 5 (poll_interval_minutes is mailbox configuration)
  ('scripts/helpers/live-chain-fixture.ts', "is_active=true,last_error=NULL,locked_at=NULL", "is_active=true,poll_interval_minutes=1,last_error=NULL,locked_at=NULL"),
  # lib/customers/registeredAddress.ts does not exist at the T4 base (the registered-address writer arrived later)
  ('scripts/helpers/live-chain-fixture.ts',
   "  const { recordRegisteredAddress } = await import('@/lib/customers/registeredAddress')\n  await recordRegisteredAddress({ companyId: tenant.companyId, customerId, address: input.address, source: 'staff_entry', actorUserId: tenant.adminUserId,\n    declaredAt: input.authorizedAt, reference: 'e2e_reality_august' })\n",
   "  // T4: lib/customers/registeredAddress.ts does not exist at base 1c0c088c; the registered-address writer call is omitted.\n"),
  ('scripts/reality/simulators/gridOwner.ts', "env('REALITY_SMTPS_PORT', '3465')", "env('REALITY_SMTPS_PORT', '55425')"),
  ('scripts/reality/simulators/gridOwner.ts', "env('REALITY_IMAPS_PORT', '3993')", "env('REALITY_IMAPS_PORT', '55426')"),
]

def git_show(ref, path):
    r = subprocess.run(['git', '-C', REPO, 'show', f'{ref}:{path}'], capture_output=True, text=True)
    return r.stdout if r.returncode == 0 else None

def resolve(from_file, spec):
    target = os.path.normpath(os.path.join(os.path.dirname(from_file), spec))
    for ext in ('', '.ts', '.tsx', '.mjs', '.json', '/index.ts'):
        cand = target + ext
        if git_show(SRC, cand) is not None and not cand.endswith('/'):
            return cand
    return None

IMPORT = re.compile(r"""((?:import|export)[^'"]*?from\s*|import\(\s*)(['"])(\.[^'"]+)\2""")

def rewrite(path, text):
    def sub(m):
        spec = m.group(3)
        target = resolve(path, spec)
        if target is None:
            raise SystemExit(f'{path}: cannot resolve {spec}')
        if target in FILES:
            return m.group(0)
        if git_show(BASE, target) is None:
            raise SystemExit(f'{path}: {spec} -> {target} exists neither vendored nor at base')
        return f"{m.group(1)}{m.group(2)}@/{re.sub(r'\.(ts|tsx)$', '', target)}{m.group(2)}"
    return IMPORT.sub(sub, text)

for path in FILES:
    text = git_show(SRC, path)
    if text is None: raise SystemExit(f'missing {path}')
    text = rewrite(path, text)
    for f, old, new in PATCHES:
        if f != path: continue
        if text.count(old) != 1: raise SystemExit(f'{path}: patch anchor count {text.count(old)} for {old[:50]!r}')
        text = text.replace(old, new)
    header = (f'/* eslint-disable @typescript-eslint/ban-ts-comment */\n// @ts-nocheck\n// VENDORED COPY. Origin: claude/gifted-hamilton-vss1hj @ {SRC}:{path}\n'
              f'// Only the edits listed in chain/vendor-sync.py PATCHES (and @/ import rewrites) differ from the origin.\n')
    out = os.path.join(OUT, path)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    open(out, 'w').write(header + text)
    print('vendored', path)
