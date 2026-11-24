import os
import json
import shlex
import datetime
import threading
import psycopg2
import pymysql
import redis as redis_lib
from psycopg2.extras import RealDictCursor
from pymysql.cursors import DictCursor
from fastapi import FastAPI, Request, Form, HTTPException, Query
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from starlette.middleware.sessions import SessionMiddleware

app = FastAPI(title="DBPage")
app.add_middleware(SessionMiddleware, secret_key="dbpage-secret-key-2026")
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

INIT_FILE = "init.json"
init_lock = threading.RLock()


def load_init():
    with init_lock:
        return _load_init_unlocked()


def _load_init_unlocked():
    if not os.path.exists(INIT_FILE):
        return {"connections": [], "states": {}}
    with open(INIT_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)
    if "states" not in data:
        data["states"] = {}
        # 迁移旧格式
        old_conn_id = data.pop("last_conn_id", None)
        if old_conn_id:
            data["states"][old_conn_id] = {
                "db": data.pop("last_db", None),
                "table": data.pop("last_table", None),
                "sql": data.pop("last_sql", None),
            }
    return data


def save_init(data):
    with init_lock:
        with open(INIT_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)


def parse_redis_db(dbname):
    if not dbname:
        return 0
    s = str(dbname).strip()
    if s.startswith("db") and s[2:].isdigit():
        return int(s[2:])
    return int(s) if s.isdigit() else 0


def get_db_connection(conn_type, host, port, user, password, dbname=None):
    if conn_type == "redis":
        return redis_lib.Redis(
            host=host,
            port=int(port),
            username=user or None,
            password=password or None,
            db=parse_redis_db(dbname),
            decode_responses=True,
            socket_connect_timeout=5,
        )
    if conn_type == "mysql":
        kwargs = dict(host=host, port=port, user=user, password=password, cursorclass=DictCursor)
        if dbname:
            kwargs["database"] = dbname
        return pymysql.connect(**kwargs)
    return psycopg2.connect(
        host=host,
        port=port,
        user=user,
        password=password,
        dbname=dbname or "postgres",
        cursor_factory=RealDictCursor,
    )


def get_conn_params(request: Request):
    return {
        "conn_type": request.session.get("conn_type", "postgresql"),
        "host": request.session.get("db_host"),
        "port": request.session.get("db_port"),
        "user": request.session.get("db_user"),
        "password": request.session.get("db_password"),
    }


def quote_identifier(conn_type, name):
    if conn_type == "mysql":
        return f"`{name}`"
    return f'"{name}"'


def get_pk_column(cur, conn_type, table):
    """返回单列主键的列名；无主键或复合主键时返回 None。"""
    try:
        if conn_type == "mysql":
            cur.execute(
                "SELECT COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE "
                "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s "
                "AND CONSTRAINT_NAME = 'PRIMARY' ORDER BY ORDINAL_POSITION",
                (table,),
            )
            rows = cur.fetchall()
            keys = [r.get("COLUMN_NAME") for r in rows]
        else:
            cur.execute(
                "SELECT kcu.column_name FROM information_schema.table_constraints tc "
                "JOIN information_schema.key_column_usage kcu "
                "ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema "
                "WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = 'public' "
                "AND tc.table_name = %s ORDER BY kcu.ordinal_position",
                (table,),
            )
            rows = cur.fetchall()
            keys = [r["column_name"] for r in rows]
        return keys[0] if len(keys) == 1 and keys[0] else None
    except Exception:
        return None


@app.get("/", response_class=HTMLResponse)
async def root(request: Request):
    return templates.TemplateResponse(request, "index.html")


@app.get("/api/init")
async def get_init(request: Request):
    data = load_init()
    return {**data, "active_conn_id": request.session.get("conn_id")}


@app.post("/api/connections/test")
async def test_connection(
    conn_type: str = Form("postgresql"),
    host: str = Form(...),
    port: int = Form(...),
    user: str = Form(""),
    password: str = Form(""),
):
    try:
        db = get_db_connection(conn_type, host, port, user, password, dbname=None)
        if conn_type == "redis":
            db.ping()
        db.close()
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/connections")
async def list_connections():
    return {"connections": load_init()["connections"]}


