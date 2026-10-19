#!/usr/bin/env python3
"""Redact disposable credentials from evidence, including Playwright trace ZIPs."""
import argparse
import base64
import bisect
import io
import json
import os
from pathlib import Path
import re
import tempfile
import zipfile
from html.parser import HTMLParser
from xml.parsers import expat

SENSITIVE = {'password', 'access_token', 'refresh_token', 'id_token', 'authorization', 'cookie', 'set-cookie', 'apikey', 'api_key', 'service_role_key', 'anon_key', 'jwt_secret', 's3_protocol_access_key_id', 's3_protocol_access_key_secret'}
REDACTED = '[REDACTED_LOCAL_CREDENTIAL]'
JWT = re.compile(rb'\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b')
OPAQUE_API_KEY = re.compile(rb'sb_(?:secret|publishable)_[A-Za-z0-9_-]+')
EMBEDDED_ZIP = re.compile(rb'data:application/zip;base64,([A-Za-z0-9+/=]+)')
JWT_RUN = re.compile(rb'[A-Za-z0-9_-]+')
JWT_START = re.compile(rb'\beyJ[A-Za-z0-9_-]')
ANSI_CSI_BYTES = re.compile(rb'\x1b\[[0-?]*[ -/]*[@-~]')
# Credential names as they appear in env files, `key: value` logs, embedded
# JSON and CLI output. Matching is by name, so it works without a status file.
CREDENTIAL_NAME = (rb'(?:[A-Za-z0-9]+_)*(?:s3[_ ]protocol[_ ]access[_ ]key[_ ](?:id|secret)'
                   rb'|(?:s3[_ ])?(?:access|secret)[_ ]key(?:[_ ](?:id|secret))?'
                   rb'|jwt[_ ]secret|service[_ ]role[_ ]key|anon[_ ]key|api[_ ]?key|password'
                   rb'|pgpassword|accessToken|x-api-key)')
SENSITIVE_NAME = re.compile(rb'(?i)' + CREDENTIAL_NAME)
KEY_VALUE = re.compile(rb'(?i)((?:^|(?<=[^A-Za-z0-9_]))(?:export\s+)?["\']?' + CREDENTIAL_NAME
                       + rb'["\']?[ \t]*(?::(?![:=])|=)[ \t]*)(' + re.escape(REDACTED.encode())
                       + rb'|"(?:[^"\\\r\n]|\\.)*"|\'[^\'\r\n]*\'|[^\s,;}\]\r\n]+)')
URL_SCHEME = re.compile(rb'(?i)(?<![a-z0-9+.-])[a-z][a-z0-9+.-]*://')
URL_USER = re.compile(rb'[^\s/:@?#]+:')
URL_AUTHORITY_END = re.compile(rb'[/\s?#]')
URL_TOKEN = re.compile(rb'\S+')
TABLE_LABELS = {b'access key', b'secret key', b's3 access key', b's3 secret key'}
TABLE_SEPARATORS = ('│'.encode(), '┃'.encode(), b'|')
TABLE_BORDER_CHARS = set(' ─━┬┴┼┌┐└┘╭╮╰╯┏┓┗┛┣┫┳┻╋├┤│┃-+=|')
XML_ATTRIBUTE = re.compile(rb'''(?<=[ \t\r\n])([^\x00-\x20=<>/'"]+)[ \t\r\n]*=[ \t\r\n]*(["'])(.*?)\2''', re.DOTALL)
XML_ENTITY = re.compile(rb'&(?:amp|lt|gt|quot|apos|\#[0-9]+|\#x[0-9a-fA-F]+);')
HTML_DOCTYPE_START = re.compile(rb'(?i)\A<!doctype[ \t\r\n\f]+html(?=[ \t\r\n\f>\[])')
HTML5_WRAPPER = re.compile(
    rb'(?i)\A<!doctype[ \t\r\n\f]+html[ \t\r\n\f]*>[ \t\r\n\f]*<html(?=[ \t\r\n\f>])'
    rb'''(?:[^<>"']|"[^"]*"|'[^']*')*>''')
