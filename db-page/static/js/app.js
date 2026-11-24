let state = {
    db: '',
    table: '',
    page: 1,
    size: 10,
    total: 0,
    pages: 1,
    sortCol: '',
    sortDir: '',
    colWidths: {},
    equalWidth: false,
    hiddenCols: new Set(),
    allColumns: [],
    columnTypes: {},
    lastTableData: null,
    filterCol: '',
    filterOp: 'contains',
    filterVal: ''
};
let sqlColWidths = {};
let lastSqlResultData = null;
let connections = [];
let currentConnId = null;
let currentConnType = 'postgresql';
let currentView = 'connections';
let initData = {};
let cellModalCtx = null;
let connFilterType = 'all';

const VIEW_PREFS_KEY = 'dbpage_view_prefs';
let viewPrefs = loadViewPrefs();

function loadViewPrefs() {
    const defaults = { showColTypes: false, showRowIndex: false };
    try {
        const raw = localStorage.getItem(VIEW_PREFS_KEY);
        if (!raw) return defaults;
        return { ...defaults, ...JSON.parse(raw) };
    } catch (_) {
        return defaults;
    }
}

function saveViewPrefs() {
    try {
        localStorage.setItem(VIEW_PREFS_KEY, JSON.stringify(viewPrefs));
    } catch (_) {}
}

function syncViewPrefsUI() {
    const cbTypes = document.getElementById('opt-show-col-types');
    const cbIndex = document.getElementById('opt-show-row-index');
    if (cbTypes) cbTypes.checked = Boolean(viewPrefs.showColTypes);
    if (cbIndex) cbIndex.checked = Boolean(viewPrefs.showRowIndex);
}

const SELECT_ICONS = {
    db: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/><path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3"/></svg>',
    pg: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/><path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3"/></svg>',
    mysql: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 9v12"/></svg>',
    redis: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 12 12 17 22 12"/><polyline points="2 17 12 22 22 17"/></svg>',
    pk: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/></svg>',
    empty: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>',
    table: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18"/><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/></svg>',
    chevron: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
    search: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>',
    check: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
    edit: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z"/></svg>',
    trash: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>',
    expand: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" x2="14" y1="3" y2="10"/><line x1="3" x2="10" y1="21" y2="14"/></svg>'
};

const customSelectInstances = [];

function closeAllCustomSelects(except = null) {
    customSelectInstances.forEach(inst => {
        if (inst !== except) inst.close();
    });
    ['col-picker', 'export-picker', 'history-picker', 'active-conn-switcher', 'view-opts-picker'].forEach(id => {
        const el = document.getElementById(id);
        if (el && except !== el) el.classList.remove('open');
    });
}

document.addEventListener('click', (e) => {
    if (!e.target.closest('.custom-select')) {
        closeAllCustomSelects();
    }
});

function createCustomSelect(selectEl, opts = {}) {
    if (!selectEl || selectEl._customSelect) return selectEl?._customSelect;

    const {
        icon = null,
        searchable = false,
        searchPlaceholder = '搜索',
        upward = false,
        compact = false
    } = opts;

    selectEl.classList.add('hidden');

    const wrapper = document.createElement('div');
    wrapper.className = 'custom-select';
    if (upward) wrapper.classList.add('upward');
    if (compact) wrapper.classList.add('compact');

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'custom-select-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');

    const valueWrap = document.createElement('span');
    valueWrap.className = 'custom-select-value-wrap';

    if (icon && SELECT_ICONS[icon]) {
        const iconEl = document.createElement('span');
        iconEl.className = 'custom-select-icon';
        iconEl.innerHTML = SELECT_ICONS[icon];
        valueWrap.appendChild(iconEl);
    }

    const labelEl = document.createElement('span');
    labelEl.className = 'custom-select-label';
    valueWrap.appendChild(labelEl);

    const chevronEl = document.createElement('span');
    chevronEl.className = 'custom-select-chevron';
    chevronEl.innerHTML = SELECT_ICONS.chevron;

    trigger.appendChild(valueWrap);
    trigger.appendChild(chevronEl);

    const menu = document.createElement('div');
    menu.className = 'custom-select-menu';
    menu.setAttribute('role', 'listbox');

    let searchInput = null;
    if (searchable) {
        const searchWrap = document.createElement('div');
        searchWrap.className = 'custom-select-search-wrap';
        const searchIcon = document.createElement('span');
        searchIcon.className = 'custom-select-search-icon';
        searchIcon.innerHTML = SELECT_ICONS.search;
        searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.className = 'custom-select-search';
        searchInput.placeholder = searchPlaceholder;
        searchWrap.appendChild(searchIcon);
        searchWrap.appendChild(searchInput);
        menu.appendChild(searchWrap);
    }

    const optionsList = document.createElement('div');
    optionsList.className = 'custom-select-options';
    menu.appendChild(optionsList);

    wrapper.appendChild(trigger);
    wrapper.appendChild(menu);
    selectEl.parentNode.insertBefore(wrapper, selectEl.nextSibling);

    let highlightedIndex = -1;

    function getVisibleOptionEls() {
        return Array.from(optionsList.querySelectorAll('.custom-select-option'));
    }

    function setHighlighted(idx) {
        const items = getVisibleOptionEls();
        items.forEach(el => el.classList.remove('highlighted'));
        if (idx >= 0 && idx < items.length) {
            highlightedIndex = idx;
            items[idx].classList.add('highlighted');
            items[idx].scrollIntoView({ block: 'nearest' });
        } else {
            highlightedIndex = -1;
        }
    }

    function renderOptions(filter = '') {
        const keyword = filter.trim().toLowerCase();
        optionsList.innerHTML = '';
        highlightedIndex = -1;

        const allOptions = Array.from(selectEl.options);
        const filtered = allOptions.filter(opt => {
            if (!keyword) return true;
            if (opt.value === '') return false;
            return opt.textContent.toLowerCase().includes(keyword);
        });

        if (!filtered.length) {
            const emptyEl = document.createElement('div');
            emptyEl.className = 'custom-select-empty';
            emptyEl.textContent = '无匹配结果';
            optionsList.appendChild(emptyEl);
            return;
        }

        filtered.forEach(opt => {
            const item = document.createElement('div');
            item.className = 'custom-select-option';
            if (opt.value === selectEl.value) item.classList.add('selected');
            if (opt.value === '') item.classList.add('is-placeholder');
            item.dataset.value = opt.value;
            item.setAttribute('role', 'option');

            const textSpan = document.createElement('span');
            textSpan.className = 'custom-select-option-text';
            textSpan.textContent = opt.textContent;

            const checkSpan = document.createElement('span');
            checkSpan.className = 'custom-select-check';
            checkSpan.innerHTML = SELECT_ICONS.check;

            item.appendChild(textSpan);
            item.appendChild(checkSpan);

            item.addEventListener('click', (e) => {
                e.stopPropagation();
                selectValue(opt.value);
            });

            optionsList.appendChild(item);
        });
    }

    function updateTrigger() {
        const selectedOpt = selectEl.options[selectEl.selectedIndex] || selectEl.options[0];
        const text = selectedOpt ? selectedOpt.textContent : '';
        const hasValue = Boolean(selectEl.value);
        labelEl.textContent = text;
        labelEl.classList.toggle('placeholder', !hasValue);
        wrapper.classList.toggle('has-value', hasValue);
    }

    function selectValue(val) {
        const changed = selectEl.value !== val;
        selectEl.value = val;
        updateTrigger();
        close();
        if (changed) {
            selectEl.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }

    function open() {
        closeAllCustomSelects(instance);
        if (searchInput) searchInput.value = '';
        renderOptions('');
        wrapper.classList.add('open');
        trigger.setAttribute('aria-expanded', 'true');

        const selectedEl = optionsList.querySelector('.custom-select-option.selected');
        if (selectedEl) {
            selectedEl.scrollIntoView({ block: 'nearest' });
        }
        if (searchInput) {
            requestAnimationFrame(() => searchInput.focus());
        }
    }

    function close() {
        wrapper.classList.remove('open');
        trigger.setAttribute('aria-expanded', 'false');
        highlightedIndex = -1;
    }

    function handleKeydown(e) {
        const isOpen = wrapper.classList.contains('open');
        if (!isOpen) {
            if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
                e.preventDefault();
                open();
            }
            return;
        }
        const items = getVisibleOptionEls();
        if (e.key === 'Escape') {
            e.preventDefault();
            close();
            trigger.focus();
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            setHighlighted(highlightedIndex + 1 < items.length ? highlightedIndex + 1 : 0);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHighlighted(highlightedIndex - 1 >= 0 ? highlightedIndex - 1 : items.length - 1);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (highlightedIndex >= 0 && items[highlightedIndex]) {
                selectValue(items[highlightedIndex].dataset.value);
            } else if (items.length === 1) {
                selectValue(items[0].dataset.value);
            }
        }
    }

    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        if (wrapper.classList.contains('open')) close();
        else open();
    });
    trigger.addEventListener('keydown', handleKeydown);

    if (searchInput) {
        searchInput.addEventListener('input', () => {
            renderOptions(searchInput.value);
        });
        searchInput.addEventListener('keydown', handleKeydown);
        searchInput.addEventListener('click', (e) => e.stopPropagation());
    }

    const instance = {
        refresh() {
            updateTrigger();
            if (wrapper.classList.contains('open')) {
                renderOptions(searchInput ? searchInput.value : '');
            }
        },
        close
    };

    selectEl._customSelect = instance;
    customSelectInstances.push(instance);
    updateTrigger();
    return instance;
}

function syncCustomSelect(selectEl) {
    if (selectEl && selectEl._customSelect) {
        selectEl._customSelect.refresh();
    }
}

async function fetchJSON(url, opts) {
    const r = await fetch(url, opts);
    if (!r.ok) {
        let detail = '请求失败';
        try {
            const e = await r.json();
            detail = e.detail || detail;
        } catch (_) {}
        throw new Error(detail);
    }
    return r.json();
}

function connTypeLabel(t) {
    if (t === 'mysql') return 'MySQL';
    if (t === 'redis') return 'Redis';
    return 'PostgreSQL';
}

function connTypeShort(t) {
    if (t === 'mysql') return 'MySQL';
    if (t === 'redis') return 'Redis';
    return 'PG';
}

function connTypeClass(t) {
    if (t === 'mysql') return 'type-mysql';
    if (t === 'redis') return 'type-redis';
    return 'type-postgresql';
}

