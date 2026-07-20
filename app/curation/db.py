"""SQLite persistence shared between the Python pipeline and the Next.js UI.

The DB doubles as the job queue (same pattern as ai-toolkit): the UI's API
routes insert/patch Job rows, a cron worker spawns this pipeline, and the
pipeline writes progress + per-image results back here. The UI polls.

Schema is created here with CREATE TABLE IF NOT EXISTS so the CLI works with no
UI present; the column set is kept identical to prisma/schema.prisma (all
timestamps stored as TEXT, booleans as 0/1) so Prisma `db push` is a no-op on
an already-created DB.
"""
from __future__ import annotations

import json
import os
import sqlite3
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

SCHEMA = """
CREATE TABLE IF NOT EXISTS Job (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE,
  source_folder TEXT NOT NULL,
  gpu_ids TEXT NOT NULL DEFAULT '0',
  params TEXT NOT NULL DEFAULT '{}',
  mode TEXT NOT NULL DEFAULT 'auto',
  status TEXT NOT NULL DEFAULT 'queued',
  step INTEGER NOT NULL DEFAULT 0,
  total_steps INTEGER NOT NULL DEFAULT 0,
  info TEXT NOT NULL DEFAULT '',
  verdict TEXT,
  report_dir TEXT,
  dry_run INTEGER NOT NULL DEFAULT 0,
  recaption INTEGER NOT NULL DEFAULT 0,
  do_delete INTEGER NOT NULL DEFAULT 0,
  target INTEGER,
  stop INTEGER NOT NULL DEFAULT 0,
  pid INTEGER,
  created_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_job_status ON Job(status);

CREATE TABLE IF NOT EXISTS ImageResult (
  id TEXT PRIMARY KEY,
  job_ref TEXT NOT NULL,
  path TEXT NOT NULL,
  filename TEXT NOT NULL,
  thumb_path TEXT,
  width INTEGER NOT NULL DEFAULT 0,
  height INTEGER NOT NULL DEFAULT 0,
  quality_score REAL NOT NULL DEFAULT 0,
  quality_verdict TEXT NOT NULL DEFAULT 'pass',
  quality_reasons TEXT NOT NULL DEFAULT '[]',
  global_sharpness REAL NOT NULL DEFAULT 0,
  face_sharpness REAL NOT NULL DEFAULT 0,
  face_detected INTEGER NOT NULL DEFAULT 0,
  face_area_frac REAL NOT NULL DEFAULT 0,
  vl TEXT NOT NULL DEFAULT '{}',
  bucket TEXT NOT NULL DEFAULT '',
  uniqueness REAL NOT NULL DEFAULT 0,
  cluster_id INTEGER NOT NULL DEFAULT -1,
  is_duplicate INTEGER NOT NULL DEFAULT 0,
  auto_decision TEXT NOT NULL DEFAULT 'keep',
  auto_reason TEXT NOT NULL DEFAULT '',
  user_decision TEXT,
  applied INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_img_job ON ImageResult(job_ref);
"""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class CurationDB:
    def __init__(self, db_path: str):
        self.db_path = db_path
        os.makedirs(os.path.dirname(os.path.abspath(db_path)), exist_ok=True)
        self._ensure_schema()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, timeout=30.0)
        conn.isolation_level = None  # autocommit
        conn.execute("PRAGMA busy_timeout=30000;")
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.row_factory = sqlite3.Row
        return conn

    def _ensure_schema(self):
        with self._connect() as c:
            c.executescript(SCHEMA)

    def _retry(self, fn, tries: int = 4):
        last = None
        for i in range(tries):
            try:
                return fn()
            except sqlite3.OperationalError as e:
                if "locked" in str(e).lower():
                    last = e
                    time.sleep(0.5 * (2 ** i))
                    continue
                raise
        raise last  # type: ignore[misc]

    # -- Job ---------------------------------------------------------------
    def create_job(self, job: Dict[str, Any]) -> str:
        job.setdefault("created_at", _now())
        job["updated_at"] = _now()
        cols = ",".join(job.keys())
        ph = ",".join("?" for _ in job)
        vals = [json.dumps(v) if isinstance(v, (dict, list)) else v for v in job.values()]

        def op():
            with self._connect() as c:
                c.execute(f"INSERT INTO Job ({cols}) VALUES ({ph})", vals)
        self._retry(op)
        return job["id"]

    def get_job(self, job_id: str) -> Optional[Dict[str, Any]]:
        def op():
            with self._connect() as c:
                row = c.execute("SELECT * FROM Job WHERE id=?", (job_id,)).fetchone()
                return dict(row) if row else None
        return self._retry(op)

    def update_job(self, job_id: str, **fields):
        fields["updated_at"] = _now()
        sets = ",".join(f"{k}=?" for k in fields)
        vals = [json.dumps(v) if isinstance(v, (dict, list)) else v for v in fields.values()]
        vals.append(job_id)

        def op():
            with self._connect() as c:
                c.execute(f"UPDATE Job SET {sets} WHERE id=?", vals)
        self._retry(op)

    def should_stop(self, job_id: str) -> bool:
        def op():
            with self._connect() as c:
                row = c.execute("SELECT stop FROM Job WHERE id=?", (job_id,)).fetchone()
                return bool(row and row["stop"])
        return self._retry(op)

    def set_progress(self, job_id: str, step: int, total: int, info: str = ""):
        self.update_job(job_id, step=step, total_steps=total, info=info)

    # -- ImageResult -------------------------------------------------------
    def clear_images(self, job_id: str):
        def op():
            with self._connect() as c:
                c.execute("DELETE FROM ImageResult WHERE job_ref=?", (job_id,))
        self._retry(op)

    def upsert_image(self, rec: Dict[str, Any]):
        r = dict(rec)
        for k in ("quality_reasons", "vl"):
            if k in r and isinstance(r[k], (dict, list)):
                r[k] = json.dumps(r[k], ensure_ascii=False)
        cols = ",".join(r.keys())
        ph = ",".join("?" for _ in r)
        updates = ",".join(f"{k}=excluded.{k}" for k in r if k != "id")

        def op():
            with self._connect() as c:
                c.execute(
                    f"INSERT INTO ImageResult ({cols}) VALUES ({ph}) "
                    f"ON CONFLICT(id) DO UPDATE SET {updates}",
                    list(r.values()),
                )
        self._retry(op)

    def get_images(self, job_id: str) -> List[Dict[str, Any]]:
        def op():
            with self._connect() as c:
                rows = c.execute(
                    "SELECT * FROM ImageResult WHERE job_ref=? ORDER BY filename", (job_id,)
                ).fetchall()
                out = []
                for row in rows:
                    d = dict(row)
                    for k in ("quality_reasons", "vl"):
                        try:
                            d[k] = json.loads(d[k])
                        except (TypeError, json.JSONDecodeError):
                            d[k] = {} if k == "vl" else []
                    out.append(d)
                return out
        return self._retry(op)

    def final_decision(self, rec: Dict[str, Any]) -> str:
        """user_decision overrides auto_decision when present."""
        ud = rec.get("user_decision")
        if ud in ("keep", "reject"):
            return ud
        return rec.get("auto_decision", "keep")

    def mark_applied(self, image_id: str):
        def op():
            with self._connect() as c:
                c.execute("UPDATE ImageResult SET applied=1 WHERE id=?", (image_id,))
        self._retry(op)
