#!/usr/bin/env python3
"""Compile directory facts from unchanged, hash-pinned UN/EDIFACT archives.

No national table or third-party generated mapping is grammar authority.
Unknown/changed source formats fail compilation rather than guessing a rule.
"""
import hashlib
import io
import json
import re
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'quality/sources/ediel-unsm-original'
OUTPUT = ROOT / 'lib/ediel/core/unsmGrammar.generated.json'
CONFIG = [
    ('97A', 'PRODAT', '4a8fbe74935a140b0982f9b555571831e7b9d90311acdbf195ae481e2fe705a8'),
    ('02B', 'UTILTS', '5eee0d255d03ee972be0adbcdc47c4ab5dd1e3160b90a48d5078972198ee8393'),
    ('96A', 'APERAK', '1f94c7663a48bbc99d48e93bab16ed2ee127fda73682e6f4c80363256cbcdcd2'),
    ('04A', 'APERAK', '7a907cf82f9de32a913e8c8500398fdd6d965536c17389adcb5a40d4b7bcba28'),
]


def directory(archive, suffix):
    matches = [name for name in archive.namelist() if name.upper().endswith(suffix)]
    assert len(matches) == 1, (suffix, matches)
    return matches[0], archive.read(matches[0])


def nested(archive, suffix):
    name, raw = directory(archive, suffix)
    return name, zipfile.ZipFile(io.BytesIO(raw))


def layout(raw):
    """Only directory row positions are fields; inline prose is never a rule."""
    text = raw.decode('cp437')
    blocks = re.split(r'(?m)^[-─]{40,}[ \t\r]*$', text)
    result = {}
    for block in blocks:
        header = re.search(r'(?m)^[ \t]{2,}[+*#|X -]?[ \t]*([A-Z]{3}|C\d{3})[ \t]+[A-Z]', block)
        if not header:
            continue
        rows = list(re.finditer(r'(?m)^(\d{3})[ \t]+[+*#|X -]?[ \t]*([CS]\d{3}|\d{4})[ \t]+', block))
        assert len(rows) == len(re.findall(r'(?m)^\d{3}[ \t]+', block)), header[1]
        assert [int(row[1]) for row in rows] == list(range(10, 10 * (len(rows) + 1), 10)), header[1]
        fields = []
        for index, row in enumerate(rows):
            # Wrapped labels have their M/C and representation on the next line.
            # Inline component rows have no 3-digit directory position.
            end = rows[index + 1].start() if index + 1 < len(rows) else len(block)
            row_text = block[row.end():end].splitlines()
            rule = None
            for line in row_text:
                # A segment's inline composite components are descriptive here;
                # their exact positions are separately read from EDCD/TRCD.
                if re.match(r'^\s+\d{4}\s+', line):
                    break
                found = re.search(r'\s([MC])(?:\s+(\d+))?(?:\s+((?:an|a|n)(?:\.\.)?\d+))?\s*$', line)
                if found:
                    rule = found
                    break
            assert rule is not None, (header[1], row[2], row_text)
            field = {'id': row[2], 'min': int(rule[1] == 'M')}
            field['max'] = int(rule[2] or '1')
            if rule[3]:
                field['representation'] = rule[3]
            else:
                assert row[2].startswith(('C', 'S')), (header[1], row[2], row_text)
            fields.append(field)
        if fields:
            assert header[1] not in result, header[1]
            result[header[1]] = fields
    assert result, 'empty layout directory'
    return result


def message_grammar(raw):
    text = raw.decode('cp437')
    # The contents list also names this heading. Only the actual numbered table
    # has two spaces after 4.3.1 and actual numeric rows following it.
    table = text.split('4.3.1  Segment table')[-1]
    nodes, stack = [], []
    for line in table.splitlines():
        row = re.match(r'^(\d{4})\s+.*?\s([MC])\s+(\d+)(.*)$', line)
        if not row:
            continue
        group = re.search(r'Segment group (\d+)', line)
        tag = re.match(r'^\d{4}\s+[+*#|X -]?\s*([A-Z]{3})\s', line)
        assert bool(group) != bool(tag), line
        suffix = row[4]
        depth = sum(char in '|+│┐┘┤┴└' for char in suffix)
        if group:
            # A group row's new corner is its own depth; following segments are
            # at the same depth, while the group belongs to its parent depth.
            assert depth > 0, line
            while stack and stack[-1][0] >= depth:
                stack.pop()
            assert len(stack) == depth - 1, line
            node = {'group': int(group[1]), 'position': row[1], 'min': int(row[2] == 'M'), 'max': int(row[3]), 'children': []}
            (stack[-1][1]['children'] if stack else nodes).append(node)
            stack.append((depth, node))
        else:
            while stack and stack[-1][0] > depth:
                stack.pop()
            assert len(stack) == depth, line
            node = {'tag': tag[1], 'position': row[1], 'min': int(row[2] == 'M'), 'max': int(row[3])}
            (stack[-1][1]['children'] if stack else nodes).append(node)
            if tag[1] == 'UNT':
                break
    assert nodes[0]['tag'] == 'UNH' and nodes[-1]['tag'] == 'UNT'
    def check(children):
        for child in children:
            if 'children' in child:
                assert child['children'][0].get('min') == 1 and child['children'][0].get('max') == 1
                check(child['children'])
    check(nodes)
    positions = []
    def positions_in(children):
        for child in children:
            positions.append(int(child['position']))
            if 'children' in child:
                positions_in(child['children'])
    positions_in(nodes)
    assert positions == list(range(10, positions[-1] + 1, 10)), positions
    return nodes