function connTypeIcon(t) {
    if (t === 'mysql') return SELECT_ICONS.mysql;
    if (t === 'redis') return SELECT_ICONS.redis;
    return SELECT_ICONS.pg;
}

function emptyHtml(text) {
    return `<div class="empty-box"><span class="empty-icon">${SELECT_ICONS.empty}</span><span>${escapeHtml(text)}</span></div>`;
}

/* ===== URL Hash 状态同步 ===== */
function updateUrlHash() {
    if (!currentConnId || currentView === 'connections') {
        if (location.hash) {
            history.replaceState(null, '', location.pathname + location.search);
        }
        return;
    }
    const params = new URLSearchParams();
    params.set('conn', currentConnId);
    params.set('view', currentView);
    history.replaceState(null, '', '#' + params.toString());
}

function parseUrlHash() {
    const raw = location.hash ? location.hash.slice(1) : '';
    const params = new URLSearchParams(raw);
    return {
        conn: params.get('conn') || '',
        view: params.get('view') || 'data'
    };
}

/* ===== 顶栏三页导航 & P2/P3 显眼连接胶囊 ===== */
function updateTopNav() {
    const sep = document.getElementById('header-nav-sep');
    const nav = document.getElementById('top-nav');
    const hasConn = Boolean(currentConnId);
    if (sep) sep.classList.toggle('hidden', !hasConn);
    if (nav) nav.classList.toggle('hidden', !hasConn);
    document.querySelectorAll('#top-nav .top-nav-item').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.view === currentView);
    });
}

function updateActiveConnBadges() {
    updateTopNav();
    const connSep = document.getElementById('header-conn-sep');
    const bar = document.getElementById('active-conn-bar');
    const conn = connections.find(c => c.id === currentConnId);
    const showBar = Boolean(conn && currentView !== 'connections');
    if (connSep) connSep.classList.toggle('hidden', !showBar);
    if (bar) bar.classList.toggle('hidden', !showBar);
    if (!conn) return;

    const typeCls = connTypeClass(conn.type);
    const typeShort = connTypeShort(conn.type);
    const remarkText = (conn.remark || '').trim();
    const fallbackAddr = `${conn.host}:${conn.port}`;

    const switcher = document.getElementById('active-conn-switcher');
    const nameEl = document.getElementById('active-conn-name');
    const typeEl = document.getElementById('active-conn-type');
    const remarkEl = document.getElementById('active-conn-remark');
    const listEl = document.getElementById('active-conn-list');
    if (!switcher || !nameEl || !typeEl || !listEl) return;

    switcher.className = `custom-select conn-pill-switcher ${typeCls}`;
    nameEl.textContent = conn.name;
    typeEl.textContent = typeShort;

    if (remarkEl) {
        if (remarkText) {
            remarkEl.textContent = remarkText;
            remarkEl.title = `备注: ${remarkText} (${fallbackAddr})`;
            remarkEl.classList.add('is-remark');
            remarkEl.classList.remove('hidden');
        } else {
            remarkEl.textContent = fallbackAddr;
            remarkEl.title = fallbackAddr;
            remarkEl.classList.remove('is-remark');
            remarkEl.classList.remove('hidden');
        }
    }

    listEl.innerHTML = '';
    connections.forEach(c => {
        const item = document.createElement('div');
        item.className = 'custom-select-option' + (c.id === currentConnId ? ' selected' : '');
        const rHint = (c.remark || '').trim() ? ` · ${escapeHtml(c.remark.trim())}` : '';
        item.innerHTML = `
            <span class="custom-select-option-text">${escapeHtml(c.name)} <span class="card-type-tag ${connTypeClass(c.type)}" style="margin-left:4px;font-size:10.5px;padding:1px 6px;">${connTypeShort(c.type)}</span><span class="row-field-type">${rHint}</span></span>
            <span class="custom-select-check">${SELECT_ICONS.check}</span>
        `;
        item.addEventListener('click', async (e) => {
            e.stopPropagation();
            switcher.classList.remove('open');
            if (c.id !== currentConnId) {
                await useConnection(c.id, currentView === 'sql' ? 'sql' : 'data');
            }
        });
        listEl.appendChild(item);
    });
}

/* ===== 按连接保存/恢复 P2 & P3 全量操作状态 ===== */
function getConnLocalStateKey(connId) {
    return `dbpage_conn_state_${connId}`;
}

function loadConnLocalState(connId) {
    if (!connId) return {};
    try {
        return JSON.parse(localStorage.getItem(getConnLocalStateKey(connId)) || '{}') || {};
    } catch (_) {
        return {};
    }
}

function saveConnLocalState() {
    if (!currentConnId) return;
    const sqlInput = document.getElementById('sql-input');
    const snapshot = {
        db: state.db || '',
        table: state.table || '',
        page: state.page || 1,
        size: state.size || 10,
        sortCol: state.sortCol || '',
        sortDir: state.sortDir || '',
        filterCol: state.filterCol || '',
        filterOp: state.filterOp || 'contains',
        filterVal: state.filterVal || '',
        hiddenCols: Array.from(state.hiddenCols || []),
        equalWidth: Boolean(state.equalWidth),
        sql: sqlInput ? sqlInput.value : ''
    };
    try {
        localStorage.setItem(getConnLocalStateKey(currentConnId), JSON.stringify(snapshot));
    } catch (_) {}
}

/* ===== 连接卡片 ===== */
function renderConnFilterTabs() {
    const counts = { all: connections.length, postgresql: 0, mysql: 0, redis: 0 };
    connections.forEach(c => {
        const t = c.type || 'postgresql';
        if (counts[t] !== undefined) counts[t]++;
    });
    const labels = { all: '全部', postgresql: 'PostgreSQL', mysql: 'MySQL', redis: 'Redis' };
    document.querySelectorAll('#conn-filter-tabs .conn-tab').forEach(btn => {
        const t = btn.dataset.type;
        btn.classList.toggle('active', t === connFilterType);
        const cnt = counts[t] || 0;
        btn.innerHTML = `${labels[t]} <span class="conn-tab-count">${cnt}</span>`;
    });
}

async function loadConnections() {
    const data = await fetchJSON('/api/connections');
    connections = data.connections;
    if (currentConnId && !connections.some(c => c.id === currentConnId)) {
        currentConnId = null;
        if (currentView !== 'connections') showConnectionsView();
    }
    renderConnFilterTabs();
    renderCards();
    updateActiveConnBadges();
}

function renderCards() {
    const grid = document.getElementById('conn-cards');
    const filtered = connFilterType === 'all'
        ? connections
        : connections.filter(c => (c.type || 'postgresql') === connFilterType);
    if (!filtered.length) {
        const msg = connections.length ? '当前类型下暂无连接' : '暂无连接，点击右上角新建连接';
        grid.innerHTML = `<div class="empty" style="grid-column:1/-1;">${emptyHtml(msg)}</div>`;
        return;
    }
    grid.innerHTML = filtered.map(c => {
        const typeLabel = connTypeLabel(c.type);
        const typeCls = connTypeClass(c.type);
        const metaAddr = c.user ? `${escapeHtml(c.user)}@${escapeHtml(c.host)}:${c.port}` : `${escapeHtml(c.host)}:${c.port}`;
        const remarkHtml = (c.remark || '').trim()
            ? `<div class="card-remark" title="${escapeHtml(c.remark.trim())}">${escapeHtml(c.remark.trim())}</div>`
            : '';
        return `
        <div class="conn-card ${typeCls}" data-id="${escapeHtml(c.id)}">
            <div class="card-header">
                <div class="card-type-group">
                    <div class="card-icon">${connTypeIcon(c.type)}</div>
                    <span class="card-type-tag">${typeLabel}</span>
                </div>
                <div class="card-actions">
                    <button type="button" class="btn-icon edit" title="编辑" aria-label="编辑连接">${SELECT_ICONS.edit}</button>
                    <button type="button" class="btn-icon delete" title="删除" aria-label="删除连接">${SELECT_ICONS.trash}</button>
                </div>
            </div>
            <div class="card-name">${escapeHtml(c.name)}</div>
            <div class="card-meta">${metaAddr}</div>
            ${remarkHtml}
        </div>
    `}).join('');

    grid.querySelectorAll('.conn-card').forEach(card => {
        const id = card.dataset.id;
        card.addEventListener('click', async (e) => {
            if (e.target.closest('.btn-icon')) return;
            await useConnection(id, 'data');
        });
        card.querySelector('.edit').addEventListener('click', () => openEditModal(id));
        card.querySelector('.delete').addEventListener('click', () => {
            showConfirm('确定删除此连接？删除后不可恢复', async () => {
                await fetchJSON(`/api/connections/${id}`, { method: 'DELETE' });
                await loadConnections();
            }, null, { confirmText: '删除', danger: true });
        });
    });
}

function resetTableViewState() {
    state.page = 1;
    state.sortCol = '';
    state.sortDir = '';
    state.colWidths = {};
    state.equalWidth = false;
    state.hiddenCols = new Set();
    state.allColumns = [];
    state.columnTypes = {};
    state.lastTableData = null;
    state.filterCol = '';
    state.filterOp = 'contains';
    state.filterVal = '';
    const btnEqual = document.getElementById('btn-equal-width');
    if (btnEqual) btnEqual.classList.remove('active');
    const filterValInput = document.getElementById('filter-val-input');
    if (filterValInput) {
        filterValInput.value = '';
        filterValInput.classList.remove('hidden');
    }
    const filterOpSel = document.getElementById('filter-op-select');
    if (filterOpSel) {
        filterOpSel.value = 'contains';
        syncCustomSelect(filterOpSel);
    }
    const filterBar = document.getElementById('filter-bar');
    if (filterBar) filterBar.classList.add('hidden');
    updateFilterUIState();
}

function updateFilterUIState() {
    const hasFilter = Boolean(
        state.filterCol && (
            state.filterOp === 'isnull' ||
            state.filterOp === 'notnull' ||
            state.filterVal !== ''
        )
    );
    const btn = document.getElementById('btn-toggle-filter');
    const badge = document.getElementById('filter-badge');
    if (btn) btn.classList.toggle('active', hasFilter);
    if (badge) badge.classList.toggle('hidden', !hasFilter);
}

function syncConnTypeLabels() {
    const isRedis = currentConnType === 'redis';
    const labelAddRow = document.getElementById('label-add-row');
    const sqlLabel = document.getElementById('sql-editor-label');
    if (labelAddRow) labelAddRow.textContent = isRedis ? '新增 Key' : '新增记录';
    if (sqlLabel) sqlLabel.textContent = isRedis ? 'Redis 命令' : 'SQL 编辑器';
}

