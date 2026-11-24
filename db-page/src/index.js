#!/usr/bin/env node

const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { Client, types: pgTypes } = require('pg');
const mysql = require('mysql2/promise');
const Redis = require('ioredis');
const open = require('open').default;

// PostgreSQL: 保持 DATE (1082) 原样输出，TIMESTAMP WITHOUT TIME ZONE (1114) 格式化为 YYYY-MM-DD HH:mm:ss
pgTypes.setTypeParser(1082, val => val);
pgTypes.setTypeParser(1114, val => (val ? val.replace('T', ' ').replace(/\.\d+$/, '') : val));

function formatDateTime(d) {
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function normalizeRows(rows) {
    if (!Array.isArray(rows)) return rows;
    return rows.map(row => {
        const out = {};
        for (const [k, v] of Object.entries(row)) {
            out[k] = v instanceof Date ? formatDateTime(v) : v;
        }
        return out;
    });
}

const app = express();
const VERSION = require('../package.json').version;
const DEFAULT_PORT = 12301;
const CONFIG_DIR = path.join(os.homedir(), '.db-webpage');
const INIT_FILE = path.join(CONFIG_DIR, 'dbw-cache.json');
const LEGACY_FILE = path.join(CONFIG_DIR, 'init.json');

function printUsage() {
    console.log(`DBWebpage ${VERSION} - a lightweight database data visualization tool

Usage:
  dbw                  Start server on default port ${DEFAULT_PORT}
  dbw -p, --port <port>  Start server on specified port
  dbw -v, --version    Show version
  dbw -h, --help       Show this help message`);
}

function argError(message) {
    console.error(`dbw: ${message}`);
    console.error('Run \'dbw --help\' for usage.');
    process.exit(1);
}

function parsePort(value) {
    if (!/^\d+$/.test(String(value || ''))) {
        return null;
    }
    const port = parseInt(value, 10);
    return port >= 1 && port <= 65535 ? port : null;
}

function parseCliArgs(argv) {
    const args = argv.slice(2);
    const first = args[0];

    if (first === undefined) {
        return { port: null };
    }

    if (first === '-v' || first === '--version') {
        if (args.length > 1) {
            argError(`unexpected extra argument '${args[1]}' after '${first}'`);
        }
        console.log(`db-webpage v${VERSION}`);
        process.exit(0);
    }

    if (first === '-h' || first === '--help') {
        if (args.length > 1) {
            argError(`unexpected extra argument '${args[1]}' after '${first}'`);
        }
        printUsage();
        process.exit(0);
    }

    if (first === '-p' || first === '--port') {
        if (args.length === 1) {
            argError(`'${first}' requires a port number`);
        }
        if (args.length > 2) {
            argError(`unexpected extra argument '${args[2]}'`);
        }
        const port = parsePort(args[1]);
        if (!port) {
            argError(`invalid port '${args[1]}', must be an integer between 1 and 65535`);
        }
        return { port };
    }

    argError(`unknown argument '${first}'`);
}

function defaultInit() {
    return { connections: [], states: {} };
}

function ensureInitFile() {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    // 旧版 init.json 自动迁移为 dbw-cache.json
    if (!fs.existsSync(INIT_FILE) && fs.existsSync(LEGACY_FILE)) {
        fs.copyFileSync(LEGACY_FILE, INIT_FILE);
    }
    if (!fs.existsSync(INIT_FILE)) {
        const bundledInit = path.join(__dirname, '..', 'dbw-cache.json');
        if (fs.existsSync(bundledInit)) {
            fs.copyFileSync(bundledInit, INIT_FILE);
        } else {
            fs.writeFileSync(INIT_FILE, JSON.stringify(defaultInit(), null, 2), 'utf-8');
        }
    }
    // 迁移完成后清理旧文件，避免残留混淆
    if (fs.existsSync(LEGACY_FILE)) {
        try { fs.unlinkSync(LEGACY_FILE); } catch (_) {}
    }
}

const { port: cliPort } = parseCliArgs(process.argv);
const envPort = process.env.PORT ? parsePort(process.env.PORT) : null;
const PORT = cliPort || envPort || DEFAULT_PORT;

app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: 'dbpage-secret-key-2026',
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

app.use('/static', express.static(path.join(__dirname, '..', 'static')));

function loadInit() {
    ensureInitFile();
    if (!fs.existsSync(INIT_FILE)) {
        return defaultInit();
    }
    try {
        const data = JSON.parse(fs.readFileSync(INIT_FILE, 'utf-8'));
        if (!data.states) {
            data.states = {};
            const oldConnId = data.last_conn_id;
            if (oldConnId) {
                data.states[oldConnId] = {
                    db: data.last_db || null,
                    table: data.last_table || null,
                    sql: data.last_sql || null
                };
                delete data.last_conn_id;
                delete data.last_db;
                delete data.last_table;
                delete data.last_sql;
            }
        }
        return data;
    } catch (e) {
        return defaultInit();
    }
}

function saveInit(data) {
    ensureInitFile();
    fs.writeFileSync(INIT_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

function parseRedisDb(dbname) {
    if (!dbname) return 0;
    const s = String(dbname).trim();
    if (s.startsWith('db') && /^\d+$/.test(s.slice(2))) return parseInt(s.slice(2), 10);
    return /^\d+$/.test(s) ? parseInt(s, 10) : 0;
}

async function closeDbConnection(conn) {
    if (!conn) return;
    try {
        if (typeof conn.quit === 'function') {
            await conn.quit();
        } else if (typeof conn.end === 'function') {
            await conn.end();
        }
    } catch (_) {}
}

async function getDbConnection(conn_type, host, port, user, password, dbname) {
    if (conn_type === 'redis') {
        const client = new Redis({
            host,
            port: parseInt(port, 10),
            username: user || undefined,
            password: password || undefined,
            db: parseRedisDb(dbname),
            lazyConnect: true,
            connectTimeout: 5000,
            maxRetriesPerRequest: 1
        });
        await client.connect();
        return client;
    }
    if (conn_type === 'mysql') {
        return mysql.createConnection({
            host,
            port: parseInt(port, 10),
            user,
            password,
            database: dbname || undefined,
            dateStrings: true
        });
    } else {
        const client = new Client({
            host,
            port: parseInt(port, 10),
            user,
            password,
            database: dbname || 'postgres'
        });
        await client.connect();
        return client;
    }
}

function getConnParams(req) {
    return {
        conn_type: req.session.conn_type || 'postgresql',
        host: req.session.db_host,
        port: req.session.db_port,
        user: req.session.db_user,
        password: req.session.db_password
    };
}

function quoteIdentifier(conn_type, name) {
    if (conn_type === 'mysql') return `\`${name}\``;
    return `"${name}"`;
}

/* AggregateError（如 ECONNREFUSED）的 message 为空，需从 errors/code 中提取 */
function errMessage(e) {
    if (!e) return 'Unknown error';
    if (e.message) return e.message;
    if (e.errors && e.errors.length && e.errors[0].message) {
        return `${e.code || 'ERROR'}: ${e.errors[0].message}`;
    }
    if (e.code) return e.code;
    return String(e);
}

async function getPkColumn(conn, conn_type, table) {
    /* 返回单列主键的列名；无主键或复合主键时返回 null */
    try {
        if (conn_type === 'mysql') {
            const [rows] = await conn.query(
                "SELECT COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE " +
                "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? " +
                "AND CONSTRAINT_NAME = 'PRIMARY' ORDER BY ORDINAL_POSITION",
                [table]
            );
            const keys = rows.map(r => r.COLUMN_NAME);
            return keys.length === 1 && keys[0] ? keys[0] : null;
        } else {
            const result = await conn.query(
                "SELECT kcu.column_name FROM information_schema.table_constraints tc " +
                "JOIN information_schema.key_column_usage kcu " +
                "ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema " +
                "WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = 'public' " +
                "AND tc.table_name = $1 ORDER BY kcu.ordinal_position",
                [table]
            );
            const keys = result.rows.map(r => r.column_name);
            return keys.length === 1 && keys[0] ? keys[0] : null;
        }
    } catch (_) {
        return null;
    }
}

/* ===== 路由 ===== */

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'templates', 'index.html'));
});

