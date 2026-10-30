#!/usr/bin/env python3
"""Sätter portar och project_id i KOPIAN av supabase/config.toml (CLI 2.101.0 accepterar repots config oförändrad).

Inget i RUN_DIR ändras; endast kopian under SIM_HOME.
Användning: prepare-supabase.py <config.toml> <project_id> api db shadow pooler studio mail smtp
"""
import pathlib, re, sys

path = pathlib.Path(sys.argv[1])
project_id = sys.argv[2]
api, db, shadow, pooler, studio, mail, smtp = sys.argv[3:10]
t = path.read_text()

t = re.sub(r'^project_id\s*=.*$', f'project_id = "{project_id}"', t, count=1, flags=re.M)

def set_in_table(text, table, key, value, uncomment=False):
    m = re.search(r'^\[' + re.escape(table) + r'\]\n((?:(?!\[).*\n?)*)', text, flags=re.M)
    if not m:
        raise SystemExit(f'tabell saknas: [{table}]')
    body = m.group(1)
    pat = (r'^#?\s*' if uncomment else r'^') + re.escape(key) + r'\s*=.*$'
    if re.search(pat, body, flags=re.M):
        nb = re.sub(pat, f'{key} = {value}', body, count=1, flags=re.M)
    else:
        nb = body.rstrip('\n') + f'\n{key} = {value}\n'
    return text[:m.start(1)] + nb + text[m.end(1):]

t = set_in_table(t, 'api', 'port', api)
t = set_in_table(t, 'db', 'port', db)
t = set_in_table(t, 'db', 'shadow_port', shadow)
t = set_in_table(t, 'db.pooler', 'port', pooler)
t = set_in_table(t, 'studio', 'port', studio)
t = set_in_table(t, 'inbucket', 'port', mail)
t = set_in_table(t, 'inbucket', 'smtp_port', smtp, uncomment=True)
# Spår 5 (AUTH01.05): kort, verklig sessionslivslängd i realtid så att en session faktiskt kan löpa ut.
# Bara i kopian; ingen klockmanipulation. Tom variabel = repots värde.
import os
jwt_expiry = os.environ.get('SIM_AUTH_JWT_EXPIRY', '').strip()
timebox = os.environ.get('SIM_AUTH_SESSION_TIMEBOX', '').strip()
if jwt_expiry:
    if not jwt_expiry.isdigit():
        raise SystemExit('SIM_AUTH_JWT_EXPIRY måste vara sekunder')
    t = set_in_table(t, 'auth', 'jwt_expiry', jwt_expiry)
if timebox:
    if not re.fullmatch(r'\d+[smh]', timebox):
        raise SystemExit('SIM_AUTH_SESSION_TIMEBOX måste vara t.ex. 3m')
    t = re.sub(r'^#\s*\[auth\.sessions\]\s*$', '[auth.sessions]', t, count=1, flags=re.M)
    t = set_in_table(t, 'auth.sessions', 'timebox', f'"{timebox}"', uncomment=True)
path.write_text(t)
