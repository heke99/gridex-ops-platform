"""Compatibility exports of the unchanged complete field/PK oracle semantics."""
import importlib.util
from pathlib import Path

_path = Path(__file__).resolve().with_name('canonical-auth-provisioning-replay.py')
_spec = importlib.util.spec_from_file_location('fixed_oracle_loader', _path)
_loader = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(_loader)
_runtime = _loader.load_fixed()
ORDER, Generated, Clock, timestamp = _runtime.ORDER, _runtime.Generated, _runtime.Clock, _runtime.timestamp
Oracle, activate, bootstrap, normalize = _runtime.Oracle, _runtime.activate, _runtime.bootstrap, _runtime.normalize
