"""Offline source and finite-postcondition tests; no native SQL acceptance."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import canonical_permission_forward_contract as m

class ContractTests(unittest.TestCase):
    def test_only_exact_retained_candidate_bytes_are_admitted(self):
        scope, permissions = m.retain()
        self.assertEqual(len(m.function_specs(permissions)),8)
        for raw in (permissions+b'\n', b'', None, scope):
            with self.assertRaises(ValueError):m.function_specs(raw)
        with patch.object(m,'SCOPE_SHA','0'*64):
            with self.assertRaises(ValueError):m.retain()
        with patch.object(m,'PERMISSION_SHA','0'*64):
            with self.assertRaises(ValueError):m.retain()

    def test_scope_predicate_requires_two_exact_roles_without_write(self):
        sql=m.storage_assertion()
        self.assertIn('count(*)=2',sql)
        self.assertIn("ARRAY[('authenticated'::regrole)::oid]",sql)
        self.assertIn("('grid_owner_agreements_platform_read','r')",sql)
        self.assertIn("('grid_owner_agreements_platform_write','a')",sql)
        self.assertIn('p.polqual IS NOT NULL AND p.polwithcheck IS NULL',sql)
        self.assertIn('p.polqual IS NULL AND p.polwithcheck IS NOT NULL',sql)
        for verb in ('GRANT ', 'ALTER POLICY', 'CREATE FUNCTION', 'UPDATE ', 'DELETE '):
            self.assertNotIn(verb,sql)

    def test_function_predicate_requires_bodies_metadata_and_acl(self):
        sql=m.permission_assertion()
        self.assertIn('count(*)=8',sql)
        for spec in m.function_specs(m.retain()[1]):
            self.assertIn(m.sql_literal(spec['body']),sql)
            self.assertIn(m.sql_literal(spec['arguments']),sql)
            self.assertIn(m.sql_literal(spec['result']),sql)
        for field in ('p.prokind','p.prosecdef','p.prosrc=v.body','p.proconfig=ARRAY[v.config]',
                      'pg_get_function_identity_arguments','pg_get_function_result',
                      'pg_get_expr(p.proargdefaults,0)',"pg_get_userbyid(p.proowner)='postgres'"):
            self.assertIn(field,sql)
        for signature in m.OWNER_ONLY:
            self.assertIn(m.sql_literal(signature)+'::regprocedure',sql)
            for role in ('anon','authenticated','service_role'):
                self.assertIn('(NOT has_function_privilege('+m.sql_literal(role)+','+m.sql_literal(signature),sql)
        for signature in m.SERVICE_ONLY:
            self.assertIn("has_function_privilege('service_role',"+m.sql_literal(signature),sql)
        self.assertIn("NOT has_schema_privilege('anon','gridex_private','USAGE,CREATE')",sql)
        self.assertIn("a.privilege_type='EXECUTE' AND NOT a.is_grantable",sql)

    def test_exact_specs_match_independently_executed_clone_contract(self):
        path=m.ROOT/'scripts/canonical-full-permission-clone-qualification.py'
        spec=importlib.util.spec_from_file_location('permission_clone_contract_reference',path)
        clone=importlib.util.module_from_spec(spec);spec.loader.exec_module(clone)
        expected=tuple(dict(row,owner='postgres') for row in clone.function_specs(clone.candidate()))
        self.assertEqual(m.function_specs(m.retain()[1]),expected)

    def test_sql_literal_preserves_quote_and_rejects_non_text_and_nul(self):
        self.assertEqual(m.sql_literal("a'\\b\n"),"'a''\\b\n'")
        for value in (None,1,True,'a\x00b'):
            with self.assertRaises(ValueError):m.sql_literal(value)

    def test_missing_or_symlinked_sources_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            with self.assertRaises(ValueError):m.retain(root)
            for name,raw in zip((m.SCOPE_SOURCE,m.PERMISSION_SOURCE),m.retain()):
                path=root/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(raw)
            self.assertEqual(m.retain(root),m.retain())
            path=root/m.SCOPE_SOURCE;raw=path.read_bytes();path.unlink()
            outside=root/'outside.sql';outside.write_bytes(raw);path.symlink_to(outside)
            with self.assertRaises(ValueError):m.retain(root)

    def test_real_prepromotion_proof_and_cli_identity_are_required(self):
        import hashlib
        import json
        m.validate_promotion_evidence()
        for filename in m.EVIDENCE_PINS:
            with patch.dict(m.EVIDENCE_PINS,{filename:'0'*64}):
                with self.assertRaises(ValueError):m.validate_promotion_evidence()
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            for name in m.EVIDENCE_PINS:
                path=root/name;path.parent.mkdir(parents=True,exist_ok=True)
                path.write_bytes((m.ROOT/name).read_bytes())
            names=list(m.EVIDENCE_PINS)
            proof_path=root/names[0]
            original=json.loads(proof_path.read_bytes())
            from copy import deepcopy
            variants=[]
            for flag in ('ownedCleanupVerified','sourcePreserved','privateWorkspaceRemoved'):
                bad=deepcopy(original);bad[flag]=False;variants.append(bad)
            bad=deepcopy(original);bad['details']['permissionQualification']['matrixCases']=128;variants.append(bad)
            bad=deepcopy(original);bad['details']['storagePolicyScopeQualification']['negativeAndRecoveryVerified']=False;variants.append(bad)
            for bad in variants:
                raw=(json.dumps(bad)+'\n').encode();proof_path.write_bytes(raw)
                with patch.dict(m.EVIDENCE_PINS,{names[0]:hashlib.sha256(raw).hexdigest()}):
                    with self.assertRaises(ValueError):m.validate_promotion_evidence(root)
            proof_path.write_bytes((m.ROOT/names[0]).read_bytes())
            scaffold_path=root/names[1];scaffold=json.loads(scaffold_path.read_bytes())
            scaffold['migrations'][1]['basename']='20990101000000_invented.sql'
            raw=json.dumps(scaffold).encode();scaffold_path.write_bytes(raw)
            with patch.dict(m.EVIDENCE_PINS,{names[1]:hashlib.sha256(raw).hexdigest()}):
                with self.assertRaisesRegex(ValueError,'CLI_IDENTITY'):m.validate_promotion_evidence(root)

if __name__=='__main__':unittest.main()
