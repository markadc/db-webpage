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
    lastTableData: null,
    filterCol: '',
    filterOp: 'contains',
    filterVal: ''
};
let sqlColWidths = {};
let connections = [];
let currentConnId = null;
let currentConnType = 'postgresql';
let initData = {};

const SELECT_ICONS = {
    db: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/><path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3"/></svg>',
    table: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18"/><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/></svg>',
    chevron: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
    search: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>',
    check: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
    edit: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z"/></svg>',
    trash: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>'
};

const customSelectInstances = [];

function closeAllCustomSelects(except = null) {
    customSelectInstances.forEach(inst => {
        if (inst !== except) inst.close();
    });
    const colPicker = document.getElementById('col-picker');
    if (colPicker && except !== colPicker) {
        colPicker.classList.remove('open');
    }
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
        searchPlaceholder = '搜索...',
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
    if (!r.ok) { const e = await r.json(); throw new Error(e.detail || '请求失败'); }
    return r.json();
}

/* ===== 连接卡片 ===== */
async function loadConnections() {
    const data = await fetchJSON('/api/connections');
    connections = data.connections;
    renderCards();
}

function renderCards() {
    const grid = document.getElementById('conn-cards');
    if (!connections.length) {
        grid.innerHTML = '<div class="empty" style="grid-column:1/-1;">暂无连接，点击右上角新建</div>';
        return;
    }
    grid.innerHTML = connections.map(c => {
        const typeLabel = c.type === 'mysql' ? 'MySQL' : 'PostgreSQL';
        return `
        <div class="conn-card" data-id="${escapeHtml(c.id)}">
            <div class="card-header">
                <div class="card-type-group">
                    <div class="card-icon">${SELECT_ICONS.db}</div>
                    <span class="card-type-tag">${typeLabel}</span>
                </div>
                <div class="card-actions">
                    <button type="button" class="btn-icon edit" title="编辑" aria-label="编辑连接">${SELECT_ICONS.edit}</button>
                    <button type="button" class="btn-icon delete" title="删除" aria-label="删除连接">${SELECT_ICONS.trash}</button>
                </div>
            </div>
            <div class="card-name">${escapeHtml(c.name)}</div>
            <div class="card-meta">${escapeHtml(c.user)}@${escapeHtml(c.host)}:${c.port}</div>
        </div>
    `}).join('');

    grid.querySelectorAll('.conn-card').forEach(card => {
        const id = card.dataset.id;
        card.addEventListener('click', async (e) => {
            if (e.target.closest('.btn-icon')) return;
            await useConnection(id);
        });
        card.querySelector('.edit').addEventListener('click', () => openEditModal(id));
        card.querySelector('.delete').addEventListener('click', () => {
            showConfirm('确定删除此连接？', async () => {
                await fetchJSON(`/api/connections/${id}`, { method: 'DELETE' });
                await loadConnections();
            });
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
    const btnEqual = document.getElementById('btn-equal-width');
    if (btnEqual) btnEqual.classList.remove('active');
    state.allColumns = [];
    state.lastTableData = null;
    state.filterCol = '';
    state.filterOp = 'contains';
    state.filterVal = '';
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

async function useConnection(id) {
    try {
        await fetchJSON(`/api/connections/${id}/use`, { method: 'POST' });
    } catch (err) {
        showAlert('连接失败: ' + (err.message || '无法连接到数据库，请检查服务是否启动'));
        return;
    }
    currentConnId = id;
    const conn = connections.find(c => c.id === id);
    currentConnType = conn?.type || 'postgresql';
    showDataView();
    const hist = initData.states?.[id] || {};
    if (hist.sql) document.getElementById('sql-input').value = hist.sql;
    state.db = hist.db || '';
    state.table = hist.table || '';
    resetTableViewState();
    await loadDatabases();
    await loadTables();
    await loadData();
}

function showConnectionsView() {
    document.getElementById('connections-view').classList.remove('hidden');
    document.getElementById('data-view').classList.add('hidden');
    document.getElementById('sql-view').classList.add('hidden');
    state.db = '';
    state.table = '';
    resetTableViewState();
    currentConnId = null;
    currentConnType = 'postgresql';
}

function showDataView() {
    document.getElementById('connections-view').classList.add('hidden');
    document.getElementById('data-view').classList.remove('hidden');
    document.getElementById('sql-view').classList.add('hidden');
}

function showSqlView() {
    document.getElementById('connections-view').classList.add('hidden');
    document.getElementById('data-view').classList.add('hidden');
    document.getElementById('sql-view').classList.remove('hidden');
    loadSqlDatabases();
}

/* ===== 连接弹窗 ===== */
function openAddModal() {
    document.getElementById('modal-title').textContent = '新建连接';
    document.getElementById('modal-conn-id').value = '';
    document.getElementById('modal-name').value = '';
    document.getElementById('modal-type').value = 'postgresql';
    syncCustomSelect(document.getElementById('modal-type'));
    document.getElementById('modal-host').value = 'localhost';
    document.getElementById('modal-port').value = '5432';
    document.getElementById('modal-user').value = '';
    document.getElementById('modal-password').value = '';
    document.getElementById('conn-modal').classList.remove('hidden');
}

function openEditModal(id) {
    const c = connections.find(x => x.id === id);
    if (!c) return;
    document.getElementById('modal-title').textContent = '编辑连接';
    document.getElementById('modal-conn-id').value = c.id;
    document.getElementById('modal-name').value = c.name;
    document.getElementById('modal-type').value = c.type || 'postgresql';
    syncCustomSelect(document.getElementById('modal-type'));
    document.getElementById('modal-host').value = c.host;
    document.getElementById('modal-port').value = c.port;
    document.getElementById('modal-user').value = c.user;
    document.getElementById('modal-password').value = c.password;
    document.getElementById('conn-modal').classList.remove('hidden');
}

function closeModal() {
    document.getElementById('conn-modal').classList.add('hidden');
}

async function saveModal() {
    const id = document.getElementById('modal-conn-id').value;
    const body = new URLSearchParams();
    body.append('name', document.getElementById('modal-name').value);
    body.append('conn_type', document.getElementById('modal-type').value);
    body.append('host', document.getElementById('modal-host').value);
    body.append('port', document.getElementById('modal-port').value);
    body.append('user', document.getElementById('modal-user').value);
    body.append('password', document.getElementById('modal-password').value);

    if (id) {
        await fetchJSON(`/api/connections/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    } else {
        await fetchJSON('/api/connections', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    }
    closeModal();
    await loadConnections();
}

/* ===== 数据查询 ===== */
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
    sel.innerHTML = '<option value="">选择表</option>';
    if (!state.db) {
        syncCustomSelect(sel);
        return;
    }
    try {
        const data = await fetchJSON(`/api/tables?db=${encodeURIComponent(state.db)}`);
        data.tables.forEach(t => {
            const opt = document.createElement('option');
            opt.value = t; opt.textContent = t;
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
    const ths = Array.from(tableEl.querySelectorAll('thead th'));
    ths.forEach((th, colIdx) => {
        const resizer = th.querySelector('.col-resizer');
        if (!resizer) return;
        const colName = th.dataset.col;
        resizer.addEventListener('click', (e) => e.stopPropagation());
        resizer.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (tableEl.classList.contains('equal-width')) {
                ths.forEach((h, i) => {
                    const cw = Math.round(h.getBoundingClientRect().width);
                    const cname = h.dataset.col;
                    if (widthMap && cname) widthMap[cname] = cw;
                    h.style.width = cw + 'px';
                    h.style.minWidth = cw + 'px';
                    h.style.maxWidth = cw + 'px';
                    tableEl.querySelectorAll('tbody tr').forEach(tr => {
                        const cell = tr.children[i];
                        if (cell && !cell.hasAttribute('colspan')) {
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
                const newWidth = Math.max(60, Math.round(startWidth + (moveEvent.clientX - startX)));
                if (widthMap && colName) {
                    widthMap[colName] = newWidth;
                }
                th.style.width = newWidth + 'px';
                th.style.minWidth = newWidth + 'px';
                th.style.maxWidth = newWidth + 'px';
                tableEl.querySelectorAll('tbody tr').forEach(tr => {
                    const td = tr.children[colIdx];
                    if (td && !td.hasAttribute('colspan')) {
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
            if (state.lastTableData) renderDataTable(state.lastTableData);
        });
        const span = document.createElement('span');
        span.textContent = c;
        item.appendChild(cb);
        item.appendChild(span);
        listEl.appendChild(item);
    });
}

function syncTableColumnsUI(columns) {
    const colPicker = document.getElementById('col-picker');
    const btnEqual = document.getElementById('btn-equal-width');
    const btnFilter = document.getElementById('btn-toggle-filter');
    const prevKey = state.allColumns.join('\0');
    const nextKey = columns.join('\0');
    state.allColumns = columns.slice();

    if (!columns.length) {
        if (colPicker) colPicker.classList.add('hidden');
        if (btnEqual) btnEqual.classList.add('hidden');
        if (btnFilter) btnFilter.classList.add('hidden');
        return;
    }
    if (colPicker) colPicker.classList.remove('hidden');
    if (btnEqual) btnEqual.classList.remove('hidden');
    if (btnFilter) btnFilter.classList.remove('hidden');

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

function renderDataTable(data) {
    const tableEl = document.getElementById('data-table');
    const thead = tableEl.querySelector('thead');
    const tbody = tableEl.querySelector('tbody');
    const visibleCols = data.columns.filter(c => !state.hiddenCols.has(c));
    const equalCount = state.equalWidth ? visibleCols.length : 0;
    tableEl.classList.toggle('equal-width', Boolean(state.equalWidth && visibleCols.length > 0));

    thead.innerHTML = '<tr>' + visibleCols.map(c => {
        const isSorted = state.sortCol === c;
        const dirClass = isSorted ? (state.sortDir === 'desc' ? ' sort-active sort-desc' : ' sort-active sort-asc') : '';
        return `<th class="sortable${dirClass}" data-col="${escapeHtml(c)}"${colWidthStyle(state.colWidths, c, equalCount)} title="点击切换排序"><span class="th-inner"><span>${escapeHtml(c)}</span><span class="sort-icon"><span class="sort-arrow up"></span><span class="sort-arrow down"></span></span></span><span class="col-resizer" title="左右拖动调整列宽"></span></th>`;
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
            await loadData();
        });
    });

    if (!data.data.length) {
        tbody.innerHTML = '<tr><td colspan="100" class="empty">暂无数据</td></tr>';
    } else {
        const pkColumn = data.pk || data.columns[0];
        tbody.innerHTML = data.data.map(row => '<tr>' + visibleCols.map(c => `<td class="editable-cell"${colWidthStyle(state.colWidths, c, equalCount)}>${escapeHtml(formatCellValue(row[c]))}</td>`).join('') + '</tr>').join('');
        tbody.querySelectorAll('tr').forEach((tr, rowIdx) => {
            const pkVal = data.data[rowIdx][pkColumn];
            tr.querySelectorAll('td').forEach((td, colIdx) => {
                td.dataset.pk = String(pkVal ?? '');
                td.dataset.col = visibleCols[colIdx];
                td.addEventListener('dblclick', () => startEdit(td, state.db, state.table, pkColumn));
                td.addEventListener('click', () => { if (!td.querySelector('input')) copyCell(td); });
            });
        });
    }

    attachColumnResizers(tableEl, state.colWidths);
}

async function loadData() {
    const thead = document.querySelector('#data-table thead');
    const tbody = document.querySelector('#data-table tbody');
    const pagination = document.getElementById('pagination');
    if (!state.db || !state.table) {
        thead.innerHTML = '';
        tbody.innerHTML = '<tr><td colspan="100" class="empty">请选择数据库和表</td></tr>';
        pagination.classList.add('hidden');
        syncTableColumnsUI([]);
        return;
    }
    let url = `/api/data?db=${encodeURIComponent(state.db)}&table=${encodeURIComponent(state.table)}&page=${state.page}&size=${state.size}`;
    if (state.sortCol) {
        url += `&sort_col=${encodeURIComponent(state.sortCol)}&sort_dir=${encodeURIComponent(state.sortDir || 'asc')}`;
    }
    if (state.filterCol && (state.filterOp === 'isnull' || state.filterOp === 'notnull' || state.filterVal !== '')) {
        url += `&filter_col=${encodeURIComponent(state.filterCol)}&filter_op=${encodeURIComponent(state.filterOp || 'contains')}&filter_val=${encodeURIComponent(state.filterVal)}`;
    }
    const data = await fetchJSON(url);
    state.lastTableData = data;
    syncTableColumnsUI(data.columns);
    renderDataTable(data);
    state.total = data.total;
    state.pages = Math.max(1, data.pages || 1);
    document.getElementById('page-num').textContent = state.page;
    document.getElementById('page-total').textContent = state.pages;
    document.getElementById('row-total').textContent = state.total;
    renderPageNumbers();
    pagination.classList.remove('hidden');
}

async function startEdit(td, db, table, pkColumn) {
    if (td.querySelector('input')) return;
    const originalValue = td.textContent;
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
    const restore = (val) => {
        td.textContent = val;
        td.style.width = '';
        td.style.height = '';
    };
    const save = () => {
        const newValue = input.value;
        if (newValue === originalValue) {
            restore(originalValue);
            return;
        }
        showConfirm('内容已修改，是否保存？', async () => {
            try {
                const body = new URLSearchParams();
                body.append('db', db);
                body.append('table', table);
                body.append('pk_col', pkColumn);
                body.append('pk_val', pk);
                body.append('column', col);
                body.append('value', newValue);
                await fetchJSON('/api/data', { method: 'PUT', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
                restore(newValue);
            } catch (err) {
                showAlert('保存失败: ' + err.message);
                restore(originalValue);
            }
        }, () => {
            restore(originalValue);
        });
    };
    const cancel = () => { restore(originalValue); };
    input.addEventListener('blur', save);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { input.blur(); }
        else if (e.key === 'Escape') { cancel(); }
    });
}

let confirmYesCallback = null;
let confirmNoCallback = null;

function showConfirm(message, onYes, onNo) {
    document.getElementById('confirm-message').textContent = message;
    document.getElementById('btn-confirm-yes').classList.remove('hidden');
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
            if (i !== state.page) { state.page = i; await loadData(); }
        });
        container.appendChild(btn);
    }
}

/* ===== SQL 查询 ===== */
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

async function saveState() {
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

async function copyCell(td) {
    const text = td.textContent;
    try {
        await navigator.clipboard.writeText(text);
        showToast('已复制');
    } catch (err) {
        const textarea = document.createElement('textarea');
        textarea.value = text;
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
document.getElementById('btn-add-conn').addEventListener('click', openAddModal);
document.getElementById('btn-cancel-conn').addEventListener('click', closeModal);
document.getElementById('btn-save-conn').addEventListener('click', saveModal);
document.getElementById('btn-back').addEventListener('click', showConnectionsView);

document.getElementById('modal-type').addEventListener('change', (e) => {
    document.getElementById('modal-port').value = e.target.value === 'mysql' ? '3306' : '5432';
});

document.getElementById('db-select').addEventListener('change', async (e) => {
    state.db = e.target.value;
    state.table = '';
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

/* 平分宽度切换事件 */
document.getElementById('btn-equal-width').addEventListener('click', () => {
    state.equalWidth = !state.equalWidth;
    state.colWidths = {};
    document.getElementById('btn-equal-width').classList.toggle('active', state.equalWidth);
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
    await loadData();
});

document.getElementById('page-size').addEventListener('change', async (e) => {
    state.size = parseInt(e.target.value, 10);
    state.page = 1;
    await loadData();
});

document.getElementById('btn-first').addEventListener('click', async () => { if (state.page > 1) { state.page = 1; await loadData(); } });
document.getElementById('btn-prev').addEventListener('click', async () => { if (state.page > 1) { state.page--; await loadData(); } });
document.getElementById('btn-next').addEventListener('click', async () => { if (state.page < state.pages) { state.page++; await loadData(); } });
document.getElementById('btn-last').addEventListener('click', async () => { if (state.page < state.pages) { state.page = state.pages; await loadData(); } });

document.getElementById('btn-new-query').addEventListener('click', () => {
    showSqlView();
    const hist = initData.states?.[currentConnId] || {};
    if (hist.sql) {
        document.getElementById('sql-input').value = hist.sql;
    } else if (state.table) {
        const q = currentConnType === 'mysql' ? `\`${state.table}\`` : `"${state.table}"`;
        document.getElementById('sql-input').value = `SELECT * FROM ${q} LIMIT 10`;
    } else {
        document.getElementById('sql-input').value = 'SELECT * FROM table_name LIMIT 10';
    }
});

document.getElementById('btn-back-data').addEventListener('click', () => {
    showDataView();
});

document.getElementById('sql-db-select').addEventListener('change', async (e) => {
    state.db = e.target.value;
    await saveState();
});

document.getElementById('btn-run-sql').addEventListener('click', async () => {
    const sql = document.getElementById('sql-input').value.trim();
    const errorEl = document.getElementById('sql-error');
    if (!sql) return;
    if (!state.db) { errorEl.textContent = '请先选择数据库'; errorEl.classList.remove('hidden'); return; }
    errorEl.classList.add('hidden');
    try {
        const body = new URLSearchParams();
        body.append('db', state.db);
        body.append('sql', sql);
        const data = await fetchJSON('/api/query', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
        const sqlTableEl = document.getElementById('sql-result-table');
        const thead = sqlTableEl.querySelector('thead');
        const tbody = sqlTableEl.querySelector('tbody');
        sqlColWidths = {};
        if (data.columns.length) {
            thead.innerHTML = '<tr>' + data.columns.map(c => `<th data-col="${escapeHtml(c)}"><span class="th-inner"><span>${escapeHtml(c)}</span></span><span class="col-resizer" title="左右拖动调整列宽"></span></th>`).join('') + '</tr>';
            tbody.innerHTML = data.data.map(row => '<tr>' + data.columns.map(c => `<td class="copyable-cell">${escapeHtml(formatCellValue(row[c]))}</td>`).join('') + '</tr>').join('');
            tbody.querySelectorAll('td').forEach(td => td.addEventListener('click', () => copyCell(td)));
            attachColumnResizers(sqlTableEl, sqlColWidths);
        } else {
            thead.innerHTML = '';
            tbody.innerHTML = `<tr><td colspan="100" class="empty">执行成功，影响 ${data.rowcount} 行</td></tr>`;
        }
        await saveState();
    } catch (err) {
        errorEl.textContent = err.message;
        errorEl.classList.remove('hidden');
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
        searchPlaceholder: '搜索表'
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

async function init() {
    initCustomSelects();
    await loadConnections();
    initData = await fetchJSON('/api/init');
}
init();
