// File Path : accuweather-crawler/dashboard/static/js/app.js

const DOW_NAMES = ['월', '화', '수', '목', '금', '토', '일'];
let tableData = { logs: [], hourly: [], daily: [], monthly: [], kma_hourly: [], kma_daily: [] };
let activeFilter = { hourly: null, daily: null, monthly: null, kma_hourly: null, kma_daily: null };
let sortState = {
    logs: { key: 'id', dir: 'desc', type: 'num' },
    hourly: { key: 'id', dir: 'desc', type: 'num' },
    daily: { key: 'id', dir: 'desc', type: 'num' },
    monthly: { key: 'id', dir: 'desc', type: 'num' },
    kma_hourly: { key: 'id', dir: 'desc', type: 'num' },
    kma_daily: { key: 'id', dir: 'desc', type: 'num' }
};
let detailPayloads = {};
let timelineData = [];
let temperatureTrend = {
    activeSeries: 'hourly',
    ranges: { hourly: '7d', daily: '1m', monthly: '3m' },
    dataCache: {},
    data: null,
    renderCtx: null
};

const TREND_SERIES_CONFIG = {
    hourly: {
        label: 'Hourly',
        icon: '⏰',
        valueLabel: '온도',
        targetLabel: '대상시각',
        defaultRange: '7d',
        rangeOptions: [
            { key: '7d', label: '7일' },
            { key: '14d', label: '14일' },
            { key: '1m', label: '1개월' }
        ]
    },
    daily: {
        label: 'Daily',
        icon: '📅',
        valueLabel: '최고기온',
        targetLabel: '대상일자',
        defaultRange: '1m',
        rangeOptions: [
            { key: '1m', label: '1개월' },
            { key: '3m', label: '3개월' },
            { key: '6m', label: '6개월' }
        ]
    },
    monthly: {
        label: 'Monthly',
        icon: '🗓️',
        valueLabel: '최고기온',
        targetLabel: '대상일자',
        defaultRange: '3m',
        rangeOptions: [
            { key: '3m', label: '3개월' },
            { key: '6m', label: '6개월' },
            { key: '1y', label: '1년' }
        ]
    }
};

// Terminal state
let terminalLines = [];
let termAutoScroll = true;
let termPollTimer = null;
let termLastLine = 0;
let termSource = '';
let termFile = '';

// Auto-refresh state
let autoRefreshEnabled = true;
let autoRefreshTimer = null;
let autoRefreshSysTimer = null;

// ══════════════════ Dark Mode ══════════════════
function initDarkMode() {
    const saved = localStorage.getItem('dashboard-theme');
    if (saved === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
    }
    updateDarkModeBtn();
}

function toggleDarkMode() {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('dashboard-theme', next);
    updateDarkModeBtn();
}

function updateDarkModeBtn() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const btn = document.getElementById('darkModeBtn');
    if (btn) {
        btn.textContent = isDark ? '☀️ 라이트' : '🌙 다크';
        btn.classList.toggle('active', isDark);
    }
}

// ══════════════════ Auto-Refresh ══════════════════
function toggleAutoRefresh() {
    autoRefreshEnabled = !autoRefreshEnabled;
    updateAutoRefreshBtn();
    if (autoRefreshEnabled) {
        startAutoRefresh();
    } else {
        stopAutoRefresh();
    }
}

function updateAutoRefreshBtn() {
    const btn = document.getElementById('autoRefreshBtn');
    if (btn) {
        btn.textContent = autoRefreshEnabled ? '⟳ 자동갱신 ON' : '⟳ 자동갱신 OFF';
        btn.classList.toggle('active', autoRefreshEnabled);
        btn.classList.toggle('off', !autoRefreshEnabled);
    }
}

function startAutoRefresh() {
    stopAutoRefresh();
    autoRefreshTimer = setInterval(loadAll, 30000);
    autoRefreshSysTimer = setInterval(function () {
        if (document.getElementById('pane-system').classList.contains('active')) loadSystemAll();
    }, 30000);
}

function stopAutoRefresh() {
    if (autoRefreshTimer) { clearInterval(autoRefreshTimer); autoRefreshTimer = null; }
    if (autoRefreshSysTimer) { clearInterval(autoRefreshSysTimer); autoRefreshSysTimer = null; }
}

// ══════════════════ Top Pane ══════════════════
function showTopPane(name, btn) {
    document.querySelectorAll('.top-nav-btn').forEach(function (b) { b.classList.remove('active'); });
    document.querySelectorAll('.top-pane').forEach(function (p) { p.classList.remove('active'); });
    btn.classList.add('active');
    document.getElementById('pane-' + name).classList.add('active');

    var crawlerStatus = document.getElementById('lastUpdate');
    var systemStatus = document.getElementById('sysLastUpdate');
    if (crawlerStatus && systemStatus) {
        crawlerStatus.style.display = name === 'crawler' ? 'inline-flex' : 'none';
        systemStatus.style.display = name === 'system' ? 'inline-flex' : 'none';
    }

    if (name === 'system') { loadSystemAll(); if (!termFile) refreshLogSources(); }
}

function refreshActivePane() {
    if (document.getElementById('pane-system').classList.contains('active')) loadSystemAll();
    else loadAll();
}

function showTab(name, btn) {
    document.querySelectorAll('.tab-btn').forEach(function (b) { b.classList.remove('active'); });
    document.querySelectorAll('.tab-content').forEach(function (c) { c.classList.remove('active'); });
    if (btn) btn.classList.add('active');
    document.getElementById('tab-' + name).classList.add('active');
}

function showSysTab(name, btn) {
    document.querySelectorAll('.sys-tab-btn').forEach(function (b) { b.classList.remove('active'); });
    document.querySelectorAll('.sys-tab-content').forEach(function (c) { c.classList.remove('active'); });
    if (btn) btn.classList.add('active');
    document.getElementById('systab-' + name).classList.add('active');
    if (name === 'terminal' && !termFile) refreshLogSources();
}

function formatDate(iso) { if (!iso) return '-'; return new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }); }
function shortDate(iso) { if (!iso) return '-'; return iso.substring(0, 10); }
function shortDateTime(iso) { if (!iso) return '-'; return iso.substring(0, 16).replace('T', ' '); }

// ══════════════════ Filter ══════════════════
function getTargetParam(dataType) {
    if (dataType === 'hourly') return 'target_at';
    if (dataType === 'kma_hourly') return 'observed_at';
    if (dataType === 'kma_daily') return 'observed_date';
    return 'target_date';
}
function getTargetDisplayLabel(dataType) {
    if (dataType === 'kma_hourly') return '관측 대상시각';
    if (dataType === 'kma_daily') return '관측 대상일자';
    return dataType === 'hourly' ? '대상시각' : '대상일자';
}
async function filterByTarget(dataType, targetValue) {
    var p = getTargetParam(dataType);
    try {
        var res = await fetch('/api/data/' + dataType + '?' + p + '=' + encodeURIComponent(targetValue) + '&limit=500');
        tableData[dataType] = await res.json();
        activeFilter[dataType] = { type: 'target', value: targetValue };
        document.getElementById('filter-' + dataType + '-text').textContent = '🔍 ' + getTargetDisplayLabel(dataType) + ' 필터: ' + (dataType === 'hourly' || dataType === 'kma_hourly' ? formatDate(targetValue) : targetValue);
        document.getElementById('filter-' + dataType).classList.add('active');
        renderTable(dataType);
    } catch (e) { console.error(e); }
}

async function filterByCollected(dataType, collectedValue) {
    try {
        var res = await fetch('/api/data/' + dataType + '?collected_at=' + encodeURIComponent(collectedValue) + '&limit=500');
        tableData[dataType] = await res.json();
        activeFilter[dataType] = { type: 'collected', value: collectedValue };
        document.getElementById('filter-' + dataType + '-text').textContent = '🔍 수집시각 필터: ' + formatDate(collectedValue);
        document.getElementById('filter-' + dataType).classList.add('active');
        renderTable(dataType);
    } catch (e) { console.error(e); }
}

async function clearFilter(dataType) {
    activeFilter[dataType] = null;
    document.getElementById('filter-' + dataType).classList.remove('active');
    if (dataType === 'hourly') await loadHourlyData();
    else if (dataType === 'daily') await loadDailyData();
    else if (dataType === 'monthly') await loadMonthlyData();
    else if (dataType === 'kma_hourly') await loadKmaHourlyData();
    else if (dataType === 'kma_daily') await loadKmaDailyData();
}

// ══════════════════ Preview ══════════════════
let previewTimeout = null;
function showPreview(e, dataType, targetValue) {
    clearTimeout(previewTimeout);
    previewTimeout = setTimeout(async function () {
        var p = dataType === 'hourly' ? 'target_at' : 'target_date';
        try {
            var res = await fetch('/api/preview/' + dataType + '?' + p + '=' + encodeURIComponent(targetValue));
            var data = await res.json();
            if (!data.length) return;
            document.getElementById('previewTitle').textContent = (dataType === 'hourly' ? '대상시각' : '대상일자') + ': ' + (dataType === 'hourly' ? formatDate(targetValue) : targetValue);
            var html = '<table>';
            if (dataType === 'hourly') {
                html += '<tr><th>수집시각</th><th>온도</th><th>체감</th><th>바람</th><th>강수</th></tr>';
                data.forEach(function (d) { html += '<tr><td>' + shortDateTime(d.collected_at) + '</td><td>' + (d.temp_c !== null ? d.temp_c + '°' : '-') + '</td><td>' + (d.real_feel !== null ? d.real_feel + '°' : '-') + '</td><td>' + (d.wind_speed || '-') + '</td><td>' + (d.precip_probability || '-') + '</td></tr>'; });
            } else if (dataType === 'daily') {
                html += '<tr><th>수집시각</th><th>최고</th><th>최저</th><th>강수</th><th>풍향</th></tr>';
                data.forEach(function (d) { html += '<tr><td>' + shortDateTime(d.collected_at) + '</td><td>' + (d.tmax !== null ? d.tmax + '°' : '-') + '</td><td>' + (d.tmin !== null ? d.tmin + '°' : '-') + '</td><td>' + (d.precip_pct !== null ? d.precip_pct + '%' : '-') + '</td><td>' + (d.wind_dir || '-') + '</td></tr>'; });
            } else {
                html += '<tr><th>수집시각</th><th>최고</th><th>최저</th></tr>';
                data.forEach(function (d) { html += '<tr><td>' + shortDateTime(d.collected_at) + '</td><td>' + (d.tmax !== null ? d.tmax + '°' : '-') + '</td><td>' + (d.tmin !== null ? d.tmin + '°' : '-') + '</td></tr>'; });
            }
            html += '</table>';
            document.getElementById('previewContent').innerHTML = html;
            var box = document.getElementById('previewBox');
            box.style.left = Math.min(e.clientX + 12, window.innerWidth - 340) + 'px';
            box.style.top = Math.min(e.clientY + 12, window.innerHeight - 200) + 'px';
            box.classList.add('visible');
        } catch (err) { console.error(err); }
    }, 300);
}
function hidePreview() { clearTimeout(previewTimeout); document.getElementById('previewBox').classList.remove('visible'); }

