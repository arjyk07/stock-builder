// ── 설정 ─────────────────────────────────────────────────────────────────
const TICKER   = '010170.KS';
const INTERVAL = '1d';

const YAHOO_URL = (range) =>
    `https://query1.finance.yahoo.com/v8/finance/chart/${TICKER}?interval=${INTERVAL}&range=${range}`;

const PROXIES = [
    (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
    (u) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
];

// ── 샘플 데이터 (API 실패 시 즉시 표시용) ────────────────────────────────
function buildSampleData() {
    const rows = [];
    let price = 3200;
    const start = new Date('2024-08-01');
    const end   = new Date('2026-02-20');
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dow = d.getDay();
        if (dow === 0 || dow === 6) continue;
        const chg   = (Math.random() - 0.47) * 100;
        const open  = Math.max(Math.round(price), 500);
        const close = Math.max(Math.round(price + chg), 500);
        rows.push({
            time:   d.toISOString().slice(0, 10),
            open,
            high:   Math.max(open, close) + Math.round(Math.random() * 60),
            low:    Math.min(open, close) - Math.round(Math.random() * 60),
            close,
            volume: Math.round(80000 + Math.random() * 600000),
            isSample: true,
        });
        price = close;
    }
    return rows;
}
const SAMPLE_DATA = buildSampleData();

// ── 캐시 ─────────────────────────────────────────────────────────────────
const CACHE_TTL = 10 * 60 * 1000;

function getCached(range) {
    try {
        const raw = localStorage.getItem(`stock_${TICKER}_${range}`);
        if (!raw) return null;
        const { data, ts } = JSON.parse(raw);
        if (Date.now() - ts > CACHE_TTL) return null;
        return data;
    } catch { return null; }
}

function setCache(range, data) {
    try {
        localStorage.setItem(`stock_${TICKER}_${range}`,
            JSON.stringify({ data, ts: Date.now() }));
    } catch {}
}

