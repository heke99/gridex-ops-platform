# Current state

Updated: 2026-09-17. Status: IMPLEMENTED_NOT_VERIFIED (full CI pending).
Active: F3-C exact PRODAT characteristic components and affected consumers.
Branch: `codex/ediel-v2-prodat-characteristics-20260917`; base main `b1e077288c8a6865c413c1bf366797b3a23d07d8`.
Audit: `quality/audits/ediel-masterplan-v2/f3-characteristic-fields.md`.

PR322 MERGED as b1e07728 after exact-head full CI passed; PR319 closed superseded
without importing its incorrect16-B assertion. PR318/320/321 are already merged.
F3-C local124 new +210 retained source tests pass. Sixteen new full-dependency
consumer tests plus ordinary exact-head CI/review/merge are next. No whole-phase
or live/TGT certification is claimed. PR310 remains PAUSED at e9611351; no SQL,
generated types, schema/replay inputs or recovery references are changed.