// ══════════════════ Sort ══════════════════
function sortTable(tableName, key, type) {
    var s = sortState[tableName];
    if (s.key === key) { s.dir = s.dir === 'asc' ? 'desc' : 'asc'; }
    else { s.key = key; s.dir = 'asc'; s.type = type; }
    document.getElementById('table-' + tableName).querySelectorAll('.sort-indicator').forEach(function (el) { el.classList.remove('active'); el.textContent = ''; });
    var ind = document.getElementById('sort-' + tableName + '-' + key);
    if (ind) { ind.classList.add('active'); ind.textContent = s.dir === 'asc' ? '▲' : '▼'; }
    tableData[tableName].sort(function (a, b) {
        var va = a[key], vb = b[key];
        if (va == null) va = type === 'num' ? -Infinity : '';
        if (vb == null) vb = type === 'num' ? -Infinity : '';
        if (type === 'num') { va = typeof va === 'number' ? va : parseFloat(va) || 0; vb = typeof vb === 'number' ? vb : parseFloat(vb) || 0; return s.dir === 'asc' ? va - vb : vb - va; }
        else { return s.dir === 'asc' ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va)); }
    });
    renderTable(tableName);
}

// ══════════════════ Render Tables ══════════════════
function renderTable(n) { if (n === 'logs') renderLogs(); else if (n === 'hourly') renderHourly(); else if (n === 'daily') renderDaily(); else if (n === 'monthly') renderMonthly(); else if (n === 'kma_hourly') renderKmaHourly(); else if (n === 'kma_daily') renderKmaDaily(); }

function renderLogs() {
    document.getElementById('logsBody').innerHTML = tableData.logs.map(function (l) {
        return '<tr><td>' + l.id + '</td><td><span class="badge-job">' + (l.job_name || '-') + '</span></td>' +
            '<td><span class="badge ' + (l.status === 'SUCCESS' ? 'badge-success' : l.status === 'NO_DATA' ? 'badge-warn' : 'badge-fail') + '">' + l.status + '</span></td>' +
            '<td>' + (l.rows_inserted || 0).toLocaleString() + '</td><td>' + (l.error_message || '-') + '</td>' +
            '<td>' + formatDate(l.started_at) + '</td><td>' + formatDate(l.ended_at) + '</td></tr>';
    }).join('');
}

function extractTargetDate(iso) { return iso ? iso.substring(0, 10) : '-'; }
function extractTargetTime(iso) { if (!iso) return '-'; return new Date(iso).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }); }

function renderHourly() {
    detailPayloads = detailPayloads || {};
    document.getElementById('hourlyBody').innerHTML = tableData.hourly.map(function (d) {
        var ds = d.extra_details ? JSON.stringify(d.extra_details, null, 2) : '-';
        var di = 'hd-' + d.id;
        setDetailPayload(di, ds);
        return `<tr><td>${d.id}</td>` +
            `<td><span class="clickable" onclick="filterByTarget('hourly','${d.target_at}')" onmouseenter="showPreview(event,'hourly','${d.target_at}')" onmouseleave="hidePreview()">${extractTargetDate(d.target_at)}</span></td>` +
            `<td>${extractTargetTime(d.target_at)}</td>` +
            `<td>${d.temp_c !== null ? d.temp_c + '°' : '-'}</td><td>${d.real_feel !== null ? d.real_feel + '°' : '-'}</td><td>${d.real_feel_shade !== null ? d.real_feel_shade + '°' : '-'}</td>` +
            `<td>${d.wind_speed || '-'}</td><td>${d.air_quality || '-'}</td><td>${d.max_uv || '-'}</td><td>${d.precip_probability || '-'}</td>` +
            `<td><span class="details-link" onclick="openDetailModal('${di}', 'Hourly 상세 원본')">보기</span></td>` +
            `<td><span class="clickable" onclick="filterByCollected('hourly','${d.collected_at}')">${formatDate(d.collected_at)}</span></td></tr>`;
    }).join('');
}

function renderDaily() {
    document.getElementById('dailyBody').innerHTML = tableData.daily.map(function (d) {
        return '<tr><td>' + d.id + '</td>' +
            '<td><span class="clickable" onclick="filterByTarget(\'daily\',\'' + d.target_date + '\')" onmouseenter="showPreview(event,\'daily\',\'' + d.target_date + '\')" onmouseleave="hidePreview()">' + (d.target_date || '-') + '</span></td>' +
            '<td class="dow-label">' + (d.dow != null ? DOW_NAMES[d.dow] || d.dow : '-') + '</td>' +
            '<td>' + (d.tmax !== null ? d.tmax + '°' : '-') + '</td><td>' + (d.tmin !== null ? d.tmin + '°' : '-') + '</td><td>' + (d.precip_pct !== null ? d.precip_pct + '%' : '-') + '</td>' +
            '<td>' + (d.realfeel !== null ? d.realfeel + '°' : '-') + '</td><td>' + (d.realfeel_shade !== null ? d.realfeel_shade + '°' : '-') + '</td><td>' + (d.uv_max !== null ? d.uv_max : '-') + '</td>' +
            '<td>' + (d.wind_dir || '-') + '</td><td>' + (d.wind_kmh !== null ? d.wind_kmh : '-') + '</td>' +
            '<td><span class="clickable" onclick="filterByCollected(\'daily\',\'' + d.collected_at + '\')">' + formatDate(d.collected_at) + '</span></td></tr>';
    }).join('');
}

function renderMonthly() {
    document.getElementById('monthlyBody').innerHTML = tableData.monthly.map(function (d) {
        return '<tr><td>' + d.id + '</td>' +
            '<td><span class="clickable" onclick="filterByTarget(\'monthly\',\'' + d.target_date + '\')" onmouseenter="showPreview(event,\'monthly\',\'' + d.target_date + '\')" onmouseleave="hidePreview()">' + (d.target_date || '-') + '</span></td>' +
            '<td>' + (d.tmax !== null ? d.tmax + '°' : '-') + '</td><td>' + (d.tmin !== null ? d.tmin + '°' : '-') + '</td>' +
            '<td><span class="clickable" onclick="filterByCollected(\'monthly\',\'' + d.collected_at + '\')">' + formatDate(d.collected_at) + '</span></td></tr>';
    }).join('');
}

function renderKmaHourly() {
    var body = document.getElementById('kmaHourlyBody');
    if (!body) return;
    body.innerHTML = tableData.kma_hourly.map(function (d) {
        var raw = d.raw_fields ? JSON.stringify(d.raw_fields, null, 2) : (d.raw_line || '-');
        var di = 'kmah-' + d.id;
        setDetailPayload(di, raw);
        return `<tr><td>${d.id}</td>` +
            `<td><span class="clickable" onclick="filterByTarget('kma_hourly','${d.observed_at}')">${formatDate(d.observed_at)}</span></td>` +
            `<td>${d.stn ?? '-'}</td><td>${d.temp_c !== null ? d.temp_c + '°' : '-'}</td>` +
            `<td>${d.humidity_pct !== null ? d.humidity_pct + '%' : '-'}</td>` +
            `<td>${d.wind_speed_ms !== null ? d.wind_speed_ms + ' m/s' : '-'}</td>` +
            `<td>${d.rain_mm !== null ? d.rain_mm + ' mm' : '-'}</td>` +
            `<td><span class="details-link" onclick="openDetailModal('${di}', 'KMA Hourly 원본')">보기</span></td>` +
            `<td><span class="clickable" onclick="filterByCollected('kma_hourly','${d.collected_at}')">${formatDate(d.collected_at)}</span></td></tr>`;
    }).join('');
}

function renderKmaDaily() {
    var body = document.getElementById('kmaDailyBody');
    if (!body) return;
    body.innerHTML = tableData.kma_daily.map(function (d) {
        var raw = d.raw_fields ? JSON.stringify(d.raw_fields, null, 2) : (d.raw_line || '-');
        var di = 'kmad-' + d.id;
        setDetailPayload(di, raw);
        return `<tr><td>${d.id}</td>` +
            `<td><span class="clickable" onclick="filterByTarget('kma_daily','${d.observed_date}')">${d.observed_date || '-'}</span></td>` +
            `<td>${d.stn ?? '-'}</td><td>${d.temp_avg_c !== null ? d.temp_avg_c + '°' : '-'}</td>` +
            `<td>${d.temp_max_c !== null ? d.temp_max_c + '°' : '-'}</td>` +
            `<td>${d.temp_min_c !== null ? d.temp_min_c + '°' : '-'}</td>` +
            `<td>${d.rain_day_mm !== null ? d.rain_day_mm + ' mm' : '-'}</td>` +
            `<td>${d.humidity_avg_pct !== null ? d.humidity_avg_pct + '%' : '-'}</td>` +
            `<td><span class="details-link" onclick="openDetailModal('${di}', 'KMA Daily 원본')">보기</span></td>` +
            `<td><span class="clickable" onclick="filterByCollected('kma_daily','${d.collected_at}')">${formatDate(d.collected_at)}</span></td></tr>`;
    }).join('');
}

function setDetailPayload(id, text) { detailPayloads[id] = text || '-'; }
function openDetailModal(id, title) {
    var modal = document.getElementById('rawDetailModalBackdrop');
    var titleEl = document.getElementById('rawDetailTitle');
    var bodyEl = document.getElementById('rawDetailContent');
    if (!modal || !bodyEl) return;
    if (titleEl) titleEl.textContent = title || '원본 상세 데이터';
    bodyEl.textContent = detailPayloads[id] || '-';
    modal.classList.add('visible');
    document.body.classList.add('modal-open');
}
function closeDetailModal(event) {
    if (event && event.target && event.target.id !== 'rawDetailModalBackdrop') return;
    var modal = document.getElementById('rawDetailModalBackdrop');
    if (modal) modal.classList.remove('visible');
    document.body.classList.remove('modal-open');
}
// Backward-compatible alias for older inline detail links.
function toggleDetail(id) { openDetailModal(id, '원본 상세 데이터'); }

// ══════════════════ Timeline (7-day, KST-aligned) ══════════════════

/**
 * Returns a consistent KST-formatted hour key like "2025-03-20T14"
 * This ensures both generated slots and server data map to the same key space.
 */
function kstHourKey(date) {
    var d = new Date(date);
    var parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Seoul',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', hourCycle: 'h23'
    }).formatToParts(d);
    var p = {};
    parts.forEach(function (x) { p[x.type] = x.value; });
    return p.year + '-' + p.month + '-' + p.day + 'T' + p.hour;
}

/** Returns KST date string like "2025-03-20" */
function kstDateStr(date) {
    return new Date(date).toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
}

