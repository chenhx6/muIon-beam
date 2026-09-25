"""Build the local reference catalog and PDF text library.

Uses the bundled Python runtime with pypdf. Original reference files are never
modified; extracted text and metadata are derived views under 08_references.
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

try:
    from pypdf import PdfReader
except Exception as exc:  # pragma: no cover
    print(f"pypdf is required: {exc}", file=sys.stderr)
    raise SystemExit(2)

ROOT = Path(sys.argv[1] if len(sys.argv) > 1 else Path.cwd()).resolve()
REFS = ROOT / "08_references"
CATALOG = REFS / "catalog"
TEXT = REFS / "library" / "text"
CATALOG.mkdir(parents=True, exist_ok=True)
TEXT.mkdir(parents=True, exist_ok=True)

def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()

def safe_stem(path: Path) -> str:
    return re.sub(r"[^a-z0-9_]+", "_", path.stem.lower()).strip("_") or "reference"

records = []
for source in sorted(REFS.rglob("*")):
    if not source.is_file() or "library" in source.parts or "catalog" in source.parts:
        continue
    rel = source.relative_to(ROOT).as_posix()
    digest = sha256(source)
    record = {
        "reference_id": f"ref_{digest[:12]}",
        "source_kind": source.suffix.lower().lstrip(".") or "file",
        "original_path": rel,
        "original_filename": source.name,
        "sha256": digest,
        "bytes": source.stat().st_size,
        "retrieved_at_cst": None,
        "source_url": None,
        "title": source.stem,
        "authors": [],
        "year": None,
        "language": "unknown",
        "topics": [],
        "text_path": None,
        "page_count": None,
        "extraction_status": "not_applicable",
    }
    if source.suffix.lower() == ".pdf":
        text_path = TEXT / f"{record['reference_id']}_{safe_stem(source)}.txt"
        try:
            reader = PdfReader(str(source))
            pages = []
            for index, page in enumerate(reader.pages, 1):
                content = page.extract_text() or ""
                pages.append(f"\n\n--- page {index} ---\n\n{content}")
            text_path.write_text("".join(pages), encoding="utf-8")
            record.update({
                "text_path": text_path.relative_to(ROOT).as_posix(),
                "page_count": len(reader.pages),
                "extraction_status": "complete",
            })
        except Exception as exc:
            record["extraction_status"] = f"failed: {type(exc).__name__}: {exc}"
    records.append(record)

records.sort(key=lambda item: item["original_path"])
output = {
    "schema_version": 1,
    "generated_at_utc": datetime.now(timezone.utc).isoformat(),
    "timezone_for_display": "Asia/Shanghai",
    "root": "08_references",
    "count": len(records),
    "records": records,
}
(CATALOG / "reference_index.json").write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
(CATALOG / "reference_index.md").write_text(
    "# Reference Index\n\n" + "\n".join(
        f"- `{item['reference_id']}` — [{item['original_path']}]({item['original_path']}) — {item['extraction_status']}"
        for item in records
    ) + "\n",
    encoding="utf-8",
)
print(json.dumps({"count": len(records), "catalog": "08_references/catalog/reference_index.json"}, ensure_ascii=False, indent=2))
