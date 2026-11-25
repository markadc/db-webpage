# 🗃️ DBPage

<p align="center">
  <img src="dbpage-home.png" width="700" alt="DBPage Preview">
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/db-webpage"><img src="https://img.shields.io/npm/v/db-webpage?color=2563eb&logo=npm&logoColor=white" alt="npm"></a>
  <a href="#"><img src="https://img.shields.io/badge/Node.js-18+-339933?logo=node.js&logoColor=white" alt="Node.js"></a>
  <a href="#"><img src="https://img.shields.io/badge/Python-3.8+-3776AB?logo=python&logoColor=white" alt="Python"></a>
  <a href="#"><img src="https://img.shields.io/badge/PostgreSQL-2563EB?logo=postgresql&logoColor=white" alt="PostgreSQL"></a>
  <a href="#"><img src="https://img.shields.io/badge/MySQL-D97706?logo=mysql&logoColor=white" alt="MySQL"></a>
  <a href="#"><img src="https://img.shields.io/badge/Redis-059669?logo=redis&logoColor=white" alt="Redis"></a>
</p>

> 一个轻量级数据库可视化工作台，支持 **PostgreSQL**、**MySQL** 和 **Redis**。提供 `npm` 全局 CLI（`dbw`）与 Python FastAPI 两种运行方式，通过 Web 界面管理连接、浏览与增删改导数据、执行 SQL 与 Redis 命令，无需登录，开箱即用。

---

## 🚀 快速开始

### 方式一：npm 全局安装（推荐）

无需克隆仓库，直接通过 npm 安装 CLI 工具 `db-webpage`：

```bash
npm install -g db-webpage
```

安装完成后，在任意目录执行：

```bash
dbw
```

服务默认启动在 `http://localhost:12301` 并自动打开浏览器。

#### CLI 常用参数

```bash
dbw                   # 默认端口 12301 启动
dbw -p 8080           # 指定端口启动（或 PORT=8080 dbw）
dbw -v, --version     # 查看当前版本
dbw -h, --help        # 查看帮助信息
```

---

### 方式二：源码运行（Python FastAPI）

#### 1. 克隆项目

```bash
git clone https://github.com/markadc/dbpage.git
cd dbpage
```

#### 2. 启动服务

```bash
chmod +x start.sh
./start.sh
```

> `start.sh` 会自动创建虚拟环境、安装 `requirements.txt` 依赖并启动服务。

#### 3. 访问应用

打开浏览器访问 👉 `http://localhost:22001`

---

## ✨ 功能特性

- 🔌 **连接管理** — 按数据库品牌色区分的卡片列表与类型筛选，支持两步式快速新建、编辑、备注提示、连通性测试、删除及顶栏快速切换
- 🗄️ **多数据库支持** — 同时支持 **PostgreSQL**、**MySQL** 与 **Redis**
- 📊 **数据浏览与增删改导** — 分页、字段排序、多条件筛选、显示字段筛选、列宽拖拽/平分、单元格单击复制/双击内联编辑、多行 JSON & NULL 弹窗编辑、新增/删除行、导出 CSV/JSON
- 📝 **查询终端** — 统一执行 SQL 语句与 Redis 命令，支持 `Cmd/Ctrl + Enter` 快捷运行（支持选中片段执行）、结果导出及历史记录回溯
- 💾 **独立状态持久化** — 每个连接独立记忆上次使用的数据库、表、查询语句及界面偏好，刷新或切换连接不丢失上下文
- 🎨 **清爽直观的工作台 UI** — 顶栏三页一体化导航（连接列表 / 数据浏览 / 查询）与醒目的当前连接状态胶囊

---

## 🛠️ 技术栈

| 层级            | Node.js CLI (`db-webpage`) | Python 源码版              |
| --------------- | -------------------------- | -------------------------- |
| 后端框架        | Node.js + Express          | Python + FastAPI           |
| 前端界面        | 原生 HTML + CSS + JavaScript | 原生 HTML + CSS + JavaScript |
| PostgreSQL 驱动 | `pg`                       | `psycopg2`                 |
| MySQL 驱动      | `mysql2`                   | `pymysql`                  |
| Redis 驱动      | `ioredis`                  | `redis`                    |

---

## 📁 项目结构

```
DBPage/
├── 📄 main.py              # Python FastAPI 后端入口
├── 📄 requirements.txt     # Python 依赖
├── 📄 start.sh             # 一键启动脚本
├── 📁 templates/
│   └── 📄 index.html       # 主页面模板
├── 📁 static/
│   ├── 📁 css/style.css    # 样式文件
│   └── 📁 js/app.js        # 前端逻辑
├── 📁 db-page/             # npm 包 (db-webpage / dbw CLI)
│   ├── 📄 package.json
│   ├── 📁 src/index.js     # Express 后端与 CLI 入口
│   └── 📄 README.md        # npm 包说明文档
├── 🖼️ dbpage-home.png
├── 🖼️ dbpage-view-data.png
├── 🖼️ dbpage-exec-sql.png
└── 📄 README.md
```

---

## 📸 使用指南

### 🔌 添加与切换连接

1. 在「连接列表」右上角点击「新建连接」
2. 选择数据库类型（PostgreSQL / MySQL / Redis），自动带入默认端口
3. 填写主机、端口、账号与备注，点击「测试连接」验证后保存
4. 点击连接卡片进入「数据浏览」，后续可直接在顶栏胶囊切换其他连接

![连接管理](dbpage-home.png)

### 📊 浏览与编辑数据

1. 在「数据浏览」选择目标数据库和表（Redis 支持按数据类型或 `ALL` 浏览 Key）
2. 支持分页（10 / 20 / 50 / 100 / 500）、列排序、条件筛选、列显示控制与平分宽度
3. 单元格支持单击复制、双击编辑，悬停右侧可展开多行 JSON / NULL 编辑弹窗，鼠标移至行外左侧/右侧可快速删除当前行

![数据浏览](dbpage-view-data.png)

### 📝 执行 SQL / Redis 命令

1. 点击顶栏「查询」切换到查询页面，选择目标数据库（或 Redis `db0`..`db15`）
2. 输入 SQL 或 Redis 命令（如 `SELECT * FROM table_name LIMIT 10` 或 `KEYS *`）
3. 点击「执行」或按 `Cmd/Ctrl + Enter` 运行，支持导出 CSV / JSON 与历史命令回填

![SQL 执行](dbpage-exec-sql.png)

---

## ⚙️ 配置与缓存说明

- **npm CLI 版（`dbw`）**：连接配置与各连接最近状态保存在 `~/.db-webpage/dbw-cache.json`
- **Python 源码版**：连接配置与状态保存在项目根目录 `init.json`
- **前端界面偏好**：表格视图开关、历史查询、每页条数等保存在浏览器 `localStorage`

> ⚠️ **注意**：配置文件中可能包含数据库连接密码，请勿将 `init.json` 或 `dbw-cache.json` 提交到公共版本库。

---

## ⚠️ 注意事项

- 服务端通过 Session Cookie 维护当前活动连接状态
- 查询终端支持直接执行 SQL / Redis 命令，请注意数据操作安全
- 建议仅在本地或受信任的内网环境中使用 🔒

---

## 📄 License

[MIT](LICENSE)