HTML_ENTITY_DECLARATION = re.compile(rb'(?i)<!ENTITY(?=[ \t\r\n%>])')



def scrub_jwts(data):
    # Without the original matcher's required prefix there is no JWT span.
    if JWT_START.search(data) is None:
        return data
    # A candidate can start after '-' inside an ASCII token run. Scanning the
    # same remaining run at every such start makes incomplete tokens quadratic.
    # Visit each three-run window once, then use the original JWT matcher for
    # its exact span (including its trailing word-boundary/backtracking rule).
    runs = iter(JWT_RUN.finditer(data))
    first = next(runs, None)
    second = next(runs, None)
    output = []
    cursor = 0
    for third in runs:
        if (data[first.end():second.start()] == b'.'
                and data[second.end():third.start()] == b'.'
                and third.group().rstrip(b'-')):
            start = JWT_START.search(data, max(cursor, first.start()), first.end())
            match = JWT.match(data, start.start()) if start is not None else None
            if match is not None:
                output.extend((data[cursor:match.start()], REDACTED.encode()))
                cursor = match.end()
        first, second = second, third
    if not output:
        return data
    output.append(data[cursor:])
    return b''.join(output)


def _plain(cell):
    return b' '.join(ANSI_CSI_BYTES.sub(b'', cell).split()).lower()


def _redacted_cell(cell):
    # Keep the cell's own line ending so record boundaries never move.
    ending = cell[len(cell.rstrip(b'\r\n')):]
    return b' ' + REDACTED.encode() + b' ' + ending


def _json_record(data):
    try:
        # Only UTF-8 records may re-enter scrub after a binary-file fallback.
        json.loads(data.decode('utf-8'))
    except (json.JSONDecodeError, UnicodeDecodeError):
        return False
    return True


def sensitive_name(name):
    """Recognize whole credential-name families, not arbitrary substrings.

    Underscore provider prefixes are allowed; the final component must be a
    named credential family. Policy/count/prose suffixes are not credentials.
    The same classification applies to JSON keys, header pairs and local status.
    """
    name = str(name)
    return name.lower() in SENSITIVE or SENSITIVE_NAME.fullmatch(name.encode('utf-8', errors='surrogatepass')) is not None


def _xml_entity_view(data):
    # Decode qualified XML references exactly once. Keep one compact mapping
    # segment per entity, not one Python object per input/decoded byte.
    builtins = {b'amp': b'&', b'lt': b'<', b'gt': b'>', b'quot': b'"', b'apos': b"'"}
    pieces, starts, ends, raw_starts, raw_ends, shifts = [], [], [], [], [], [0]
    cursor = length = 0
    for match in XML_ENTITY.finditer(data):
        literal = data[cursor:match.start()]
        pieces.append(literal)
        length += len(literal)
        name = match[0][1:-1]
        if name in builtins:
            value = builtins[name]
        else:
            hexadecimal = name.startswith(b'#x')
            digits = name[2:] if hexadecimal else name[1:]
            # The containing XML was validated. Leading zeroes need not enter
            # int(), whose decimal safety bound is unrelated to XML validity.
            digits = digits.lstrip(b'0') or b'0'
            value = chr(int(digits, 16 if hexadecimal else 10)).encode('utf-8')
        pieces.append(value)
        starts.append(length); ends.append(length + len(value))
        raw_starts.append(match.start()); raw_ends.append(match.end())
        shifts.append(match.end() - (length + len(value)))
        length += len(value)
        cursor = match.end()
    if not starts:
        return data, lambda offset, end=False: offset
    pieces.append(data[cursor:])

    def raw_boundary(offset, end=False):
        index = bisect.bisect_right(starts, offset) - 1
        if index >= 0 and starts[index] < offset < ends[index]:
            return raw_ends[index] if end else raw_starts[index]
        return offset + shifts[bisect.bisect_right(ends, offset)]

    return b''.join(pieces), raw_boundary