/** Returns KST hour integer 0-23 */
function kstHour(date) {
    return parseInt(new Date(date).toLocaleString('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', hourCycle: 'h23' }));
}

/** Returns KST-formatted display string for tooltip */
function kstDisplay(date) {
    return new Date(date).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: 'numeric' });
}

/** Returns KST short date for date axis labels */
function kstShortDate(dateStr) {
    // Timeline header is purely positional; keep the label short so it never overlaps cells.
    var raw = String(dateStr || '');
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw.substring(5, 10).replace('-', '.');
    var d = new Date(raw + 'T00:00:00+09:00');
    return kstYMD(d.getTime()).substring(5, 10).replace('-', '.');
}

async function loadTimeline() {
    try { var res = await fetch('/api/crawl-timeline'); timelineData = await res.json(); renderTimeline(); } catch (e) { console.error(e); }
}

function renderTimeline() {
    var grid = document.getElementById('timelineGrid');
    var datesRow = document.getElementById('timelineDates');
    var now = new Date();
    var DAYS = 7;

    // V11: 날짜/시간 라벨과 실제 셀을 동일한 slot grid에 배치한다.
    // 서로 다른 flex width를 쓰면 timelineDates와 cells가 어긋나므로 --slot-count 하나로 통일한다.
    var endMs = now.getTime() - (now.getTime() % 3600000);
    var startMs = endMs - ((DAYS * 24) - 1) * 3600000;

    var slots = [];
    for (var ms = startMs; ms <= endMs; ms += 3600000) {
        slots.push(new Date(ms));
    }
    var slotCount = slots.length;

    var dataMap = {};
    timelineData.forEach(function (item) {
        var key = kstHourKey(new Date(item.time_slot));
        if (!dataMap[key]) dataMap[key] = {};
        if (!dataMap[key][item.job_name]) dataMap[key][item.job_name] = {};
        dataMap[key][item.job_name][item.status] = {
            cnt: item.cnt,
            total_rows: item.total_rows,
            target_range: item.target_range_sample
        };
    });

    var dayGroups = [];
    var prevDate = '', spanCount = 0;
    slots.forEach(function (s) {
        var dk = kstDateStr(s);
        if (dk !== prevDate) {
            if (prevDate) dayGroups.push({ label: prevDate, span: spanCount });
            prevDate = dk;
            spanCount = 1;
        } else {
            spanCount++;
        }
    });
    if (prevDate) dayGroups.push({ label: prevDate, span: spanCount });

    var gridStyle = ' style="--slot-count:' + slotCount + '"';
    var dh = '<div class="timeline-date-row"' + gridStyle + '><div class="timeline-axis-spacer"></div>';
    dayGroups.forEach(function (g) {
        dh += '<div class="timeline-date-group" style="grid-column: span ' + g.span + '"><span class="timeline-date-label">' + kstShortDate(g.label) + '</span></div>';
    });
    dh += '</div>';

    dh += '<div class="timeline-hour-row"' + gridStyle + '><div class="timeline-axis-spacer"></div>';
    slots.forEach(function (s) {
        var h = kstHour(s);
        var label = (h === 0 || h === 6 || h === 12 || h === 18) ? String(h).padStart(2, '0') : '';
        dh += '<div class="timeline-hour-label">' + label + '</div>';
    });
    dh += '</div>';
    datesRow.innerHTML = dh;

    var jobs = ['hourly', 'kma_hourly', 'daily', 'kma_daily', 'monthly'];
    var jobLabels = {
        hourly: '⏰ Hourly',
        kma_hourly: '🇰🇷 KMA Hourly',
        daily: '📅 Daily',
        kma_daily: '🇰🇷 KMA Daily',
        monthly: '🗓️ Monthly'
    };
    var gh = '';
    jobs.forEach(function (job) {
        // V12: cells are direct children of the same CSS grid as the row label.
        // This removes the nested .timeline-cells width drift that caused dates/cells to misalign.
        gh += '<div class="timeline-row"' + gridStyle + '><div class="timeline-row-label">' + jobLabels[job] + '</div>';
        slots.forEach(function (s) {
            var key = kstHourKey(s);
            var jd = dataMap[key] && dataMap[key][job];
            var cc = 'empty', tt = '';
            var ss = kstDisplay(s);
            if (jd) {
                if (jd['SUCCESS']) {
                    cc = 'success';
                    tt = ss + ' | ' + jobLabels[job].replace(/^\S+\s/, '') + '\n상태: 성공\n저장: ' + (jd['SUCCESS'].total_rows || 0) + '건';
                } else if (jd['NO_DATA']) {
                    cc = 'no-data';
                    tt = ss + ' | ' + jobLabels[job].replace(/^\S+\s/, '') + '\n상태: 데이터 없음';
                } else if (jd['FAILED']) {
                    cc = 'fail';
                    tt = ss + ' | ' + jobLabels[job].replace(/^\S+\s/, '') + '\n상태: 실패';
                }
                if (jd['SUCCESS'] && (jd['FAILED'] || jd['NO_DATA'])) {
                    cc = 'mixed';
                    tt = ss + ' | ' + jobLabels[job].replace(/^\S+\s/, '') + '\n상태: 혼합\n저장: ' + (jd['SUCCESS'].total_rows || 0) + '건';
                }
            } else {
                tt = ss + ' | ' + jobLabels[job].replace(/^\S+\s/, '') + '\n미실행';
            }
            gh += '<div class="timeline-cell ' + cc + '" data-tooltip="' + tt.replace(/"/g, '&quot;') + '" onmouseenter="showChartTooltip(event,this)" onmousemove="showChartTooltip(event,this)" onmouseleave="hideChartTooltip()"></div>';
        });
        gh += '</div>';
    });
    grid.innerHTML = gh;
}

function positionFloatingTooltip(e, preferredWidth) {
    var t = document.getElementById('chartTooltip');
    if (!t) return;
    var pad = 14;
    var width = preferredWidth || t.offsetWidth || 360;
    var height = t.offsetHeight || 180;
    var left = e.clientX + pad;
    if (left + width > window.innerWidth - pad) left = e.clientX - width - pad;
    left = Math.max(pad, Math.min(left, window.innerWidth - width - pad));
    var top = e.clientY + pad;
    if (top + height > window.innerHeight - pad) top = Math.max(pad, e.clientY - height - pad);
    t.style.left = left + 'px';
    t.style.top = top + 'px';
}

function showChartTooltip(e, el) {
    var t = document.getElementById('chartTooltip'), txt = el.getAttribute('data-tooltip');
    if (!txt) return;
    t.classList.remove('trend-tooltip-mode');
    t.innerHTML = '<div class="timeline-tooltip-card">' + txt.replace(/\n/g, '<br>') + '</div>';
    t.classList.add('visible');
    positionFloatingTooltip(e, 260);
}
function hideChartTooltip() { document.getElementById('chartTooltip').classList.remove('visible', 'trend-tooltip-mode'); }
function showChartTooltipHtml(e, html) {
    var t = document.getElementById('chartTooltip');
    if (!html) return;
    t.innerHTML = html;
    t.classList.add('visible', 'trend-tooltip-mode');
    requestAnimationFrame(function () { positionFloatingTooltip(e, 470); });
}

// ══════════════════ Download Modal ══════════════════
const DOWNLOAD_TYPE_CONFIG = {
    hourly: { label: 'AccuWeather Hourly Forecast', targetLabel: '예측 대상시각', targetKind: 'datetime' },
    daily: { label: 'AccuWeather Daily Forecast', targetLabel: '예측 대상일자', targetKind: 'date' },
    monthly: { label: 'AccuWeather Monthly Forecast', targetLabel: '예측 대상일자', targetKind: 'date' },
    kma_hourly: { label: 'KMA ASOS Hourly Observation', targetLabel: '관측 대상시각', targetKind: 'datetime' },
    kma_daily: { label: 'KMA ASOS Daily Observation', targetLabel: '관측 대상일자', targetKind: 'date' }
};

let downloadRangeCache = {};

function openDownloadModal() {
    var backdrop = document.getElementById('downloadModalBackdrop');
    if (!backdrop) return;
    backdrop.classList.add('visible');
    document.body.classList.add('modal-open');
    updateDownloadTypeUI(false);
}

function closeDownloadModal(event) {
    if (event && event.target && event.target.id !== 'downloadModalBackdrop') return;
    var backdrop = document.getElementById('downloadModalBackdrop');
    if (backdrop) backdrop.classList.remove('visible');
    document.body.classList.remove('modal-open');
}

function getSelectedDownloadMode() {
    var checked = document.querySelector('input[name="downloadMode"]:checked');
    return checked ? checked.value : 'all';
}

function syncDownloadModeCards() {
    var mode = getSelectedDownloadMode();
    var all = document.getElementById('downloadModeAllLabel');
    var latest = document.getElementById('downloadModeLatestLabel');
    if (all) all.classList.toggle('active', mode === 'all');
    if (latest) latest.classList.toggle('active', mode === 'latest');
}

function toDateInputValue(value) {
    if (!value) return '';
    return String(value).substring(0, 10);
}

function toDateTimeInputValue(value) {
    if (!value) return '';
    return String(value).replace(' ', 'T').substring(0, 16);
}

function setInputValue(id, value, kind) {
    var el = document.getElementById(id);
    if (!el) return;
    el.value = kind === 'date' ? toDateInputValue(value) : toDateTimeInputValue(value);
}

function resetDownloadFilters() {
    ['downloadTargetFrom', 'downloadTargetTo', 'downloadCollectedFrom', 'downloadCollectedTo'].forEach(function (id) {
        var el = document.getElementById(id); if (el) el.value = '';
    });
    var hint = document.getElementById('downloadRangeHint');
    if (hint) hint.textContent = '필터를 비워두면 선택한 데이터 유형의 전체 범위를 다운로드합니다.';
}

async function updateDownloadTypeUI(forceReload) {
    var typeEl = document.getElementById('downloadDataType');
    if (!typeEl) return;
    var type = typeEl.value || 'hourly';
    var cfg = DOWNLOAD_TYPE_CONFIG[type] || DOWNLOAD_TYPE_CONFIG.hourly;
    var targetKind = cfg.targetKind;
    var targetFrom = document.getElementById('downloadTargetFrom');
    var targetTo = document.getElementById('downloadTargetTo');
    if (targetFrom) targetFrom.type = targetKind === 'date' ? 'date' : 'datetime-local';
    if (targetTo) targetTo.type = targetKind === 'date' ? 'date' : 'datetime-local';
    var fromLabel = document.getElementById('downloadTargetFromLabel');
    var toLabel = document.getElementById('downloadTargetToLabel');
    if (fromLabel) fromLabel.textContent = cfg.targetLabel + ' 시작';
    if (toLabel) toLabel.textContent = cfg.targetLabel + ' 종료';
    syncDownloadModeCards();
    await loadDateRanges(forceReload);
}

async function loadDateRanges(forceReload) {
    var typeEl = document.getElementById('downloadDataType');
    if (!typeEl) return;
    var type = typeEl.value || 'hourly';
    var cfg = DOWNLOAD_TYPE_CONFIG[type] || DOWNLOAD_TYPE_CONFIG.hourly;
    var hint = document.getElementById('downloadRangeHint');
    try {
        if (hint) hint.textContent = cfg.label + ' 데이터 범위를 확인하는 중...';
        if (!downloadRangeCache[type] || forceReload) {
            var r = await fetch('/api/date-range/' + encodeURIComponent(type));
            downloadRangeCache[type] = await r.json();
        }
        var d = downloadRangeCache[type] || {};
        if (d.error) {
            if (hint) hint.textContent = '범위 조회 실패: ' + d.error;
            return;
        }
        setInputValue('downloadTargetFrom', d.min_date, cfg.targetKind);
        setInputValue('downloadTargetTo', d.max_date, cfg.targetKind);
        setInputValue('downloadCollectedFrom', d.min_collected_at, 'datetime');
        setInputValue('downloadCollectedTo', d.max_collected_at, 'datetime');
        if (hint) {
            var targetRange = (cfg.targetKind === 'date')
                ? (toDateInputValue(d.min_date) + ' ~ ' + toDateInputValue(d.max_date))
                : (toDateTimeInputValue(d.min_date).replace('T', ' ') + ' ~ ' + toDateTimeInputValue(d.max_date).replace('T', ' '));
            var collectedRange = toDateTimeInputValue(d.min_collected_at).replace('T', ' ') + ' ~ ' + toDateTimeInputValue(d.max_collected_at).replace('T', ' ');
            hint.textContent = '대상 범위: ' + targetRange + ' · 수집 범위: ' + collectedRange + ' · 총 ' + Number(d.total_records || 0).toLocaleString() + ' rows';
        }
    } catch (e) {
        console.error(e);
        if (hint) hint.textContent = '범위 정보를 불러올 수 없습니다.';
    }
}

function downloadCSVFromModal() {
    var type = document.getElementById('downloadDataType')?.value || 'hourly';
    var mode = getSelectedDownloadMode();
    var targetFrom = document.getElementById('downloadTargetFrom')?.value || '';
    var targetTo = document.getElementById('downloadTargetTo')?.value || '';
    var collectedFrom = document.getElementById('downloadCollectedFrom')?.value || '';
    var collectedTo = document.getElementById('downloadCollectedTo')?.value || '';
    var ps = ['mode=' + encodeURIComponent(mode)];
    if (targetFrom) ps.push('from=' + encodeURIComponent(targetFrom));
    if (targetTo) ps.push('to=' + encodeURIComponent(targetTo));
    if (collectedFrom) ps.push('collected_from=' + encodeURIComponent(collectedFrom));
    if (collectedTo) ps.push('collected_to=' + encodeURIComponent(collectedTo));
    if (window.SNAPSHOT_MODE) {
        window.location.href = 'snapshot/downloads/' + encodeURIComponent(type) + '_latest.csv';
        return;
    }
    window.location.href = '/api/download/' + encodeURIComponent(type) + '?' + ps.join('&');
}

// Backward-compatible alias for old inline buttons.
function downloadCSV(dt) {
    var typeEl = document.getElementById('downloadDataType');
    if (typeEl && dt) typeEl.value = dt;
    downloadCSVFromModal();
}

function showDlTab(type, btn) {
    var typeEl = document.getElementById('downloadDataType');
    if (typeEl) typeEl.value = type;
    updateDownloadTypeUI(true);
}

// ══════════════════ Data Load ══════════════════
async function loadSummary() {
    try {
        var r = await fetch('/api/summary'); var d = await r.json();
        if (d.error) { document.getElementById('hourlyTotal').textContent = '⚠️'; return; }
        document.getElementById('hourlyTotal').textContent = (d.hourly?.total_records || 0).toLocaleString();
        document.getElementById('dailyTotal').textContent = (d.daily?.total_records || 0).toLocaleString();
        document.getElementById('monthlyTotal').textContent = (d.monthly?.total_records || 0).toLocaleString();
        var kh = document.getElementById('kmaHourlyTotal'); if (kh) kh.textContent = (d.kma_hourly?.total_records || 0).toLocaleString();
        var kd = document.getElementById('kmaDailyTotal'); if (kd) kd.textContent = (d.kma_daily?.total_records || 0).toLocaleString();
        document.getElementById('grandTotal').textContent = (d.total?.total_records || 0).toLocaleString();
        document.getElementById('firstCollected').textContent = formatDate(d.total?.first_collected);
        document.getElementById('lastCollected').textContent = formatDate(d.total?.last_collected);
    } catch (e) { console.error(e); document.getElementById('hourlyTotal').textContent = '연결 실패'; }
}

async function loadLogs() { try { tableData.logs = await (await fetch('/api/logs')).json(); renderLogs(); } catch (e) { console.error(e); } }
async function loadHourlyData() { if (activeFilter.hourly) return; try { tableData.hourly = await (await fetch('/api/data/hourly?limit=200')).json(); renderHourly(); } catch (e) { console.error(e); } }
async function loadDailyData() { if (activeFilter.daily) return; try { tableData.daily = await (await fetch('/api/data/daily?limit=200')).json(); renderDaily(); } catch (e) { console.error(e); } }
async function loadMonthlyData() { if (activeFilter.monthly) return; try { tableData.monthly = await (await fetch('/api/data/monthly?limit=200')).json(); renderMonthly(); } catch (e) { console.error(e); } }
async function loadKmaHourlyData() { if (activeFilter.kma_hourly) return; try { tableData.kma_hourly = await (await fetch('/api/data/kma_hourly?limit=200')).json(); renderKmaHourly(); } catch (e) { console.error(e); } }
async function loadKmaDailyData() { if (activeFilter.kma_daily) return; try { tableData.kma_daily = await (await fetch('/api/data/kma_daily?limit=200')).json(); renderKmaDaily(); } catch (e) { console.error(e); } }

async function loadProgress() {
    try {
        var pl = await (await fetch('/api/progress')).json(); var g = document.getElementById('progressGrid');
        if (!pl || !pl.length) { g.innerHTML = ''; return; }
        var jo = { hourly: 0, kma_hourly: 1, daily: 2, kma_daily: 3, monthly: 4 }; pl.sort(function (a, b) { return (jo[a.job_name] ?? 99) - (jo[b.job_name] ?? 99); });
        var jl = { hourly: '⏰ Hourly', daily: '📅 Daily', monthly: '🗓️ Monthly', kma_hourly: '🇰🇷 KMA Hourly', kma_daily: '🇰🇷 KMA Daily' };
        g.innerHTML = pl.map(function (p) {
            var sc = '', st = '', dt = '';
            if (p.status === 'RUNNING' || p.status === 'COLLECTING_URLS') { st = (p.progress_pct || 0).toFixed(1) + '%'; dt = (p.completed_pages || 0) + '/' + (p.total_pages || 0) + ' 페이지' + (p.current_url ? ' — ' + p.current_url : ''); }
            else if (p.status === 'COMPLETED') { sc = 'progress-completed'; st = '완료 ✓'; dt = (p.total_pages || 0) + '개 페이지 완료 — ' + formatDate(p.updated_at); }
            else if (p.status === 'FAILED') { sc = 'progress-failed'; st = '실패 ✕'; dt = p.current_url || 'Unknown error'; }
            else { sc = 'progress-idle'; st = '대기'; dt = p.updated_at ? ('최근 상태 — ' + formatDate(p.updated_at)) : '아직 실행 이력이 없습니다'; }
            var pct = p.status === 'COMPLETED' ? 100 : (p.status === 'FAILED' ? 100 : (p.status === 'IDLE' ? 0 : (p.progress_pct || 0)));
            return '<div class="progress-container ' + sc + '"><div class="progress-header"><span class="progress-title">' + (jl[p.job_name] || p.job_name) + '</span><span class="progress-text">' + st + '</span></div><div class="progress-bar-bg"><div class="progress-bar-fill" style="width:' + pct + '%"></div></div><div class="progress-detail">' + dt + '</div></div>';
        }).filter(Boolean).join('');
    } catch (e) { console.error(e); }
}

// ══════════════════ System Health ══════════════════
async function loadSystemHealth() {
    try {
        var d = await (await fetch('/api/system-health')).json(); if (d.error) return;
        var de = document.getElementById('discordStatus');
        if (de) { de.textContent = d.discord_configured ? '✅ 연결됨' : '❌ 미설정'; de.style.color = d.discord_configured ? '#1e8e3e' : '#d93025'; }
        var fe = document.getElementById('recentFailures');
        var tf = Object.values(d.recent_failures || {}).reduce(function (a, b) { return a + b; }, 0);
        if (fe) { fe.textContent = tf + '건'; fe.style.color = tf > 0 ? '#d93025' : '#1e8e3e'; }
        var bn = document.getElementById('systemAlertBanner'), bt = document.getElementById('systemAlertBannerText');
        if (bn && bt) {
            if (tf > 0) {
                bt.textContent = '최근 1시간 실패 — ' + Object.entries(d.recent_failures || {}).map(function (e) { return e[0] + ': ' + e[1] + '건'; }).join(', ');
                bn.style.display = 'block';
            } else { bn.style.display = 'none'; }
        }
    } catch (e) { console.error(e); }
}

async function loadAlerts() {
    try {
        var al = await (await fetch('/api/alerts?limit=50')).json(); var tb = document.getElementById('alertsBody');
        if (!al || al.error) { tb.innerHTML = '<tr><td colspan="8">데이터 없음</td></tr>'; return; }
        var sb = function (s) { return s === 'CRITICAL' ? '<span class="badge badge-fail">CRITICAL</span>' : s === 'WARNING' ? '<span class="badge badge-warn">WARNING</span>' : '<span class="badge badge-success">INFO</span>'; };
        var tp = function (t) { var c = { 'FAILURE': 'badge-fail', 'NO_DATA': 'badge-warn', 'SUCCESS': 'badge-success', 'RECOVERY': 'badge-success' }; return '<span class="badge ' + (c[t] || '') + '">' + t + '</span>'; };
        tb.innerHTML = al.map(function (a) {
            return '<tr><td>' + a.id + '</td><td>' + tp(a.alert_type) + '</td><td><span class="badge-job">' + (a.job_name || '-') + '</span></td><td>' + sb(a.severity) + '</td><td>' + (a.message || '-') + '</td><td>' + (a.sent_to || '-') + '</td><td>' + (a.status || '-') + '</td><td>' + formatDate(a.created_at) + '</td></tr>';
        }).join('');
    } catch (e) { console.error(e); }
}

async function loadSystemLogs() {
    try {
        var jf = document.getElementById('syslog-job-filter').value, sf = document.getElementById('syslog-status-filter').value;
        var url = '/api/system-logs?limit=100'; if (jf) url += '&job_name=' + encodeURIComponent(jf); if (sf) url += '&status=' + encodeURIComponent(sf);
        var logs = await (await fetch(url)).json(); var tb = document.getElementById('syslogsBody');
        if (!logs || logs.error) { tb.innerHTML = '<tr><td colspan="11">데이터 없음</td></tr>'; return; }
        tb.innerHTML = logs.map(function (l) {
            var ti = 'tb-' + l.id, ht = l.traceback && l.traceback.trim();
            return '<tr><td>' + l.id + '</td><td><span class="badge-job">' + (l.job_name || '-') + '</span></td>' +
                '<td><span class="badge ' + (l.status === 'SUCCESS' ? 'badge-success' : l.status === 'NO_DATA' ? 'badge-warn' : 'badge-fail') + '">' + l.status + '</span></td>' +
                '<td>' + (l.rows_inserted || 0).toLocaleString() + '</td><td>' + (l.duration_seconds !== null ? l.duration_seconds.toFixed(1) : '-') + '</td>' +
                '<td>' + (l.error_message || '-') + '</td><td>' + (l.alert_sent ? '✅' : '❌') + '</td>' +
                '<td style="font-size:0.72rem;color:var(--text-muted);">' + (l.run_id || '-') + '</td><td>' + formatDate(l.started_at) + '</td><td>' + formatDate(l.ended_at) + '</td>' +
                '<td>' + (ht ? '<span class="details-toggle" onclick="toggleDetail(\'' + ti + '\')">보기</span><div class="details-content" id="' + ti + '" style="max-width:500px;">' + l.traceback + '</div>' : '-') + '</td></tr>';
        }).join('');
    } catch (e) { console.error(e); }
}

// ══════════════════ Terminal Log Viewer ══════════════════
async function refreshLogSources() {
    var body = document.getElementById('terminalBody');
    try {
        var res = await fetch('/api/realtime-logs/sources');
        if (!res.ok) {
            body.innerHTML = '<div class="log-line"><span class="log-text" style="color:#f44747;">로그 API에 연결할 수 없습니다. (HTTP ' + res.status + ')</span></div>';
            return;
        }
        var s = await res.json();
        var sel = document.getElementById('terminalSource'); var cv = sel.value;
        sel.innerHTML = '<option value="">-- 로그 소스 선택 --</option>';
        s.forEach(function (x) { var o = document.createElement('option'); o.value = x.source + '::' + (x.path || x.name); o.textContent = '[' + x.source + '] ' + x.name; sel.appendChild(o); });
        if (cv) sel.value = cv;
        if (!s.length) {
            body.innerHTML = '<div class="log-line"><span class="log-text" style="color:#ffbd2e;">로그 파일이 아직 생성되지 않았습니다. 크롤러가 실행 중인지 확인하세요.</span></div>';
        }
    } catch (e) {
        console.error(e);
        body.innerHTML = '<div class="log-line"><span class="log-text" style="color:#f44747;">로그 API에 연결할 수 없습니다. (' + e.message + ')</span></div>';
    }
}

function switchLogSource() {
    var v = document.getElementById('terminalSource').value;
    if (!v) {
        stopTermPoll(); termSource = ''; termFile = '';
        document.getElementById('terminalTitle').textContent = '로그 뷰어';
        document.getElementById('terminalBody').innerHTML = '<div class="log-line"><span class="log-text" style="color:#888;">로그 소스를 선택하세요...</span></div>';
        document.getElementById('terminalStatusLeft').textContent = 'Ready';
        document.getElementById('terminalStatusRight').textContent = 'Lines: 0';
        return;
    }
    var parts = v.split('::'); termSource = parts[0]; termFile = parts[1];
    terminalLines = []; termLastLine = 0;
    document.getElementById('terminalTitle').textContent = termSource + ' / ' + termFile;
    document.getElementById('terminalBody').innerHTML = '<div class="log-line"><span class="log-text" style="color:#888;">로그 불러오는 중...</span></div>';
    fetchTermLines(true); startTermPoll();
}

async function fetchTermLines(init) {
    if (!termFile) return;
    try {
        var url = '/api/realtime-logs/read?file=' + encodeURIComponent(termFile) + '&lines=200';
        if (!init && termLastLine > 0) url += '&after_line=' + termLastLine;
        var res = await fetch(url);
        if (!res.ok) {
            document.getElementById('terminalStatusLeft').textContent = 'Error: HTTP ' + res.status;
            if (init) document.getElementById('terminalBody').innerHTML = '<div class="log-line"><span class="log-text" style="color:#f44747;">로그 파일을 읽을 수 없습니다. (HTTP ' + res.status + ')</span></div>';
            return;
        }
        var d = await res.json();
        if (d.error) { document.getElementById('terminalStatusLeft').textContent = 'Error: ' + d.error; return; }
        if (init) { terminalLines = d.lines || []; } else { if (d.lines && d.lines.length > 0) { terminalLines = terminalLines.concat(d.lines); if (terminalLines.length > 2000) terminalLines = terminalLines.slice(-2000); } }
        if (terminalLines.length > 0) { var last = terminalLines[terminalLines.length - 1]; termLastLine = d.total_lines || (last.num ?? last.line_no) || 0; }
        renderTerminalLines();
        document.getElementById('terminalStatusLeft').textContent = 'Source: ' + termSource + '/' + termFile;
        document.getElementById('terminalStatusRight').textContent = 'Lines: ' + (d.total_lines || 0) + ' | Showing: ' + terminalLines.length;
    } catch (e) {
        console.error(e);
        document.getElementById('terminalStatusLeft').textContent = 'Error: ' + e.message;
        if (terminalLines.length === 0) document.getElementById('terminalBody').innerHTML = '<div class="log-line"><span class="log-text" style="color:#f44747;">로그 API에 연결할 수 없습니다.</span></div>';
    }
}

function renderTerminalLines() {
    var body = document.getElementById('terminalBody'), ft = (document.getElementById('terminalFilter').value || '').toLowerCase();
    var lines = terminalLines; if (ft) lines = lines.filter(function (l) { return l.text.toLowerCase().includes(ft); });
    if (!lines.length && termFile) {
        body.innerHTML = '<div class="log-line"><span class="log-text" style="color:#888;">' + (ft ? '필터 조건에 맞는 로그가 없습니다.' : '로그 데이터가 없습니다.') + '</span></div>';
        return;
    }
    body.innerHTML = lines.map(function (l) {
        var lineNum = l.num ?? l.line_no ?? 0;
        var lc = ''; var t = l.text.toUpperCase();
        if (t.includes('[ERROR]') || t.includes('FAILED')) lc = 'level-error';
        else if (t.includes('[WARNING]') || t.includes('WARN')) lc = 'level-warning';
        else if (t.includes('[INFO]')) lc = 'level-info';
        else if (t.includes('[DEBUG]')) lc = 'level-debug';
        var esc = l.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return '<div class="log-line"><span class="log-num">' + lineNum + '</span><span class="log-text ' + lc + '">' + esc + '</span></div>';
    }).join('');
    if (termAutoScroll) body.scrollTop = body.scrollHeight;
}

function startTermPoll() { stopTermPoll(); termPollTimer = setInterval(function () { fetchTermLines(false); }, 3000); }
function stopTermPoll() { if (termPollTimer) { clearInterval(termPollTimer); termPollTimer = null; } }
function toggleTermAutoScroll() { termAutoScroll = !termAutoScroll; var b = document.getElementById('terminalAutoScroll'); b.textContent = 'Auto-scroll: ' + (termAutoScroll ? 'ON' : 'OFF'); b.classList.toggle('active', termAutoScroll); }
function clearTerminal() { terminalLines = []; termLastLine = 0; document.getElementById('terminalBody').innerHTML = ''; document.getElementById('terminalStatusRight').textContent = 'Lines: 0'; }

// ══════════════════ Temperature Trend Chart ══════════════════
function escapeHtml(v) {
    return String(v ?? '').replace(/[&<>"]/g, function (ch) {
        return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch];
    });
}