def main():
    grammars = []
    for edition, family, digest in CONFIG:
        raw = (SOURCE / ('d' + edition.lower() + '.zip')).read_bytes()
        assert hashlib.sha256(raw).hexdigest() == digest, edition
        archive = zipfile.ZipFile(io.BytesIO(raw))
        message_zip_name, messages = nested(archive, 'TRMD.ZIP' if edition == '96A' else 'EDMD.ZIP')
        message_name, message_bytes = directory(messages, family + '_D.' + edition)
        message_text = message_bytes.decode('cp437')
        assert re.search(r'Message type\s*:\s*' + family, message_text, re.IGNORECASE)
        assert re.search(r'Release\s*:\s*' + edition, message_text, re.IGNORECASE)
        segment_zip_name, segment_zip = nested(archive, 'TRSD.ZIP' if edition == '96A' else 'EDSD.ZIP')
        segment_name, segment_bytes = directory(segment_zip, ('TRSD' if edition == '96A' else 'EDSD') + '.' + edition)
        composite_zip_name, composite_zip = nested(archive, 'TRCD.ZIP' if edition == '96A' else 'EDCD.ZIP')
        composite_name, composite_bytes = directory(composite_zip, ('TRCD' if edition == '96A' else 'EDCD') + '.' + edition)
        structure, segments, composites = message_grammar(message_bytes), layout(segment_bytes), layout(composite_bytes)
        used = set()
        def tags(nodes):
            for node in nodes:
                if 'children' in node:
                    tags(node['children'])
                else:
                    used.add(node['tag'])
        tags(structure)
        # UNH/UNT service syntax is separately owned by the envelope validator;
        # a business directory must not be substituted for service syntax.
        used -= {'UNH', 'UNT'}
        assert used <= segments.keys(), used - segments.keys()
        selected_segments = {tag: segments[tag] for tag in sorted(used)}
        used_composites = {field['id'] for fields in selected_segments.values() for field in fields if field['id'].startswith('C')}
        assert used_composites <= composites.keys(), used_composites - composites.keys()
        grammars.append({'key': family + ':D:' + edition + ':UN', 'archiveSha256': digest,
                         'sources': [{'archiveMember': message_zip_name + '!' + message_name, 'sha256': hashlib.sha256(message_bytes).hexdigest()},
                                     {'archiveMember': segment_zip_name + '!' + segment_name, 'sha256': hashlib.sha256(segment_bytes).hexdigest()},
                                     {'archiveMember': composite_zip_name + '!' + composite_name, 'sha256': hashlib.sha256(composite_bytes).hexdigest()}],
                         'structure': structure, 'segments': selected_segments,
                         'composites': {tag: composites[tag] for tag in sorted(used_composites)}})
    syntax_archive = zipfile.ZipFile(SOURCE / 'd97a.zip')
    syntax_zip_name, syntax_zip = nested(syntax_archive, 'PART4_D.ZIP')
    syntax_name, syntax_bytes = directory(syntax_zip, 'D422_D.97A')
    syntax_text = syntax_bytes.decode('cp437')
    assert '8.2 Repetition of data elements' in syntax_text and 'Tag+...+DE1+DE1+++...' in syntax_text
    output = json.dumps({'version': 1, 'syntaxSources': [{'archiveSha256': CONFIG[0][2],
        'archiveMember': syntax_zip_name + '!' + syntax_name, 'sha256': hashlib.sha256(syntax_bytes).hexdigest(),
        'pointers': ['8.2 Repetition of data elements', '10. Representation of numeric data element values']}],
        'grammars': grammars}, ensure_ascii=True, indent=2) + '\n'
    if '--check' in sys.argv:
        assert OUTPUT.read_text() == output, 'generated grammar differs from exact original directory facts'
    else:
        OUTPUT.write_text(output)
    print('Verified 4 exact original UNSM grammars, complete segment-group structure and used field layouts')


if __name__ == '__main__':
    main()