// ── fetch + 수동 타임아웃 ─────────────────────────────────────────────────
function fetchWithTimeout(url, ms) {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    return fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

async function fetchYahoo(range) {
    const url = YAHOO_URL(range);

    const tryFetch = (target) =>
        fetchWithTimeout(target, 8000)
            .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
            .then(j => { if (!j?.chart?.result) throw new Error('no result'); return j; });

    return Promise.any([
        tryFetch(url),
        ...PROXIES.map(p => tryFetch(p(url))),
    ]).catch(() => { throw new Error('API 응답 없음'); });
}

// ── 응답 파싱 ─────────────────────────────────────────────────────────────
function parseYahoo(json) {
    const result     = json.chart.result[0];
    const timestamps = result.timestamp;
    const quote      = result.indicators.quote[0];
    return timestamps
        .map((ts, i) => ({
            time:   new Date(ts * 1000).toISOString().slice(0, 10),
            open:   quote.open[i]   != null ? Math.round(quote.open[i])   : null,
            high:   quote.high[i]   != null ? Math.round(quote.high[i])   : null,
            low:    quote.low[i]    != null ? Math.round(quote.low[i])    : null,
            close:  quote.close[i]  != null ? Math.round(quote.close[i])  : null,
            volume: quote.volume[i] ?? 0,
        }))
        .filter(d => d.open && d.high && d.low && d.close);
}

// ── 기간 필터 (샘플 데이터용) ─────────────────────────────────────────────
function filterSample(range) {
    const last = new Date(SAMPLE_DATA[SAMPLE_DATA.length - 1].time);
    const from = new Date(last);
    if      (range === '3mo') from.setMonth(from.getMonth() - 3);
    else if (range === '6mo') from.setMonth(from.getMonth() - 6);
    else if (range === '1y')  from.setFullYear(from.getFullYear() - 1);
    else return SAMPLE_DATA;
    const fromStr = from.toISOString().slice(0, 10);
    return SAMPLE_DATA.filter(d => d.time >= fromStr);
}

// ── 차트 초기화 ───────────────────────────────────────────────────────────
const CHART_BG   = '#161b22';
const GRID_COLOR = '#21262d';
const TEXT_COLOR = '#8b949e';
const UP_COLOR   = '#ff4b4b';
const DOWN_COLOR = '#4b8fff';

const chartEl  = document.getElementById('chart-container');
const volumeEl = document.getElementById('volume-container');

const baseOptions = {
    layout: { background: { color: CHART_BG }, textColor: TEXT_COLOR },
    grid:   { vertLines: { color: GRID_COLOR }, horzLines: { color: GRID_COLOR } },
    crosshair:       { mode: LightweightCharts.CrosshairMode.Normal },
    rightPriceScale: { borderColor: GRID_COLOR },
    timeScale:       { borderColor: GRID_COLOR, timeVisible: true, secondsVisible: false },
    handleScroll: true,
    handleScale:  true,
};

const mainChart = LightweightCharts.createChart(chartEl, {
    ...baseOptions, width: chartEl.clientWidth, height: 380,
});
const candleSeries = mainChart.addCandlestickSeries({
    upColor: UP_COLOR, downColor: DOWN_COLOR,
    borderUpColor: UP_COLOR, borderDownColor: DOWN_COLOR,
    wickUpColor: UP_COLOR, wickDownColor: DOWN_COLOR,
});

const volumeChart = LightweightCharts.createChart(volumeEl, {
    ...baseOptions,
    width:  volumeEl.clientWidth,
    height: 100,
    rightPriceScale: { borderColor: GRID_COLOR, scaleMargins: { top: 0.1, bottom: 0 } },
    timeScale: { ...baseOptions.timeScale, visible: false },
});
const volumeSeries = volumeChart.addHistogramSeries({
    priceFormat: { type: 'volume' }, priceScaleId: 'volume',
    scaleMargins: { top: 0.1, bottom: 0 },
});

// ── UI 상태 ───────────────────────────────────────────────────────────────
const overlayEl  = document.getElementById('chart-overlay');
const sourceEl   = document.getElementById('data-source');

function hideOverlay() {
    overlayEl.className = 'chart-overlay hidden';
    mainChart.applyOptions({ width: chartEl.clientWidth });
    volumeChart.applyOptions({ width: volumeEl.clientWidth });
}

function showOverlay(type, html) {
    overlayEl.className = `chart-overlay ${type}`;
    overlayEl.innerHTML = html;
}

// ── 차트 적용 ─────────────────────────────────────────────────────────────
let currentData  = [];
let volumeByDate = {};

function applyToChart(data) {
    currentData  = data;
    volumeByDate = Object.fromEntries(data.map(d => [d.time, d.volume]));

    candleSeries.setData(data.map(({ time, open, high, low, close }) =>
        ({ time, open, high, low, close })));
    volumeSeries.setData(data.map(({ time, open, close, volume }) => ({
        time, value: volume,
        color: close >= open ? UP_COLOR + '99' : DOWN_COLOR + '99',
    })));

    mainChart.timeScale().fitContent();
    volumeChart.timeScale().fitContent();
    updatePriceHeader(data);
    updateOHLCV(data[data.length - 1]);
}

// ── 데이터 로드 ───────────────────────────────────────────────────────────
let activePeriod = '3mo';

async function loadData(range) {
    // 1. 캐시 있으면 즉시 표시
    const cached = getCached(range);
    if (cached) {
        applyToChart(cached);
        hideOverlay();
        setSource('실시간 (캐시)');
        return;
    }

    // 2. 샘플 데이터로 차트 즉시 표시 (API 기다리는 동안)
    applyToChart(filterSample(range));
    hideOverlay();
    setSource('샘플 데이터 (실제 데이터 불러오는 중…)');

    // 3. 백그라운드에서 실제 데이터 fetch
    try {
        const hardTimeout = new Promise((_, rej) =>
            setTimeout(() => rej(new Error('시간 초과')), 12000));
        const json = await Promise.race([fetchYahoo(range), hardTimeout]);
        const real = parseYahoo(json);
        if (real.length === 0) throw new Error('데이터 없음');

        setCache(range, real);
        applyToChart(real);
        setSource('Yahoo Finance (실시간)');
    } catch (err) {
        console.warn('[loadData] 실제 데이터 실패 → 샘플 유지:', err.message);
        setSource('샘플 데이터 (실제 데이터 불러오기 실패)');
    }
}

function setSource(text) {
    if (sourceEl) sourceEl.textContent = `데이터: ${text}`;
}

// ── 헤더 가격 ─────────────────────────────────────────────────────────────
function updatePriceHeader(data) {
    const last = data[data.length - 1];
    const prev = data[data.length - 2];
    document.getElementById('current-price').textContent = fmt(last.close);
    if (prev) {
        const diff = last.close - prev.close;
        const pct  = ((diff / prev.close) * 100).toFixed(2);
        const sign = diff >= 0 ? '+' : '';
        const cls  = diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat';
        const el   = document.getElementById('price-change');
        el.textContent = `${sign}${fmt(diff)} (${sign}${pct}%)`;
        el.className   = `price-change ${cls}`;
    }
}

// ── OHLCV ────────────────────────────────────────────────────────────────
function updateOHLCV(bar) {
    if (!bar) return;
    document.getElementById('info-date').textContent   = bar.time;
    document.getElementById('info-open').textContent   = fmt(bar.open);
    document.getElementById('info-high').textContent   = fmt(bar.high);
    document.getElementById('info-low').textContent    = fmt(bar.low);
    document.getElementById('info-close').textContent  = fmt(bar.close);
    document.getElementById('info-volume').textContent =
        (bar.volume ?? 0).toLocaleString('ko-KR') + '주';
}

mainChart.subscribeCrosshairMove((param) => {
    if (!param?.time) return;
    const bar = param.seriesData.get(candleSeries);
    if (!bar) return;
    const timeStr = typeof param.time === 'number'
        ? new Date(param.time * 1000).toISOString().slice(0, 10)
        : `${param.time.year}-${String(param.time.month).padStart(2,'0')}-${String(param.time.day).padStart(2,'0')}`;
    updateOHLCV({ time: timeStr, ...bar, volume: volumeByDate[timeStr] ?? 0 });
});

// ── 기간 버튼 ─────────────────────────────────────────────────────────────
document.querySelectorAll('.period-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        if (btn.dataset.period === activePeriod) return;
        document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activePeriod = btn.dataset.period;
        loadData(activePeriod);
    });
});

// ── 반응형 ───────────────────────────────────────────────────────────────
new ResizeObserver(() => {
    mainChart.applyOptions({ width: chartEl.clientWidth });
    volumeChart.applyOptions({ width: volumeEl.clientWidth });
}).observe(chartEl);

// ── 초기 로드 ─────────────────────────────────────────────────────────────
loadData(activePeriod);

// ── 유틸 ─────────────────────────────────────────────────────────────────
function fmt(n) {
    return Number(n).toLocaleString('ko-KR') + '원';
}
