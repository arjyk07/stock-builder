// ── 샘플 데이터 (대한광통신 일별 OHLCV) ──────────────────────────────────
// 실제 서비스에서는 증권 API로 교체하세요.
const ALL_DATA = generateSampleData();

function generateSampleData() {
    const data = [];
    // 2025-01-02 부터 2026-02-20 까지 영업일 기준 시뮬레이션
    let price = 3800;
    const startDate = new Date('2025-01-02');
    const endDate   = new Date('2026-02-20');

    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
        const dayOfWeek = d.getDay();
        if (dayOfWeek === 0 || dayOfWeek === 6) continue; // 주말 제외

        const change  = (Math.random() - 0.48) * 120;
        const open    = Math.round(price);
        const close   = Math.round(price + change);
        const high    = Math.round(Math.max(open, close) + Math.random() * 80);
        const low     = Math.round(Math.min(open, close) - Math.random() * 80);
        const volume  = Math.round(50000 + Math.random() * 500000);

        data.push({
            time:   d.toISOString().slice(0, 10),
            open:   Math.max(open, 100),
            high:   Math.max(high, 100),
            low:    Math.max(low,  100),
            close:  Math.max(close, 100),
            volume,
        });

        price = close;
    }
    return data;
}

// ── 기간 필터 ─────────────────────────────────────────────────────────────
function filterData(period) {
    const last = new Date(ALL_DATA[ALL_DATA.length - 1].time);
    const from = new Date(last);

    if (period === '3m') from.setMonth(from.getMonth() - 3);
    else if (period === '6m') from.setMonth(from.getMonth() - 6);
    else if (period === '1y') from.setFullYear(from.getFullYear() - 1);
    else return ALL_DATA; // 전체

    const fromStr = from.toISOString().slice(0, 10);
    return ALL_DATA.filter(d => d.time >= fromStr);
}

// ── 차트 생성 ─────────────────────────────────────────────────────────────
const CHART_BG    = '#161b22';
const GRID_COLOR  = '#21262d';
const TEXT_COLOR  = '#8b949e';
const UP_COLOR    = '#ff4b4b'; // 한국 관례: 상승=빨강
const DOWN_COLOR  = '#4b8fff'; // 한국 관례: 하락=파랑

const chartEl  = document.getElementById('chart-container');
const volumeEl = document.getElementById('volume-container');

const commonOptions = {
    layout: {
        background: { color: CHART_BG },
        textColor:  TEXT_COLOR,
    },
    grid: {
        vertLines:  { color: GRID_COLOR },
        horzLines:  { color: GRID_COLOR },
    },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
    rightPriceScale: { borderColor: GRID_COLOR },
    timeScale: {
        borderColor:     GRID_COLOR,
        timeVisible:     true,
        secondsVisible:  false,
        tickMarkFormatter: (time) => {
            const d = new Date(time * 1000);
            return `${d.getMonth() + 1}/${d.getDate()}`;
        },
    },
    handleScroll:   true,
    handleScale:    true,
};

// 메인 캔들 차트
const mainChart = LightweightCharts.createChart(chartEl, {
    ...commonOptions,
    width:  chartEl.clientWidth,
    height: 380,
});

const candleSeries = mainChart.addCandlestickSeries({
    upColor:        UP_COLOR,
    downColor:      DOWN_COLOR,
    borderUpColor:  UP_COLOR,
    borderDownColor: DOWN_COLOR,
    wickUpColor:    UP_COLOR,
    wickDownColor:  DOWN_COLOR,
});

// 거래량 차트 (별도 컨테이너)
const volumeChart = LightweightCharts.createChart(volumeEl, {
    ...commonOptions,
    width:  volumeEl.clientWidth,
    height: 100,
    rightPriceScale: {
        borderColor: GRID_COLOR,
        scaleMargins: { top: 0.1, bottom: 0 },
    },
    timeScale: {
        ...commonOptions.timeScale,
        visible: false, // 시간 축은 메인 차트에만 표시
    },
});

const volumeSeries = volumeChart.addHistogramSeries({
    priceFormat:     { type: 'volume' },
    priceScaleId:    'volume',
    scaleMargins:    { top: 0.1, bottom: 0 },
});

// ── 데이터 적용 ───────────────────────────────────────────────────────────
function applyData(period) {
    const filtered = filterData(period);
    const candleData = filtered.map(({ time, open, high, low, close }) => ({ time, open, high, low, close }));
    const volData    = filtered.map(({ time, open, close, volume }) => ({
        time,
        value: volume,
        color: close >= open ? UP_COLOR + '99' : DOWN_COLOR + '99',
    }));

    candleSeries.setData(candleData);
    volumeSeries.setData(volData);

    mainChart.timeScale().fitContent();
    volumeChart.timeScale().fitContent();

    // 마지막 봉 정보 업데이트
    updateOHLCV(filtered[filtered.length - 1]);
    updatePriceHeader(filtered);
}

// ── 헤더 가격 표시 ────────────────────────────────────────────────────────
function updatePriceHeader(data) {
    const last = data[data.length - 1];
    const prev = data[data.length - 2];

    const priceEl  = document.getElementById('current-price');
    const changeEl = document.getElementById('price-change');

    priceEl.textContent = formatPrice(last.close);

    if (prev) {
        const diff    = last.close - prev.close;
        const pct     = ((diff / prev.close) * 100).toFixed(2);
        const sign    = diff >= 0 ? '+' : '';
        const cls     = diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat';
        changeEl.textContent  = `${sign}${formatPrice(diff)} (${sign}${pct}%)`;
        changeEl.className    = `price-change ${cls}`;
    }
}

// ── 시황 요약 패널 ────────────────────────────────────────────────────────
function updateOHLCV(bar) {
    if (!bar) return;
    document.getElementById('info-date').textContent   = bar.time;
    document.getElementById('info-open').textContent   = formatPrice(bar.open);
    document.getElementById('info-high').textContent   = formatPrice(bar.high);
    document.getElementById('info-low').textContent    = formatPrice(bar.low);
    document.getElementById('info-close').textContent  = formatPrice(bar.close);
    document.getElementById('info-volume').textContent = bar.volume.toLocaleString('ko-KR') + '주';
}

// 크로스헤어 이동 시 OHLCV 실시간 갱신
mainChart.subscribeCrosshairMove((param) => {
    if (!param || !param.time) return;
    const bar = param.seriesData.get(candleSeries);
    if (bar) updateOHLCV({ time: param.time, ...bar });
});

// ── 기간 버튼 이벤트 ──────────────────────────────────────────────────────
let activePeriod = '3m';

document.querySelectorAll('.period-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activePeriod = btn.dataset.period;
        applyData(activePeriod);
    });
});

// ── 반응형 리사이즈 ───────────────────────────────────────────────────────
const resizeObserver = new ResizeObserver(() => {
    mainChart.applyOptions({  width: chartEl.clientWidth });
    volumeChart.applyOptions({ width: volumeEl.clientWidth });
});
resizeObserver.observe(chartEl);
resizeObserver.observe(volumeEl);

// ── 초기 렌더 ─────────────────────────────────────────────────────────────
applyData(activePeriod);

// ── 유틸 ──────────────────────────────────────────────────────────────────
function formatPrice(n) {
    return Number(n).toLocaleString('ko-KR') + '원';
}