function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

function getActiveTrendRange() {
    var series = temperatureTrend.activeSeries;
    var cfg = TREND_SERIES_CONFIG[series];
    if (!cfg) return '1m';
    var range = temperatureTrend.ranges[series] || cfg.defaultRange;
    var isAllowed = (cfg.rangeOptions || []).some(function (opt) { return opt.key === range; });
    if (!isAllowed) {
        range = cfg.defaultRange;
        temperatureTrend.ranges[series] = range;
    }
    return range;
}

function initTemperatureTrendControls() {
    var active = temperatureTrend.activeSeries || 'hourly';
    document.querySelectorAll('.trend-tab-btn').forEach(function (b) {
        b.classList.toggle('active', b.getAttribute('data-series') === active);
    });
    renderTrendRangeButtons();
    updateTrendMeta(null, null, null);
}

function renderTrendRangeButtons() {
    var series = temperatureTrend.activeSeries;
    var cfg = TREND_SERIES_CONFIG[series];
    var range = getActiveTrendRange();
    var el = document.getElementById('trendRangeToggle');
    if (!el || !cfg) return;
    el.innerHTML = cfg.rangeOptions.map(function (opt) {
        var cls = opt.key === range ? 'trend-range-btn active' : 'trend-range-btn';
        return '<button class="' + cls + '" data-range="' + opt.key + '" onclick="setTrendRange(\'' + opt.key + '\', this)">' + opt.label + '</button>';
    }).join('');
}