@app.post("/api/connections")
async def create_connection(
    name: str = Form(...),
    conn_type: str = Form("postgresql"),
    host: str = Form(...),
    port: int = Form(...),
    user: str = Form(""),
    password: str = Form(""),
):
    data = load_init()
    with init_lock:
        conns = data["connections"]
        new_id = str(max([int(c["id"]) for c in conns if c["id"].isdigit()], default=0) + 1)
        conns.append({"id": new_id, "name": name, "type": conn_type, "host": host, "port": port, "user": user, "password": password})
        data["connections"] = conns
        save_init(data)
    return {"success": True, "id": new_id}


@app.put("/api/connections/{conn_id}")
async def update_connection(
    conn_id: str,
    name: str = Form(...),
    conn_type: str = Form("postgresql"),
    host: str = Form(...),
    port: int = Form(...),
    user: str = Form(""),
    password: str = Form(""),
):
    data = load_init()
    with init_lock:
        conns = data["connections"]
        for c in conns:
            if c["id"] == conn_id:
                c.update({"name": name, "type": conn_type, "host": host, "port": port, "user": user, "password": password})
                data["connections"] = conns
                save_init(data)
                return {"success": True}
    raise HTTPException(status_code=404, detail="连接不存在")


@app.delete("/api/connections/{conn_id}")
async def delete_connection(conn_id: str):
    with init_lock:
        data = load_init()
        data["connections"] = [c for c in data["connections"] if c["id"] != conn_id]
        save_init(data)
    return {"success": True}


@app.post("/api/connections/{conn_id}/use")
async def use_connection(request: Request, conn_id: str):
    data = load_init()
    conn = next((c for c in data["connections"] if c["id"] == conn_id), None)
    if not conn:
        raise HTTPException(status_code=404, detail="连接不存在")
    try:
        conn_type = conn.get("type", "postgresql")
        db = get_db_connection(conn_type, conn["host"], conn["port"], conn["user"], conn["password"], dbname=None)
        if conn_type == "redis":
            db.ping()
        db.close()
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    request.session["conn_id"] = conn_id
    request.session["conn_type"] = conn.get("type", "postgresql")
    request.session["db_host"] = conn["host"]
    request.session["db_port"] = conn["port"]
    request.session["db_user"] = conn["user"]
    request.session["db_password"] = conn["password"]
    save_init(data)
    return {"success": True}


@app.post("/api/state")
async def save_state(request: Request, db: str = Form(None), table: str = Form(None), sql: str = Form(None)):
    conn_id_session = request.session.get("conn_id")
    if not conn_id_session:
        raise HTTPException(status_code=400, detail="未选择连接")
    with init_lock:
        data = load_init()
        if conn_id_session not in data["states"]:
            data["states"][conn_id_session] = {}
        st = data["states"][conn_id_session]
        if db is not None:
            st["db"] = db
        if table is not None:
            st["table"] = table
        if sql is not None:
            st["sql"] = sql
        save_init(data)
    return {"success": True}


@app.get("/api/databases")
async def list_databases(request: Request):
    params = get_conn_params(request)
    if not params["host"]:
        raise HTTPException(status_code=400, detail="未选择连接")
    conn = get_db_connection(**params, dbname="postgres" if params["conn_type"] == "postgresql" else None)
    try:
        if params["conn_type"] == "redis":
            db_count = 16
            try:
                cfg = conn.config_get("databases")
                if cfg and "databases" in cfg:
                    db_count = max(1, int(cfg["databases"]))
            except Exception:
                pass
            return {"databases": [f"db{i}" for i in range(db_count)]}
        with conn.cursor() as cur:
            if params["conn_type"] == "mysql":
                cur.execute("SHOW DATABASES")
                rows = cur.fetchall()
                exclude = {"information_schema", "mysql", "performance_schema", "sys"}
                return {"databases": [r.get("Database") or r.get("database") for r in rows if (r.get("Database") or r.get("database")) not in exclude]}
            else:
                cur.execute("SELECT datname FROM pg_database WHERE datistemplate = false AND datallowconn = true ORDER BY datname")
                rows = cur.fetchall()
                return {"databases": [r["datname"] for r in rows]}
    finally:
        conn.close()


@app.get("/api/tables")
async def list_tables(request: Request, db: str = Query(...)):
    params = get_conn_params(request)
    if params["conn_type"] == "redis":
        return {"tables": ["ALL", "string", "hash", "list", "set", "zset"]}
    conn = get_db_connection(**params, dbname=db)
    try:
        with conn.cursor() as cur:
            if params["conn_type"] == "mysql":
                cur.execute("SHOW FULL TABLES WHERE Table_type = 'BASE TABLE'")
                rows = cur.fetchall()
                return {"tables": [list(r.values())[0] for r in rows]}
            else:
                cur.execute("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name")
                rows = cur.fetchall()
                return {"tables": [r["table_name"] for r in rows]}
    finally:
        conn.close()


