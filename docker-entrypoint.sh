#!/bin/sh
# Persist the SQLite job DB on a mounted volume without changing the Prisma
# schema (keeps the on-server, non-Docker setup untouched): symlink the DB
# path both Prisma (file:../curation.db) and the Python pipeline use onto
# /data/db, then create/upgrade the schema there before starting.
set -e

DB_DIR="${CURATION_DB_DIR:-/data/db}"
mkdir -p "$DB_DIR"
ln -sf "$DB_DIR/curation.db" /app/curation/ui/curation.db

cd /app/curation/ui
# idempotent: creates the schema on the (possibly empty) volume
npm run update_db
exec npm run start