function setTrendSeries(series, btn) {
    if (!TREND_SERIES_CONFIG[series]) return;
    temperatureTrend.activeSeries = series;
    if (!temperatureTrend.ranges[series]) temperatureTrend.ranges[series] = TREND_SERIES_CONFIG[series].defaultRange;
    document.querySelectorAll('.trend-tab-btn').forEach(function (b) { b.classList.remove('active'); });
    if (btn) btn.classList.add('active');
    renderTrendRangeButtons();
    loadTemperatureTrends(true);
}

function setTrendRange(rangeKey, btn) {
    var series = temperatureTrend.activeSeries;
    var cfg = TREND_SERIES_CONFIG[series];
    var isAllowed = cfg && (cfg.rangeOptions || []).some(function (opt) { return opt.key === rangeKey; });
    if (!isAllowed) return;
    temperatureTrend.ranges[series] = rangeKey;
    document.querySelectorAll('.trend-range-btn').forEach(function (b) { b.classList.remove('active'); });
    if (btn) btn.classList.add('active');
    loadTemperatureTrends(true);
}

// Backward-compatible alias for old buttons. The V1 UI uses tab mode.
function toggleTrendSeries(series, btn) { setTrendSeries(series, btn); }

function trendTargetMs(point) {
    if (!point || !point.target_key) return NaN;
    var raw = String(point.target_key).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) raw += 'T00:00:00+09:00';
    else if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(raw) && !/(Z|[+-]\d{2}:?\d{2})$/.test(raw)) raw = raw.replace(' ', 'T') + '+09:00';
    return new Date(raw).getTime();
}

