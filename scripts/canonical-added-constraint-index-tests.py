"""Focused offline source reconstruction controls; no database execution."""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

PATH=Path(__file__).with_name('canonical-added-constraint-index-indexes.py')

class Tests(unittest.TestCase):
    def module(self):
        self.assertTrue(PATH.is_file(), 'index reconstruction helper not implemented')
        spec=importlib.util.spec_from_file_location('index_reconstruction',PATH)
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        return module

    def test_plain_source_preserves_order_method_and_unique(self):
        module=self.module()
        values=list(module.definitions('create unique index if not exists sample on public.example(company_id, created_at desc);'))
        self.assertIn('CREATE UNIQUE INDEX sample ON public.example USING btree (company_id, created_at DESC)',values)
        self.assertNotIn('CREATE INDEX sample ON public.example USING btree (company_id, created_at DESC)',values)

    def test_hash_match_requires_complete_catalog_row(self):
        module=self.module()
        row=module.index_row('example','sample','CREATE INDEX sample ON public.example USING btree (company_id)')
        wrong=dict(row,indisprimary=True)
        self.assertNotEqual(module.sha(row),module.sha(wrong))
        wrong=dict(row,definition=row['definition']+' WHERE (company_id IS NOT NULL)')
        self.assertNotEqual(module.sha(row),module.sha(wrong))

    def test_quoted_semicolon_is_not_statement_end(self):
        module=self.module()
        source="create index sample on public.example (company_id) where marker = 'a;b'; select 1;"
        self.assertEqual(module.statement_at(source,0),source[:source.index('; select')+1])

    def test_typed_date_constants_do_not_consume_the_next_quote(self):
        module=self.module()
        value="COALESCE(start_date, '1900-01-01'::date), COALESCE(end_date, '1900-01-01'::date), COALESCE(code, '')"
        self.assertEqual(module.typed_constants(value),value[:-3]+"''::text)")

    def test_complete_source_reconstruction_and_independent_unique_classes(self):
        module=self.module();result=module.dispositions()
        self.assertEqual(result['definitionReconstructionCount'],451)
        self.assertEqual(len({tuple(r['identity']) for r in result['records']}),451)
        for record in result['records']:
            self.assertEqual(module.sha(record['row']),record['sha256'])
            self.assertTrue(record['sources'])
            self.assertFalse(record['semantics']['schemaAccepted'])
        lock=next(r for r in result['records'] if r['identity'][2]=='ediel_test_run_locks_one_active_agt_uidx')
        self.assertEqual(lock['semantics']['definitionDisposition'],'PRESERVE_UNIQUE_GUARD_CALLER_FIXED')
        for record in result['records']:
            if record['semantics']['classification']=='TENANT_COMPOSITE_REFERENCE_KEY':
                self.assertEqual(record['semantics']['primaryKeyProof']['row']['definition'],'PRIMARY KEY (id)')

    def test_changed_source_and_constraint_register_pins_fail_closed(self):
        module=self.module()
        path=next(iter(module.SOURCE_PINS))
        with patch.dict(module.SOURCE_PINS,{path:'0'*64}):
            with self.assertRaisesRegex(ValueError,'EXACT_INDEX_SOURCE_REQUIRED'):module.reconstruct()
        with patch.object(module,'CONSTRAINT_REGISTER_SHA','0'*64):
            with self.assertRaisesRegex(ValueError,'EXACT_CONSTRAINT_REGISTER_REQUIRED'):module.constraint_rows()

if __name__=='__main__':unittest.main()