async function useConnection(id, targetView = 'data') {
    try {
        await fetchJSON(`/api/connections/${id}/use`, { method: 'POST' });
    } catch (err) {
        showAlert('连接失败: ' + (err.message || '无法连接到数据库，请检查服务是否启动'));
        return;
    }
    currentConnId = id;
    const conn = connections.find(c => c.id === id);
    currentConnType = conn?.type || 'postgresql';
    syncConnTypeLabels();

    const serverHist = initData.states?.[id] || {};
    const localHist = loadConnLocalState(id);

    resetTableViewState();
    state.db = localHist.db || serverHist.db || (currentConnType === 'redis' ? 'db0' : '');
    state.table = localHist.table || serverHist.table || (currentConnType === 'redis' ? 'ALL' : '');
    state.page = Math.max(1, parseInt(localHist.page || 1, 10));
    state.size = [10, 20, 50, 100, 500].includes(Number(localHist.size)) ? Number(localHist.size) : 10;
    state.sortCol = localHist.sortCol || '';
    state.sortDir = localHist.sortDir || '';
    state.filterCol = localHist.filterCol || '';
    state.filterOp = localHist.filterOp || 'contains';
    state.filterVal = localHist.filterVal || '';
    state.hiddenCols = new Set(Array.isArray(localHist.hiddenCols) ? localHist.hiddenCols : []);
    state.equalWidth = Boolean(localHist.equalWidth);

    const pageSizeSel = document.getElementById('page-size');
    if (pageSizeSel) {
        pageSizeSel.value = String(state.size);
        syncCustomSelect(pageSizeSel);
    }
    document.getElementById('btn-equal-width')?.classList.toggle('active', state.equalWidth);

    const filterOpSel = document.getElementById('filter-op-select');
    const filterValInp = document.getElementById('filter-val-input');
    if (filterOpSel) {
        filterOpSel.value = state.filterOp;
        syncCustomSelect(filterOpSel);
    }
    if (filterValInp) {
        filterValInp.value = state.filterVal;
        filterValInp.classList.toggle('hidden', state.filterOp === 'isnull' || state.filterOp === 'notnull');
    }
    updateFilterUIState();

    const savedSql = localHist.sql || serverHist.sql || '';
    const sqlInput = document.getElementById('sql-input');
    if (sqlInput) {
        sqlInput.value = savedSql;
    }

    if (targetView === 'sql') {
        showSqlView();
        if (!savedSql) populateSqlDefaultInput();
    } else {
        showDataView();
    }
    await loadDatabases();
    await loadTables();
    await loadData();
}

function showConnectionsView() {
    currentView = 'connections';
    hideFloatingRowDel();
    document.getElementById('connections-view').classList.remove('hidden');
    document.getElementById('data-view').classList.add('hidden');
    document.getElementById('sql-view').classList.add('hidden');
    updateActiveConnBadges();
    updateUrlHash();
}

function showDataView() {
    if (!currentConnId) {
        showConnectionsView();
        return;
    }
    currentView = 'data';
    document.getElementById('connections-view').classList.add('hidden');
    document.getElementById('data-view').classList.remove('hidden');
    document.getElementById('sql-view').classList.add('hidden');
    updateActiveConnBadges();
    updateUrlHash();
}

function showSqlView() {
    if (!currentConnId) {
        showConnectionsView();
        return;
    }
    currentView = 'sql';
    hideFloatingRowDel();
    document.getElementById('connections-view').classList.add('hidden');
    document.getElementById('data-view').classList.add('hidden');
    document.getElementById('sql-view').classList.remove('hidden');
    updateActiveConnBadges();
    updateUrlHash();
    loadSqlDatabases();
    renderQueryHistoryMenu();
    const sqlInput = document.getElementById('sql-input');
    if (sqlInput && !sqlInput.value.trim()) {
        populateSqlDefaultInput();
    }
}

/* ===== 连接弹窗 ===== */
function syncModalFieldHints(connType) {
    const isRedis = connType === 'redis';
    document.getElementById('modal-user-hint').classList.toggle('hidden', !isRedis);
    document.getElementById('modal-pwd-hint').classList.toggle('hidden', !isRedis);
    document.getElementById('modal-user').placeholder = isRedis ? '默认留空' : (connType === 'mysql' ? 'root' : 'postgres');
}

function hideTestResult() {
    const el = document.getElementById('modal-test-result');
    el.classList.add('hidden');
    el.classList.remove('ok', 'err');
}

function openAddModal() {
    document.getElementById('modal-title').textContent = '新建连接';
    document.getElementById('modal-conn-id').value = '';
    document.getElementById('modal-name').value = '';
    document.getElementById('modal-type').value = 'postgresql';
    syncCustomSelect(document.getElementById('modal-type'));
    syncModalFieldHints('postgresql');
    document.getElementById('modal-host').value = 'localhost';
    document.getElementById('modal-port').value = '5432';
    document.getElementById('modal-user').value = '';
    document.getElementById('modal-password').value = '';
    document.getElementById('modal-remark').value = '';
    hideTestResult();
    document.getElementById('conn-modal').classList.remove('hidden');
}

function openEditModal(id) {
    const c = connections.find(x => x.id === id);
    if (!c) return;
    const t = c.type || 'postgresql';
    document.getElementById('modal-title').textContent = '编辑连接';
    document.getElementById('modal-conn-id').value = c.id;
    document.getElementById('modal-name').value = c.name;
    document.getElementById('modal-type').value = t;
    syncCustomSelect(document.getElementById('modal-type'));
    syncModalFieldHints(t);
    document.getElementById('modal-host').value = c.host;
    document.getElementById('modal-port').value = c.port;
    document.getElementById('modal-user').value = c.user || '';
    document.getElementById('modal-password').value = c.password || '';
    document.getElementById('modal-remark').value = c.remark || '';
    hideTestResult();
    document.getElementById('conn-modal').classList.remove('hidden');
}

function closeModal() {
    document.getElementById('conn-modal').classList.add('hidden');
}

function buildConnFormBody() {
    const body = new URLSearchParams();
    body.append('name', document.getElementById('modal-name').value.trim() || '未命名连接');
    body.append('conn_type', document.getElementById('modal-type').value);
    body.append('host', document.getElementById('modal-host').value.trim() || 'localhost');
    body.append('port', document.getElementById('modal-port').value.trim() || '5432');
    body.append('user', document.getElementById('modal-user').value.trim());
    body.append('password', document.getElementById('modal-password').value);
    body.append('remark', document.getElementById('modal-remark').value.trim());
    return body;
}

async function testModalConnection() {
    const btn = document.getElementById('btn-test-conn');
    const resEl = document.getElementById('modal-test-result');
    btn.disabled = true;
    btn.textContent = '测试中...';
    hideTestResult();
    try {
        const body = buildConnFormBody();
        await fetchJSON('/api/connections/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body
        });
        resEl.textContent = '连接成功';
        resEl.classList.add('ok');
        resEl.classList.remove('hidden');
    } catch (err) {
        resEl.textContent = '连接失败: ' + err.message;
        resEl.classList.add('err');
        resEl.classList.remove('hidden');
    } finally {
        btn.disabled = false;
        btn.textContent = '测试连接';
    }
}