function kstYMD(ms) {
    if (!isFinite(ms)) return '-';
    var parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date(ms));
    var y = parts.find(function (p) { return p.type === 'year'; })?.value || '0000';
    var m = parts.find(function (p) { return p.type === 'month'; })?.value || '00';
    var d = parts.find(function (p) { return p.type === 'day'; })?.value || '00';
    return y + '-' + m + '-' + d;
}

function kstYMDH(ms) {
    if (!isFinite(ms)) return '-';
    var parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23'
    }).formatToParts(new Date(ms));
    var y = parts.find(function (p) { return p.type === 'year'; })?.value || '0000';
    var m = parts.find(function (p) { return p.type === 'month'; })?.value || '00';
    var d = parts.find(function (p) { return p.type === 'day'; })?.value || '00';
    var h = parts.find(function (p) { return p.type === 'hour'; })?.value || '00';
    return y + '-' + m + '-' + d + ' ' + h;
}

function kstDayStartMs(ms) {
    return new Date(kstYMD(ms) + 'T00:00:00+09:00').getTime();
}

function currentTrendTickMs(series, nowMs) {
    if (!isFinite(nowMs)) return NaN;
    if (series === 'hourly') return Math.ceil(nowMs / 3600000) * 3600000;
    return kstDayStartMs(nowMs);
}

function trendDateLabel(ms, isNow, series) {
    if (!isFinite(ms)) return '-';
    var ymd = kstYMD(ms);
    var mmdd = ymd.substring(5, 10).replace('-', '.');
    return mmdd;
}

function trendHoverTickMs(series, ms) {
    if (!isFinite(ms)) return NaN;
    if (series === 'hourly') return Math.round(ms / 3600000) * 3600000;
    return kstDayStartMs(ms);
}

function trendTickDisplay(series, ms) {
    if (!isFinite(ms)) return '-';
    if (series === 'hourly') return kstYMDH(ms) + ':00 KST';
    return kstYMD(ms) + ' KST';
}

function trendFullTargetLabel(series, point) {
    var target = point.target_key ? String(point.target_key) : '-';
    if (series === 'hourly') return target.replace('T', ' ').substring(0, 16);
    return target.substring(0, 10);
}

function formatTrendNumber(value) {
    var n = Number(value);
    return isFinite(n) ? (Math.round(n * 10) / 10).toString() : '-';
}

function trendTooltipHtml(series, point, kmaPoint) {
    var cfg = TREND_SERIES_CONFIG[series];
    var latest = point.latest_collected_at ? shortDateTime(point.latest_collected_at) : '-';
    var first = point.first_collected_at ? shortDateTime(point.first_collected_at) : '-';
    var accTemp = Number(point.latest_temp);        // (A)
    var kmaTemp = kmaPoint && kmaPoint.actual_temp !== null && kmaPoint.actual_temp !== undefined ? Number(kmaPoint.actual_temp) : NaN; // (B)
    var accLow = Number(point.latest_low);          // (C)
    var kmaLow = kmaPoint && kmaPoint.actual_low !== null && kmaPoint.actual_low !== undefined ? Number(kmaPoint.actual_low) : NaN; // (D)
    var delta = isFinite(accTemp) && isFinite(kmaTemp) ? accTemp - kmaTemp : NaN;
    var deltaLow = isFinite(accLow) && isFinite(kmaLow) ? accLow - kmaLow : NaN;
    var deltaText = isFinite(delta) ? (delta > 0 ? '+' : '') + formatTrendNumber(delta) + '℃' : '-';
    var deltaLowText = isFinite(deltaLow) ? (deltaLow > 0 ? '+' : '') + formatTrendNumber(deltaLow) + '℃' : '-';
    var kmaObservedAt = kmaPoint && kmaPoint.observed_at ? shortDateTime(kmaPoint.observed_at) : '-';
    var accLowRow = series !== 'hourly'
        ? '<div class="tooltip-row"><span>최저 예측 (C)</span><b>' + (isFinite(accLow) ? formatTrendNumber(accLow) + '℃' : '-') + '</b></div>'
        : '';
    var kmaLowRow = series !== 'hourly'
        ? '<div class="tooltip-row"><span>최저 온도 (D)</span><b>' + (isFinite(kmaLow) ? formatTrendNumber(kmaLow) + '℃' : '-') + '</b></div>'
        : '';
    var lowDeltaRow = series !== 'hourly'
        ? '<div class="tooltip-row compare"><span>최저 차이 (C-D)</span><b>' + deltaLowText + '</b></div>'
        : '';
    return '<div class="trend-tooltip-card">' +
        '<div class="trend-tooltip-title"><span>' + cfg.icon + '</span><b>' + cfg.label + '</b></div>' +
        '<div class="tooltip-target">' + escapeHtml(trendFullTargetLabel(series, point)) + '</div>' +
        '<div class="tooltip-grid">' +
            '<div class="tooltip-section"><em>AccuWeather</em>' +
                '<div class="tooltip-row"><span>최신 ' + cfg.valueLabel + ' (A)</span><b>' + (isFinite(accTemp) ? formatTrendNumber(accTemp) + '℃' : '-') + '</b></div>' +
                accLowRow +
                '<div class="tooltip-row"><span>예측 범위</span><b>' + formatTrendNumber(point.range_min) + ' ~ ' + formatTrendNumber(point.range_max) + '℃</b></div>' +
                '<div class="tooltip-row"><span>최신 크롤링</span><b>' + escapeHtml(latest) + '</b></div>' +
            '</div>' +
            '<div class="tooltip-section"><em>KMA</em>' +
                '<div class="tooltip-row"><span>실측 온도 (B)</span><b>' + (isFinite(kmaTemp) ? formatTrendNumber(kmaTemp) + '℃' : '-') + '</b></div>' +
                kmaLowRow +
                '<div class="tooltip-row"><span>관측시각</span><b>' + escapeHtml(kmaObservedAt) + '</b></div>' +
            '</div>' +
        '</div>' +
        '<div class="tooltip-section tooltip-compare"><em>비교</em>' +
            '<div class="tooltip-row compare"><span>온도 차이 (A-B)</span><b>' + deltaText + '</b></div>' +
            lowDeltaRow +
        '</div>' +
        '<div class="tooltip-foot">표본 ' + escapeHtml(point.sample_count || 0) + '건 · ' + escapeHtml(first) + ' ~ ' + escapeHtml(latest) + '</div>' +
    '</div>';
}

async function loadTemperatureTrends(force) {
    var wrap = document.getElementById('temperatureChartWrap');
    if (!wrap) return;
    var series = temperatureTrend.activeSeries || 'hourly';
    var range = getActiveTrendRange();
    var cacheKey = series + ':' + range;

    if (!temperatureTrend.dataCache[cacheKey] || force) {
        try {
            wrap.innerHTML = '<div class="chart-loading">' + TREND_SERIES_CONFIG[series].label + ' 온도 그래프 데이터를 불러오는 중...</div>';
            var res = await fetch('/api/temperature-trends?series=' + encodeURIComponent(series) + '&range=' + encodeURIComponent(range));
            temperatureTrend.dataCache[cacheKey] = await res.json();
        } catch (e) {
            console.error(e);
            wrap.innerHTML = '<div class="chart-empty">온도 그래프 API에 연결할 수 없습니다.</div>';
            return;
        }
    }
    temperatureTrend.data = temperatureTrend.dataCache[cacheKey];
    renderTemperatureTrend();
}

function buildSampledPoints(points, plotW, series) {
    // V7: do not resample forecast targets. Each AccuWeather/KMA point is placed
    // at its exact target timestamp on the fixed x-axis.
    return points || [];
}

function addDaysKst(ms, days) {
    return ms + days * 86400000;
}

function buildEvenTicks(minX, maxX, count) {
    if (count <= 1 || minX === maxX) return [{ ms: minX }];
    var out = [];
    for (var i = 0; i < count; i++) out.push({ ms: minX + (maxX - minX) * i / (count - 1) });
    return out;
}

function alignToHour(ms) { return Math.round(ms / 3600000) * 3600000; }
function alignToKstDay(ms) {
    var offset = 9 * 3600000;
    return Math.round((ms + offset) / 86400000) * 86400000 - offset;
}
function buildAlignedEvenTicks(minX, maxX, count, series) {
    if (count <= 1 || minX === maxX) return [{ ms: minX }];
    var out = [{ ms: minX }];
    var seen = {};
    seen[Math.round(minX / 60000)] = true;
    for (var i = 1; i < count - 1; i++) {
        var raw = minX + (maxX - minX) * i / (count - 1);
        var aligned = series === 'hourly' ? alignToHour(raw) : alignToKstDay(raw);
        aligned = clamp(aligned, minX, maxX);
        var key = Math.round(aligned / 60000);
        if (!seen[key]) { out.push({ ms: aligned }); seen[key] = true; }
    }
    if (!seen[Math.round(maxX / 60000)]) out.push({ ms: maxX });
    return out;
}

function buildXAxisTicks(minX, maxX, rangeKey, series, currentTickMs) {
    if (!isFinite(minX) || !isFinite(maxX) || minX === maxX) return [];
    var ticks = [];

    if (series === 'hourly' && (rangeKey === '7d' || rangeKey === '14d')) {
        var intervalHours = rangeKey === '7d' ? 24 : 48;
        ticks.push({ ms: minX, isNow: false });
        var cursor = minX + intervalHours * 3600000;
        while (cursor < maxX - 1800000) {
            ticks.push({ ms: cursor, isNow: false });
            cursor += intervalHours * 3600000;
        }
        ticks.push({ ms: maxX, isNow: false });
    } else {
        var desired = 6;
        if (series === 'monthly' && rangeKey === '1y') desired = 12;
        ticks = buildAlignedEvenTicks(minX, maxX, desired, series).map(function (d) { return { ms: d.ms, isNow: false }; });
    }

    // Current time is rendered as a separate red guide line, not as an x-axis label.

    var seen = {};
    return ticks.sort(function (a, b) { return a.ms - b.ms; }).filter(function (d) {
        var key = Math.round(d.ms / 60000);
        if (seen[key]) return false;
        seen[key] = true;
        return true;
    });
}

function updateTrendMeta(pointCount, tickCount, sampledCount) {
    var series = temperatureTrend.activeSeries || 'hourly';
    var cfg = TREND_SERIES_CONFIG[series];
    var legend = document.getElementById('trendLegend');
    if (legend) {
        legend.classList.remove('hourly', 'daily', 'monthly');
        legend.classList.add(series);
        legend.querySelectorAll('.active-series').forEach(function (el) {
            el.classList.remove('hourly', 'daily', 'monthly');
            el.classList.add(series);
            var b = el.querySelector('b'); if (b) b.textContent = cfg.label + ' 최신 예측값';
        });
    }
    var lowLegend = document.getElementById('trendLowLegend');
    if (lowLegend) lowLegend.style.display = series === 'hourly' ? 'none' : 'inline-flex';
    var kmaLowLegend = document.getElementById('trendKmaLowLegend');
    if (kmaLowLegend) kmaLowLegend.style.display = series === 'hourly' ? 'none' : 'inline-flex';
}