def get_table_column_types(cur, conn_type, table):
    if conn_type == "mysql":
        cur.execute(f"DESCRIBE {quote_identifier(conn_type, table)}")
        return {r.get("Field"): (r.get("Type") or "").lower() for r in cur.fetchall() if r.get("Field")}
    cur.execute(
        "SELECT column_name, udt_name, character_maximum_length "
        "FROM information_schema.columns "
        "WHERE table_name = %s AND table_schema = 'public' ORDER BY ordinal_position",
        (table,),
    )
    out = {}
    for r in cur.fetchall():
        t = r["udt_name"] or ""
        if t in ("varchar", "bpchar") and r.get("character_maximum_length"):
            t = f"varchar({r['character_maximum_length']})"
        out[r["column_name"]] = t
    return out


def get_table_columns(cur, conn_type, table):
    return list(get_table_column_types(cur, conn_type, table).keys())


def normalize_row(row):
    out = {}
    for k, v in dict(row).items():
        if isinstance(v, datetime.datetime):
            if v.tzinfo is not None:
                v = v.astimezone()
            out[k] = v.strftime("%Y-%m-%d %H:%M:%S")
        elif isinstance(v, datetime.date):
            out[k] = v.strftime("%Y-%m-%d")
        else:
            out[k] = v
    return out


def redis_read_value(conn, key, key_type):
    if key_type == "string":
        return conn.get(key)
    if key_type == "hash":
        return json.dumps(conn.hgetall(key), ensure_ascii=False)
    if key_type == "list":
        return json.dumps(conn.lrange(key, 0, 99), ensure_ascii=False)
    if key_type == "set":
        return json.dumps(list(conn.smembers(key)), ensure_ascii=False)
    if key_type == "zset":
        return json.dumps(conn.zrange(key, 0, 99, withscores=True), ensure_ascii=False)
    return f"<{key_type}>"


def match_redis_filter(row, filter_col, filter_op, filter_val):
    if not filter_col:
        return True
    val = row.get(filter_col)
    op = (filter_op or "contains").lower()
    if op == "isnull":
        return val is None or val == ""
    if op == "notnull":
        return val is not None and val != ""
    if filter_val is None or filter_val == "":
        return True
    s_val = "" if val is None else str(val)
    if op == "eq":
        return s_val == filter_val
    if op == "neq":
        return s_val != filter_val
    if op in ("gt", "lt"):
        try:
            a, b = float(s_val), float(filter_val)
            return a > b if op == "gt" else a < b
        except Exception:
            return s_val > filter_val if op == "gt" else s_val < filter_val
    return filter_val.lower() in s_val.lower()


def get_redis_data(conn, table, page, size, sort_col, sort_dir, filter_col, filter_op, filter_val):
    columns = ["key", "type", "ttl", "value"]
    if filter_col and filter_col not in columns:
        raise HTTPException(status_code=400, detail="无效的筛选字段")
    if sort_col and sort_col not in columns:
        raise HTTPException(status_code=400, detail="无效的排序字段")

    keys = []
    for k in conn.scan_iter(count=500):
        keys.append(k)
        if len(keys) >= 2000:
            break
    keys.sort()

    pipe = conn.pipeline()
    for k in keys:
        pipe.type(k)
        pipe.ttl(k)
    meta = pipe.execute() if keys else []

    rows = []
    target_type = table if table and table != "ALL" else None
    for idx, k in enumerate(keys):
        k_type = meta[idx * 2]
        k_ttl = meta[idx * 2 + 1]
        if target_type and k_type != target_type:
            continue
        k_val = redis_read_value(conn, k, k_type)
        row = {"key": k, "type": k_type, "ttl": k_ttl, "value": k_val}
        if match_redis_filter(row, filter_col, filter_op, filter_val):
            rows.append(row)

    active_sort_col = None
    active_sort_dir = None
    if sort_col:
        active_sort_col = sort_col
        active_sort_dir = "desc" if (sort_dir or "").lower() == "desc" else "asc"
        reverse = active_sort_dir == "desc"
        if sort_col == "ttl":
            rows.sort(key=lambda r: int(r["ttl"]), reverse=reverse)
        else:
            rows.sort(key=lambda r: "" if r[sort_col] is None else str(r[sort_col]), reverse=reverse)

    total = len(rows)
    start = (page - 1) * size
    paged = rows[start:start + size]
    return {
        "columns": columns,
        "column_types": {"key": "key", "type": "type", "ttl": "seconds", "value": "value"},
        "data": paged,
        "total": total,
        "page": page,
        "size": size,
        "pages": (total + size - 1) // size,
        "pk": "key",
        "sort_col": active_sort_col,
        "sort_dir": active_sort_dir,
    }