async function saveModal() {
    const id = document.getElementById('modal-conn-id').value;
    const body = buildConnFormBody();
    try {
        if (id) {
            await fetchJSON(`/api/connections/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
        } else {
            await fetchJSON('/api/connections', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
        }
        closeModal();
        await loadConnections();
    } catch (err) {
        showAlert('保存失败: ' + err.message);
    }
}

/* ===== 数据查询与渲染 ===== */
async function loadDatabases() {
    const sel = document.getElementById('db-select');
    sel.innerHTML = '<option value="">选择数据库</option>';
    try {
        const data = await fetchJSON('/api/databases');
        data.databases.forEach(db => {
            const opt = document.createElement('option');
            opt.value = db; opt.textContent = db;
            if (db === state.db) opt.selected = true;
            sel.appendChild(opt);
        });
    } catch (err) {
        console.error('加载数据库失败:', err);
        sel.innerHTML = '<option value="">加载失败</option>';
    }
    syncCustomSelect(sel);
}

async function loadTables() {
    const sel = document.getElementById('table-select');
    sel.innerHTML = `<option value="">${currentConnType === 'redis' ? '选择类型' : '选择表'}</option>`;
    if (!state.db) {
        syncCustomSelect(sel);
        return;
    }
    try {
        const data = await fetchJSON(`/api/tables?db=${encodeURIComponent(state.db)}`);
        data.tables.forEach(t => {
            const opt = document.createElement('option');
            opt.value = t;
            opt.textContent = (currentConnType === 'redis' && t === 'ALL') ? '全部类型 (ALL)' : t;
            if (t === state.table) opt.selected = true;
            sel.appendChild(opt);
        });
    } catch (err) {
        console.error('加载表失败:', err);
        sel.innerHTML = '<option value="">加载失败</option>';
    }
    syncCustomSelect(sel);
}

function colWidthStyle(widthMap, col, equalCount = 0) {
    const w = widthMap && widthMap[col];
    if (w) {
        return ` style="width:${w}px;min-width:${w}px;max-width:${w}px;"`;
    }
    if (equalCount > 0) {
        const pct = (100 / equalCount).toFixed(4);
        return ` style="width:${pct}%;min-width:72px;"`;
    }
    return '';
}

function attachColumnResizers(tableEl, widthMap) {
    const ths = Array.from(tableEl.querySelectorAll('thead th:not(.row-index-col):not(.row-action-col)'));
    ths.forEach((th) => {
        const resizer = th.querySelector('.col-resizer');
        if (!resizer) return;
        const colName = th.dataset.col;
        const domIdx = Array.from(th.parentNode.children).indexOf(th);
        resizer.addEventListener('click', (e) => e.stopPropagation());
        resizer.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (tableEl.classList.contains('equal-width')) {
                ths.forEach((h) => {
                    const cw = Math.round(h.getBoundingClientRect().width);
                    const cname = h.dataset.col;
                    const hDomIdx = Array.from(h.parentNode.children).indexOf(h);
                    if (widthMap && cname) widthMap[cname] = cw;
                    h.style.width = cw + 'px';
                    h.style.minWidth = cw + 'px';
                    h.style.maxWidth = cw + 'px';
                    tableEl.querySelectorAll('tbody tr').forEach(tr => {
                        const cell = tr.children[hDomIdx];
                        if (cell && !cell.hasAttribute('colspan') && !cell.classList.contains('row-action-col') && !cell.classList.contains('row-index-col')) {
                            cell.style.width = cw + 'px';
                            cell.style.minWidth = cw + 'px';
                            cell.style.maxWidth = cw + 'px';
                        }
                    });
                });
                tableEl.classList.remove('equal-width');
                if (tableEl.id === 'data-table') {
                    state.equalWidth = false;
                    const btnEqual = document.getElementById('btn-equal-width');
                    if (btnEqual) btnEqual.classList.remove('active');
                }
            }
            const startX = e.clientX;
            const startWidth = th.getBoundingClientRect().width;
            resizer.classList.add('resizing');
            document.body.classList.add('col-resizing');

            const onMouseMove = (moveEvent) => {
                const newWidth = Math.max(64, Math.round(startWidth + (moveEvent.clientX - startX)));
                if (widthMap && colName) {
                    widthMap[colName] = newWidth;
                }
                th.style.width = newWidth + 'px';
                th.style.minWidth = newWidth + 'px';
                th.style.maxWidth = newWidth + 'px';
                tableEl.querySelectorAll('tbody tr').forEach(tr => {
                    const td = tr.children[domIdx];
                    if (td && !td.hasAttribute('colspan') && !td.classList.contains('row-action-col') && !td.classList.contains('row-index-col')) {
                        td.style.width = newWidth + 'px';
                        td.style.minWidth = newWidth + 'px';
                        td.style.maxWidth = newWidth + 'px';
                    }
                });
            };

            const onMouseUp = () => {
                resizer.classList.remove('resizing');
                document.body.classList.remove('col-resizing');
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
            };

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });
    });
}

function updateColPickerLabel() {
    const labelEl = document.getElementById('col-picker-label');
    const picker = document.getElementById('col-picker');
    if (!labelEl || !picker) return;
    const total = state.allColumns.length;
    const visible = total - state.hiddenCols.size;
    if (state.hiddenCols.size === 0) {
        labelEl.textContent = `显示字段 (${total})`;
        picker.classList.remove('has-value');
    } else {
        labelEl.textContent = `显示字段 (${visible}/${total})`;
        picker.classList.add('has-value');
    }
}

function renderColPickerList(filter = '') {
    const listEl = document.getElementById('col-picker-list');
    if (!listEl) return;
    const kw = filter.trim().toLowerCase();
    const cols = state.allColumns.filter(c => !kw || c.toLowerCase().includes(kw));
    listEl.innerHTML = '';
    if (!cols.length) {
        listEl.innerHTML = '<div class="custom-select-empty">无匹配字段</div>';
        return;
    }
    cols.forEach(c => {
        const item = document.createElement('label');
        item.className = 'col-picker-item';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = !state.hiddenCols.has(c);
        cb.addEventListener('change', () => {
            if (!cb.checked) {
                if (state.hiddenCols.size >= state.allColumns.length - 1) {
                    cb.checked = true;
                    showToast('至少保留一个显示字段');
                    return;
                }
                state.hiddenCols.add(c);
            } else {
                state.hiddenCols.delete(c);
            }
            updateColPickerLabel();
            saveConnLocalState();
            if (state.lastTableData) renderDataTable(state.lastTableData);
        });
        const span = document.createElement('span');
        span.textContent = c;
        item.appendChild(cb);
        item.appendChild(span);
        listEl.appendChild(item);
    });
}

function syncTableColumnsUI(columns, colTypes = {}) {
    const ids = ['col-picker', 'btn-equal-width', 'btn-toggle-filter', 'view-opts-picker', 'btn-refresh-data', 'btn-add-row', 'export-picker', 'toolbar-div-1', 'toolbar-div-2'];
    const prevKey = state.allColumns.join('\0');
    const nextKey = columns.join('\0');
    state.allColumns = columns.slice();
    state.columnTypes = colTypes || {};

    if (!columns.length) {
        ids.forEach(id => document.getElementById(id)?.classList.add('hidden'));
        return;
    }
    ids.forEach(id => document.getElementById(id)?.classList.remove('hidden'));

    updateColPickerLabel();
    const searchInput = document.getElementById('col-picker-search');
    renderColPickerList(searchInput ? searchInput.value : '');

    if (prevKey !== nextKey) {
        const filterColSel = document.getElementById('filter-col-select');
        if (filterColSel) {
            filterColSel.innerHTML = '<option value="">选择字段</option>';
            columns.forEach(c => {
                const opt = document.createElement('option');
                opt.value = c;
                opt.textContent = c;
                if (c === state.filterCol) opt.selected = true;
                filterColSel.appendChild(opt);
            });
            syncCustomSelect(filterColSel);
        }
    }
}

function renderCellInnerHtml(val, colName = '') {
    const expandBtn = `<button type="button" class="cell-expand-btn" title="展开详情编辑器">${SELECT_ICONS.expand}</button>`;
    if (val === null || val === undefined) {
        return `<span class="null-badge">NULL</span>${expandBtn}`;
    }
    if (typeof val === 'boolean') {
        return `<span class="bool-badge ${val ? 'is-true' : 'is-false'}">${val ? 'true' : 'false'}</span>${expandBtn}`;
    }
    const formatted = formatCellValue(val);
    if (currentConnType === 'redis') {
        if (colName === 'type') {
            const safeT = escapeHtml(formatted.toLowerCase());
            return `<span class="redis-type-badge redis-type-${safeT}">${escapeHtml(formatted)}</span>${expandBtn}`;
        }
        if (colName === 'ttl') {
            const num = Number(val);
            if (num === -1) return `<span class="ttl-forever">永久 (-1)</span>${expandBtn}`;
            if (!Number.isNaN(num) && num >= 0) return `<span class="ttl-sec">${escapeHtml(String(num))}s</span>${expandBtn}`;
        }
    }
    const trimmed = formatted.trim();
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
        return `<span class="cell-json">${escapeHtml(formatted)}</span>${expandBtn}`;
    }
    return `<span class="cell-text">${escapeHtml(formatted)}</span>${expandBtn}`;
}

/* ===== 行外侧悬浮删除按钮 ===== */
let floatingDelTarget = null;
let hideFloatingDelTimer = null;

function hideFloatingRowDel() {
    if (hideFloatingDelTimer) {
        clearTimeout(hideFloatingDelTimer);
        hideFloatingDelTimer = null;
    }
    const btn = document.getElementById('floating-row-del');
    if (btn) btn.classList.add('hidden');
    if (floatingDelTarget?.tr) {
        floatingDelTarget.tr.classList.remove('row-del-target');
    }
    floatingDelTarget = null;
}

function scheduleHideFloatingRowDel() {
    if (hideFloatingDelTimer) clearTimeout(hideFloatingDelTimer);
    hideFloatingDelTimer = setTimeout(hideFloatingRowDel, 180);
}

function showFloatingRowDel(tr, pkColumn, pkVal) {
    if (hideFloatingDelTimer) {
        clearTimeout(hideFloatingDelTimer);
        hideFloatingDelTimer = null;
    }
    const stage = document.getElementById('data-table-stage');
    const wrap = document.getElementById('table-wrap');
    const btn = document.getElementById('floating-row-del');
    if (!stage || !wrap || !btn) return;

    const stageRect = stage.getBoundingClientRect();
    const wrapRect = wrap.getBoundingClientRect();
    const trRect = tr.getBoundingClientRect();
    const centerY = trRect.top + trRect.height / 2;
    if (centerY < wrapRect.top + 36 || centerY > wrapRect.bottom) {
        hideFloatingRowDel();
        return;
    }

    if (floatingDelTarget?.tr && floatingDelTarget.tr !== tr) {
        floatingDelTarget.tr.classList.remove('row-del-target');
    }
    tr.classList.add('row-del-target');
    floatingDelTarget = { tr, pkColumn, pkVal };

    btn.style.top = `${Math.round(centerY - stageRect.top)}px`;
    btn.classList.toggle('dock-inside', window.innerWidth - stageRect.right < 42);
    btn.classList.remove('hidden');
}

function renderDataTable(data) {
    hideFloatingRowDel();
    const tableEl = document.getElementById('data-table');
    const thead = tableEl.querySelector('thead');
    const tbody = tableEl.querySelector('tbody');
    const visibleCols = data.columns.filter(c => !state.hiddenCols.has(c));
    const equalCount = state.equalWidth ? visibleCols.length : 0;
    const colTypes = data.column_types || {};
    tableEl.classList.toggle('equal-width', Boolean(state.equalWidth && visibleCols.length > 0));

    const showIndex = Boolean(viewPrefs.showRowIndex);
    const showTypes = Boolean(viewPrefs.showColTypes);

    const indexTh = showIndex ? '<th class="row-index-col">#</th>' : '';

    thead.innerHTML = '<tr>' + indexTh + visibleCols.map(c => {
        const isSorted = state.sortCol === c;
        const dirClass = isSorted ? (state.sortDir === 'desc' ? ' sort-active sort-desc' : ' sort-active sort-asc') : '';
        const isPk = data.pk && data.pk === c;
        const pkBadge = (isPk && showTypes) ? '<span class="pk-badge" title="主键列 (Primary Key)">PK</span>' : '';
        const typeSub = (showTypes && colTypes[c]) ? `<span class="col-type-sub">${escapeHtml(colTypes[c])}</span>` : '';
        return `<th class="sortable${dirClass}" data-col="${escapeHtml(c)}"${colWidthStyle(state.colWidths, c, equalCount)} title="点击切换排序"><span class="th-inner"><span class="th-col-stack"><span class="th-col-name"><span>${escapeHtml(c)}</span>${pkBadge}</span>${typeSub}</span><span class="sort-icon"><span class="sort-arrow up"></span><span class="sort-arrow down"></span></span></span><span class="col-resizer" title="左右拖动调整列宽"></span></th>`;
    }).join('') + '</tr>';

    thead.querySelectorAll('th.sortable').forEach(th => {
        th.addEventListener('click', async (e) => {
            if (e.target.closest('.col-resizer')) return;
            const col = th.dataset.col;
            if (state.sortCol !== col) {
                state.sortCol = col;
                state.sortDir = 'asc';
            } else if (state.sortDir === 'asc') {
                state.sortDir = 'desc';
            } else {
                state.sortCol = '';
                state.sortDir = '';
            }
            state.page = 1;
            saveConnLocalState();
            await loadData();
        });
    });

    if (!data.data.length) {
        tbody.innerHTML = `<tr><td colspan="100" class="empty">${emptyHtml('当前条件下暂无数据')}</td></tr>`;
    } else {
        const pkColumn = data.pk || data.columns[0];
        const rowOffset = (state.page - 1) * state.size;
        tbody.innerHTML = data.data.map((row, rIdx) => {
            const seq = rowOffset + rIdx + 1;
            const indexTd = showIndex ? `<td class="row-index-col">${seq}</td>` : '';
            const cellsHtml = visibleCols.map(c => {
                const rawVal = row[c];
                const isNull = rawVal === null || rawVal === undefined;
                return `<td class="editable-cell" data-isnull="${isNull ? '1' : '0'}"${colWidthStyle(state.colWidths, c, equalCount)}>${renderCellInnerHtml(rawVal, c)}</td>`;
            }).join('');
            return `<tr>${indexTd}${cellsHtml}</tr>`;
        }).join('');

        tbody.querySelectorAll('tr').forEach((tr, rowIdx) => {
            const rowObj = data.data[rowIdx];
            const pkVal = rowObj[pkColumn];

            tr.addEventListener('mouseenter', () => {
                showFloatingRowDel(tr, pkColumn, pkVal);
            });
            tr.addEventListener('mouseleave', () => {
                scheduleHideFloatingRowDel();
            });

            tr.querySelectorAll('td.editable-cell').forEach((td, colIdx) => {
                const colName = visibleCols[colIdx];
                const rawVal = rowObj[colName];
                td.dataset.pk = String(pkVal ?? '');
                td.dataset.col = colName;
                td.dataset.raw = rawVal === null || rawVal === undefined ? '' : formatCellValue(rawVal);

                let clickTimer = null;

                td.querySelector('.cell-expand-btn')?.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
                    openCellModal({
                        readonly: false,
                        db: state.db,
                        table: state.table,
                        pkColumn,
                        pkVal: String(pkVal ?? ''),
                        colName,
                        colType: colTypes[colName] || '',
                        isNull: td.dataset.isnull === '1',
                        value: td.dataset.raw
                    });
                });

                td.addEventListener('click', (e) => {
                    if (td.querySelector('input') || e.target.closest('.cell-expand-btn')) return;
                    if (clickTimer) clearTimeout(clickTimer);
                    clickTimer = setTimeout(() => {
                        clickTimer = null;
                        if (!td.querySelector('input')) {
                            copyText(td.dataset.isnull === '1' ? 'NULL' : td.dataset.raw);
                        }
                    }, 200);
                });

                td.addEventListener('dblclick', (e) => {
                    if (e.target.closest('.cell-expand-btn')) return;
                    if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
                    startEdit(td, state.db, state.table, pkColumn);
                });
            });
        });
    }

    attachColumnResizers(tableEl, state.colWidths);
}

async function loadData() {
    const wrap = document.getElementById('table-wrap');
    const refreshIcon = document.getElementById('icon-refresh');
    const thead = document.querySelector('#data-table thead');
    const tbody = document.querySelector('#data-table tbody');
    const pagination = document.getElementById('pagination');
    if (!state.db || !state.table) {
        thead.innerHTML = '';
        tbody.innerHTML = `<tr><td colspan="100" class="empty">${emptyHtml(currentConnType === 'redis' ? '请选择 Redis 库与数据类型' : '请选择数据库和数据表')}</td></tr>`;
        pagination.classList.add('hidden');
        syncTableColumnsUI([]);
        return;
    }
    wrap?.classList.add('loading');
    refreshIcon?.classList.add('spinning');
    try {
        let url = `/api/data?db=${encodeURIComponent(state.db)}&table=${encodeURIComponent(state.table)}&page=${state.page}&size=${state.size}`;
        if (state.sortCol) {
            url += `&sort_col=${encodeURIComponent(state.sortCol)}&sort_dir=${encodeURIComponent(state.sortDir || 'asc')}`;
        }
        if (state.filterCol && (state.filterOp === 'isnull' || state.filterOp === 'notnull' || state.filterVal !== '')) {
            url += `&filter_col=${encodeURIComponent(state.filterCol)}&filter_op=${encodeURIComponent(state.filterOp || 'contains')}&filter_val=${encodeURIComponent(state.filterVal)}`;
        }
        const data = await fetchJSON(url);
        state.lastTableData = data;
        syncTableColumnsUI(data.columns, data.column_types);
        renderDataTable(data);
        state.total = data.total;
        state.pages = Math.max(1, data.pages || 1);
        document.getElementById('page-num').textContent = state.page;
        document.getElementById('page-total').textContent = state.pages;
        document.getElementById('row-total').textContent = state.total;
        renderPageNumbers();
        pagination.classList.remove('hidden');
    } catch (err) {
        showAlert('加载数据失败: ' + err.message);
    } finally {
        wrap?.classList.remove('loading');
        refreshIcon?.classList.remove('spinning');
    }
}

/* ===== 内联编辑与详情弹窗编辑 ===== */
async function submitCellUpdate({ db, table, pkColumn, pkVal, colName, value, isNull }) {
    const body = new URLSearchParams();
    body.append('db', db);
    body.append('table', table);
    body.append('pk_col', pkColumn);
    body.append('pk_val', pkVal);
    body.append('column', colName);
    body.append('value', value);
    body.append('is_null', isNull ? '1' : '0');
    await fetchJSON('/api/data', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body
    });
}

async function startEdit(td, db, table, pkColumn) {
    if (td.querySelector('input')) return;
    if (currentConnType === 'redis' && td.dataset.col === 'type') {
        showToast('Redis Key 类型不可直接修改');
        return;
    }
    const wasNull = td.dataset.isnull === '1';
    const originalValue = td.dataset.raw || '';
    const pk = td.dataset.pk;
    const col = td.dataset.col;
    const tableEl = document.getElementById('data-table');
    const colIndex = Array.from(td.parentNode.children).indexOf(td);
    const th = tableEl.querySelectorAll('thead th')[colIndex];
    const tdRect = td.getBoundingClientRect();
    td.style.width = tdRect.width + 'px';
    td.style.height = tdRect.height + 'px';
    const thWidth = th ? th.getBoundingClientRect().width : tdRect.width;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = originalValue;
    input.className = 'cell-editor';
    input.style.width = thWidth + 'px';
    td.innerHTML = '';
    td.appendChild(input);
    input.focus();
    input.select();

    const restore = (val, isNullFlag) => {
        td.dataset.isnull = isNullFlag ? '1' : '0';
        td.dataset.raw = isNullFlag ? '' : val;
        td.innerHTML = renderCellInnerHtml(isNullFlag ? null : val, col);
        td.querySelector('.cell-expand-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            openCellModal({
                readonly: false,
                db,
                table,
                pkColumn,
                pkVal: pk,
                colName: col,
                colType: state.columnTypes[col] || '',
                isNull: td.dataset.isnull === '1',
                value: td.dataset.raw
            });
        });
        const savedWidth = state.colWidths[col];
        if (!savedWidth) {
            td.style.width = '';
            td.style.height = '';
        } else {
            td.style.height = '';
        }
    };

    let finished = false;
    const save = () => {
        if (finished) return;
        finished = true;
        const newValue = input.value;
        if (!wasNull && newValue === originalValue) {
            restore(originalValue, false);
            return;
        }
        if (wasNull && newValue === '') {
            restore('', true);
            return;
        }
        showConfirm('内容已修改，是否保存？', async () => {
            try {
                await submitCellUpdate({ db, table, pkColumn, pkVal: pk, colName: col, value: newValue, isNull: false });
                restore(newValue, false);
                showToast('已保存');
                if (currentConnType === 'redis' && col === 'key') {
                    await loadData();
                }
            } catch (err) {
                showAlert('保存失败: ' + err.message);
                restore(originalValue, wasNull);
            }
        }, () => {
            restore(originalValue, wasNull);
        }, { confirmText: '保存' });
    };

    const cancel = () => {
        if (finished) return;
        finished = true;
        restore(originalValue, wasNull);
    };

    input.addEventListener('blur', save);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    });
}

function openCellModal(ctx) {
    cellModalCtx = ctx;
    document.getElementById('cell-modal-title').textContent = ctx.readonly ? `查看字段 · ${ctx.colName}` : `编辑字段 · ${ctx.colName}`;
    const metaParts = [];
    if (ctx.colType) metaParts.push(ctx.colType);
    if (!ctx.readonly && ctx.pkColumn) metaParts.push(`${ctx.pkColumn} = ${ctx.pkVal}`);
    if (ctx.isNull) metaParts.push('当前值: NULL');
    document.getElementById('cell-modal-meta').textContent = metaParts.join(' · ');

    const ta = document.getElementById('cell-modal-textarea');
    let displayVal = ctx.value || '';
    try {
        const trimmed = displayVal.trim();
        if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
            displayVal = JSON.stringify(JSON.parse(trimmed), null, 2);
        }
    } catch (_) {}
    ta.value = displayVal;
    ta.readOnly = Boolean(ctx.readonly);

    const canSetNull = !ctx.readonly && currentConnType !== 'redis';
    document.getElementById('btn-cell-set-null').classList.toggle('hidden', !canSetNull);
    document.getElementById('btn-cell-save').classList.toggle('hidden', Boolean(ctx.readonly));
    document.getElementById('cell-modal').classList.remove('hidden');
    requestAnimationFrame(() => ta.focus());
}

function closeCellModal() {
    document.getElementById('cell-modal').classList.add('hidden');
    cellModalCtx = null;
}

/* ===== 新增记录 / 新增 Key 弹窗 ===== */
function openAddRowModal() {
    if (!state.db || !state.table) return;
    const container = document.getElementById('row-modal-fields');
    container.innerHTML = '';
    const isRedis = currentConnType === 'redis';
    document.getElementById('row-modal-title').textContent = isRedis ? `新增 Redis Key (${state.db})` : `新增记录 · ${state.table}`;

    if (isRedis) {
        container.innerHTML = `
            <div class="row-field-item">
                <div class="row-field-top"><span class="row-field-label">Key 名称</span></div>
                <input type="text" id="redis-new-key" class="row-field-input" placeholder="例如 user:1001">
            </div>
            <div class="row-field-item">
                <div class="row-field-top"><span class="row-field-label">数据类型</span></div>
                <select id="redis-new-type" class="row-field-input">
                    <option value="string">string</option>
                    <option value="hash">hash (JSON 对象)</option>
                    <option value="list">list (JSON 数组)</option>
                    <option value="set">set (JSON 数组)</option>
                    <option value="zset">zset ([[member, score], ...])</option>
                </select>
            </div>
            <div class="row-field-item">
                <div class="row-field-top"><span class="row-field-label">TTL 秒数 <span class="row-field-type">(-1 表示永不过期)</span></span></div>
                <input type="number" id="redis-new-ttl" class="row-field-input" value="-1">
            </div>
            <div class="row-field-item">
                <div class="row-field-top"><span class="row-field-label">Value 内容</span></div>
                <textarea id="redis-new-val" class="cell-modal-textarea" style="min-height:110px;" placeholder="输入字符串值"></textarea>
            </div>
        `;
        const typeSel = document.getElementById('redis-new-type');
        const valTa = document.getElementById('redis-new-val');
        if (state.table && state.table !== 'ALL') {
            typeSel.value = state.table;
        }
        const syncPlaceholder = () => {
            const map = {
                string: '输入字符串内容',
                hash: '{"name": "Alice", "role": "admin"}',
                list: '["item1", "item2"]',
                set: '["tag1", "tag2"]',
                zset: '[["member1", 10], ["member2", 20]]'
            };
            valTa.placeholder = map[typeSel.value] || '';
        };
        typeSel.addEventListener('change', syncPlaceholder);
        syncPlaceholder();
    } else {
        const pkCol = state.lastTableData?.pk || '';
        state.allColumns.forEach(col => {
            const cType = state.columnTypes[col] || '';
            const isDefaultSkip = col === pkCol || cType.includes('timestamp') || cType.includes('serial');
            const item = document.createElement('div');
            item.className = 'row-field-item';
            item.dataset.col = col;
            item.innerHTML = `
                <div class="row-field-top">
                    <span class="row-field-label">${escapeHtml(col)} <span class="row-field-type">${escapeHtml(cType)}</span></span>
                    <div class="row-field-checks">
                        <label><input type="checkbox" class="cb-skip"${isDefaultSkip ? ' checked' : ''}> 默认/跳过</label>
                        <label><input type="checkbox" class="cb-null"> NULL</label>
                    </div>
                </div>
                <input type="text" class="row-field-input" placeholder="${isDefaultSkip ? '使用数据库默认值' : '输入字段值'}"${isDefaultSkip ? ' disabled' : ''}>
            `;
            const cbSkip = item.querySelector('.cb-skip');
            const cbNull = item.querySelector('.cb-null');
            const inp = item.querySelector('.row-field-input');
            const syncInput = () => {
                inp.disabled = cbSkip.checked || cbNull.checked;
                if (cbSkip.checked) inp.placeholder = '使用数据库默认值';
                else if (cbNull.checked) inp.placeholder = 'NULL';
                else inp.placeholder = '输入字段值';
            };
            cbSkip.addEventListener('change', () => {
                if (cbSkip.checked) cbNull.checked = false;
                syncInput();
            });
            cbNull.addEventListener('change', () => {
                if (cbNull.checked) cbSkip.checked = false;
                syncInput();
            });
            container.appendChild(item);
        });
    }

    document.getElementById('row-modal').classList.remove('hidden');
}

function closeAddRowModal() {
    document.getElementById('row-modal').classList.add('hidden');
}

async function saveNewRow() {
    let payload = {};
    if (currentConnType === 'redis') {
        const key = document.getElementById('redis-new-key').value.trim();
        const type = document.getElementById('redis-new-type').value;
        const ttl = parseInt(document.getElementById('redis-new-ttl').value || '-1', 10);
        const value = document.getElementById('redis-new-val').value;
        if (!key) {
            showToast('请填写 Key 名称');
            return;
        }
        payload = { key, type, ttl: Number.isNaN(ttl) ? -1 : ttl, value };
    } else {
        document.querySelectorAll('#row-modal-fields .row-field-item').forEach(item => {
            const col = item.dataset.col;
            const skip = item.querySelector('.cb-skip').checked;
            const isNull = item.querySelector('.cb-null').checked;
            const val = item.querySelector('.row-field-input').value;
            if (!skip) {
                payload[col] = isNull ? null : val;
            }
        });
    }

    try {
        const body = new URLSearchParams();
        body.append('db', state.db);
        body.append('table', state.table);
        body.append('row_json', JSON.stringify(payload));
        await fetchJSON('/api/data', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body
        });
        closeAddRowModal();
        showToast('新增成功');
        await loadData();
    } catch (err) {
        showAlert('新增失败: ' + err.message);
    }
}

/* ===== 确认与提示框 ===== */
let confirmYesCallback = null;
let confirmNoCallback = null;

function showConfirm(message, onYes, onNo, opts = {}) {
    const yesBtn = document.getElementById('btn-confirm-yes');
    document.getElementById('confirm-message').textContent = message;
    yesBtn.textContent = opts.confirmText || '确定';
    yesBtn.classList.toggle('btn-danger', Boolean(opts.danger));
    yesBtn.classList.remove('hidden');
    document.getElementById('btn-confirm-no').classList.remove('hidden');
    document.getElementById('btn-confirm-ok').classList.add('hidden');
    document.getElementById('custom-confirm').classList.remove('hidden');
    confirmYesCallback = onYes;
    confirmNoCallback = onNo;
}

function showAlert(message) {
    document.getElementById('confirm-message').textContent = message;
    document.getElementById('btn-confirm-yes').classList.add('hidden');
    document.getElementById('btn-confirm-no').classList.add('hidden');
    document.getElementById('btn-confirm-ok').classList.remove('hidden');
    document.getElementById('custom-confirm').classList.remove('hidden');
    confirmYesCallback = null;
    confirmNoCallback = null;
}

document.getElementById('btn-confirm-yes').addEventListener('click', () => {
    document.getElementById('custom-confirm').classList.add('hidden');
    if (confirmYesCallback) confirmYesCallback();
});

document.getElementById('btn-confirm-no').addEventListener('click', () => {
    document.getElementById('custom-confirm').classList.add('hidden');
    if (confirmNoCallback) confirmNoCallback();
});

document.getElementById('btn-confirm-ok').addEventListener('click', () => {
    document.getElementById('custom-confirm').classList.add('hidden');
});

/* ===== 分页器 ===== */
function renderPageNumbers() {
    document.getElementById('btn-prev').disabled = state.page <= 1;
    document.getElementById('btn-first').disabled = state.page <= 1;
    document.getElementById('btn-next').disabled = state.page >= state.pages;
    document.getElementById('btn-last').disabled = state.page >= state.pages;

    const container = document.getElementById('page-numbers');
    container.innerHTML = '';
    let start = 1;
    let end = state.pages;
    if (state.pages > 5) {
        if (state.page <= 3) { start = 1; end = 5; }
        else if (state.page >= state.pages - 2) { start = state.pages - 4; end = state.pages; }
        else { start = state.page - 2; end = state.page + 2; }
    }
    for (let i = start; i <= end; i++) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = i;
        if (i === state.page) btn.classList.add('active');
        btn.addEventListener('click', async () => {
            if (i !== state.page) { state.page = i; saveConnLocalState(); await loadData(); }
        });
        container.appendChild(btn);
    }
}

/* ===== 导出 CSV / JSON ===== */
function exportRowsData(columns, rows, format, filePrefix) {
    if (!columns?.length || !rows?.length) {
        showToast('暂无可导出的数据');
        return;
    }
    let content = '';
    let mime = '';
    let ext = format;
    if (format === 'json') {
        const out = rows.map(r => {
            const obj = {};
            columns.forEach(c => { obj[c] = r[c] ?? null; });
            return obj;
        });
        content = JSON.stringify(out, null, 2);
        mime = 'application/json;charset=utf-8';
    } else {
        const escCsv = (v) => {
            if (v === null || v === undefined) return '';
            const s = formatCellValue(v);
            if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
            return s;
        };
        const lines = [
            columns.map(escCsv).join(','),
            ...rows.map(r => columns.map(c => escCsv(r[c])).join(','))
        ];
        content = '\uFEFF' + lines.join('\r\n');
        mime = 'text/csv;charset=utf-8';
    }
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filePrefix || 'export'}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(`已导出 ${ext.toUpperCase()}`);
}

/* ===== SQL 查询与命令历史 ===== */
function getHistoryKey() {
    return `dbpage_history_${currentConnId || 'default'}`;
}

function getQueryHistory() {
    try {
        return JSON.parse(localStorage.getItem(getHistoryKey()) || '[]');
    } catch (_) {
        return [];
    }
}

function addQueryHistory(sql) {
    const clean = sql.trim();
    if (!clean) return;
    const list = getQueryHistory().filter(item => item !== clean);
    list.unshift(clean);
    try {
        localStorage.setItem(getHistoryKey(), JSON.stringify(list.slice(0, 15)));
    } catch (_) {}
    renderQueryHistoryMenu();
}

function renderQueryHistoryMenu() {
    const listEl = document.getElementById('history-list');
    if (!listEl) return;
    const history = getQueryHistory();
    listEl.innerHTML = '';
    if (!history.length) {
        listEl.innerHTML = '<div class="custom-select-empty">暂无执行历史</div>';
        return;
    }
    history.forEach(cmd => {
        const item = document.createElement('div');
        item.className = 'custom-select-option';
        item.title = cmd;
        item.innerHTML = `<span class="history-item-code">${escapeHtml(cmd)}</span>`;
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            document.getElementById('sql-input').value = cmd;
            document.getElementById('history-picker').classList.remove('open');
        });
        listEl.appendChild(item);
    });
}

function populateSqlDefaultInput() {
    const sqlInput = document.getElementById('sql-input');
    const hist = initData.states?.[currentConnId] || {};
    sqlInput.placeholder = currentConnType === 'redis' ? 'KEYS * 或 GET mykey' : 'SELECT * FROM table_name LIMIT 10';
    if (hist.sql) {
        sqlInput.value = hist.sql;
    } else if (currentConnType === 'redis') {
        sqlInput.value = 'KEYS *';
    } else if (state.table) {
        const q = currentConnType === 'mysql' ? `\`${state.table}\`` : `"${state.table}"`;
        sqlInput.value = `SELECT * FROM ${q} LIMIT 10`;
    } else {
        sqlInput.value = 'SELECT * FROM table_name LIMIT 10';
    }
}

async function loadSqlDatabases() {
    const sel = document.getElementById('sql-db-select');
    sel.innerHTML = '<option value="">选择数据库</option>';
    try {
        const data = await fetchJSON('/api/databases');
        data.databases.forEach(db => {
            const opt = document.createElement('option');
            opt.value = db; opt.textContent = db;
            if (db === state.db) opt.selected = true;
            sel.appendChild(opt);
        });
    } catch (err) {
        console.error('加载数据库失败:', err);
        sel.innerHTML = '<option value="">加载失败</option>';
    }
    syncCustomSelect(sel);
}

async function runSqlQuery() {
    const sqlInput = document.getElementById('sql-input');
    const selText = sqlInput.value.substring(sqlInput.selectionStart, sqlInput.selectionEnd).trim();
    const sql = selText || sqlInput.value.trim();
    const errorEl = document.getElementById('sql-error');
    const wrap = document.getElementById('sql-table-wrap');
    if (!sql) return;
    if (!state.db) {
        errorEl.textContent = '请先选择数据库';
        errorEl.classList.remove('hidden');
        return;
    }
    errorEl.classList.add('hidden');
    wrap?.classList.add('loading');
    try {
        const body = new URLSearchParams();
        body.append('db', state.db);
        body.append('sql', sql);
        const data = await fetchJSON('/api/query', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
        lastSqlResultData = data;
        const sqlTableEl = document.getElementById('sql-result-table');
        const thead = sqlTableEl.querySelector('thead');
        const tbody = sqlTableEl.querySelector('tbody');
        sqlColWidths = {};

        const hasRows = Boolean(data.columns.length && data.data.length);
        document.getElementById('btn-export-sql-csv').classList.toggle('hidden', !hasRows);
        document.getElementById('btn-export-sql-json').classList.toggle('hidden', !hasRows);

        if (data.columns.length) {
            const sqlIndexTh = viewPrefs.showRowIndex ? '<th class="row-index-col">#</th>' : '';
            thead.innerHTML = '<tr>' + sqlIndexTh + data.columns.map(c => `<th data-col="${escapeHtml(c)}"><span class="th-inner"><span class="th-col-name">${escapeHtml(c)}</span></span><span class="col-resizer" title="左右拖动调整列宽"></span></th>`).join('') + '</tr>';
            if (!data.data.length) {
                tbody.innerHTML = `<tr><td colspan="100" class="empty">${emptyHtml('查询结果为空')}</td></tr>`;
            } else {
                tbody.innerHTML = data.data.map((row, rIdx) => {
                    const sqlIndexTd = viewPrefs.showRowIndex ? `<td class="row-index-col">${rIdx + 1}</td>` : '';
                    return `<tr>${sqlIndexTd}` + data.columns.map(c => {
                        const rawVal = row[c];
                        const isNull = rawVal === null || rawVal === undefined;
                        return `<td class="copyable-cell" data-isnull="${isNull ? '1' : '0'}">${renderCellInnerHtml(rawVal, c)}</td>`;
                    }).join('') + '</tr>';
                }).join('');

                tbody.querySelectorAll('tr').forEach((tr, rIdx) => {
                    const rowObj = data.data[rIdx];
                    tr.querySelectorAll('td.copyable-cell').forEach((td, cIdx) => {
                        const colName = data.columns[cIdx];
                        const rawVal = rowObj[colName];
                        const rawStr = rawVal === null || rawVal === undefined ? '' : formatCellValue(rawVal);
                        td.dataset.raw = rawStr;
                        td.querySelector('.cell-expand-btn')?.addEventListener('click', (e) => {
                            e.stopPropagation();
                            openCellModal({
                                readonly: true,
                                colName,
                                isNull: td.dataset.isnull === '1',
                                value: rawStr
                            });
                        });
                        td.addEventListener('click', (e) => {
                            if (e.target.closest('.cell-expand-btn')) return;
                            copyText(td.dataset.isnull === '1' ? 'NULL' : rawStr);
                        });
                    });
                });
            }
            attachColumnResizers(sqlTableEl, sqlColWidths);
        } else {
            thead.innerHTML = '';
            tbody.innerHTML = `<tr><td colspan="100" class="empty">执行成功，影响 ${data.rowcount} 行</td></tr>`;
        }
        addQueryHistory(sql);
        await saveState();
    } catch (err) {
        errorEl.textContent = err.message;
        errorEl.classList.remove('hidden');
    } finally {
        wrap?.classList.remove('loading');
    }
}

async function saveState() {
    if (!currentConnId) return;
    saveConnLocalState();
    const body = new URLSearchParams();
    if (state.db) body.append('db', state.db);
    if (state.table) body.append('table', state.table);
    const sql = document.getElementById('sql-input').value.trim();
    if (sql) body.append('sql', sql);
    try {
        await fetchJSON('/api/state', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
        if (!initData.states) initData.states = {};
        initData.states[currentConnId] = {
            db: state.db || null,
            table: state.table || null,
            sql: sql || null
        };
    } catch (e) {
        console.error('保存状态失败:', e);
    }
}

function formatCellValue(val) {
    if (val === null || val === undefined) return '';
    if (typeof val === 'object') {
        try { return JSON.stringify(val); } catch (_) { return String(val); }
    }
    if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/.test(val)) {
        const d = new Date(val);
        if (!isNaN(d.getTime())) {
            const pad = n => String(n).padStart(2, '0');
            return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
        }
    }
    return String(val);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

async function copyText(text) {
    const str = String(text ?? '');
    try {
        await navigator.clipboard.writeText(str);
        showToast('已复制');
    } catch (_) {
        const textarea = document.createElement('textarea');
        textarea.value = str;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        showToast('已复制');
    }
}

function showToast(message) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), 1500);
}

/* ===== 事件绑定 ===== */
const brandEl = document.querySelector('.brand');
brandEl.addEventListener('click', showConnectionsView);
brandEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        showConnectionsView();
    }
});

