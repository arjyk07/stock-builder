// ── 설정 ─────────────────────────────────────────────────────────────────
const TICKER   = '010170.KS'; // 대한광통신 Yahoo Finance 티커
const INTERVAL = '1d';

// Yahoo Finance v8 차트 API
const YAHOO_URL = (range) =>
    `https://query1.finance.yahoo.com/v8/finance/chart/${TICKER}?interval=${INTERVAL}&range=${range}`;

// CORS 프록시 (직접 호출 실패 시 자동 전환)
const PROXY_URL = (url) =>
    `https://corsproxy.io/?${encodeURIComponent(url)}`;

// ── 캐시 (localStorage, TTL 10분) ────────────────────────────────────────
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
    } catch { /* 저장 공간 부족 시 무시 */ }
}

// ── Yahoo Finance 호출 (직접 + 프록시 동시 경쟁) ─────────────────────────
async function fetchYahoo(range) {
    const url = YAHOO_URL(range);
    const timeout = 8000;

    const tryFetch = (target) =>
        fetch(target, { signal: AbortSignal.timeout(timeout) })
            .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
            .then(j => { if (!j?.chart?.result) throw new Error('no result'); return j; });

    // 직접 호출과 프록시를 동시에 시작 → 먼저 성공한 쪽 사용
    return Promise.any([
        tryFetch(url),
        tryFetch(PROXY_URL(url)),
    ]).catch(() => { throw new Error('데이터를 불러올 수 없습니다'); });
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
        .filter(d => d.open && d.high && d.low && d.close); // 결측 봉 제거
}

// ── 차트 초기화 ───────────────────────────────────────────────────────────
const CHART_BG   = '#161b22';
const GRID_COLOR = '#21262d';
const TEXT_COLOR = '#8b949e';
const UP_COLOR   = '#ff4b4b'; // 한국 관례: 상승 = 빨강
const DOWN_COLOR = '#4b8fff'; // 한국 관례: 하락 = 파랑

const chartEl  = document.getElementById('chart-container');
const volumeEl = document.getElementById('volume-container');

const baseOptions = {
    layout: {
        background: { color: CHART_BG },
        textColor:  TEXT_COLOR,
    },
    grid: {
        vertLines: { color: GRID_COLOR },
        horzLines: { color: GRID_COLOR },
    },
    crosshair:       { mode: LightweightCharts.CrosshairMode.Normal },
    rightPriceScale: { borderColor: GRID_COLOR },
    timeScale: {
        borderColor:    GRID_COLOR,
        timeVisible:    true,
        secondsVisible: false,
    },
    handleScroll: true,
    handleScale:  true,
};

const mainChart = LightweightCharts.createChart(chartEl, {
    ...baseOptions,
    width:  chartEl.clientWidth,
    height: 380,
});

const candleSeries = mainChart.addCandlestickSeries({
    upColor:         UP_COLOR,
    downColor:       DOWN_COLOR,
    borderUpColor:   UP_COLOR,
    borderDownColor: DOWN_COLOR,
    wickUpColor:     UP_COLOR,
    wickDownColor:   DOWN_COLOR,
});

const volumeChart = LightweightCharts.createChart(volumeEl, {
    ...baseOptions,
    width:  volumeEl.clientWidth,
    height: 100,
    rightPriceScale: {
        borderColor:  GRID_COLOR,
        scaleMargins: { top: 0.1, bottom: 0 },
    },
    timeScale: { ...baseOptions.timeScale, visible: false },
});

const volumeSeries = volumeChart.addHistogramSeries({
    priceFormat:  { type: 'volume' },
    priceScaleId: 'volume',
    scaleMargins: { top: 0.1, bottom: 0 },
});

// ── UI 상태 관리 (오버레이 방식) ──────────────────────────────────────────
const overlayEl = document.getElementById('chart-overlay');

function showLoading() {
    overlayEl.className = 'chart-overlay';
    overlayEl.innerHTML = '<div class="spinner"></div><span>데이터 불러오는 중…</span>';
}

function showChart() {
    overlayEl.className = 'chart-overlay hidden';
    // display:none 후 크기 재계산
    mainChart.applyOptions({ width: chartEl.clientWidth });
    volumeChart.applyOptions({ width: volumeEl.clientWidth });
}

function showError(msg) {
    overlayEl.className = 'chart-overlay error';
    overlayEl.innerHTML = `⚠️ ${msg}<br><small style="color:#8b949e">잠시 후 다시 시도해주세요.</small>`;
}

// ── 데이터 적용 ───────────────────────────────────────────────────────────
let currentData = [];

async function loadData(range) {
    // 캐시 우선 확인
    const cached = getCached(range);
    if (cached) {
        currentData = cached;
        applyToChart(currentData);
        showChart();
        return;
    }

    showLoading();
    try {
        const json = await fetchYahoo(range);
        currentData = parseYahoo(json);
        setCache(range, currentData);

        if (currentData.length === 0) throw new Error('수신된 봉 데이터가 없습니다');

        applyToChart(currentData);
        showChart();
    } catch (err) {
        console.error(err);
        showError(err.message || '데이터를 불러올 수 없습니다');
    }
}

// ── 차트에 데이터 적용 ────────────────────────────────────────────────────
let volumeByDate = {}; // 날짜 문자열 → volume 빠른 조회용

function applyToChart(data) {
    const candleData = data.map(({ time, open, high, low, close }) =>
        ({ time, open, high, low, close }));
    const volData = data.map(({ time, open, close, volume }) => ({
        time,
        value: volume,
        color: close >= open ? UP_COLOR + '99' : DOWN_COLOR + '99',
    }));

    // 거래량 빠른 조회 맵 재구성
    volumeByDate = Object.fromEntries(data.map(d => [d.time, d.volume]));

    candleSeries.setData(candleData);
    volumeSeries.setData(volData);
    mainChart.timeScale().fitContent();
    volumeChart.timeScale().fitContent();

    updatePriceHeader(data);
    updateOHLCV(data[data.length - 1]);
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

// ── OHLCV 패널 ────────────────────────────────────────────────────────────
function updateOHLCV(bar) {
    if (!bar) return;
    const dateStr = typeof bar.time === 'number'
        ? new Date(bar.time * 1000).toISOString().slice(0, 10)
        : bar.time;
    document.getElementById('info-date').textContent   = dateStr;
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
    // param.time은 Unix timestamp(초) 또는 BusinessDay 객체일 수 있으므로 문자열로 변환
    const timeStr = typeof param.time === 'number'
        ? new Date(param.time * 1000).toISOString().slice(0, 10)
        : `${param.time.year}-${String(param.time.month).padStart(2,'0')}-${String(param.time.day).padStart(2,'0')}`;
    updateOHLCV({ time: timeStr, ...bar, volume: volumeByDate[timeStr] ?? 0 });
});

// ── 기간 버튼 ─────────────────────────────────────────────────────────────
let activePeriod = '3mo';

document.querySelectorAll('.period-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        if (btn.dataset.period === activePeriod) return;
        document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activePeriod = btn.dataset.period;
        loadData(activePeriod);
    });
});

// ── 반응형 리사이즈 ───────────────────────────────────────────────────────
new ResizeObserver(() => {
    mainChart.applyOptions({ width: chartEl.clientWidth });
    volumeChart.applyOptions({ width: volumeEl.clientWidth });
}).observe(chartEl);

// ── 초기 로드 ─────────────────────────────────────────────────────────────
loadData(activePeriod);

// ── 유틸 ──────────────────────────────────────────────────────────────────
function fmt(n) {
    return Number(n).toLocaleString('ko-KR') + '원';
}