@app.get("/api/data")
async def get_data(
    request: Request,
    db: str = Query(...),
    table: str = Query(...),
    page: int = Query(1, ge=1),
    size: int = Query(10, ge=1, le=1000),
    sort_col: str = Query(None),
    sort_dir: str = Query("asc"),
    filter_col: str = Query(None),
    filter_op: str = Query("contains"),
    filter_val: str = Query(None),
):
    params = get_conn_params(request)
    conn = get_db_connection(**params, dbname=db)
    try:
        if params["conn_type"] == "redis":
            return get_redis_data(conn, table, page, size, sort_col, sort_dir, filter_col, filter_op, filter_val)
        with conn.cursor() as cur:
            q = quote_identifier(params["conn_type"], table)
            valid_cols = None

            where_clause = ""
            where_params = []
            if filter_col:
                valid_cols = get_table_columns(cur, params["conn_type"], table)
                if filter_col not in valid_cols:
                    raise HTTPException(status_code=400, detail="无效的筛选字段")
                q_fcol = quote_identifier(params["conn_type"], filter_col)
                op = (filter_op or "contains").lower()
                if op == "isnull":
                    where_clause = f" WHERE {q_fcol} IS NULL"
                elif op == "notnull":
                    where_clause = f" WHERE {q_fcol} IS NOT NULL"
                elif filter_val is not None and filter_val != "":
                    if op == "eq":
                        where_clause = f" WHERE {q_fcol} = %s"
                        where_params.append(filter_val)
                    elif op == "neq":
                        where_clause = f" WHERE {q_fcol} != %s"
                        where_params.append(filter_val)
                    elif op == "gt":
                        where_clause = f" WHERE {q_fcol} > %s"
                        where_params.append(filter_val)
                    elif op == "lt":
                        where_clause = f" WHERE {q_fcol} < %s"
                        where_params.append(filter_val)
                    else:
                        if params["conn_type"] == "mysql":
                            where_clause = f" WHERE CAST({q_fcol} AS CHAR) LIKE %s"
                        else:
                            where_clause = f" WHERE CAST({q_fcol} AS TEXT) ILIKE %s"
                        where_params.append(f"%{filter_val}%")

            cur.execute(f"SELECT COUNT(*) as total FROM {q}{where_clause}", tuple(where_params))
            total = cur.fetchone()["total"]

            order_clause = ""
            active_sort_col = None
            active_sort_dir = None
            if sort_col:
                if valid_cols is None:
                    valid_cols = get_table_columns(cur, params["conn_type"], table)
                if sort_col not in valid_cols:
                    raise HTTPException(status_code=400, detail="无效的排序字段")
                active_sort_col = sort_col
                active_sort_dir = "desc" if (sort_dir or "").lower() == "desc" else "asc"
                q_sort = quote_identifier(params["conn_type"], active_sort_col)
                order_clause = f" ORDER BY {q_sort} {active_sort_dir.upper()}"

            offset = (page - 1) * size
            cur.execute(
                f"SELECT * FROM {q}{where_clause}{order_clause} LIMIT %s OFFSET %s",
                tuple(where_params) + (size, offset),
            )
            rows = cur.fetchall()
            col_types = get_table_column_types(cur, params["conn_type"], table)
            columns = [desc[0] for desc in cur.description] if cur.description else list(col_types.keys())
            pk = get_pk_column(cur, params["conn_type"], table)
            return {
                "columns": columns,
                "column_types": col_types,
                "data": [normalize_row(r) for r in rows],
                "total": total,
                "page": page,
                "size": size,
                "pages": (total + size - 1) // size,
                "pk": pk,
                "sort_col": active_sort_col,
                "sort_dir": active_sort_dir,
            }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        conn.close()