app.get('/api/init', (req, res) => {
    const data = loadInit();
    res.json({ ...data, active_conn_id: req.session.conn_id || null });
});

app.post('/api/connections/test', async (req, res) => {
    const { conn_type = 'postgresql', host, port, user = '', password = '' } = req.body;
    let db;
    try {
        db = await getDbConnection(conn_type, host, port, user, password, null);
        if (conn_type === 'redis') {
            await db.ping();
        }
        await closeDbConnection(db);
        res.json({ success: true });
    } catch (e) {
        await closeDbConnection(db);
        res.status(400).json({ detail: errMessage(e) });
    }
});

app.get('/api/connections', (req, res) => {
    res.json({ connections: loadInit().connections });
});

app.post('/api/connections', (req, res) => {
    const { name, conn_type, host, port, user = '', password = '', remark = '' } = req.body;
    const data = loadInit();
    const conns = data.connections;
    const maxId = conns
        .filter(c => /^\d+$/.test(c.id))
        .map(c => parseInt(c.id, 10))
        .reduce((a, b) => Math.max(a, b), 0);
    const newId = String(maxId + 1);
    conns.push({ id: newId, name, type: conn_type || 'postgresql', host, port: parseInt(port, 10), user, password, remark });
    data.connections = conns;
    saveInit(data);
    res.json({ success: true, id: newId });
});