def _apply_clean_spans(data, spans_for, xml_entities=False):
    # Match through ANSI decoration, but replace only secret spans in the
    # original bytes. Public styling, labels and diagnostics stay byte-exact.
    original = data
    if xml_entities:
        data, raw_boundary = _xml_entity_view(data)
    else:
        raw_boundary = lambda offset, end=False: offset
    pieces, positions, removed = [], [], [0]
    cursor = 0
    for code in ANSI_CSI_BYTES.finditer(data):
        pieces.append(data[cursor:code.start()])
        positions.append(code.start() - removed[-1])
        removed.append(removed[-1] + code.end() - code.start())
        cursor = code.end()
    if positions:
        pieces.append(data[cursor:])
        clean = b''.join(pieces)
    else:
        clean = data
    output, cursor = [], 0
    for start, end, replacement in spans_for(clean):
        # Codes exactly at a value boundary belong to the surrounding style.
        raw_start = start + removed[bisect.bisect_right(positions, start)]
        raw_end = end + removed[bisect.bisect_left(positions, end)]
        raw_start, raw_end = raw_boundary(raw_start), raw_boundary(raw_end, end=True)
        output.extend((original[cursor:raw_start], replacement))
        cursor = raw_end
    if not output:
        return original
    output.append(original[cursor:])
    return b''.join(output)


def _url_spans(data):
    # Every non-whitespace token is visited once. Scheme admission cannot
    # restart inside a dotted scheme run. A successful userinfo span consumes
    # through its authority @, before /?#. With no later delimiter or @,
    # later schemes cannot qualify. Raw reserved characters are not inferred
    # as password characters; valid percent-encoded userinfo is supported.
    # No arbitrary scheme-length cap or repeated suffix regex is needed.
    cursor = 0
    for token in URL_TOKEN.finditer(data):
        if data.find(b'@', token.start(), token.end()) < 0:
            continue
        for scheme in URL_SCHEME.finditer(data, token.start(), token.end()):
            if scheme.start() < cursor:
                continue
            user = URL_USER.match(data, scheme.end(), token.end())
            if user is None:
                continue
            boundary = URL_AUTHORITY_END.search(data, user.end(), token.end())
            authority_end = boundary.start() if boundary is not None else token.end()
            at = data.find(b'@', user.end(), authority_end)
            if at < 0:
                if boundary is None:
                    break
                continue
            if at == user.end():
                continue
            yield scheme.start(), at, REDACTED.encode()
            cursor = at


def scrub_url_passwords(data, xml_entities=False):
    # Remove the complete scheme://user:password shape. Keeping user:marker@
    # would still fail the existing callers' independent URL leak detector.
    return _apply_clean_spans(data, _url_spans, xml_entities=xml_entities)


def _scrub_named_values(data, preserve_quotes=False, xml_entities=False):
    def spans(clean):
        if xml_entities and _json_record(clean):
            # Credential-bearing JSON already uses the structured scrubber's
            # canonical form. Reuse its typed/duplicate/nested semantics; only
            # this changed JSON span may be rewritten, with XML-safe bytes.
            result = scrub(clean, _xml_text='literal')
            if result != clean:
                result = result.replace(b'&', b'&amp;').replace(b'<', b'&lt;').replace(b'>', b'&gt;')
                yield 0, len(clean), result
            return
        for match in KEY_VALUE.finditer(clean):
            replacement = REDACTED.encode()
            if xml_entities and match[2][:1] in b'"\'' and match[2][-1:] == match[2][:1]:
                # Preserve the original literal/entity quote tokens. Only
                # the decoded credential interior maps back to a raw edit.
                yield match.start(2) + 1, match.end(2) - 1, replacement
                continue
            if match[2][:1] in b'"\'':
                quote = match[2][:1] if preserve_quotes else b'"'
                replacement = quote + replacement + quote
            yield match.start(2), match.end(2), replacement
    return scrub_url_passwords(_apply_clean_spans(data, spans, xml_entities=xml_entities), xml_entities=xml_entities)


