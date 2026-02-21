class ChartAnalysis extends HTMLElement {
  constructor() {
    super();
    this.innerHTML = `<p>차트 분석 내용이 여기에 표시됩니다.</p>`;
  }
}

class CompanyInfo extends HTMLElement {
  constructor() {
    super();
    this.innerHTML = `<p>기업 정보 내용이 여기에 표시됩니다.</p>`;
  }
}

class InvestorAnalysis extends HTMLElement {
  constructor() {
    super();
    this.innerHTML = `<p>투자자 분석 내용이 여기에 표시됩니다.</p>`;
  }
}

customElements.define('chart-analysis', ChartAnalysis);
customElements.define('company-info', CompanyInfo);
customElements.define('investor-analysis', InvestorAnalysis);

document.getElementById('chart-analysis').innerHTML = '<chart-analysis></chart-analysis>';
document.getElementById('company-info').innerHTML = '<company-info></company-info>';
document.getElementById('investor-analysis').innerHTML = '<investor-analysis></investor-analysis>';
