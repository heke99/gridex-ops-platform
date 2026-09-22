"""Explicit correction to the unadopted SQL template; no historical rewrite."""
import os,pathlib
p=pathlib.Path(os.environ['E035_INPUT_DIR'])/'object-disposition.sql'
s=p.read_text()
a="IS DISTINCT FROM CASE WHEN f->>'messageCode'='Z04' THEN '210' ELSE '216' END"
b="IS DISTINCT FROM (CASE WHEN f->>'messageCode'='Z04' THEN '210' ELSE '216' END)"
assert s.count(a)==1
p.write_text(s.replace(a,b))
