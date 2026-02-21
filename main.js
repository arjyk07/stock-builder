// ── 설정 ─────────────────────────────────────────────────────────────────
const TICKER   = '010170.KS'; // 대한광통신 Yahoo Finance 티커
const INTERVAL = '1d';

// Yahoo Finance v8 차트 API
const YAHOO_URL = (range) =>
    `https://query1.finance.yahoo.com/v8/finance/chart/${TICKER}?interval=${INTERVAL}&range=${range}`;

// CORS 프록시 (직접 호출 실패 시 자동 전환)
const PROXY_URL = (url) =>
    `https://corsproxy.io/?${encodeURIComponent(url)}`;

// ── Yahoo Finance 호출 ────────────────────────────────────────────────────
async function fetchYahoo(range) {
    const direct = YAHOO_URL(range);

    // 1차: 직접 호출
    try {
        const res = await fetch(direct, { signal: AbortSignal.timeout(6000) });
        if (res.ok) {
            const json = await res.json();
            if (json?.chart?.result) return json;
        }
    } catch (_) { /* CORS or timeout → proxy로 재시도 */ }

    // 2차: CORS 프록시
    const res = await fetch(PROXY_URL(direct), { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (!json?.chart?.result) throw new Error('데이터 형식 오류');
    return json;
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

// ── UI 상태 관리 ──────────────────────────────────────────────────────────
const loadingEl = document.getElementById('chart-loading');
const errorEl   = document.getElementById('chart-error');

function showLoading() {
    loadingEl.style.display = 'flex';
    errorEl.style.display   = 'none';
    chartEl.style.display   = 'none';
    volumeEl.style.display  = 'none';
}

function showChart() {
    loadingEl.style.display = 'none';
    errorEl.style.display   = 'none';
    chartEl.style.display   = 'block';
    volumeEl.style.display  = 'block';
}

function showError(msg) {
    loadingEl.style.display = 'none';
    errorEl.style.display   = 'flex';
    chartEl.style.display   = 'none';
    volumeEl.style.display  = 'none';
    errorEl.innerHTML = `⚠️ ${msg}<br><small style="color:#8b949e">잠시 후 다시 시도해주세요.</small>`;
}

// ── 데이터 적용 ───────────────────────────────────────────────────────────
let currentData = [];

async function loadData(range) {
    showLoading();
    try {
        const json = await fetchYahoo(range);
        currentData = parseYahoo(json);

        if (currentData.length === 0) throw new Error('수신된 봉 데이터가 없습니다');

        const candleData = currentData.map(({ time, open, high, low, close }) =>
            ({ time, open, high, low, close }));
        const volData = currentData.map(({ time, open, close, volume }) => ({
            time,
            value: volume,
            color: close >= open ? UP_COLOR + '99' : DOWN_COLOR + '99',
        }));

        candleSeries.setData(candleData);
        volumeSeries.setData(volData);
        mainChart.timeScale().fitContent();
        volumeChart.timeScale().fitContent();

        updatePriceHeader(currentData);
        updateOHLCV(currentData[currentData.length - 1]);
        showChart();
    } catch (err) {
        console.error(err);
        showError(err.message || '데이터를 불러올 수 없습니다');
    }
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
    if (bar) updateOHLCV({ time: param.time, ...bar,
        volume: currentData.find(d => d.time === param.time)?.volume });
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