function buildKmaMap(items) {
    var map = {};
    (items || []).forEach(function (p) {
        var ms = trendTargetMs(p);
        if (!isFinite(ms)) return;
        map[kstYMDH(ms)] = p;
        map[Math.round(ms / 3600000) * 3600000] = p;
        map[kstYMD(ms)] = p;
    });
    return map;
}

function trendPointKey(series, ms) {
    if (!isFinite(ms)) return '';
    return series === 'hourly' ? String(Math.round(ms / 3600000) * 3600000) : kstYMD(ms);
}

function buildTrendPointMap(series, points) {
    var map = {};
    (points || []).forEach(function (d) {
        map[trendPointKey(series, d.ms)] = d;
    });
    return map;
}

function findTrendPointAtTick(series, tickMs, pointMap) {
    return (pointMap || {})[trendPointKey(series, tickMs)] || null;
}

function findKmaForTick(series, tickMs, kmaMap) {
    if (series === 'hourly') return (kmaMap || {})[Math.round(tickMs / 3600000) * 3600000] || null;
    return (kmaMap || {})[kstYMD(tickMs)] || null;
}

function isSameTrendTick(series, aMs, bMs) {
    if (!isFinite(aMs) || !isFinite(bMs)) return false;
    if (series === 'hourly') return Math.round(aMs / 3600000) === Math.round(bMs / 3600000);
    return kstYMD(aMs) === kstYMD(bMs);
}

function findTrendPointForTick(series, tickMs, points) {
    var arr = points || [];
    for (var i = 0; i < arr.length; i++) {
        if (isSameTrendTick(series, arr[i].ms, tickMs)) return arr[i];
    }
    return null;
}

function findKmaPointForTick(series, tickMs, kmaPoints) {
    var arr = kmaPoints || [];
    for (var i = 0; i < arr.length; i++) {
        if (isSameTrendTick(series, arr[i].ms, tickMs)) return arr[i].p;
    }
    return null;
}

function setSvgHoverIndicator(svg, ctx, tickMs, accPoint, kmaPoint) {
    if (!svg || !ctx || !isFinite(tickMs)) return;
    var old = svg.querySelector('#trendHoverIndicator');
    if (old) old.remove();
    var span = Math.max(1, ctx.maxX - ctx.minX);
    var xx = ctx.left + ((tickMs - ctx.minX) / span) * ctx.plotW;
    var g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('id', 'trendHoverIndicator');
    g.setAttribute('class', 'trend-hover-indicator');
    var line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('class', 'hover-guide active');
    line.setAttribute('x1', xx.toFixed(1)); line.setAttribute('x2', xx.toFixed(1));
    line.setAttribute('y1', ctx.top); line.setAttribute('y2', ctx.top + ctx.plotH);
    g.appendChild(line);

    function appendCircle(cls, value, r) {
        var n = Number(value);
        if (!isFinite(n)) return;
        var yy = ctx.top + (1 - ((n - ctx.minY) / Math.max(1e-9, ctx.maxY - ctx.minY))) * ctx.plotH;
        var c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        c.setAttribute('class', cls);
        c.setAttribute('cx', xx.toFixed(1)); c.setAttribute('cy', yy.toFixed(1)); c.setAttribute('r', r);
        g.appendChild(c);
    }
    if (accPoint) {
        appendCircle('temp-point hover-active ' + ctx.series, accPoint.p.latest_temp, '4.8');
        if (ctx.series !== 'hourly') appendCircle('temp-low-point hover-active ' + ctx.series, accPoint.p.latest_low, '4.1');
    }
    if (kmaPoint) {
        appendCircle('kma-point kma-high-point hover-active', kmaPoint.actual_temp, '5.1');
        if (ctx.series !== 'hourly') appendCircle('kma-low-point hover-active', kmaPoint.actual_low, '5.1');
    }
    svg.appendChild(g);
}

function hideTrendHoverIndicator() {
    var wrap = document.getElementById('temperatureChartWrap');
    if (!wrap) return;
    var svg = wrap.querySelector('svg');
    var old = svg && svg.querySelector('#trendHoverIndicator');
    if (old) old.remove();
}

function emptyTrendTooltipHtml(series, tickMs, kmaPoint) {
    var cfg = TREND_SERIES_CONFIG[series];
    var kmaTemp = kmaPoint && kmaPoint.actual_temp !== null && kmaPoint.actual_temp !== undefined ? Number(kmaPoint.actual_temp) : NaN; // (B)
    var kmaLow = kmaPoint && kmaPoint.actual_low !== null && kmaPoint.actual_low !== undefined ? Number(kmaPoint.actual_low) : NaN; // (D)
    var kmaObservedAt = kmaPoint && kmaPoint.observed_at ? shortDateTime(kmaPoint.observed_at) : '-';
    var accLowRow = series !== 'hourly' ? '<div class="tooltip-row"><span>최저 예측 (C)</span><b>-</b></div>' : '';
    var kmaLowRow = series !== 'hourly' ? '<div class="tooltip-row"><span>최저 온도 (D)</span><b>' + (isFinite(kmaLow) ? formatTrendNumber(kmaLow) + '℃' : '-') + '</b></div>' : '';
    return '<div class="tooltip-hover-label">조회 tick · ' + escapeHtml(trendTickDisplay(series, tickMs)) + '</div>' +
        '<div class="trend-tooltip-card empty-accuweather">' +
            '<div class="trend-tooltip-title"><span>' + cfg.icon + '</span><b>' + cfg.label + '</b></div>' +
            '<div class="tooltip-target">' + escapeHtml(trendTickDisplay(series, tickMs).replace(' KST', '')) + '</div>' +
            '<div class="tooltip-grid">' +
                '<div class="tooltip-section muted-section"><em>AccuWeather</em>' +
                    '<div class="tooltip-row"><span>최신 ' + cfg.valueLabel + ' (A)</span><b>-</b></div>' +
                    accLowRow +
                    '<div class="tooltip-row"><span>예측 범위</span><b>-</b></div>' +
                    '<div class="tooltip-row"><span>최신 크롤링</span><b>-</b></div>' +
                '</div>' +
                '<div class="tooltip-section"><em>KMA</em>' +
                    '<div class="tooltip-row"><span>실측 온도 (B)</span><b>' + (isFinite(kmaTemp) ? formatTrendNumber(kmaTemp) + '℃' : '-') + '</b></div>' +
                    kmaLowRow +
                    '<div class="tooltip-row"><span>관측시각</span><b>' + escapeHtml(kmaObservedAt) + '</b></div>' +
                '</div>' +
            '</div>' +
            '<div class="tooltip-section tooltip-compare"><em>비교</em>' +
                '<div class="tooltip-row compare"><span>온도 차이 (A-B)</span><b>-</b></div>' +
                (series !== 'hourly' ? '<div class="tooltip-row compare"><span>최저 차이 (C-D)</span><b>-</b></div>' : '') +
            '</div>' +
            '<div class="tooltip-foot">해당 tick의 AccuWeather 예측값은 아직 없습니다.</div>' +
        '</div>';
}

function showAxisHoverFromSvg(e, el) {
    var ctx = temperatureTrend.renderCtx;
    if (!ctx) return;
    var svg = el.ownerSVGElement;
    var pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    var loc = pt.matrixTransform(svg.getScreenCTM().inverse());
    var ratio = clamp((loc.x - ctx.left) / Math.max(1, ctx.plotW), 0, 1);
    var cursorMs = ctx.minX + (ctx.maxX - ctx.minX) * ratio;
    var tickMs = clamp(trendHoverTickMs(ctx.series, cursorMs), ctx.minX, ctx.maxX);
    var accPoint = findTrendPointForTick(ctx.series, tickMs, ctx.points || []);
    var kmaPoint = findKmaPointForTick(ctx.series, tickMs, ctx.kmaPoints || []);
    setSvgHoverIndicator(svg, ctx, tickMs, accPoint, kmaPoint);
    var html = accPoint
        ? ('<div class="tooltip-hover-label">조회 tick · ' + escapeHtml(trendTickDisplay(ctx.series, tickMs)) + '</div>' + trendTooltipHtml(ctx.series, accPoint.p, kmaPoint))
        : emptyTrendTooltipHtml(ctx.series, tickMs, kmaPoint);
    showChartTooltipHtml(e, html);
}