/* ===== 顶栏三页导航 & 顶栏连接胶囊切换绑定 ===== */
document.getElementById('nav-connections').addEventListener('click', showConnectionsView);
document.getElementById('nav-data').addEventListener('click', showDataView);
document.getElementById('nav-sql').addEventListener('click', showSqlView);

const activeConnTrigger = document.getElementById('active-conn-trigger');
const activeConnSwitcher = document.getElementById('active-conn-switcher');
if (activeConnTrigger && activeConnSwitcher) {
    activeConnTrigger.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = activeConnSwitcher.classList.contains('open');
        closeAllCustomSelects(activeConnSwitcher);
        activeConnSwitcher.classList.toggle('open', !isOpen);
    });
}

document.querySelectorAll('#conn-filter-tabs .conn-tab').forEach(btn => {
    btn.addEventListener('click', () => {
        connFilterType = btn.dataset.type || 'all';
        renderConnFilterTabs();
        renderCards();
    });
});

document.getElementById('btn-add-conn').addEventListener('click', openAddModal);
document.getElementById('btn-test-conn').addEventListener('click', testModalConnection);
document.getElementById('btn-cancel-conn').addEventListener('click', closeModal);
document.getElementById('btn-save-conn').addEventListener('click', saveModal);

document.getElementById('modal-type').addEventListener('change', (e) => {
    const t = e.target.value;
    document.getElementById('modal-port').value = t === 'mysql' ? '3306' : (t === 'redis' ? '6379' : '5432');
    syncModalFieldHints(t);
    hideTestResult();
});