def _secure_xml_parser():
    parser = expat.ParserCreate()
    parser.buffer_text = False
    parser.SetParamEntityParsing(expat.XML_PARAM_ENTITY_PARSING_NEVER)

    def refuse(*args):
        raise ValueError('redaction_xml_DTD_or_external_entity_not_supported')

    parser.StartDoctypeDeclHandler = refuse
    parser.EntityDeclHandler = refuse
    parser.ExternalEntityRefHandler = refuse
    return parser


def _xml_text_spans(data):
    # Raw byte offsets come from the parser, never from the length of decoded
    # callbacks: entities, CRLF and multibyte UTF-8 have different raw lengths.
    parser = _secure_xml_parser()
    spans = []
    pending = None
    literal = False

    def flush(*args):
        nonlocal pending
        if pending is not None:
            spans.append((pending[0], parser.CurrentByteIndex, pending[1]))
            pending = None

    def text(value):
        nonlocal pending
        if pending is None:
            pending = (parser.CurrentByteIndex, 'literal' if literal else 'entities')

    def comment(value):
        flush()
        start = parser.CurrentByteIndex
        spans.append((start + 4, data.index(b'-->', start + 4), 'literal'))

    def instruction(target, value):
        flush()
        start = parser.CurrentByteIndex
        spans.append((start + 2, data.index(b'?>', start + 2), 'literal'))

    def cdata_start(*args):
        nonlocal literal
        flush()
        literal = True

    def cdata_end(*args):
        nonlocal literal
        flush()
        literal = False

    parser.CharacterDataHandler = text
    parser.StartElementHandler = flush
    parser.EndElementHandler = flush
    parser.CommentHandler = comment
    parser.ProcessingInstructionHandler = instruction
    parser.StartCdataSectionHandler = cdata_start
    parser.EndCdataSectionHandler = cdata_end
    parser.Parse(data, True)
    flush()
    return spans


def _scrub_xml_attributes(markup):
    # The complete input was qualified as XML. Only quoted attribute values
    # may change here; names, quotes, declarations and structural bytes stay.
    output, cursor = [], 0
    for attribute in XML_ATTRIBUTE.finditer(markup):
        # Consume complete XML-qualified names, including Unicode, so neither
        # a name suffix nor a quoted value can become a second attribute.
        name = attribute[1].rsplit(b':', 1)[-1].decode('ascii', errors='replace')
        value = attribute[3]
        replacement = REDACTED.encode() if sensitive_name(name) else _scrub_named_values(value, preserve_quotes=True, xml_entities=True)
        if replacement != value:
            # Named-value normalization may introduce quotes. A literal quote
            # matching this attribute's delimiter was absent in the valid
            # input; escape only such introduced delimiters, not existing
            # entity bytes or the other quote style.
            quote = attribute[2]
            replacement = replacement.replace(quote, b'&quot;' if quote == b'"' else b'&apos;')
            output.extend((markup[cursor:attribute.start(3)], replacement))
            cursor = attribute.end(3)
    if not output:
        return markup
    output.append(markup[cursor:])
    return b''.join(output)