function renderTemperatureTrend() {
    var wrap = document.getElementById('temperatureChartWrap');
    if (!wrap) return;
    var payload = temperatureTrend.data;
    var series = temperatureTrend.activeSeries || 'hourly';
    var cfg = TREND_SERIES_CONFIG[series];
    var rangeKey = getActiveTrendRange();
    if (!payload || payload.error) {
        wrap.innerHTML = '<div class="chart-empty">온도 그래프 데이터가 없습니다.</div>';
        updateTrendMeta(null, null, null);
        return;
    }

    var axisStartMs = new Date(payload.axis_start || '').getTime();
    var axisEndMs = new Date(payload.axis_end || '').getTime();
    var nowMs = new Date(payload.now_kst || '').getTime();

    var rawAll = ((payload.series && payload.series[series]) || []).map(function (p) {
        return { p: p, ms: trendTargetMs(p) };
    }).filter(function (d) {
        return isFinite(d.ms) && isFinite(Number(d.p.latest_temp));
    }).sort(function (a, b) { return a.ms - b.ms; });

    if (!isFinite(axisStartMs) || !isFinite(axisEndMs) || axisStartMs === axisEndMs) {
        axisStartMs = rawAll.length ? rawAll[0].ms : Date.now() - 86400000;
        axisEndMs = rawAll.length ? rawAll[rawAll.length - 1].ms : Date.now();
    }
    if (!isFinite(nowMs)) nowMs = Date.now();

    var raw = rawAll.filter(function (d) { return d.ms >= axisStartMs && d.ms <= axisEndMs; });
    if (!raw.length) {
        wrap.innerHTML = '<div class="chart-empty">' + cfg.label + ' 그래프에 표시할 데이터가 없습니다.</div>';
        updateTrendMeta(0, 0, 0);
        return;
    }

    var width = Math.max(920, wrap.clientWidth || 1120);
    var height = series === 'hourly' ? 430 : 414;
    var m = { left: 70, right: 30, top: 36, bottom: 92 };
    var plotW = width - m.left - m.right;
    var plotH = height - m.top - m.bottom;
    var points = buildSampledPoints(raw, plotW, series);
    var minX = axisStartMs;
    var maxX = axisEndMs;
    if (minX === maxX) maxX = minX + (series === 'hourly' ? 3600000 : 86400000);
    var currentTickMs = currentTrendTickMs(series, nowMs);
    var ticks = buildXAxisTicks(minX, maxX, rangeKey, series, currentTickMs);

    var kmaItems = (payload.kma && payload.kma[series]) || [];
    var kmaMap = buildKmaMap(kmaItems);
    var kmaPoints = kmaItems.map(function (p) { return { p: p, ms: trendTargetMs(p) }; })
        .filter(function (d) { return isFinite(d.ms) && d.ms >= minX && d.ms <= maxX && isFinite(Number(d.p.actual_temp)); })
        .sort(function (a, b) { return a.ms - b.ms; });

    var yVals = [];
    // V14: the hourly y-axis must be based only on visible hourly forecast/KMA
    // temperature lines. Do not let variance bands, low-temp placeholders, or KMA
    // sentinel values such as -99/-9 flatten a 23~30℃ chart into a huge range.
    function pushScaleValue(value) {
        var v = Number(value);
        if (!isFinite(v)) return;
        // KMA uses large negative sentinels for missing values. Real Korean air
        // temperature can be negative, so only remove obvious sentinel/outlier values.
        if (v <= -50 || v >= 60) return;
        yVals.push(v);
    }
    points.forEach(function (d) {
        pushScaleValue(d.p.latest_temp);
        if (series !== 'hourly') pushScaleValue(d.p.latest_low);
    });
    kmaPoints.forEach(function (d) {
        pushScaleValue(d.p.actual_temp);
        if (series !== 'hourly') pushScaleValue(d.p.actual_low);
    });
    var minY = Math.min.apply(null, yVals), maxY = Math.max.apply(null, yVals);
    if (!isFinite(minY) || !isFinite(maxY)) { minY = 0; maxY = 40; }
    if (minY === maxY) { minY -= 1.2; maxY += 1.2; }
    var spanY = maxY - minY;
    var padY = series === 'hourly'
        ? Math.max(0.75, Math.min(2.0, spanY * 0.16))
        : Math.max(0.9, Math.min(3.0, spanY * 0.14));
    minY = Math.floor((minY - padY) * 2) / 2;
    maxY = Math.ceil((maxY + padY) * 2) / 2;

    function x(ms) { return m.left + ((ms - minX) / (maxX - minX)) * plotW; }
    function y(val) { return m.top + (1 - ((val - minY) / (maxY - minY))) * plotH; }
    function pointsString(data, key) {
        return data.filter(function (d) { return isFinite(Number(d.p[key])); })
            .map(function (d) { return x(d.ms).toFixed(1) + ',' + y(Number(d.p[key])).toFixed(1); }).join(' ');
    }
    function bandPolygon(data, lowKey, highKey) {
        var good = data.filter(function (d) { return isFinite(Number(d.p[lowKey])) && isFinite(Number(d.p[highKey])); });
        if (good.length < 2) return '';
        var upper = good.map(function (d) { return x(d.ms).toFixed(1) + ',' + y(Number(d.p[highKey])).toFixed(1); });
        var lower = good.slice().reverse().map(function (d) { return x(d.ms).toFixed(1) + ',' + y(Number(d.p[lowKey])).toFixed(1); });
        return upper.concat(lower).join(' ');
    }

    var svg = '';
    svg += '<svg class="temperature-svg ' + series + '" viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="' + cfg.label + ' temperature trend">';
    svg += '<rect class="chart-bg" x="0" y="0" width="' + width + '" height="' + height + '"></rect>';
    svg += '<defs><clipPath id="trendClip"><rect x="' + m.left + '" y="' + m.top + '" width="' + plotW + '" height="' + plotH + '"></rect></clipPath></defs>';

    // Grid is clipped to plot area, labels are not clipped.
    svg += '<g class="grid-layer" clip-path="url(#trendClip)">';
    var ySteps = 6;
    for (var i = 0; i <= ySteps; i++) {
        var tv = minY + ((maxY - minY) * i / ySteps);
        var yy = y(tv);
        svg += '<line class="grid-line" x1="' + m.left + '" y1="' + yy + '" x2="' + (width - m.right) + '" y2="' + yy + '"></line>';
    }
    ticks.forEach(function (d) {
        var xx = x(d.ms);
        svg += '<line class="grid-line x-grid" x1="' + xx + '" y1="' + m.top + '" x2="' + xx + '" y2="' + (height - m.bottom) + '"></line>';
    });
    svg += '</g>';

    svg += '<g class="plot-layer" clip-path="url(#trendClip)">';
    var rangeBand = bandPolygon(points, 'range_min', 'range_max');
    if (rangeBand) svg += '<polygon class="forecast-range-fill ' + series + '" points="' + rangeBand + '"></polygon>';
    if (series !== 'hourly') {
        var lowBand = bandPolygon(points, 'low_range_min', 'low_range_max');
        if (lowBand) svg += '<polygon class="forecast-low-range-fill ' + series + '" points="' + lowBand + '"></polygon>';
    }

    var linePts = pointsString(points, 'latest_temp');
    if (linePts) svg += '<polyline class="temp-line ' + series + '" points="' + linePts + '"></polyline>';
    if (series !== 'hourly') {
        var lowPts = pointsString(points, 'latest_low');
        if (lowPts) svg += '<polyline class="temp-low-line ' + series + '" points="' + lowPts + '"></polyline>';
    }

    var kmaLine = kmaPoints.map(function (d) { return x(d.ms).toFixed(1) + ',' + y(Number(d.p.actual_temp)).toFixed(1); }).join(' ');
    if (kmaLine) svg += '<polyline class="kma-line" points="' + kmaLine + '"></polyline>';
    if (series !== 'hourly') {
        var kmaLowLine = kmaPoints.filter(function (d) { return isFinite(Number(d.p.actual_low)); })
            .map(function (d) { return x(d.ms).toFixed(1) + ',' + y(Number(d.p.actual_low)).toFixed(1); }).join(' ');
        if (kmaLowLine) svg += '<polyline class="kma-low-line" points="' + kmaLowLine + '"></polyline>';
    }

    points.forEach(function (d) {
        var xx = x(d.ms), yy = y(Number(d.p.latest_temp));
        if (isFinite(yy)) svg += '<circle class="temp-point ' + series + '" cx="' + xx.toFixed(1) + '" cy="' + yy.toFixed(1) + '" r="2.05"></circle>';
        if (series !== 'hourly' && isFinite(Number(d.p.latest_low))) {
            svg += '<circle class="temp-low-point ' + series + '" cx="' + xx.toFixed(1) + '" cy="' + y(Number(d.p.latest_low)).toFixed(1) + '" r="1.75"></circle>';
        }
    });
    kmaPoints.forEach(function (d) {
        var xx = x(d.ms), yy = y(Number(d.p.actual_temp));
        if (isFinite(yy)) svg += '<circle class="kma-point kma-high-point" cx="' + xx.toFixed(1) + '" cy="' + yy.toFixed(1) + '" r="2.45"></circle>';
        if (series !== 'hourly' && isFinite(Number(d.p.actual_low))) {
            svg += '<circle class="kma-low-point" cx="' + xx.toFixed(1) + '" cy="' + y(Number(d.p.actual_low)).toFixed(1) + '" r="2.45"></circle>';
        }
    });
    if (isFinite(currentTickMs) && currentTickMs >= minX && currentTickMs <= maxX) {
        var nowX = x(currentTickMs);
        svg += '<line class="current-time-line" x1="' + nowX.toFixed(1) + '" y1="' + m.top + '" x2="' + nowX.toFixed(1) + '" y2="' + (height - m.bottom) + '"></line>';
    }
    svg += '</g>';

    // Axis labels are intentionally outside the plot clip.
    for (var yi = 0; yi <= ySteps; yi++) {
        var yv = minY + ((maxY - minY) * yi / ySteps);
        var yPos = y(yv);
        svg += '<text class="axis-label y-label" x="' + (m.left - 12) + '" y="' + (yPos + 4) + '" text-anchor="end">' + formatTrendNumber(yv) + '℃</text>';
    }
    ticks.forEach(function (d) {
        var xx = x(d.ms);
        var yy = height - 48;
        svg += '<line class="x-axis-tick" x1="' + xx.toFixed(1) + '" y1="' + (height - m.bottom) + '" x2="' + xx.toFixed(1) + '" y2="' + (height - m.bottom + 7) + '"></line>';
        svg += '<text class="axis-label x-label" x="' + xx.toFixed(1) + '" y="' + yy + '" text-anchor="end" transform="rotate(-45 ' + xx.toFixed(1) + ' ' + yy + ')">' + escapeHtml(trendDateLabel(d.ms, false, series)) + '</text>';
    });
    svg += '<text class="axis-title y-axis-title" x="' + m.left + '" y="20" text-anchor="start">Temperature (℃)</text>';
    svg += '<text class="axis-title x-axis-title" x="' + (width - m.right) + '" y="' + (height - 12) + '" text-anchor="end">Target date</text>';
    svg += '<rect class="axis-hover-capture" x="' + (m.left - 24) + '" y="' + (m.top - 8) + '" width="' + (plotW + 48) + '" height="' + (plotH + 16) + '" onmousemove="showAxisHoverFromSvg(event,this)" onmouseenter="showAxisHoverFromSvg(event,this)" onmouseleave="hideTrendHoverIndicator();hideChartTooltip()"></rect>';
    svg += '</svg>';

    temperatureTrend.renderCtx = {
        series: series, minX: minX, maxX: maxX, nowMs: nowMs, currentTickMs: currentTickMs,
        left: m.left, top: m.top, plotW: plotW, plotH: plotH, minY: minY, maxY: maxY,
        points: points, pointMap: buildTrendPointMap(series, points), kmaMap: kmaMap, kmaPoints: kmaPoints
    };
    wrap.innerHTML = svg;
    updateTrendMeta(raw.length, ticks.length, points.length);
}

// ══════════════════ Load All ══════════════════
function loadAll() {
    loadProgress(); loadSummary(); loadLogs(); loadHourlyData(); loadDailyData(); loadMonthlyData(); loadKmaHourlyData(); loadKmaDailyData(); loadTimeline(); loadTemperatureTrends(true);
    document.getElementById('lastUpdate').textContent = '업데이트: ' + new Date().toLocaleString('ko-KR');
}
function loadSystemAll() {
    loadSystemHealth(); loadAlerts(); loadSystemLogs();
    document.getElementById('sysLastUpdate').textContent = '시스템 업데이트: ' + new Date().toLocaleString('ko-KR');
}

// ══════════════════ Init ══════════════════
document.addEventListener('DOMContentLoaded', function () {
    initDarkMode();
    updateAutoRefreshBtn();
    initTemperatureTrendControls();
    loadAll();
    loadDateRanges();
    startAutoRefresh();
    window.addEventListener('resize', function () { renderTemperatureTrend(); });
});
