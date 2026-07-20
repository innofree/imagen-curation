#!/bin/sh
# Persist the SQLite job DB on a mounted volume without changing the Prisma
# schema (keeps the on-server, non-Docker setup untouched): symlink the DB
# path both Prisma (file:../curation.db) and the Python pipeline use onto
# /data/db, then create/upgrade the schema there before starting.
set -e

DATASETS="${DATASETS_DIR:-/data/datasets}"
HF="${HF_HOME:-/data/hf}"

# Preflight: the two essential binds are easy to get wrong on a fragmented host
# (typo'd path, forgotten .env). Docker silently creates missing bind sources as
# empty root-owned dirs, after which the UI just shows "no datasets" with no clue
# why. Surface the resolved paths and warn loudly instead.
echo "[curation] datasets dir : $DATASETS"
echo "[curation] HF cache dir : $HF"
if [ ! -d "$DATASETS" ] || [ -z "$(ls -A "$DATASETS" 2>/dev/null)" ]; then
    echo "[curation] WARNING: datasets dir is missing or empty. Set DATASETS_DIR in .env"
    echo "[curation]          to the SAME folder ai-toolkit trains from (mounted at $DATASETS)."
fi
if [ ! -d "$HF" ]; then
    echo "[curation] WARNING: HF cache dir missing — the VL model (~16GB) will download on first job."
elif [ -z "$(ls -A "$HF" 2>/dev/null)" ]; then
    echo "[curation] NOTE: HF cache is empty — the VL model (~16GB) downloads on the first job."
fi

DB_DIR="${CURATION_DB_DIR:-/data/db}"
mkdir -p "$DB_DIR"
ln -sf "$DB_DIR/curation.db" /app/curation/ui/curation.db

cd /app/curation/ui
# idempotent: creates the schema on the (possibly empty) volume
npm run update_db
exec npm run start