app.put('/api/connections/:conn_id', (req, res) => {
    const { conn_id } = req.params;
    const { name, conn_type, host, port, user = '', password = '', remark = '' } = req.body;
    const data = loadInit();
    const conns = data.connections;
    const conn = conns.find(c => c.id === conn_id);
    if (!conn) {
        return res.status(404).json({ detail: '连接不存在' });
    }
    conn.name = name;
    conn.type = conn_type || 'postgresql';
    conn.host = host;
    conn.port = parseInt(port, 10);
    conn.user = user;
    conn.password = password;
    conn.remark = remark;
    data.connections = conns;
    saveInit(data);
    res.json({ success: true });
});

app.delete('/api/connections/:conn_id', (req, res) => {
    const { conn_id } = req.params;
    const data = loadInit();
    data.connections = data.connections.filter(c => c.id !== conn_id);
    saveInit(data);
    res.json({ success: true });
});

app.post('/api/connections/:conn_id/use', async (req, res) => {
    const { conn_id } = req.params;
    const data = loadInit();
    const conn = data.connections.find(c => c.id === conn_id);
    if (!conn) {
        return res.status(404).json({ detail: '连接不存在' });
    }
    try {
        const db = await getDbConnection(
            conn.type || 'postgresql',
            conn.host,
            conn.port,
            conn.user,
            conn.password,
            null
        );
        if ((conn.type || 'postgresql') === 'redis') {
            await db.ping();
        }
        await closeDbConnection(db);
    } catch (e) {
        return res.status(400).json({ detail: errMessage(e) });
    }
    req.session.conn_id = conn_id;
    req.session.conn_type = conn.type || 'postgresql';
    req.session.db_host = conn.host;
    req.session.db_port = conn.port;
    req.session.db_user = conn.user;
    req.session.db_password = conn.password;
    saveInit(data);
    res.json({ success: true });
});

app.post('/api/state', (req, res) => {
    const conn_id = req.session.conn_id;
    if (!conn_id) {
        return res.status(400).json({ detail: '未选择连接' });
    }
    const { db, table, sql } = req.body;
    const data = loadInit();
    if (!data.states[conn_id]) {
        data.states[conn_id] = {};
    }
    const st = data.states[conn_id];
    if (db !== undefined) st.db = db || null;
    if (table !== undefined) st.table = table || null;
    if (sql !== undefined) st.sql = sql || null;
    saveInit(data);
    res.json({ success: true });
});

app.get('/api/databases', async (req, res) => {
    const params = getConnParams(req);
    if (!params.host) {
        return res.status(400).json({ detail: '未选择连接' });
    }
    let conn;
    try {
        conn = await getDbConnection(
            params.conn_type,
            params.host,
            params.port,
            params.user,
            params.password,
            params.conn_type === 'postgresql' ? 'postgres' : null
        );
        if (params.conn_type === 'redis') {
            let dbCount = 16;
            try {
                const cfg = await conn.config('GET', 'databases');
                if (Array.isArray(cfg) && cfg.length >= 2) {
                    dbCount = Math.max(1, parseInt(cfg[1], 10) || 16);
                }
            } catch (_) {}
            res.json({ databases: Array.from({ length: dbCount }, (_, i) => `db${i}`) });
        } else if (params.conn_type === 'mysql') {
            const [rows] = await conn.query('SHOW DATABASES');
            const exclude = new Set(['information_schema', 'mysql', 'performance_schema', 'sys']);
            const databases = rows
                .map(r => r.Database || r.database)
                .filter(d => !exclude.has(d));
            res.json({ databases });
        } else {
            const result = await conn.query(
                "SELECT datname FROM pg_database WHERE datistemplate = false AND datallowconn = true ORDER BY datname"
            );
            res.json({ databases: result.rows.map(r => r.datname) });
        }
    } catch (e) {
        res.status(400).json({ detail: errMessage(e) });
    } finally {
        await closeDbConnection(conn);
    }
});

