"""Offline proof checks; no new database or performance acceptance."""
from collections import Counter
import copy
import json
import unittest
from unittest.mock import patch
import canonical_schema_index_column_decisions as m


class DecisionsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.retained=m.retain()
        cls.records,cls.survivors=m.contract(cls.retained)

    def test_exact65_decisions_match_independently_verified_original_artifact(self):
        self.assertEqual(Counter((r['section'],r['change']) for r in self.records),
                         {('indexes','removed'):51,('columns','changed'):14})
        projected=[]
        for r in self.records:
            keys=('identity','sha256') if r['change']=='removed' else ('identity','fields','referenceSha256','replaySha256')
            projected.append(dict(section=r['section'],change=r['change'],**{k:r[k] for k in keys}))
            self.assertTrue(r['decision'].startswith('PRESERVE_'))
            self.assertEqual(r['witness'],'nativeFinalSql')
            if r['change']=='changed':
                self.assertNotEqual(r['fields'],['attnum'])
                self.assertNotIn('data_type',r['fields'])
        # Independently reconstructed from hash-verified original335f987f ZIP,
        # not a hash freshly accepted from incoming native comparison output.
        self.assertEqual(m.sha(projected),'af7db59ffae680b7e50c8c7cfae0b2279fb28b9dfdf143a08dd6e568803e4409')
        self.assertEqual(Counter(r['change'] for r in self.survivors),{'added':48,'unchanged':1})
        self.assertEqual(sum(r['decision']==m.DECISIONS['OPEN'] for r in self.records),2)
        self.assertEqual(sum(r['decision']==m.DECISIONS['PN'] for r in self.records),1)

    def test_every_audit_reference_and_sql_source_pin_is_required(self):
        self.assertEqual(len(self.retained),73)
        for index,(name,raw) in enumerate(self.retained):
            altered=self.retained[:index]+((name,raw+b'\n'),)+self.retained[index+1:]
            with self.subTest(name=name),self.assertRaisesRegex(ValueError,'SCHEMA_INDEX_COLUMN_SOURCE_REQUIRED'):
                m.contract(altered)
        for invalid in ((),self.retained[:-1],self.retained[::-1],self.retained+(self.retained[0],),list(self.retained)):
            with self.assertRaisesRegex(ValueError,'SCHEMA_INDEX_COLUMN_SOURCE_REQUIRED'):m.contract(invalid)

    def context(self):
        return dict(sections=dict(indexes=dict(added=[{k:r[k] for k in ('identity','sha256')}
                    for r in self.survivors if r['change']=='added'],removed=[],changed=[])))

    def test_all48_added_survivors_require_exact_identity_hash_and_unique_presence(self):
        base=self.context();m.validate_context(base)
        for index in range(48):
            for defect in ('missing','hash','identity','extra_field','duplicate'):
                changed=copy.deepcopy(base);rows=changed['sections']['indexes']['added']
                if defect=='missing':rows.pop(index)
                elif defect=='hash':rows[index]['sha256']='0'*64
                elif defect=='identity':rows[index]['identity'][-1]+='_unknown'
                elif defect=='extra_field':rows[index]['definition']='invented'
                else:rows.append(copy.deepcopy(rows[index]))
                with self.subTest(index=index,defect=defect),self.assertRaisesRegex(ValueError,'SURVIVOR_REQUIRED'):
                    m.validate_context(changed)

    def test_reference_retained_survivor_may_not_be_removed_changed_or_reclassified(self):
        survivor=next(r for r in self.survivors if r['change']=='unchanged')
        for change in ('added','removed','changed'):
            diff=self.context();diff['sections']['indexes'][change].append({'identity':survivor['identity']})
            with self.assertRaisesRegex(ValueError,'SURVIVOR_REQUIRED'):m.validate_context(diff)
        for malformed in ({},{'sections':{}},{'sections':{'indexes':None}}):
            with self.assertRaisesRegex(ValueError,'SURVIVOR_REQUIRED'):m.validate_context(malformed)

    def final_receipt(self):
        from canonical_native_final_sql import PINS
        return dict(scope='POST_REPLAY_SQL_NOT_SCHEMA_OR_TYPE_ACCEPTANCE',verified=True,
            checks=[dict(source=p,sourceSha256=h,verified=True,catalogAndRowsPreserved=True,ledgerUnchanged=True)
                    for p,h in PINS.items()],schemaAccepted=False,generatedTypesVerified=False)

    def test_exact_native_preserved_final_sql_is_mandatory_without_acceptance_flags(self):
        receipt=self.final_receipt();m.validate_execution_receipt(receipt,native=True)
        for native in (False,1,None):
            with self.assertRaisesRegex(ValueError,'NATIVE_FINAL_SQL_REQUIRED'):m.validate_execution_receipt(receipt,native=native)
        for defect in ('missing','order','hash','preservation','truthy','extra','accepted'):
            changed=copy.deepcopy(receipt)
            if defect=='missing':changed['checks'].pop()
            elif defect=='order':changed['checks'].reverse()
            elif defect=='hash':changed['checks'][0]['sourceSha256']='0'*64
            elif defect=='preservation':changed['checks'][0]['ledgerUnchanged']=False
            elif defect=='truthy':changed['checks'][0]['verified']=1
            elif defect=='extra':changed['unknown']=True
            else:changed['schemaAccepted']=True
            with self.subTest(defect=defect),self.assertRaisesRegex(ValueError,'NATIVE_FINAL_SQL_REQUIRED'):
                m.validate_execution_receipt(changed,native=True)

    def test_unknown_index_definition_shape_is_not_approved(self):
        for definition in ('CREATE INDEX x ON private.t USING btree (a)',
                           'CREATE INDEX x ON public.t USING hash (a)',
                           'DROP INDEX public.x','CREATE UNIQUE INDEX x ON public.t USING btree (a);'):
            # A trailing-semicolon definition may parse lexically, but does not
            # match any pinned catalog hash and is not sufficient for approval.
            if definition.endswith(';'):
                self.assertNotIn(m.sha(m.index_row(definition)),[r.get('sha256') for r in self.records])
            else:
                with self.assertRaisesRegex(ValueError,'DEFINITION_REQUIRED'):m.index_row(definition)


if __name__=='__main__':unittest.main()