def _validate_html5_declarations(data):
    # Token callbacks distinguish actual declarations from public strings in
    # scripts, raw text and comments. No HTML is serialized or entity resolved.
    line_starts = [0] + [match.end() for match in re.finditer(b'\n', data)]

    class Declarations(HTMLParser):
        CDATA_CONTENT_ELEMENTS = HTMLParser.CDATA_CONTENT_ELEMENTS + (
            'textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes', 'plaintext')
        seen_doctype = False

        def handle_decl(self, declaration):
            if self.seen_doctype or ' '.join(declaration.split()).lower() != 'doctype html':
                raise ValueError('redaction_xml_DTD_or_external_entity_not_supported')
            self.seen_doctype = True

        def handle_comment(self, value):
            # HTMLParser reports unknown <!ENTITY ...> as a bogus comment;
            # real <!-- ... --> comments retain their literal public bytes.
            line, column = self.getpos()
            if HTML_ENTITY_DECLARATION.match(data, line_starts[line - 1] + column):
                raise ValueError('redaction_xml_DTD_or_external_entity_not_supported')

    parser = Declarations(convert_charrefs=False)
    parser.feed(data.decode('latin-1'))
    parser.close()


def _scrub_xml(data):
    # Complete XML documents/self-contained records have qualified text spans.
    # Other logs retain the existing plaintext path. No parser state or partial
    # token is retained across bounded records, and XML is never serialized.
    admission = data[3:] if data.startswith(b'\xef\xbb\xbf') else data
    html = admission.lstrip(b' \t\r\n\f')
    if HTML_DOCTYPE_START.match(html):
        # A bare HTML5 doctype plus a complete actual HTML opening tag is
        # the existing HTML/embedded-ZIP report format, not XML with a DTD.
        # Never exempt subsets, external identifiers or other root names.
        if HTML5_WRAPPER.match(html):
            _validate_html5_declarations(html)
            return None
        raise ValueError('redaction_xml_DTD_or_external_entity_not_supported')
    if not admission.lstrip().startswith(b'<'):
        return None
    try:
        spans = _xml_text_spans(data)
    except expat.ExpatError:
        return None
    output, cursor = [], 0
    for start, end, kind in spans:
        output.append(_scrub_xml_attributes(data[cursor:start]))
        output.append(scrub(data[start:end], _xml_text=kind))
        cursor = end
    output.append(_scrub_xml_attributes(data[cursor:]))
    result = b''.join(output)
    try:
        _xml_text_spans(result)
    except expat.ExpatError:
        raise ValueError('redaction_xml_structure_changed') from None
    return result


def _table_end(cells):
    # A trailing blank/ANSI cell is outside the terminal table frame.
    if not _plain(cells[-1]):
        return len(cells) - 1
    return len(cells)


def _table_border(line):
    try:
        text = ANSI_CSI_BYTES.sub(b'', line).decode('utf-8').strip()
    except UnicodeDecodeError:
        return False
    return bool(text) and all(char in TABLE_BORDER_CHARS for char in text)


