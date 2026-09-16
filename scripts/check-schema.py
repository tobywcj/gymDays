"""`npm run db:check` entrypoint.

Detects migration drift: a migration recorded in supabase_migrations history
whose DDL never actually ran (seen with 0021 and 0038). Parses every file in
supabase/migrations/ for the tables, columns and functions it creates, then
checks each one exists in the remote DB (minus anything a later migration drops).

Read-only. Exits 1 if anything is missing. Run with the gymDays conda python:
  /Users/toby/anaconda3/envs/gymDays/bin/python scripts/check-schema.py
"""
import glob
import os
import re
import sys

import psycopg2

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def db_url() -> str:
    for line in open(os.path.join(ROOT, ".env")).read().splitlines():
        if line.startswith("SUPABASE_DB_URL="):
            # Session mode (5432) — the transaction pooler (6543) is fine for reads
            # but keep parity with db-push.sh.
            return line.split("=", 1)[1].strip().strip("'\"").replace(":6543/", ":5432/")
    sys.exit("ERROR: SUPABASE_DB_URL not set in .env")


def expected_objects():
    expect, dropped = [], set()
    for path in sorted(glob.glob(os.path.join(ROOT, "supabase/migrations/*.sql"))):
        mig = os.path.basename(path)[:4]
        sql = re.sub(r"--[^\n]*", "", open(path).read())
        # Only unqualified / public-schema objects; auth.* shims etc. are skipped.
        for t in re.findall(r"create table (?:if not exists )?(?:public\.)?(\w+)\b(?!\.)", sql, re.I):
            expect.append((mig, "table", t))
        for m in re.finditer(r"alter table (?:if exists )?(?:only )?(?:public\.)?(\w+)\b(?!\.)([^;]*)", sql, re.I):
            table, body = m.groups()
            for c in re.findall(r"add column (?:if not exists )?(\w+)", body, re.I):
                expect.append((mig, "column", f"{table}.{c}"))
            for c in re.findall(r"drop column (?:if exists )?(\w+)", body, re.I):
                dropped.add(("column", f"{table}.{c}"))
        for fn in re.findall(r"create (?:or replace )?function (?:public\.)?(\w+)\b(?!\.)", sql, re.I):
            expect.append((mig, "function", fn))
        for t in re.findall(r"drop table (?:if exists )?(?:public\.)?(\w+)", sql, re.I):
            dropped.add(("table", t))
        for fn in re.findall(r"drop function (?:if exists )?(?:public\.)?(\w+)", sql, re.I):
            dropped.add(("function", fn))
    return [e for e in expect if (e[1], e[2]) not in dropped]


def exists(cur, kind: str, name: str) -> bool:
    if kind == "table":
        cur.execute("select to_regclass(%s)", (f"public.{name}",))
        return cur.fetchone()[0] is not None
    if kind == "column":
        table, col = name.split(".")
        cur.execute(
            "select 1 from information_schema.columns "
            "where table_schema='public' and table_name=%s and column_name=%s",
            (table, col),
        )
        return cur.fetchone() is not None
    cur.execute(
        "select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace "
        "where n.nspname='public' and proname=%s",
        (name,),
    )
    return cur.fetchone() is not None


def main() -> None:
    expect = expected_objects()
    with psycopg2.connect(db_url()) as conn, conn.cursor() as cur:
        missing = [e for e in expect if not exists(cur, e[1], e[2])]
    print(f"checked {len(expect)} objects from migrations; missing: {len(missing)}")
    for mig, kind, name in missing:
        print(f"  {mig}  {kind:<8} {name}")
    if missing:
        print("\nRe-run the listed migration files' (idempotent) SQL directly, then "
              "NOTIFY pgrst, 'reload schema'.")
        sys.exit(1)


if __name__ == "__main__":
    main()