@app.post("/api/data")
async def insert_data(
    request: Request,
    db: str = Form(...),
    table: str = Form(...),
    row_json: str = Form(...),
):
    params = get_conn_params(request)
    conn = get_db_connection(**params, dbname=db)
    try:
        payload = json.loads(row_json)
        if params["conn_type"] == "redis":
            k = str(payload.get("key") or "").strip()
            if not k:
                raise HTTPException(status_code=400, detail="Key 不能为空")
            k_type = str(payload.get("type") or "string").lower()
            ttl = int(payload.get("ttl", -1))
            val = payload.get("value", "")
            if k_type == "string":
                conn.set(k, "" if val is None else str(val))
            else:
                parsed = json.loads(val) if isinstance(val, str) else val
                conn.delete(k)
                if k_type == "hash" and isinstance(parsed, dict):
                    if not parsed:
                        raise HTTPException(status_code=400, detail="Hash 内容不能为空对象")
                    conn.hset(k, mapping={str(fk): str(fv) for fk, fv in parsed.items()})
                elif k_type == "list" and isinstance(parsed, list):
                    if not parsed:
                        raise HTTPException(status_code=400, detail="List 内容不能为空数组")
                    conn.rpush(k, *[str(x) for x in parsed])
                elif k_type == "set" and isinstance(parsed, list):
                    if not parsed:
                        raise HTTPException(status_code=400, detail="Set 内容不能为空数组")
                    conn.sadd(k, *[str(x) for x in parsed])
                elif k_type == "zset" and isinstance(parsed, list):
                    mapping = {str(item[0]): float(item[1]) for item in parsed}
                    if not mapping:
                        raise HTTPException(status_code=400, detail="ZSet 内容不能为空数组")
                    conn.zadd(k, mapping)
                else:
                    raise HTTPException(status_code=400, detail="值格式与所选 Redis 类型不匹配")
            if ttl > 0:
                conn.expire(k, ttl)
            return {"success": True, "rowcount": 1}

        with conn.cursor() as cur:
            valid_cols = get_table_columns(cur, params["conn_type"], table)
            q_table = quote_identifier(params["conn_type"], table)
            cols = []
            vals = []
            for col_name, col_val in payload.items():
                if col_name not in valid_cols:
                    raise HTTPException(status_code=400, detail=f"无效的字段: {col_name}")
                cols.append(quote_identifier(params["conn_type"], col_name))
                vals.append(col_val)
            if not cols:
                if params["conn_type"] == "mysql":
                    cur.execute(f"INSERT INTO {q_table} () VALUES ()")
                else:
                    cur.execute(f"INSERT INTO {q_table} DEFAULT VALUES")
            else:
                placeholders = ", ".join(["%s"] * len(cols))
                cur.execute(f"INSERT INTO {q_table} ({', '.join(cols)}) VALUES ({placeholders})", tuple(vals))
            conn.commit()
            return {"success": True, "rowcount": cur.rowcount}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        conn.close()