def scrub_credential_lines(data, state=None, _xml_text=False):
    """Sanitize finite named/plain, JSON-record and terminal-table formats.

    Supports underscore-prefixed credential families; quoted or delimiter-
    terminated key/value logs; ASCII/light/heavy tables, wrapped values and
    one horizontal header/data row. Unquoted comma/semicolon free text is
    deliberately not reinterpreted as an unlimited credential value.
    """
    state = {} if state is None else state
    if not state and _json_record(data):
        return _scrub_named_values(data, xml_entities=True) if _xml_text == 'entities' else data
    if not _xml_text:
        xml = _scrub_xml(data)
        if xml is not None:
            return xml
    output = []
    for line in data.splitlines(keepends=True):
        if state.pop('next_value', False):
            if line.strip():
                output.append(_redacted_cell(line).lstrip())
                continue
            state['next_value'] = True
        if _json_record(line):
            state.pop('table_value', None)
            state.pop('table_header', None)
            output.append(_scrub_named_values(line, xml_entities=True) if _xml_text == 'entities' else line)
            continue
        plain = ANSI_CSI_BYTES.sub(b'', line)
        separator = next((value for value in TABLE_SEPARATORS if value in plain), None)
        if separator is None:
            if _table_border(line):
                output.append(line)
                continue
            state.pop('table_value', None)
            state.pop('table_header', None)
            if _plain(line).rstrip(b':') in TABLE_LABELS:
                state['next_value'] = True
            output.append(_scrub_named_values(line, xml_entities=_xml_text == 'entities'))
            continue
        cells = line.split(separator)
        end = _table_end(cells)
        headers = [index for index in range(end) if _plain(cells[index]) in TABLE_LABELS]
        pending = state.pop('table_header', None)
        if len(headers) >= 2:
            state.pop('table_value', None)
            state['table_header'] = (separator, len(cells), headers)
        elif pending and pending[0] == separator and pending[1] == len(cells) and not _table_border(line):
            for index in pending[2]:
                if index < end and _plain(cells[index]):
                    cells[index] = _redacted_cell(cells[index])
            state.pop('table_value', None)
        elif _table_border(line):
            if pending:
                state['table_header'] = pending
        else:
            label = 0 if _plain(cells[0]) in TABLE_LABELS else 1
            if label < end and _plain(cells[label]) in TABLE_LABELS and end > label + 1:
                state['table_value'] = True
                for index in range(label + 1, min(end, label + 2) if _xml_text else end):
                    if _plain(cells[index]):
                        cells[index] = _redacted_cell(cells[index])
            elif state.get('table_value') and label < end and not _plain(cells[label]) and any(_plain(cell) for cell in cells[label + 1:end]):
                for index in range(label + 1, min(end, label + 2) if _xml_text else end):
                    if _plain(cells[index]):
                        cells[index] = _redacted_cell(cells[index])
            else:
                state.pop('table_value', None)
        output.append(_scrub_named_values(separator.join(cells), xml_entities=_xml_text == 'entities'))
    return b''.join(output)


def scrub(data, secrets=(), state=None, _xml_text=False):
    if data.startswith(b'PK\x03\x04'):
        result = io.BytesIO()
        with zipfile.ZipFile(io.BytesIO(data)) as source, zipfile.ZipFile(result, 'w') as target:
            for item in source.infolist():
                target.writestr(item, scrub(source.read(item), secrets))
        return result.getvalue()
    original = data
    for secret in secrets:
        data = data.replace(secret, REDACTED.encode())
    data = scrub_jwts(data)
    data = OPAQUE_API_KEY.sub(REDACTED.encode(), data)
    data = EMBEDDED_ZIP.sub(lambda m: b'data:application/zip;base64,' + base64.b64encode(scrub(base64.b64decode(m[1]), secrets)), data)
    data = scrub_credential_lines(data, state, _xml_text=_xml_text)
    try:
        text = data.decode('utf-8')
    except UnicodeDecodeError:
        # Byte-level table/plaintext redaction has already run. Sanitize each
        # complete UTF-8 JSON record independently; keep other binary bytes.
        return b''.join(scrub(line, secrets) if _json_record(line) else line
                        for line in data.splitlines(keepends=True))

    def load(text):
        duplicate = False

        def pairs(items):
            nonlocal duplicate
            result = {}
            for key, item in items:
                if key in result:
                    duplicate = True
                result[key] = item
            # A later duplicate name must not hide an earlier auth header.
            if (len(result) != len(items) and 'value' in result
                    and any(key == 'name' and sensitive_name(item) for key, item in items)):
                result['value'] = REDACTED
            return result

        return json.loads(text, object_pairs_hook=pairs), duplicate

    def value(item):
        if isinstance(item, list):
            return [value(x) for x in item]
        if isinstance(item, dict):
            if sensitive_name(item.get('name', '')) and 'value' in item:
                item = {**item, 'value': REDACTED}
            return {key: REDACTED if sensitive_name(key) else value(x) for key, x in item.items()}
        # Encoded JSON scalar strings can themselves contain credential logs.
        # Successful decoding removes one encoding layer; unchanged values keep
        # their original formatting, including numeric/boolean/null strings.
        if isinstance(item, str):
            try:
                parsed, duplicate = load(item)
                cleaned = value(parsed)
                # Preserve formatted nested JSON only when no key was hidden
                # and scrubbing made no change to the decoded value.
                return json.dumps(cleaned, separators=(',', ':')) if duplicate or cleaned != parsed else item
            except json.JSONDecodeError:
                pass
        if isinstance(item, str):
            return scrub_credential_lines(item.encode('utf-8', errors='surrogatepass'), _xml_text=_xml_text).decode('utf-8', errors='surrogatepass')
        return item

    def record(text):
        parsed, duplicate = load(text)
        cleaned = value(parsed)
        # Decoded equality alone cannot authorize a no-op for duplicate keys:
        # an earlier credential may have been shadowed by the last value.
        if duplicate or cleaned != parsed or data != original:
            return json.dumps(cleaned, separators=(',', ':')) + '\n'
        return text

    # JSON scalars in SQL and secret-free JSON/NDJSON keep their original
    # whitespace, line endings and final-newline state.
    try:
        return record(text).encode()
    except json.JSONDecodeError:
        lines = []
        for line in text.splitlines(keepends=True):
            try:
                lines.append(record(line))
            except json.JSONDecodeError:
                lines.append(line)
        return ''.join(lines).encode()