app.get('/api/tables', async (req, res) => {
    const { db } = req.query;
    const params = getConnParams(req);
    if (params.conn_type === 'redis') {
        return res.json({ tables: ['ALL', 'string', 'hash', 'list', 'set', 'zset'] });
    }
    let conn;
    try {
        conn = await getDbConnection(params.conn_type, params.host, params.port, params.user, params.password, db);
        if (params.conn_type === 'mysql') {
            const [rows] = await conn.query("SHOW FULL TABLES WHERE Table_type = 'BASE TABLE'");
            res.json({ tables: rows.map(r => Object.values(r)[0]) });
        } else {
            const result = await conn.query(
                "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name"
            );
            res.json({ tables: result.rows.map(r => r.table_name) });
        }
    } catch (e) {
        res.status(400).json({ detail: errMessage(e) });
    } finally {
        await closeDbConnection(conn);
    }
});

async function getTableColumnTypes(conn, conn_type, table) {
    if (conn_type === 'mysql') {
        const [desc] = await conn.query(`DESCRIBE ${quoteIdentifier('mysql', table)}`);
        const out = {};
        for (const d of desc) {
            if (d.Field) out[d.Field] = String(d.Type || '').toLowerCase();
        }
        return out;
    }
    const descResult = await conn.query(
        `SELECT column_name, udt_name, character_maximum_length FROM information_schema.columns WHERE table_name = $1 AND table_schema = 'public' ORDER BY ordinal_position`,
        [table]
    );
    const out = {};
    for (const r of descResult.rows) {
        let t = r.udt_name || '';
        if ((t === 'varchar' || t === 'bpchar') && r.character_maximum_length) {
            t = `varchar(${r.character_maximum_length})`;
        }
        out[r.column_name] = t;
    }
    return out;
}

async function getTableColumns(conn, conn_type, table) {
    const types = await getTableColumnTypes(conn, conn_type, table);
    return Object.keys(types);
}

async function redisReadValue(conn, key, keyType) {
    if (keyType === 'string') return await conn.get(key);
    if (keyType === 'hash') return JSON.stringify(await conn.hgetall(key));
    if (keyType === 'list') return JSON.stringify(await conn.lrange(key, 0, 99));
    if (keyType === 'set') return JSON.stringify(await conn.smembers(key));
    if (keyType === 'zset') {
        const raw = await conn.zrange(key, 0, 99, 'WITHSCORES');
        const pairs = [];
        for (let i = 0; i < raw.length; i += 2) {
            pairs.push([raw[i], Number(raw[i + 1])]);
        }
        return JSON.stringify(pairs);
    }
    return `<${keyType}>`;
}

function matchRedisFilter(row, filterCol, filterOp, filterVal) {
    if (!filterCol) return true;
    const val = row[filterCol];
    const op = String(filterOp || 'contains').toLowerCase();
    if (op === 'isnull') return val === null || val === undefined || val === '';
    if (op === 'notnull') return val !== null && val !== undefined && val !== '';
    if (filterVal === undefined || filterVal === '') return true;
    const sVal = val === null || val === undefined ? '' : String(val);
    if (op === 'eq') return sVal === filterVal;
    if (op === 'neq') return sVal !== filterVal;
    if (op === 'gt' || op === 'lt') {
        const a = Number(sVal), b = Number(filterVal);
        if (!Number.isNaN(a) && !Number.isNaN(b)) {
            return op === 'gt' ? a > b : a < b;
        }
        return op === 'gt' ? sVal > filterVal : sVal < filterVal;
    }
    return sVal.toLowerCase().includes(String(filterVal).toLowerCase());
}

function parseRedisCommand(input) {
    const tokens = [];
    let current = '';
    let quote = null;
    let escaped = false;
    for (const ch of String(input || '').trim()) {
        if (escaped) {
            current += ch;
            escaped = false;
        } else if (ch === '\\') {
            escaped = true;
        } else if (quote) {
            if (ch === quote) quote = null;
            else current += ch;
        } else if (ch === '"' || ch === "'") {
            quote = ch;
        } else if (/\s/.test(ch)) {
            if (current) {
                tokens.push(current);
                current = '';
            }
        } else {
            current += ch;
        }
    }
    if (current) tokens.push(current);
    return tokens;
}

