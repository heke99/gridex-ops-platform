"""Exact source-bound LOCK context for native forward10, without an early COMMIT.

The official CLI owns the outer transaction and its real ledger INSERT. Only the
one pinned top-level LOCK is wrapped; all other source bytes remain unchanged.
The caller still requires original source hashes and complete rollback witnesses.
"""
import canonical_native_timestamp_sources as compiler
import canonical_native_historical_prefix as prefix

SOURCE = 'migrations/20260915183840_drop_inert_inbound_client_policies.sql'
SOURCE_SHA = '5cd56392d5647196fe4f64e7d5a76fe5fa0a3a9a454efcfd34a6d8f754ac86a7'
PLAIN_SHA = '95989bed2ee88e6ad908565b75eff413d93676934c0f17c1332b3cb6b7c5fc98'
LOCK = ('lock table public.inbound_ediel_match_attempts, public.inbound_ediel_parse_results,\n'
        '  public.inbound_email_attachments in access exclusive mode;')
OPEN = b'DO $gridex_native_forward_lock$ BEGIN\n'
CLOSE = b'\nEND $gridex_native_forward_lock$;'


def adapt(source, body):
    if type(body) is not bytes:
        raise ValueError('FORWARD_LOCK_SOURCE_REQUIRED')
    text = body.decode('utf-8')
    locks = [item for item in compiler.prefix.statements(text) if item[0][0].upper() == 'LOCK']
    if not locks:
        if source.source == SOURCE:
            raise ValueError('FORWARD_LOCK_SOURCE_REQUIRED')
        return body
    if (source.source != SOURCE or source.source_sha256 != SOURCE_SHA
            or prefix.sha(source.sql) != SOURCE_SHA or prefix.sha(body) != PLAIN_SHA
            or compiler.transfer_outer(source.sql) != (body, True)
            or len(locks) != 1 or OPEN in body or CLOSE in body):
        raise ValueError('FORWARD_LOCK_SOURCE_REQUIRED')
    start, end = locks[0][0][1], locks[0][-1][2]
    if text[start:end+1] != LOCK:
        raise ValueError('FORWARD_LOCK_STATEMENT_REQUIRED')
    candidate = text[:start].encode() + OPEN + text[start:end+1].encode() + CLOSE + text[end+1:].encode()
    if candidate.replace(OPEN, b'').replace(CLOSE, b'') != body:
        raise ValueError('FORWARD_LOCK_BYTES_REQUIRED')
    return candidate


def boundary(ordinal):
    if type(ordinal) is not int or not 1 <= ordinal <= 12:
        raise ValueError('FORWARD_SOURCE_ORDINAL_REQUIRED')
    if ordinal != 10:
        return 'true'
    return """(current_setting('lock_timeout')::interval=interval '5 seconds'
      AND current_setting('statement_timeout')::interval=interval '60 seconds'
      AND current_setting('search_path')='pg_catalog, public'
      AND (SELECT count(*)=3 FROM pg_locks WHERE pid=pg_backend_pid() AND granted
        AND mode='AccessExclusiveLock' AND relation IN (
          'public.inbound_ediel_match_attempts'::regclass,
          'public.inbound_ediel_parse_results'::regclass,
          'public.inbound_email_attachments'::regclass)))"""