document.getElementById('db-select').addEventListener('change', async (e) => {
    state.db = e.target.value;
    state.table = (currentConnType === 'redis' && state.db) ? 'ALL' : '';
    resetTableViewState();
    if (!state.db) {
        document.querySelector('#data-table thead').innerHTML = '';
        document.querySelector('#data-table tbody').innerHTML = '<tr><td colspan="100" class="empty">请选择数据库和表</td></tr>';
        document.getElementById('pagination').classList.add('hidden');
    }
    await loadTables();
    await loadData();
    await saveState();
});

document.getElementById('table-select').addEventListener('change', async (e) => {
    state.table = e.target.value;
    resetTableViewState();
    await loadData();
    await saveState();
});

document.getElementById('btn-refresh-data').addEventListener('click', async () => {
    await loadData();
});

document.getElementById('btn-add-row').addEventListener('click', openAddRowModal);
document.getElementById('btn-cancel-row').addEventListener('click', closeAddRowModal);
document.getElementById('btn-save-row').addEventListener('click', saveNewRow);

/* 单元格详情弹窗事件 */
document.getElementById('btn-cell-cancel').addEventListener('click', closeCellModal);
document.getElementById('btn-cell-copy').addEventListener('click', () => {
    copyText(document.getElementById('cell-modal-textarea').value);
});
document.getElementById('btn-cell-format-json').addEventListener('click', () => {
    const ta = document.getElementById('cell-modal-textarea');
    try {
        const parsed = JSON.parse(ta.value);
        ta.value = JSON.stringify(parsed, null, 2);
        showToast('JSON 已格式化');
    } catch (_) {
        showToast('当前内容不是有效的 JSON');
    }
});
document.getElementById('btn-cell-set-null').addEventListener('click', async () => {
    if (!cellModalCtx || cellModalCtx.readonly) return;
    try {
        await submitCellUpdate({
            db: cellModalCtx.db,
            table: cellModalCtx.table,
            pkColumn: cellModalCtx.pkColumn,
            pkVal: cellModalCtx.pkVal,
            colName: cellModalCtx.colName,
            value: '',
            isNull: true
        });
        closeCellModal();
        showToast('已设为 NULL');
        await loadData();
    } catch (err) {
        showAlert('更新失败: ' + err.message);
    }
});
document.getElementById('btn-cell-save').addEventListener('click', async () => {
    if (!cellModalCtx || cellModalCtx.readonly) return;
    const newVal = document.getElementById('cell-modal-textarea').value;
    try {
        await submitCellUpdate({
            db: cellModalCtx.db,
            table: cellModalCtx.table,
            pkColumn: cellModalCtx.pkColumn,
            pkVal: cellModalCtx.pkVal,
            colName: cellModalCtx.colName,
            value: newVal,
            isNull: false
        });
        closeCellModal();
        showToast('已保存');
        await loadData();
    } catch (err) {
        showAlert('保存失败: ' + err.message);
    }
});

