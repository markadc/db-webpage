# 🗃️ DBWebpage

> A lightweight database data visualization tool for PostgreSQL, MySQL, and Redis.

<p align="center">
  <img src="https://unpkg.com/db-webpage@latest/dbpage-view-data.png" width="700" alt="DBWebpage Preview">
</p>

## Install

```bash
npm install -g db-webpage
```

## Usage

After global installation, simply run:

```bash
dbw
```

This will start the server on port **12301** and automatically open your browser.

### CLI Options

```bash
dbw -v, --version     # Show version
dbw -h, --help        # Show help
dbw -p, --port <port> # Start on a custom port, e.g. dbw -p 8080
```

You can also set the port via the `PORT` environment variable:

```bash
PORT=8080 dbw
```

## Features

- 🔌 **Connection Management** — Create, edit, test, and delete database connections with quick header switching
- 🗄️ **Multi-Database Support** — PostgreSQL, MySQL, and Redis
- 📊 **Data Browsing & CRUD** — Pagination, sorting, multi-op filtering, inline & JSON modal editing, add/delete rows, and CSV/JSON export
- 📝 **SQL & Redis Terminal** — Execute arbitrary SQL queries or Redis commands with history and `Cmd/Ctrl + Enter` shortcut
- 💾 **State Persistence** — Saves last used database, table, and query history per connection

## Tech Stack

| Layer       | Technology                     |
|-------------|--------------------------------|
| Backend     | Node.js + Express              |
| Frontend    | HTML + CSS + JavaScript        |
| PostgreSQL  | `pg`                           |
| MySQL       | `mysql2`                       |
| Redis       | `ioredis`                      |

## Configuration

Connection settings and state are stored in `~/.db-webpage/dbw-cache.json`.

## License

MIT
