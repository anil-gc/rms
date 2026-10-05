"""Consistent PostgreSQL backups and safe restoration checks. Never overwrites a database."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import uuid

import psycopg
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict


def tool(name):
    directory = os.environ.get("PG_BIN")
    path = str(Path(directory) / (name + (".exe" if os.name == "nt" else ""))) if directory else shutil.which(name)
    if not path or not Path(path).exists():
        raise RuntimeError(f"Install PostgreSQL client tools or set PG_BIN; {name} is missing.")
    return path


def pg_environment(url, database=None):
    info = conninfo_to_dict(url)
    env = os.environ.copy()
    for key, variable in {"host": "PGHOST", "port": "PGPORT", "dbname": "PGDATABASE", "user": "PGUSER", "password": "PGPASSWORD", "sslmode": "PGSSLMODE"}.items():
        if key in info:
            env[variable] = info[key]
    if database:
        env["PGDATABASE"] = database
    return env


def table_fingerprints(connection):
    result = {}
    tables = connection.execute("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename").fetchall()
    for (name,) in tables:
        if not name.startswith(("restaurant_", "django_", "auth_")):
            continue
        fingerprint = hashlib.sha256()
        count = 0
        # Server-side cursor streams sorted rows, avoiding large aggregate strings.
        with connection.cursor(name=f"backup_{uuid.uuid4().hex}") as cursor:
            cursor.execute(sql.SQL("SELECT row_to_json(t)::text FROM {} t ORDER BY row_to_json(t)::text").format(sql.Identifier(name)))
            for (row,) in cursor:
                fingerprint.update(row.encode("utf-8")); fingerprint.update(b"\n"); count += 1
        result[name] = {"count": count, "sha256": fingerprint.hexdigest()}
    return result


def export_backup(url, destination):
    destination = Path(destination).resolve()
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        raise RuntimeError("Choose a new filename; existing backups are never overwritten.")
    with psycopg.connect(url) as source:
        source.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
        snapshot = source.execute("SELECT pg_export_snapshot()").fetchone()[0]
        fingerprints = table_fingerprints(source)
        subprocess.run([tool("pg_dump"), "--format=custom", "--no-owner", "--no-acl", f"--snapshot={snapshot}", "--file", str(destination)], env=pg_environment(url), check=True, capture_output=True)
    manifest = {"created_at": datetime.now(timezone.utc).isoformat(), "sha256": hashlib.sha256(destination.read_bytes()).hexdigest(), "tables": fingerprints}
    destination.with_suffix(destination.suffix + ".json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest


def verify_backup(url, source_file):
    source_file = Path(source_file).resolve()
    manifest = json.loads(source_file.with_suffix(source_file.suffix + ".json").read_text(encoding="utf-8"))
    if hashlib.sha256(source_file.read_bytes()).hexdigest() != manifest["sha256"]:
        raise RuntimeError("Backup checksum does not match its manifest.")
    scratch = f"restaurant_restore_{uuid.uuid4().hex}"
    info = conninfo_to_dict(url)
    with psycopg.connect(url, autocommit=True) as admin:
        admin.execute(sql.SQL("CREATE DATABASE {} TEMPLATE template0").format(sql.Identifier(scratch)))
        try:
            subprocess.run([tool("pg_restore"), "--no-owner", "--no-acl", "--exit-on-error", "--single-transaction", "--dbname", scratch, str(source_file)], env=pg_environment(url, scratch), check=True, capture_output=True)
            info["dbname"] = scratch
            with psycopg.connect(**info) as restored:
                actual = table_fingerprints(restored)
            if actual != manifest["tables"]:
                raise RuntimeError("Restored data does not match the source snapshot.")
        finally:
            # Only the freshly generated scratch database can be dropped here.
            admin.execute(sql.SQL("DROP DATABASE {} WITH (FORCE)").format(sql.Identifier(scratch)))
    return {"status": "verified", "tables": len(manifest["tables"]), "rows": sum(t["count"] for t in manifest["tables"].values())}


def upload_daily(url):
    import boto3
    bucket = os.environ["BACKUP_BUCKET"]
    key = f"restaurant/{datetime.now(timezone.utc):%Y/%m/%d}/restaurant-{uuid.uuid4().hex}.dump"
    client = boto3.client("s3", endpoint_url=os.environ.get("S3_ENDPOINT_URL") or None)
    with tempfile.TemporaryDirectory() as folder:
        path = Path(folder) / "restaurant.dump"
        export_backup(url, path)
        for local, remote in [(path, key), (path.with_suffix(".dump.json"), key + ".json")]:
            client.upload_file(str(local), bucket, remote, ExtraArgs={"ServerSideEncryption": "AES256"})
    print("Daily encrypted backup uploaded successfully.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["export", "verify", "daily"])
    parser.add_argument("file", nargs="?")
    args = parser.parse_args()
    url = os.environ.get("DATABASE_URL")
    if not url:
        parser.error("Set DATABASE_URL. Credentials are read from the environment, never command-line arguments.")
    if args.action == "daily":
        upload_daily(url)
    elif not args.file:
        parser.error("A backup file path is required.")
    elif args.action == "export":
        manifest = export_backup(url, args.file)
        print(f"Backup exported: {len(manifest['tables'])} verified-source tables.")
    else:
        print(json.dumps(verify_backup(url, args.file)))


if __name__ == "__main__":
    main()