/* 字段显示选择器事件 */
document.getElementById('col-picker-trigger').addEventListener('click', (e) => {
    e.stopPropagation();
    const picker = document.getElementById('col-picker');
    const isOpen = picker.classList.contains('open');
    closeAllCustomSelects(picker);
    if (isOpen) {
        picker.classList.remove('open');
    } else {
        const searchInput = document.getElementById('col-picker-search');
        if (searchInput) searchInput.value = '';
        renderColPickerList('');
        picker.classList.add('open');
        if (searchInput) requestAnimationFrame(() => searchInput.focus());
    }
});

document.getElementById('col-picker-search').addEventListener('input', (e) => {
    renderColPickerList(e.target.value);
});
document.getElementById('col-picker-search').addEventListener('click', (e) => e.stopPropagation());

document.getElementById('col-picker-all').addEventListener('click', (e) => {
    e.stopPropagation();
    state.hiddenCols.clear();
    updateColPickerLabel();
    renderColPickerList(document.getElementById('col-picker-search').value);
    if (state.lastTableData) renderDataTable(state.lastTableData);
});

document.getElementById('col-picker-invert').addEventListener('click', (e) => {
    e.stopPropagation();
    const nextHidden = new Set();
    state.allColumns.forEach(c => {
        if (!state.hiddenCols.has(c)) nextHidden.add(c);
    });
    if (nextHidden.size >= state.allColumns.length && state.allColumns.length > 0) {
        nextHidden.delete(state.allColumns[0]);
        showToast('已保留第一个字段显示');
    }
    state.hiddenCols = nextHidden;
    updateColPickerLabel();
    renderColPickerList(document.getElementById('col-picker-search').value);
    if (state.lastTableData) renderDataTable(state.lastTableData);
});