@app.put("/api/data")
async def update_data(
    request: Request,
    db: str = Form(...),
    table: str = Form(...),
    pk_col: str = Form(...),
    pk_val: str = Form(...),
    column: str = Form(...),
    value: str = Form(""),
    is_null: str = Form("0"),
):
    params = get_conn_params(request)
    conn = get_db_connection(**params, dbname=db)
    try:
        set_null = str(is_null) == "1"
        if params["conn_type"] == "redis":
            if set_null:
                if column == "ttl":
                    conn.persist(pk_val)
                    return {"success": True, "rowcount": 1}
                raise HTTPException(status_code=400, detail="Redis 值不支持设为 NULL，如需删除请使用删除行")
            if column == "key":
                conn.rename(pk_val, value)
                return {"success": True, "rowcount": 1}
            if column == "ttl":
                sec = int(value)
                if sec < 0:
                    conn.persist(pk_val)
                else:
                    conn.expire(pk_val, sec)
                return {"success": True, "rowcount": 1}
            if column == "value":
                k_type = conn.type(pk_val)
                if k_type == "string":
                    ttl = conn.ttl(pk_val)
                    if ttl and ttl > 0:
                        conn.set(pk_val, value, ex=ttl)
                    else:
                        conn.set(pk_val, value)
                    return {"success": True, "rowcount": 1}
                parsed = json.loads(value)
                ttl = conn.ttl(pk_val)
                conn.delete(pk_val)
                if k_type == "hash" and isinstance(parsed, dict):
                    if parsed:
                        conn.hset(pk_val, mapping={str(k): str(v) for k, v in parsed.items()})
                elif k_type == "list" and isinstance(parsed, list):
                    if parsed:
                        conn.rpush(pk_val, *[str(x) for x in parsed])
                elif k_type == "set" and isinstance(parsed, list):
                    if parsed:
                        conn.sadd(pk_val, *[str(x) for x in parsed])
                elif k_type == "zset" and isinstance(parsed, list):
                    mapping = {str(item[0]): float(item[1]) for item in parsed}
                    if mapping:
                        conn.zadd(pk_val, mapping)
                else:
                    raise HTTPException(status_code=400, detail=f"不支持更新类型为 {k_type} 的值")
                if ttl and ttl > 0:
                    conn.expire(pk_val, ttl)
                return {"success": True, "rowcount": 1}
            raise HTTPException(status_code=400, detail="Redis 仅支持修改 key、ttl 或 value")
        with conn.cursor() as cur:
            valid_cols = get_table_columns(cur, params["conn_type"], table)
            if column not in valid_cols or pk_col not in valid_cols:
                raise HTTPException(status_code=400, detail="无效的字段名")
            q_table = quote_identifier(params["conn_type"], table)
            q_col = quote_identifier(params["conn_type"], column)
            q_pk_col = quote_identifier(params["conn_type"], pk_col)
            if set_null:
                cur.execute(f"UPDATE {q_table} SET {q_col} = NULL WHERE {q_pk_col} = %s", (pk_val,))
            else:
                cur.execute(f"UPDATE {q_table} SET {q_col} = %s WHERE {q_pk_col} = %s", (value, pk_val))
            conn.commit()
            return {"success": True, "rowcount": cur.rowcount}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        conn.close()


@app.delete("/api/data")
async def delete_data(
    request: Request,
    db: str = Query(...),
    table: str = Query(...),
    pk_col: str = Query(...),
    pk_val: str = Query(...),
):
    params = get_conn_params(request)
    conn = get_db_connection(**params, dbname=db)
    try:
        if params["conn_type"] == "redis":
            deleted = conn.delete(pk_val)
            return {"success": True, "rowcount": deleted}
        with conn.cursor() as cur:
            valid_cols = get_table_columns(cur, params["conn_type"], table)
            if pk_col not in valid_cols:
                raise HTTPException(status_code=400, detail="无效的主键字段")
            q_table = quote_identifier(params["conn_type"], table)
            q_pk_col = quote_identifier(params["conn_type"], pk_col)
            cur.execute(f"DELETE FROM {q_table} WHERE {q_pk_col} = %s", (pk_val,))
            conn.commit()
            return {"success": True, "rowcount": cur.rowcount}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        conn.close()


@app.post("/api/query")
async def execute_query(request: Request, db: str = Form(...), sql: str = Form(...)):
    params = get_conn_params(request)
    conn = get_db_connection(**params, dbname=db)
    try:
        if params["conn_type"] == "redis":
            parts = shlex.split(sql.strip())
            if not parts:
                raise HTTPException(status_code=400, detail="请输入 Redis 命令")
            res = conn.execute_command(*parts)
            if isinstance(res, dict):
                rows = [{"field": str(k), "value": str(v)} for k, v in res.items()]
                return {"columns": ["field", "value"], "data": rows, "rowcount": len(rows)}
            if isinstance(res, (list, tuple, set)):
                items = list(res)
                rows = [{"index": i, "value": json.dumps(v, ensure_ascii=False) if isinstance(v, (dict, list, tuple)) else ("" if v is None else str(v))} for i, v in enumerate(items)]
                return {"columns": ["index", "value"], "data": rows, "rowcount": len(rows)}
            val_str = "" if res is None else str(res)
            return {"columns": ["result"], "data": [{"result": val_str}], "rowcount": 1}
        with conn.cursor() as cur:
            cur.execute(sql)
            if cur.description:
                rows = cur.fetchall()
                columns = [desc[0] for desc in cur.description]
                return {
                    "columns": columns,
                    "data": [normalize_row(r) for r in rows],
                    "rowcount": len(rows),
                }
            else:
                conn.commit()
                return {"columns": [], "data": [], "rowcount": cur.rowcount}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        conn.close()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=22001)
