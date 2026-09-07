#!/usr/bin/env python3
import argparse
import json
import os
import sqlite3
import tempfile
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--database', required=True)
args = parser.parse_args()
entries = json.load(__import__('sys').stdin)
db = Path(args.database)
db.parent.mkdir(parents=True, exist_ok=True)
fd, name = tempfile.mkstemp(prefix='cache-', suffix='.sqlite', dir=db.parent)
os.close(fd)
tmp = Path(name)
try:
    conn = sqlite3.connect(tmp)
    conn.execute('''CREATE TABLE cache_entries (cache_path TEXT PRIMARY KEY, source_model TEXT, source_parameters TEXT, software_version TEXT, size INTEGER, last_used_at TEXT, rebuildable INTEGER, locked INTEGER, referenced_by TEXT, retention_level TEXT, sha256 TEXT)''')
    for item in entries:
        conn.execute('INSERT INTO cache_entries VALUES(?,?,?,?,?,?,?,?,?,?,?)', (item.get('cache_path'), item.get('source_model'), item.get('source_parameters'), item.get('software_version'), item.get('size'), item.get('last_used_at'), 1 if item.get('rebuildable') else 0, 1 if item.get('locked') else 0, json.dumps(item.get('referenced_by', [])), item.get('retention_level'), item.get('sha256')))
    conn.commit()
    conn.close()
    os.replace(tmp, db)
finally:
    if tmp.exists():
        tmp.unlink()
print(json.dumps({'database': str(db), 'entries': len(entries)}, ensure_ascii=False, indent=2))