/* 导出菜单事件 */
document.getElementById('export-picker-trigger').addEventListener('click', (e) => {
    e.stopPropagation();
    const picker = document.getElementById('export-picker');
    const isOpen = picker.classList.contains('open');
    closeAllCustomSelects(picker);
    picker.classList.toggle('open', !isOpen);
});

document.querySelectorAll('#export-picker .custom-select-option').forEach(opt => {
    opt.addEventListener('click', (e) => {
        e.stopPropagation();
        document.getElementById('export-picker').classList.remove('open');
        if (!state.lastTableData) return;
        const visibleCols = state.lastTableData.columns.filter(c => !state.hiddenCols.has(c));
        exportRowsData(visibleCols, state.lastTableData.data, opt.dataset.format, `${state.db}_${state.table}`);
    });
});

/* 平分宽度切换事件 */
document.getElementById('btn-equal-width').addEventListener('click', () => {
    state.equalWidth = !state.equalWidth;
    state.colWidths = {};
    document.getElementById('btn-equal-width').classList.toggle('active', state.equalWidth);
    saveConnLocalState();
    if (state.lastTableData) {
        renderDataTable(state.lastTableData);
    }
});

/* 按字段筛选数据事件 */
document.getElementById('btn-toggle-filter').addEventListener('click', () => {
    const bar = document.getElementById('filter-bar');
    bar.classList.toggle('hidden');
});

document.getElementById('filter-op-select').addEventListener('change', (e) => {
    const op = e.target.value;
    const valInput = document.getElementById('filter-val-input');
    valInput.classList.toggle('hidden', op === 'isnull' || op === 'notnull');
});

async function applyFieldFilter() {
    const col = document.getElementById('filter-col-select').value;
    const op = document.getElementById('filter-op-select').value;
    const val = document.getElementById('filter-val-input').value.trim();
    if (!col) {
        showToast('请先选择筛选字段');
        return;
    }
    state.filterCol = col;
    state.filterOp = op;
    state.filterVal = val;
    state.page = 1;
    updateFilterUIState();
    saveConnLocalState();
    await loadData();
}

document.getElementById('btn-apply-filter').addEventListener('click', applyFieldFilter);
document.getElementById('filter-val-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') applyFieldFilter();
});

document.getElementById('btn-clear-filter').addEventListener('click', async () => {
    state.filterCol = '';
    state.filterOp = 'contains';
    state.filterVal = '';
    state.page = 1;
    document.getElementById('filter-col-select').value = '';
    document.getElementById('filter-op-select').value = 'contains';
    const valInput = document.getElementById('filter-val-input');
    valInput.value = '';
    valInput.classList.remove('hidden');
    syncCustomSelect(document.getElementById('filter-col-select'));
    syncCustomSelect(document.getElementById('filter-op-select'));
    updateFilterUIState();
    saveConnLocalState();
    await loadData();
});

document.getElementById('page-size').addEventListener('change', async (e) => {
    state.size = parseInt(e.target.value, 10);
    state.page = 1;
    saveConnLocalState();
    await loadData();
});

document.getElementById('btn-first').addEventListener('click', async () => { if (state.page > 1) { state.page = 1; saveConnLocalState(); await loadData(); } });
document.getElementById('btn-prev').addEventListener('click', async () => { if (state.page > 1) { state.page--; saveConnLocalState(); await loadData(); } });
document.getElementById('btn-next').addEventListener('click', async () => { if (state.page < state.pages) { state.page++; saveConnLocalState(); await loadData(); } });
document.getElementById('btn-last').addEventListener('click', async () => { if (state.page < state.pages) { state.page = state.pages; saveConnLocalState(); await loadData(); } });

document.getElementById('sql-db-select').addEventListener('change', async (e) => {
    state.db = e.target.value;
    await saveState();
});

let sqlDraftTimer = null;
document.getElementById('sql-input').addEventListener('input', () => {
    if (sqlDraftTimer) clearTimeout(sqlDraftTimer);
    sqlDraftTimer = setTimeout(() => {
        saveConnLocalState();
    }, 300);
});

document.getElementById('history-picker-trigger').addEventListener('click', (e) => {
    e.stopPropagation();
    const picker = document.getElementById('history-picker');
    const isOpen = picker.classList.contains('open');
    closeAllCustomSelects(picker);
    if (!isOpen) renderQueryHistoryMenu();
    picker.classList.toggle('open', !isOpen);
});

document.getElementById('btn-export-sql-csv').addEventListener('click', () => {
    if (lastSqlResultData) exportRowsData(lastSqlResultData.columns, lastSqlResultData.data, 'csv', `${state.db}_query`);
});
document.getElementById('btn-export-sql-json').addEventListener('click', () => {
    if (lastSqlResultData) exportRowsData(lastSqlResultData.columns, lastSqlResultData.data, 'json', `${state.db}_query`);
});

document.getElementById('btn-run-sql').addEventListener('click', runSqlQuery);
document.getElementById('sql-input').addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        runSqlQuery();
    }
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        if (!document.getElementById('cell-modal').classList.contains('hidden')) closeCellModal();
        else if (!document.getElementById('row-modal').classList.contains('hidden')) closeAddRowModal();
        else if (!document.getElementById('conn-modal').classList.contains('hidden')) closeModal();
        else if (!document.getElementById('custom-confirm').classList.contains('hidden')) {
            document.getElementById('custom-confirm').classList.add('hidden');
            if (confirmNoCallback) confirmNoCallback();
        }
    }
});

/* ===== 初始化 ===== */
function initCustomSelects() {
    createCustomSelect(document.getElementById('db-select'), {
        icon: 'db',
        searchable: true,
        searchPlaceholder: '搜索数据库'
    });
    createCustomSelect(document.getElementById('table-select'), {
        icon: 'table',
        searchable: true,
        searchPlaceholder: '搜索表或类型'
    });
    createCustomSelect(document.getElementById('sql-db-select'), {
        icon: 'db',
        searchable: true,
        searchPlaceholder: '搜索数据库'
    });
    createCustomSelect(document.getElementById('page-size'), {
        upward: true,
        compact: true
    });
    createCustomSelect(document.getElementById('modal-type'));
    createCustomSelect(document.getElementById('filter-col-select'), {
        searchable: true,
        searchPlaceholder: '搜索字段'
    });
    createCustomSelect(document.getElementById('filter-op-select'));
}

/* 视图设置开关事件 */
document.getElementById('view-opts-trigger').addEventListener('click', (e) => {
    e.stopPropagation();
    const picker = document.getElementById('view-opts-picker');
    const isOpen = picker.classList.contains('open');
    closeAllCustomSelects(picker);
    picker.classList.toggle('open', !isOpen);
});

document.getElementById('view-opts-picker').querySelector('.view-opts-menu').addEventListener('click', (e) => {
    e.stopPropagation();
});

document.getElementById('opt-show-col-types').addEventListener('change', (e) => {
    viewPrefs.showColTypes = e.target.checked;
    saveViewPrefs();
    if (state.lastTableData) renderDataTable(state.lastTableData);
});

document.getElementById('opt-show-row-index').addEventListener('change', (e) => {
    viewPrefs.showRowIndex = e.target.checked;
    saveViewPrefs();
    if (state.lastTableData) renderDataTable(state.lastTableData);
});

/* 行外侧悬浮删除按钮事件 */
const floatingDelBtn = document.getElementById('floating-row-del');
floatingDelBtn.addEventListener('mouseenter', () => {
    if (hideFloatingDelTimer) {
        clearTimeout(hideFloatingDelTimer);
        hideFloatingDelTimer = null;
    }
});
floatingDelBtn.addEventListener('mouseleave', () => {
    scheduleHideFloatingRowDel();
});
floatingDelBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!floatingDelTarget) return;
    const { pkColumn, pkVal } = floatingDelTarget;
    if (pkVal === null || pkVal === undefined || pkVal === '') {
        showAlert('当前行缺少有效主键值，无法直接按主键删除');
        return;
    }
    const targetDesc = `${pkColumn} = ${pkVal}`;
    hideFloatingRowDel();
    showConfirm(`确定删除此条记录 (${targetDesc})？`, async () => {
        try {
            const q = `db=${encodeURIComponent(state.db)}&table=${encodeURIComponent(state.table)}&pk_col=${encodeURIComponent(pkColumn)}&pk_val=${encodeURIComponent(String(pkVal))}`;
            await fetchJSON(`/api/data?${q}`, { method: 'DELETE' });
            showToast('已删除');
            await loadData();
        } catch (err) {
            showAlert('删除失败: ' + err.message);
        }
    }, null, { confirmText: '删除', danger: true });
});

document.getElementById('table-wrap').addEventListener('scroll', hideFloatingRowDel);

async function init() {
    initCustomSelects();
    syncViewPrefsUI();
    initData = await fetchJSON('/api/init');
    await loadConnections();

    const hashState = parseUrlHash();
    const resumeConnId = hashState.conn && connections.some(c => c.id === hashState.conn) ? hashState.conn : '';
    if (resumeConnId) {
        await useConnection(resumeConnId, hashState.view === 'sql' ? 'sql' : 'data');
    }
}
init();
