#!/usr/bin/env python3
"""Build the rebuildable muIon-beam SQLite index from parsed Manifest JSON."""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import tempfile
from pathlib import Path


def text(value):
    if value is None:
        return None
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, sort_keys=True)
    return str(value)


def bool_int(value):
    if value is None:
        return None
    return 1 if bool(value) else 0


def add_manifest(conn, item):
    doc = item.get("doc", {})
    source_path = item.get("source_path", "")
    manifest_id = doc.get("manifest_id") or doc.get("migration_id") or doc.get("publication_id") or doc.get("sync_id")
    if not manifest_id:
        return None
    manifest_type = doc.get("manifest_type") or ("migration" if doc.get("migration_id") else "unknown")
    conn.execute(
        """INSERT INTO manifests(manifest_id, manifest_type, schema_version, source_path, content_sha256, status, created_at, updated_at)
           VALUES(?,?,?,?,?,?,?,?)
           ON CONFLICT(manifest_id) DO UPDATE SET manifest_type=excluded.manifest_type,
             schema_version=excluded.schema_version, source_path=excluded.source_path,
             content_sha256=excluded.content_sha256, status=excluded.status,
             created_at=excluded.created_at, updated_at=excluded.updated_at""",
        (text(manifest_id), text(manifest_type), text(doc.get("schema_version")), source_path,
         item.get("content_sha256"), text(doc.get("status")), text(doc.get("created_at")), text(doc.get("updated_at")))
    )
    return str(manifest_id)