def redact_line_records(path, secrets=(), max_line_bytes=8 * 1024 * 1024):
    """Atomically scrub explicit plaintext log/XML records with bounded memory.

    Whole JSON documents and ZIPs continue to use scrub(). JWTs cannot cross a
    newline; known local credentials that can cross one refuse this format.
    Oversized records fail closed without replacing the original evidence.
    """
    if max_line_bytes < 1:
        raise ValueError('redaction_record_invalid_memory_bound')
    if any(b'\n' in secret or b'\r' in secret for secret in secrets):
        raise ValueError('redaction_record_secret_spans_records')
    path = Path(path)
    temporary = None
    changed = False
    # Table and next-line label state spans records, never files.
    state = {}
    try:
        with path.open('rb') as source, tempfile.NamedTemporaryFile(
                mode='wb', dir=path.parent, prefix=path.name + '.redacting-',
                delete=False) as target:
            temporary = Path(target.name)
            os.fchmod(target.fileno(), path.stat().st_mode & 0o777)
            while True:
                record = source.readline(max_line_bytes + 1)
                if not record:
                    break
                if len(record) > max_line_bytes:
                    raise ValueError('redaction_record_exceeds_memory_bound')
                result = scrub(record, secrets, state)
                changed = changed or result != record
                target.write(result)
        if changed:
            temporary.replace(path)
        return changed
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', action='append', required=True)
    parser.add_argument('--local-secrets')
    parser.add_argument('--line-records', action='append', default=[],
                        help='Explicit plaintext log/XML file; atomic bounded record processing, not whole JSON/ZIP')
    args = parser.parse_args()
    secrets = []
    if args.local_secrets and Path(args.local_secrets).is_file():
        local = json.loads(Path(args.local_secrets).read_text())
        if local.get('API_URL') != 'http://127.0.0.1:54321':
            raise ValueError('redaction_disposable_local_credentials_required')
        secrets = [str(x).encode() for key, x in local.items() if sensitive_name(key) and isinstance(x, str) and len(x) >= 8]
    line_records = {Path(name).resolve() for name in args.line_records}
    files = []
    for path in map(Path, args.root):
        for file in sorted(path.rglob('*')) if path.is_dir() else [path]:
            if file.is_file():
                files.append(file)
    if line_records - {file.resolve() for file in files}:
        raise ValueError('redaction_record_file_outside_evidence')
    count = 0
    for file in files:
        if file.resolve() in line_records:
            count += int(redact_line_records(file, secrets))
        else:
            data = file.read_bytes()
            result = scrub(data, secrets)
            if result != data:
                file.write_bytes(result)
                count += 1
    print(f'NATIVE_EVIDENCE: credential redaction completed; changed files={count}; no credential values logged')


if __name__ == '__main__':
    main()