app.get('/api/data', async (req, res) => {
    const { db, table, page = 1, size = 10, sort_col, sort_dir, filter_col, filter_op, filter_val } = req.query;
    const params = getConnParams(req);
    let conn;
    try {
        conn = await getDbConnection(params.conn_type, params.host, params.port, params.user, params.password, db);
        const limit = parseInt(size, 10);
        const pageNum = parseInt(page, 10);

        if (params.conn_type === 'redis') {
            const columns = ['key', 'type', 'ttl', 'value'];
            if (filter_col && !columns.includes(filter_col)) {
                return res.status(400).json({ detail: '无效的筛选字段' });
            }
            if (sort_col && !columns.includes(sort_col)) {
                return res.status(400).json({ detail: '无效的排序字段' });
            }
            const keys = [];
            let cursor = '0';
            do {
                const [nextCursor, batch] = await conn.scan(cursor, 'COUNT', 500);
                cursor = nextCursor;
                for (const k of batch) {
                    keys.push(k);
                    if (keys.length >= 2000) break;
                }
            } while (cursor !== '0' && keys.length < 2000);
            keys.sort();

            const pipe = conn.pipeline();
            for (const k of keys) {
                pipe.type(k);
                pipe.ttl(k);
            }
            const meta = keys.length ? await pipe.exec() : [];
            const targetType = table && table !== 'ALL' ? table : null;
            const rows = [];
            for (let i = 0; i < keys.length; i++) {
                const k = keys[i];
                const kType = meta[i * 2][1];
                const kTtl = meta[i * 2 + 1][1];
                if (targetType && kType !== targetType) continue;
                const kVal = await redisReadValue(conn, k, kType);
                const row = { key: k, type: kType, ttl: kTtl, value: kVal };
                if (matchRedisFilter(row, filter_col, filter_op, filter_val)) {
                    rows.push(row);
                }
            }

            let activeSortCol = null;
            let activeSortDir = null;
            if (sort_col) {
                activeSortCol = sort_col;
                activeSortDir = String(sort_dir || '').toLowerCase() === 'desc' ? 'desc' : 'asc';
                const mult = activeSortDir === 'desc' ? -1 : 1;
                rows.sort((a, b) => {
                    if (sort_col === 'ttl') return (Number(a.ttl) - Number(b.ttl)) * mult;
                    const sa = a[sort_col] == null ? '' : String(a[sort_col]);
                    const sb = b[sort_col] == null ? '' : String(b[sort_col]);
                    return sa.localeCompare(sb) * mult;
                });
            }

            const total = rows.length;
            const offset = (pageNum - 1) * limit;
            return res.json({
                columns,
                column_types: { key: 'key', type: 'type', ttl: 'seconds', value: 'value' },
                data: rows.slice(offset, offset + limit),
                total,
                page: pageNum,
                size: limit,
                pages: Math.ceil(total / limit),
                pk: 'key',
                sort_col: activeSortCol,
                sort_dir: activeSortDir
            });
        }

        const q = quoteIdentifier(params.conn_type, table);
        const offset = (pageNum - 1) * limit;

        let validCols = null;
        let whereClauseMysql = '';
        let whereClausePg = '';
        const whereParams = [];

        if (filter_col) {
            validCols = await getTableColumns(conn, params.conn_type, table);
            if (!validCols.includes(filter_col)) {
                return res.status(400).json({ detail: '无效的筛选字段' });
            }
            const qFcol = quoteIdentifier(params.conn_type, filter_col);
            const op = String(filter_op || 'contains').toLowerCase();
            if (op === 'isnull') {
                whereClauseMysql = ` WHERE ${qFcol} IS NULL`;
                whereClausePg = ` WHERE ${qFcol} IS NULL`;
            } else if (op === 'notnull') {
                whereClauseMysql = ` WHERE ${qFcol} IS NOT NULL`;
                whereClausePg = ` WHERE ${qFcol} IS NOT NULL`;
            } else if (filter_val !== undefined && filter_val !== '') {
                const sqlOpMap = { eq: '=', neq: '!=', gt: '>', lt: '<' };
                if (sqlOpMap[op]) {
                    whereClauseMysql = ` WHERE ${qFcol} ${sqlOpMap[op]} ?`;
                    whereClausePg = ` WHERE ${qFcol} ${sqlOpMap[op]} $1`;
                    whereParams.push(filter_val);
                } else {
                    whereClauseMysql = ` WHERE CAST(${qFcol} AS CHAR) LIKE ?`;
                    whereClausePg = ` WHERE CAST(${qFcol} AS TEXT) ILIKE $1`;
                    whereParams.push(`%${filter_val}%`);
                }
            }
        }

        let orderClause = '';
        let activeSortCol = null;
        let activeSortDir = null;
        if (sort_col) {
            if (!validCols) {
                validCols = await getTableColumns(conn, params.conn_type, table);
            }
            if (!validCols.includes(sort_col)) {
                return res.status(400).json({ detail: '无效的排序字段' });
            }
            activeSortCol = sort_col;
            activeSortDir = String(sort_dir || '').toLowerCase() === 'desc' ? 'desc' : 'asc';
            orderClause = ` ORDER BY ${quoteIdentifier(params.conn_type, activeSortCol)} ${activeSortDir.toUpperCase()}`;
        }

        if (params.conn_type === 'mysql') {
            const [[countRows]] = await conn.query(`SELECT COUNT(*) as total FROM ${q}${whereClauseMysql}`, whereParams);
            const total = countRows.total;
            const [rows] = await conn.query(
                `SELECT * FROM ${q}${whereClauseMysql}${orderClause} LIMIT ? OFFSET ?`,
                [...whereParams, limit, offset]
            );
            const colTypes = await getTableColumnTypes(conn, 'mysql', table);
            const columns = rows.length > 0 ? Object.keys(rows[0]) : Object.keys(colTypes);
            const pk = await getPkColumn(conn, 'mysql', table);
            res.json({
                columns,
                column_types: colTypes,
                data: normalizeRows(rows),
                total,
                page: parseInt(page, 10),
                size: limit,
                pages: Math.ceil(total / limit),
                pk,
                sort_col: activeSortCol,
                sort_dir: activeSortDir
            });
        } else {
            const countResult = await conn.query(`SELECT COUNT(*) as total FROM ${q}${whereClausePg}`, whereParams);
            const total = parseInt(countResult.rows[0].total, 10);
            const limitIdx = whereParams.length + 1;
            const offsetIdx = whereParams.length + 2;
            const result = await conn.query(
                `SELECT * FROM ${q}${whereClausePg}${orderClause} LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
                [...whereParams, limit, offset]
            );
            const colTypes = await getTableColumnTypes(conn, 'postgresql', table);
            const columns = result.rows.length > 0 ? Object.keys(result.rows[0]) : Object.keys(colTypes);
            const pk = await getPkColumn(conn, 'postgresql', table);
            res.json({
                columns,
                column_types: colTypes,
                data: normalizeRows(result.rows),
                total,
                page: parseInt(page, 10),
                size: limit,
                pages: Math.ceil(total / limit),
                pk,
                sort_col: activeSortCol,
                sort_dir: activeSortDir
            });
        }
    } catch (e) {
        res.status(400).json({ detail: errMessage(e) });
    } finally {
        await closeDbConnection(conn);
    }
});

app.post('/api/data', async (req, res) => {
    const { db, table, row_json } = req.body;
    const params = getConnParams(req);
    let conn;
    try {
        const payload = JSON.parse(row_json || '{}');
        conn = await getDbConnection(params.conn_type, params.host, params.port, params.user, params.password, db);

        if (params.conn_type === 'redis') {
            const k = String(payload.key || '').trim();
            if (!k) return res.status(400).json({ detail: 'Key 不能为空' });
            const kType = String(payload.type || 'string').toLowerCase();
            const ttl = parseInt(payload.ttl ?? -1, 10);
            const val = payload.value ?? '';

            if (kType === 'string') {
                await conn.set(k, val === null ? '' : String(val));
            } else {
                const parsed = typeof val === 'string' ? JSON.parse(val) : val;
                await conn.del(k);
                if (kType === 'hash' && parsed && !Array.isArray(parsed) && typeof parsed === 'object') {
                    if (!Object.keys(parsed).length) return res.status(400).json({ detail: 'Hash 内容不能为空对象' });
                    await conn.hset(k, parsed);
                } else if (kType === 'list' && Array.isArray(parsed)) {
                    if (!parsed.length) return res.status(400).json({ detail: 'List 内容不能为空数组' });
                    await conn.rpush(k, ...parsed.map(String));
                } else if (kType === 'set' && Array.isArray(parsed)) {
                    if (!parsed.length) return res.status(400).json({ detail: 'Set 内容不能为空数组' });
                    await conn.sadd(k, ...parsed.map(String));
                } else if (kType === 'zset' && Array.isArray(parsed)) {
                    const args = [];
                    for (const item of parsed) args.push(Number(item[1]), String(item[0]));
                    if (!args.length) return res.status(400).json({ detail: 'ZSet 内容不能为空数组' });
                    await conn.zadd(k, ...args);
                } else {
                    return res.status(400).json({ detail: '值格式与所选 Redis 类型不匹配' });
                }
            }
            if (!Number.isNaN(ttl) && ttl > 0) {
                await conn.expire(k, ttl);
            }
            return res.json({ success: true, rowcount: 1 });
        }

        const validCols = await getTableColumns(conn, params.conn_type, table);
        const qTable = quoteIdentifier(params.conn_type, table);
        const cols = [];
        const vals = [];
        for (const [colName, colVal] of Object.entries(payload)) {
            if (!validCols.includes(colName)) {
                return res.status(400).json({ detail: `无效的字段: ${colName}` });
            }
            cols.push(quoteIdentifier(params.conn_type, colName));
            vals.push(colVal);
        }

        if (params.conn_type === 'mysql') {
            if (!cols.length) {
                const [result] = await conn.query(`INSERT INTO ${qTable} () VALUES ()`);
                res.json({ success: true, rowcount: result.affectedRows });
            } else {
                const placeholders = cols.map(() => '?').join(', ');
                const [result] = await conn.query(`INSERT INTO ${qTable} (${cols.join(', ')}) VALUES (${placeholders})`, vals);
                res.json({ success: true, rowcount: result.affectedRows });
            }
        } else {
            if (!cols.length) {
                const result = await conn.query(`INSERT INTO ${qTable} DEFAULT VALUES`);
                res.json({ success: true, rowcount: result.rowCount });
            } else {
                const placeholders = cols.map((_, idx) => `$${idx + 1}`).join(', ');
                const result = await conn.query(`INSERT INTO ${qTable} (${cols.join(', ')}) VALUES (${placeholders})`, vals);
                res.json({ success: true, rowcount: result.rowCount });
            }
        }
    } catch (e) {
        res.status(400).json({ detail: errMessage(e) });
    } finally {
        await closeDbConnection(conn);
    }
});

app.put('/api/data', async (req, res) => {
    const { db, table, pk_col, pk_val, column, value = '', is_null = '0' } = req.body;
    const params = getConnParams(req);
    const setNull = String(is_null) === '1';
    let conn;
    try {
        conn = await getDbConnection(params.conn_type, params.host, params.port, params.user, params.password, db);
        if (params.conn_type === 'redis') {
            if (setNull) {
                if (column === 'ttl') {
                    await conn.persist(pk_val);
                    return res.json({ success: true, rowcount: 1 });
                }
                return res.status(400).json({ detail: 'Redis 值不支持设为 NULL，如需删除请使用删除行' });
            }
            if (column === 'key') {
                await conn.rename(pk_val, value);
                return res.json({ success: true, rowcount: 1 });
            }
            if (column === 'ttl') {
                const sec = parseInt(value, 10);
                if (Number.isNaN(sec)) return res.status(400).json({ detail: 'TTL 必须是整数' });
                if (sec < 0) await conn.persist(pk_val);
                else await conn.expire(pk_val, sec);
                return res.json({ success: true, rowcount: 1 });
            }
            if (column === 'value') {
                const kType = await conn.type(pk_val);
                const ttl = await conn.ttl(pk_val);
                if (kType === 'string') {
                    if (ttl > 0) await conn.set(pk_val, value, 'EX', ttl);
                    else await conn.set(pk_val, value);
                    return res.json({ success: true, rowcount: 1 });
                }
                const parsed = JSON.parse(value);
                await conn.del(pk_val);
                if (kType === 'hash' && parsed && !Array.isArray(parsed) && typeof parsed === 'object') {
                    if (Object.keys(parsed).length) await conn.hset(pk_val, parsed);
                } else if (kType === 'list' && Array.isArray(parsed)) {
                    if (parsed.length) await conn.rpush(pk_val, ...parsed.map(String));
                } else if (kType === 'set' && Array.isArray(parsed)) {
                    if (parsed.length) await conn.sadd(pk_val, ...parsed.map(String));
                } else if (kType === 'zset' && Array.isArray(parsed)) {
                    const args = [];
                    for (const item of parsed) {
                        args.push(Number(item[1]), String(item[0]));
                    }
                    if (args.length) await conn.zadd(pk_val, ...args);
                } else {
                    return res.status(400).json({ detail: `不支持更新类型为 ${kType} 的值` });
                }
                if (ttl > 0) await conn.expire(pk_val, ttl);
                return res.json({ success: true, rowcount: 1 });
            }
            return res.status(400).json({ detail: 'Redis 仅支持修改 key、ttl 或 value' });
        }

        const validCols = await getTableColumns(conn, params.conn_type, table);
        if (!validCols.includes(column) || !validCols.includes(pk_col)) {
            return res.status(400).json({ detail: '无效的字段名' });
        }
        const q_table = quoteIdentifier(params.conn_type, table);
        const q_col = quoteIdentifier(params.conn_type, column);
        const q_pk_col = quoteIdentifier(params.conn_type, pk_col);

        if (params.conn_type === 'mysql') {
            const [result] = setNull
                ? await conn.query(`UPDATE ${q_table} SET ${q_col} = NULL WHERE ${q_pk_col} = ?`, [pk_val])
                : await conn.query(`UPDATE ${q_table} SET ${q_col} = ? WHERE ${q_pk_col} = ?`, [value, pk_val]);
            res.json({ success: true, rowcount: result.affectedRows });
        } else {
            const result = setNull
                ? await conn.query(`UPDATE ${q_table} SET ${q_col} = NULL WHERE ${q_pk_col} = $1`, [pk_val])
                : await conn.query(`UPDATE ${q_table} SET ${q_col} = $1 WHERE ${q_pk_col} = $2`, [value, pk_val]);
            res.json({ success: true, rowcount: result.rowCount });
        }
    } catch (e) {
        res.status(400).json({ detail: errMessage(e) });
    } finally {
        await closeDbConnection(conn);
    }
});

app.delete('/api/data', async (req, res) => {
    const { db, table, pk_col, pk_val } = req.query;
    const params = getConnParams(req);
    let conn;
    try {
        conn = await getDbConnection(params.conn_type, params.host, params.port, params.user, params.password, db);
        if (params.conn_type === 'redis') {
            const deleted = await conn.del(pk_val);
            return res.json({ success: true, rowcount: deleted });
        }
        const validCols = await getTableColumns(conn, params.conn_type, table);
        if (!validCols.includes(pk_col)) {
            return res.status(400).json({ detail: '无效的主键字段' });
        }
        const q_table = quoteIdentifier(params.conn_type, table);
        const q_pk_col = quoteIdentifier(params.conn_type, pk_col);
        if (params.conn_type === 'mysql') {
            const [result] = await conn.query(`DELETE FROM ${q_table} WHERE ${q_pk_col} = ?`, [pk_val]);
            res.json({ success: true, rowcount: result.affectedRows });
        } else {
            const result = await conn.query(`DELETE FROM ${q_table} WHERE ${q_pk_col} = $1`, [pk_val]);
            res.json({ success: true, rowcount: result.rowCount });
        }
    } catch (e) {
        res.status(400).json({ detail: errMessage(e) });
    } finally {
        await closeDbConnection(conn);
    }
});

app.post('/api/query', async (req, res) => {
    const { db, sql: sqlStr } = req.body;
    const params = getConnParams(req);
    let conn;
    try {
        conn = await getDbConnection(params.conn_type, params.host, params.port, params.user, params.password, db);

        if (params.conn_type === 'redis') {
            const parts = parseRedisCommand(sqlStr);
            if (!parts.length) {
                return res.status(400).json({ detail: '请输入 Redis 命令' });
            }
            const [cmd, ...args] = parts;
            const result = await conn.call(cmd, ...args);
            if (Array.isArray(result)) {
                const rows = result.map((v, i) => ({
                    index: i,
                    value: v === null || v === undefined ? '' : (typeof v === 'object' ? JSON.stringify(v) : String(v))
                }));
                return res.json({ columns: ['index', 'value'], data: rows, rowcount: rows.length });
            }
            if (result && typeof result === 'object') {
                const rows = Object.entries(result).map(([k, v]) => ({ field: String(k), value: String(v) }));
                return res.json({ columns: ['field', 'value'], data: rows, rowcount: rows.length });
            }
            return res.json({
                columns: ['result'],
                data: [{ result: result === null || result === undefined ? '' : String(result) }],
                rowcount: 1
            });
        }

        if (params.conn_type === 'mysql') {
            const hasResult = !/^(\s*INSERT\s+|\s*UPDATE\s+|\s*DELETE\s+|\s*CREATE\s+|\s*DROP\s+|\s*ALTER\s+|\s*TRUNCATE\s+)/i.test(sqlStr);
            if (hasResult) {
                const [rows, fields] = await conn.query(sqlStr);
                const columns = fields ? fields.map(f => f.name) : [];
                res.json({ columns, data: normalizeRows(rows), rowcount: rows.length });
            } else {
                const [result] = await conn.query(sqlStr);
                res.json({ columns: [], data: [], rowcount: result.affectedRows || 0 });
            }
        } else {
            const result = await conn.query(sqlStr);
            if (result.rows && result.fields) {
                const columns = result.fields.map(f => f.name);
                res.json({ columns, data: normalizeRows(result.rows), rowcount: result.rows.length });
            } else {
                res.json({ columns: [], data: [], rowcount: result.rowCount || 0 });
            }
        }
    } catch (e) {
        res.status(400).json({ detail: errMessage(e) });
    } finally {
        await closeDbConnection(conn);
    }
});

app.listen(PORT, '127.0.0.1', () => {
    const url = `http://localhost:${PORT}`;
    console.log(`DBPage running at ${url}`);
    open(url).catch(() => {});
});
