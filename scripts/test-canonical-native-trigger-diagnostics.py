"""No database claims: projection validation and native wiring only."""
import copy
import json
from pathlib import Path
import unittest
import canonical_native_trigger_diagnostics as diag


def example():
    return {'roleTriggerCount':0,'events':[{'name':'pgrst_ddl_watch','event':'ddl_command_end',
      'enabled':'O','tags':None,'owner':'supabase_admin','function':'extensions.pgrst_ddl_watch()',
      'functionOwner':'supabase_admin','functionContractSha256':'a'*64}]}


class DiagnosticsTests(unittest.TestCase):
    def test_native_entry_collects_evidence_before_oracle(self):
        text=(Path(__file__).parent/'canonical_native_repair_envelope.py').read_text()
        self.assertIn("report['triggerAdmissionDiagnostic']=trigger_diagnostics.summarize(sql(trigger_diagnostics.QUERY))", text)
        self.assertLess(text.index("report['triggerAdmissionDiagnostic']="),text.index("report['phase']='INDEPENDENT_SOURCE_DDL_ORACLE'"))

    def test_inventory_is_not_an_authorization(self):
        result=diag.summarize(example())
        self.assertTrue(result['blanketEventTriggerBanWouldReject'])
        self.assertFalse(result['admissionChanged'])
        self.assertFalse(result['eventTriggersAuthorized'])
        self.assertEqual(result['eventTriggers'][0]['name'],'pgrst_ddl_watch')

    def test_disabled_events_do_not_explain_active_event_ban(self):
        value=example(); value['events'][0]['enabled']='D'; value['roleTriggerCount']=2
        result=diag.summarize(value)
        self.assertFalse(result['blanketEventTriggerBanWouldReject'])
        self.assertEqual(result['activeRoleTriggerCount'],2)

    def test_unknown_name_or_known_name_with_wrong_function_never_leaks(self):
        for key in ('name','function'):
            value=example(); value['events'][0][key]='private-user@example.invalid'
            result=json.dumps(diag.summarize(value))
            self.assertNotIn('private-user',result)
            self.assertIn('UNRECOGNIZED',result)

    def test_malformed_evidence_is_rejected(self):
        for key,value in (('enabled','x'),('event','x'),('functionContractSha256','x'),('tags',['secret@value'])):
            raw=example(); raw['events'][0][key]=value
            with self.subTest(key=key),self.assertRaises(ValueError): diag.summarize(raw)
        for raw in ({}, {'roleTriggerCount':True,'events':[]}, {'roleTriggerCount':-1,'events':[]}):
            with self.assertRaises(ValueError): diag.summarize(raw)
        raw=example(); raw['events'].append(copy.deepcopy(raw['events'][0]))
        with self.assertRaises(ValueError): diag.summarize(raw)

    def test_query_is_read_only_and_does_not_return_bodies_or_exception_text(self):
        self.assertTrue(diag.QUERY.startswith('BEGIN READ ONLY;'))
        self.assertIn('SET LOCAL search_path=pg_catalog;',diag.QUERY)
        for token in ('CREATE ','ALTER ','DROP ','GRANT ','REVOKE ','pg_authid'):
            self.assertNotIn(token,diag.QUERY)
        self.assertIn('encode(sha256(convert_to',diag.QUERY)


if __name__=='__main__': unittest.main(verbosity=2)