def build(db_path: Path, schema_path: Path, items: list[dict]) -> dict:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    temp_fd, temp_name = tempfile.mkstemp(prefix="index-", suffix=".sqlite", dir=db_path.parent)
    os.close(temp_fd)
    temp_path = Path(temp_name)
    try:
        conn = sqlite3.connect(temp_path)
        conn.execute("PRAGMA foreign_keys = ON")
        conn.executescript(schema_path.read_text(encoding="utf-8"))
        counts = {"manifests": 0, "tasks": 0, "models": 0, "runs": 0, "artifacts": 0, "relations": 0, "archives": 0, "reports": 0, "figures": 0, "behavior_analyses": 0, "sync_states": 0}
        for item in items:
            doc = item.get("doc", {})
            manifest_id = add_manifest(conn, item)
            if not manifest_id:
                continue
            counts["manifests"] += 1
            task_id = doc.get("task_id")
            if task_id:
                conn.execute("""INSERT INTO tasks(task_id, task_name, source_type, is_upper_task, objective_zh, status, source_manifest_id)
                    VALUES(?,?,?,?,?,?,?) ON CONFLICT(task_id) DO UPDATE SET task_name=excluded.task_name,
                    source_type=excluded.source_type, is_upper_task=excluded.is_upper_task,
                    objective_zh=excluded.objective_zh, status=excluded.status, source_manifest_id=excluded.source_manifest_id""",
                    (text(task_id), text(doc.get("task_name")), text(doc.get("source_type")), bool_int(doc.get("is_upper_task")), text(doc.get("objective_zh")), text(doc.get("status")), manifest_id))
                counts["tasks"] += 1
            for model in doc.get("model_references", []) or []:
                model_id = model.get("model_id") if isinstance(model, dict) else str(model)
                conn.execute("INSERT OR IGNORE INTO models(model_id, model_name, model_type, revision, source_path, source_manifest_id) VALUES(?,?,?,?,?,?)", (model_id, text(model.get("model_name")) if isinstance(model, dict) else model_id, text(model.get("model_type")) if isinstance(model, dict) else None, text(model.get("revision")) if isinstance(model, dict) else None, text(model.get("path")) if isinstance(model, dict) else None, manifest_id))
                conn.execute("INSERT OR IGNORE INTO relations(source_type, source_id, relation_type, target_type, target_id) VALUES(?,?,?,?,?)", ("run" if doc.get("run_id") else "manifest", text(doc.get("run_id") or manifest_id), "uses-model", "model", text(model_id)))
                counts["models"] += 1
                counts["relations"] += 1
            run_id = doc.get("run_id")
            if run_id:
                drive = doc.get("drive") or {}
                git = doc.get("git") or {}
                conn.execute("""INSERT INTO runs(run_id, task_id, run_kind, status, maturity_level, retention_level, parent_result_tag, gitee_commit, gitee_tag, drive_path, source_manifest_id)
                    VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(run_id) DO UPDATE SET task_id=excluded.task_id,
                    run_kind=excluded.run_kind, status=excluded.status, maturity_level=excluded.maturity_level,
                    retention_level=excluded.retention_level, parent_result_tag=excluded.parent_result_tag,
                    gitee_commit=excluded.gitee_commit, gitee_tag=excluded.gitee_tag, drive_path=excluded.drive_path,
                    source_manifest_id=excluded.source_manifest_id""",
                    (text(run_id), text(task_id), text(doc.get("run_kind")), text(doc.get("status")), text(doc.get("maturity_level")), text(doc.get("retention_level")), text(doc.get("parent_result_tag")), text(git.get("commit")), text(git.get("tag")), text(drive.get("archive_path")), manifest_id))
                counts["runs"] += 1
                for region in doc.get("physical_regions", []) or []:
                    conn.execute("INSERT OR IGNORE INTO relations(source_type, source_id, relation_type, target_type, target_id) VALUES(?,?,?,?,?)", ("run", text(run_id), "covers-region", "physical-region", text(region)))
                    counts["relations"] += 1
                for artifact in doc.get("files", []) or []:
                    if not isinstance(artifact, dict) or not artifact.get("path"):
                        continue
                    conn.execute("""INSERT INTO artifacts(run_id, artifact_path, role, size, sha256, retention_level, local_status, drive_status, gitee_status)
                        VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(run_id, artifact_path) DO UPDATE SET role=excluded.role,
                        size=excluded.size, sha256=excluded.sha256, retention_level=excluded.retention_level,
                        local_status=excluded.local_status, drive_status=excluded.drive_status, gitee_status=excluded.gitee_status""",
                        (text(run_id), text(artifact.get("path")), text(artifact.get("role")), artifact.get("size"), text(artifact.get("sha256")), text(artifact.get("retention_level")), text(artifact.get("local_status")), text(artifact.get("drive_status")), text(artifact.get("gitee_status"))))
                    counts["artifacts"] += 1
                reports = doc.get("reports") or {}
                if isinstance(reports, dict):
                    for report_type, report_path in reports.items():
                        if report_path:
                            conn.execute("INSERT OR REPLACE INTO reports(report_id, run_id, report_type, path, sha256) VALUES(?,?,?,?,?)", (f"{run_id}:{report_type}", text(run_id), report_type, text(report_path), None))
                            counts["reports"] += 1
            if doc.get("archive_id"):
                drive = doc.get("drive") or {}
                conn.execute("INSERT OR REPLACE INTO archives(archive_id, run_id, drive_path, manifest_sha256, status, verified_at) VALUES(?,?,?,?,?,?)", (text(doc.get("archive_id")), text(run_id), text(doc.get("drive_path") or drive.get("archive_path")), text(doc.get("manifest_sha256")), text(doc.get("status")), text(doc.get("verified_at"))))
                counts["archives"] += 1
            if doc.get("sync_id"):
                conn.execute("INSERT OR REPLACE INTO sync_states(sync_id, task_id, run_id, local_commit, gitee_remote_commit, gitee_tag, drive_path, manifest_sha256, status, verified_at) VALUES(?,?,?,?,?,?,?,?,?,?)", (text(doc.get("sync_id")), text(task_id), text(run_id), text(doc.get("local_commit")), text(doc.get("gitee_remote_commit")), text(doc.get("gitee_tag")), text(doc.get("drive_path")), text(doc.get("manifest_sha256")), text(doc.get("status")), text(doc.get("verified_at"))))
                counts["sync_states"] += 1
            for figure in doc.get("figures", []) or []:
                if isinstance(figure, dict) and figure.get("figure_id"):
                    conn.execute("INSERT OR REPLACE INTO figures(figure_id, run_id, figure_type, path, analysis_id, sha256, retention_level) VALUES(?,?,?,?,?,?,?)", (text(figure.get("figure_id")), text(figure.get("run_id") or run_id), text(figure.get("figure_type")), text(figure.get("path")), text(figure.get("analysis_id")), text(figure.get("sha256")), text(figure.get("retention_level"))))
                    counts["figures"] += 1
            for analysis in doc.get("analyses", []) or []:
                if isinstance(analysis, dict) and analysis.get("analysis_id"):
                    conn.execute("INSERT OR REPLACE INTO behavior_analyses(analysis_id, run_id, question_zh, analysis_type, confidence) VALUES(?,?,?,?,?)", (text(analysis.get("analysis_id")), text(analysis.get("run_id") or run_id), text(analysis.get("question_zh")), text(analysis.get("analysis_type")), text(analysis.get("confidence"))))
                    counts["behavior_analyses"] += 1
        conn.commit()
        conn.close()
        os.replace(temp_path, db_path)
        return counts
    finally:
        if temp_path.exists():
            temp_path.unlink()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--database", required=True)
    parser.add_argument("--schema", required=True)
    parser.add_argument("--input-file", required=False)
    args = parser.parse_args()
    if args.input_file:
        items = json.loads(Path(args.input_file).read_text(encoding="utf-8"))
    else:
        items = json.load(__import__("sys").stdin)
    counts = build(Path(args.database), Path(args.schema), items)
    print(json.dumps({"database": args.database, "counts": counts}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
