/* ================================================================
   DDoS Analyzer — Frontend application
   ================================================================ */

const App = {
  state: {
    file: null,
    result: null,
    view: 'upload',
    sidebarCollapsed: false,
    sidebarOpenMobile: false,
    charts: { traffic: null, model: null, protocol: null },
    selectedModel: null,
  },

  $: {},

  init() {
    this.cacheEls();
    this.initTheme();
    this.applyStoredPrefs();
    this.bindEvents();
    this.loadModelMeta();
    this.loadSettings();
    this.switchView('upload');
  },

  // ── DOM caching ───────────────────────────────────────────

  cacheEls() {
    const ids = [
      // sidebar
      'sidebar', 'sidebarToggle', 'mobileMenuBtn', 'sidebarBackdrop',
      'navAnalyze', 'navReport', 'modelPillText',
      // topbar
      'viewTitle', 'viewSubtitle',
      // views
      'viewUpload', 'viewLoading', 'viewDashboard', 'viewGuide', 'viewSettings',
      // upload
      'dropZone', 'fileInput', 'browseBtn', 'fileInfo',
      'fileName', 'fileSize', 'analyzeBtn', 'analyzeBtnLabel', 'clearBtn',
      'emptyTitle', 'emptySubtitle',
      // loading
      'loadingTitle', 'loadingStatus', 'progressFill',
      // summary
      'scSize', 'scSizeSub', 'scNormal', 'scNormalSub',
      'scDdos', 'scDdosSub', 'scAcc', 'scModel',
      'threatBanner', 'threatIcon', 'threatLevel', 'threatText', 'rerunBtn',
      // charts
      'trafficChart', 'trafficSubtitle', 'legendRow', 'protocolChart',
      // confusion matrix
      'cmSelect', 'cmTN', 'cmFP', 'cmFN', 'cmTP',
      // perf cards + chart
      'trainingMetricsBanner', 'perfSelect', 'mcAcc', 'mcPrec', 'mcRec', 'modelChart',
      // recs
      'recsList', 'recsSource', 'recsNote',
      // export
      'exportCsvBtn',
      // settings
      'apiKeyInput', 'saveKeyBtn', 'clearKeyBtn', 'keyStatus',
      // pcap tool
      'pcapToolZone', 'pcapToolInput', 'pcapToolBtn',
      'pcapToolText', 'pcapToolProgress', 'pcapToolStatus',
      // toast
      'toastContainer',
    ];
    ids.forEach(id => { this.$[id] = document.getElementById(id); });
    this.$.navItems = document.querySelectorAll('.nav-item[data-view]');
    this.$.themeOptions = document.querySelectorAll('.theme-option');
  },

  // ── Theme ─────────────────────────────────────────────────

  initTheme() {
    const stored = localStorage.getItem('theme');
    let theme = stored;
    if (!theme) {
      theme = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)
        ? 'dark' : 'light';
    }
    this.applyTheme(theme, /*persist*/ Boolean(stored));
  },

  applyTheme(theme, persist = true) {
    document.body.classList.toggle('dark', theme === 'dark');
    this.state.theme = theme;
    if (persist) localStorage.setItem('theme', theme);
    if (this.$.themeOptions) {
      this.$.themeOptions.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.theme === theme);
      });
    }
    // Re-render Chart.js so colors pick up new CSS vars
    if (this.state.result) {
      this.renderTrafficChart(this.state.result);
      this.renderModelChart(this.state.result);
      this.renderProtocolChart(this.state.result);
    }
  },

  // ── Preferences ───────────────────────────────────────────

  applyStoredPrefs() {
    const collapsed = localStorage.getItem('sidebar_collapsed') === '1';
    if (collapsed && window.innerWidth > 1024) {
      document.body.classList.add('sidebar-collapsed');
      this.state.sidebarCollapsed = true;
    }
  },

  // ── Events ────────────────────────────────────────────────

  bindEvents() {
    const $ = this.$;

    // Sidebar toggle (desktop collapses, mobile closes)
    $.sidebarToggle.addEventListener('click', () => this.toggleSidebar());
    $.mobileMenuBtn.addEventListener('click', () => this.openMobileSidebar());
    $.sidebarBackdrop.addEventListener('click', () => this.closeMobileSidebar());

    // Nav switches
    $.navItems.forEach(item =>
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const v = item.dataset.view;
        if (v) this.switchView(v);
        if (window.innerWidth <= 1024) this.closeMobileSidebar();
      })
    );

    $.navAnalyze.addEventListener('click', () => {
      if ($.navAnalyze.disabled) return;
      this.runAnalysis();
    });
    $.navReport.addEventListener('click', () => {
      if ($.navReport.disabled) return;
      window.location.href = '/export/pdf';
    });

    // Upload zone
    $.browseBtn.addEventListener('click', () => $.fileInput.click());
    $.dropZone.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      $.fileInput.click();
    });
    $.fileInput.addEventListener('change', (e) => {
      const f = e.target.files[0];
      if (f) this.handleFile(f);
    });
    ['dragenter', 'dragover'].forEach(ev =>
      $.dropZone.addEventListener(ev, (e) => {
        e.preventDefault();
        $.dropZone.classList.add('dragover');
      })
    );
    ['dragleave', 'drop'].forEach(ev =>
      $.dropZone.addEventListener(ev, (e) => {
        e.preventDefault();
        $.dropZone.classList.remove('dragover');
      })
    );
    $.dropZone.addEventListener('drop', (e) => {
      const f = e.dataTransfer.files[0];
      if (f) this.handleFile(f);
    });

    $.clearBtn.addEventListener('click', () => this.clearFile());
    $.analyzeBtn.addEventListener('click', () => this.runAnalysis());

    // "Open the Dataset Guide" helper link on the upload page
    const datasetGuideLink = document.getElementById('datasetGuideLink');
    if (datasetGuideLink) {
      datasetGuideLink.addEventListener('click', (e) => {
        e.preventDefault();
        this.switchView('guide');
      });
    }

    // Results actions
    $.rerunBtn.addEventListener('click', () => this.reset());
    $.cmSelect.addEventListener('change', (e) => this.renderConfusionMatrix(e.target.value));
    $.perfSelect.addEventListener('change', (e) => this.renderPerfCards(e.target.value));
    $.exportCsvBtn.addEventListener('click', () => this.exportCSV());

    // Settings
    $.saveKeyBtn.addEventListener('click', () => this.saveKey());
    $.clearKeyBtn.addEventListener('click', () => this.clearKey());
    $.themeOptions.forEach(btn =>
      btn.addEventListener('click', () => this.applyTheme(btn.dataset.theme))
    );

    // PCAP standalone tool
    $.pcapToolZone.addEventListener('click', () => $.pcapToolInput.click());
    $.pcapToolInput.addEventListener('change', (e) => {
      const f = e.target.files[0];
      if (f) this.pcapToolPick(f);
    });
    ['dragenter','dragover'].forEach(ev =>
      $.pcapToolZone.addEventListener(ev, (e) => {
        e.preventDefault();
        $.pcapToolZone.classList.add('dragover');
      })
    );
    ['dragleave','drop'].forEach(ev =>
      $.pcapToolZone.addEventListener(ev, (e) => {
        e.preventDefault();
        $.pcapToolZone.classList.remove('dragover');
      })
    );
    $.pcapToolZone.addEventListener('drop', (e) => {
      const f = e.dataTransfer.files[0];
      if (f) this.pcapToolPick(f);
    });
    $.pcapToolBtn.addEventListener('click', () => this.pcapToolConvert());

    window.addEventListener('resize', () => this.handleResize());
  },

  // ── Sidebar ───────────────────────────────────────────────

  toggleSidebar() {
    this.state.sidebarCollapsed = !this.state.sidebarCollapsed;
    document.body.classList.toggle('sidebar-collapsed', this.state.sidebarCollapsed);
    localStorage.setItem('sidebar_collapsed', this.state.sidebarCollapsed ? '1' : '0');
  },

  openMobileSidebar() {
    document.body.classList.add('sidebar-open');
    this.state.sidebarOpenMobile = true;
  },

  closeMobileSidebar() {
    document.body.classList.remove('sidebar-open');
    this.state.sidebarOpenMobile = false;
  },

  handleResize() {
    if (window.innerWidth > 1024 && this.state.sidebarOpenMobile) {
      this.closeMobileSidebar();
    }
  },

  // ── View switching ────────────────────────────────────────

  switchView(view) {
    const titles = {
      upload:    ['Upload Dataset',    'Upload a CSV in CIC-DDoS2019 format to begin'],
      dashboard: ['Dashboard',         'Analysis overview and threat assessment'],
      guide:     ['Dataset Guide',     'CIC-DDoS2019 format and feature reference'],
      settings:  ['Settings',          'Theme, API keys, and preferences'],
      loading:   ['Analyzing…',        'Please wait while the models run'],
    };

    // If dashboard requested without a result, route to upload
    if (view === 'dashboard' && !this.state.result) {
      view = 'upload';
    }

    this.state.view = view;
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const el = this.$[`view${view.charAt(0).toUpperCase() + view.slice(1)}`];
    if (el) el.classList.add('active');

    // Highlight nav
    this.$.navItems.forEach(item => {
      item.classList.toggle('active', item.dataset.view === view);
    });

    const [t, s] = titles[view] || ['', ''];
    this.$.viewTitle.textContent = t;
    this.$.viewSubtitle.textContent = s;
  },

  // ── File handling ─────────────────────────────────────────

  handleFile(file) {
    const isCSV  = /\.csv$/i.test(file.name);
    const isPCAP = /\.(pcap|pcapng|cap)$/i.test(file.name);
    if (!isCSV && !isPCAP) {
      this.toast('Supported formats: CSV, PCAP, PCAPNG.', 'error');
      return;
    }
    if (file.size > 500 * 1024 * 1024) {
      this.toast('File exceeds 500 MB limit.', 'error');
      return;
    }
    this.state.file = file;
    this.state.isPcap = isPCAP;
    this.$.fileName.textContent = file.name;
    this.$.fileSize.textContent = this.fmtBytes(file.size)
      + (isPCAP ? ' · PCAP capture' : ' · CSV dataset');
    this.$.fileInfo.hidden = false;
    this.$.navAnalyze.disabled = false;
    this.$.analyzeBtnLabel.textContent = isPCAP ? 'Convert PCAP & Analyze' : 'Analyze Dataset';
    this.$.emptyTitle.textContent = isPCAP ? 'PCAP Ready' : 'Dataset Ready';
    this.$.emptySubtitle.textContent = isPCAP
      ? 'Click below to convert the capture and run the ML models'
      : 'Click "Analyze Dataset" to run the ML models';
    this.toast(`Ready: ${file.name}`, 'success');
  },

  clearFile() {
    this.state.file = null;
    this.state.isPcap = false;
    this.$.fileInput.value = '';
    this.$.fileInfo.hidden = true;
    this.$.navAnalyze.disabled = true;
    this.$.analyzeBtnLabel.textContent = 'Analyze Dataset';
    this.$.emptyTitle.textContent = 'No Dataset Loaded';
    this.$.emptySubtitle.textContent = 'Upload a CSV or PCAP file to begin analysis';
  },

  // ── Analysis ──────────────────────────────────────────────

  async runAnalysis() {
    if (!this.state.file) {
      this.switchView('upload');
      this.toast('Please choose a CSV file first.', 'warn');
      return;
    }

    this.switchView('loading');
    this.$.viewTitle.textContent = this.state.isPcap ? 'Converting & Analyzing…' : 'Analyzing…';
    this.$.viewSubtitle.textContent = this.state.isPcap
      ? 'Extracting flows from PCAP, then running Random Forest and Logistic Regression'
      : 'Running Random Forest and Logistic Regression';

    const steps = this.state.isPcap
      ? [
          { pct: 10, label: 'Reading PCAP capture…' },
          { pct: 30, label: 'Extracting flows via CICFlowMeter…' },
          { pct: 50, label: 'Renaming columns to CIC-DDoS2019 schema…' },
          { pct: 70, label: 'Running Random Forest…' },
          { pct: 85, label: 'Running Logistic Regression…' },
          { pct: 95, label: 'Computing metrics…' },
        ]
      : [
          { pct: 15, label: 'Reading CSV…' },
          { pct: 35, label: 'Preprocessing features…' },
          { pct: 55, label: 'Running Random Forest…' },
          { pct: 75, label: 'Running Logistic Regression…' },
          { pct: 90, label: 'Computing metrics…' },
        ];
    let i = 0;
    const tick = setInterval(() => {
      if (i < steps.length) {
        this.$.progressFill.style.width = steps[i].pct + '%';
        this.$.loadingStatus.textContent = steps[i].label;
        i++;
      }
    }, this.state.isPcap ? 900 : 600);

    try {
      const form = new FormData();
      form.append('file', this.state.file);
      const res = await fetch('/analyze', { method: 'POST', body: form });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Analysis failed.');

      this.$.progressFill.style.width = '100%';
      this.$.loadingStatus.textContent = 'Rendering results…';

      this.state.result = data;
      await new Promise(r => setTimeout(r, 250));
      this.renderResults(data);
      this.switchView('dashboard');
      this.$.navReport.disabled = false;
      this.toast('Analysis complete', 'success');

      // Kick off LLM recommendations in the background
      this.fetchLLMRecs(data);
    } catch (err) {
      this.toast(err.message || 'Analysis failed.', 'error');
      this.switchView('upload');
    } finally {
      clearInterval(tick);
      this.$.progressFill.style.width = '0%';
    }
  },

  // ── Rendering ─────────────────────────────────────────────

  renderResults(d) {
    this.renderSummaryCards(d);
    this.renderThreatBanner(d);
    this.renderTrafficChart(d);
    this.renderModelSelectors(d);
    this.renderConfusionMatrix(this.state.selectedModel);
    this.renderProtocolChart(d);
    this.renderPerfCards(this.state.selectedModel);
    this.renderModelChart(d);
    this.renderTrafficIntel(d);
    this.renderReviewFlows(d);
    this.renderRecs(d.recommendations || [], 'static');
  },

  // Borderline flows folded into Normal — surfaced for manual review (IP / port).
  renderReviewFlows(d) {
    const section = document.getElementById('reviewSection');
    if (!section) return;
    const flows = d.review_flows || [];
    if (!flows.length) { section.style.display = 'none'; return; }
    section.style.display = '';
    const tbody = document.getElementById('reviewTbody');
    if (!tbody) return;
    tbody.innerHTML = flows.map(f => {
      const svc = (f.service && f.service !== 'Unknown' && f.service !== '—')
        ? ' · ' + this.escape(f.service) : '';
      return `
        <tr>
          <td>${this.escape(String(f.src_ip ?? '—'))}</td>
          <td>${this.escape(String(f.dst_ip ?? '—'))}</td>
          <td>${this.escape(f.dst_port == null ? '—' : String(f.dst_port))}${svc}</td>
          <td>${this.escape(String(f.protocol ?? '—'))}</td>
          <td>${f.confidence != null ? f.confidence + '%' : '—'}</td>
          <td>${this.escape(String(f.counted_as ?? '—'))}</td>
        </tr>`;
    }).join('');
  },

  // Unlabeled mode: fill the right slot (where the confusion matrix sits in
  // labeled mode) with a "DDoS Flows by Protocol" bar chart.
  renderProtocolChart(d) {
    const card = document.getElementById('protocolChartSection');
    if (!card) return;
    const pd = d.traffic_intel && d.traffic_intel.protocol_dist;
    const show = !d.has_ground_truth && pd
      && ((pd.TCP || 0) + (pd.UDP || 0) + (pd.Other || 0) > 0);

    this.destroyChart('protocol');
    if (!show) { card.style.display = 'none'; return; }
    card.style.display = '';

    const cs = getComputedStyle(document.body);
    const textCol = (cs.getPropertyValue('--text-dim').trim() || '#64748b');
    const gridCol = (cs.getPropertyValue('--border').trim() || '#e5e7eb');

    this.state.charts.protocol = new Chart(this.$.protocolChart, {
      type: 'bar',
      data: {
        labels: ['TCP', 'UDP', 'Other'],
        datasets: [{
          label: 'DDoS flows',
          data: [pd.TCP || 0, pd.UDP || 0, pd.Other || 0],
          backgroundColor: ['#3b82f6', '#f59e0b', '#94a3b8'],
          borderRadius: 6,
          maxBarThickness: 38,
        }],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#0f172a', borderColor: '#1e293b', borderWidth: 1, padding: 10,
            callbacks: { label: (ctx) => ` ${ctx.parsed.x.toLocaleString()} flows` },
          },
        },
        scales: {
          x: { beginAtZero: true, grid: { color: gridCol },
               ticks: { color: textCol, precision: 0 } },
          y: { grid: { display: false }, ticks: { color: textCol, font: { weight: '600' } } },
        },
      },
    });
  },

  renderModelChart(d) {
    const cs = getComputedStyle(document.body);
    const textCol   = (cs.getPropertyValue('--text-dim').trim() || '#64748b');
    const gridCol   = (cs.getPropertyValue('--border').trim() || '#e5e7eb');

    this.destroyChart('model');

    const hasGroundTruth = d.has_ground_truth === true;
    document.getElementById('trainingMetricsBanner').style.display = hasGroundTruth ? 'none' : 'block';

    const rawModels = (d.models || []);
    const models = rawModels.map(m => ({
      ...m,
      displayName: m.metrics_source === 'training' ? m.name + ' (Training)' : m.name
    }));

    if (!models.length) return;

    const colorPairs = [
      { border: '#3b82f6', fill: 'rgba(59, 130, 246, 0.18)', fillBar: 'rgba(59, 130, 246, 0.85)' },
      { border: '#8b5cf6', fill: 'rgba(139, 92, 246, 0.18)', fillBar: 'rgba(139, 92, 246, 0.85)' },
    ];

    this.state.charts.model = new Chart(this.$.modelChart, {
      type: 'bar',
      data: {
        labels: ['Accuracy', 'Precision', 'Recall', 'F1'],
        datasets: models.map((m, idx) => {
          const c = colorPairs[idx % colorPairs.length];
          return {
            label: m.displayName,
            data: [m.accuracy ?? 0, m.precision ?? 0, m.recall ?? 0, m.f1_score ?? 0],
            backgroundColor: c.fillBar,
            borderColor: c.border,
            borderWidth: 1,
            borderRadius: 5,
            maxBarThickness: 42,
          };
        }),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: {
            beginAtZero: true,
            suggestedMax: 100,
            grid: { color: gridCol },
            ticks: { color: textCol, stepSize: 25, callback: (v) => v + '%' },
          },
          x: {
            grid: { display: false },
            ticks: { color: textCol, font: { size: 11, weight: '600' } },
          },
        },
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              padding: 10,
              usePointStyle: true,
              pointStyle: 'rectRounded',
              font: { size: 12 },
              boxWidth: 10,
            },
          },
          tooltip: {
            backgroundColor: '#0f172a',
            borderColor: '#1e293b',
            borderWidth: 1,
            padding: 10,
            callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${ctx.parsed.y}%` },
          },
        },
      },
    });
  },

  renderSummaryCards(d) {
    this.$.scSize.textContent      = `${this.fmtNum(d.total_records)} records`;
    this.$.scSizeSub.textContent   = `${d.file_size_mb ?? '—'} MB · ${d.filename || 'dataset'}`;
    this.$.scNormal.textContent    = `${d.benign_percent ?? 0}%`;
    this.$.scNormalSub.textContent = `${this.fmtNum(d.benign_count)} records`;
    this.$.scDdos.textContent      = `${d.ddos_percent ?? 0}%`;
    this.$.scDdosSub.textContent   = `${this.fmtNum(d.ddos_count)} records`;
    if (d.has_ground_truth && d.best_accuracy != null) {
      this.$.scAcc.textContent   = `${d.best_accuracy}%`;
      this.$.scModel.textContent = d.best_model || '—';
    } else {
      this.$.scAcc.textContent   = 'N/A';
      this.$.scModel.textContent = 'No labels in file';
    }

    // Flows-to-Review card (borderline flows folded into Normal)
    const rev = document.getElementById('scReview');
    if (rev) {
      if ((d.review_count || 0) > 0) {
        rev.style.display = '';
        const v = document.getElementById('scReviewVal');
        if (v) v.textContent = this.fmtNum(d.review_count);
      } else {
        rev.style.display = 'none';
      }
    }
  },

  renderThreatBanner(d) {
    const pct = d.ddos_percent || 0;

    // Caution: nothing confirmed as DDoS, but borderline flows need review.
    if ((d.ddos_count || 0) === 0 && (d.review_count || 0) > 0) {
      this.$.threatLevel.textContent = 'Caution — Review Flagged Flows';
      this.$.threatText.textContent  =
        `No confirmed DDoS. ${d.review_count} borderline flow(s) were counted as Normal — ` +
        `check the "Flows to Review" panel and verify their source / port.`;
      this.$.threatIcon.className = 'threat-icon t-medium';
      this.$.threatIcon.innerHTML = '<i class="fa-solid fa-circle-question"></i>';
      return;
    }

    let level, klass, icon, msg;
    if (pct >= 50) {
      level = 'Critical Threat'; klass = 't-critical'; icon = 'fa-skull-crossbones';
      msg = `${pct}% of analysed flows are DDoS — immediate mitigation required.`;
    } else if (pct >= 20) {
      level = 'High Threat'; klass = 't-high'; icon = 'fa-fire';
      msg = `${pct}% DDoS traffic detected — elevated risk level.`;
    } else if (pct >= 5) {
      level = 'Medium Threat'; klass = 't-medium'; icon = 'fa-triangle-exclamation';
      msg = `${pct}% DDoS traffic — monitor closely and apply rate-limiting.`;
    } else {
      level = 'Low Threat'; klass = 't-safe'; icon = 'fa-shield-halved';
      msg = `Only ${pct}% DDoS traffic — network appears mostly healthy.`;
    }
    this.$.threatLevel.textContent = level;
    this.$.threatText.textContent  = d.summary || msg;
    this.$.threatIcon.className    = `threat-icon ${klass}`;
    this.$.threatIcon.innerHTML    = `<i class="fa-solid ${icon}"></i>`;
  },

  // ── Charts ────────────────────────────────────────────────

  renderTrafficChart(d) {
    const cs = getComputedStyle(document.body);
    const surfaceCol = (cs.getPropertyValue('--surface').trim() || '#ffffff');
    const textCol    = (cs.getPropertyValue('--text-dim').trim() || '#64748b');
    const borderCol  = (cs.getPropertyValue('--border').trim() || '#e5e7eb');

    Chart.defaults.color = textCol;
    Chart.defaults.font.family = "Inter, system-ui, sans-serif";
    Chart.defaults.borderColor = borderCol;

    this.destroyChart('traffic');
    this.$.trafficSubtitle.textContent = `${this.fmtNum(d.total_records)} flows analysed`;

    const colors = ['#10b981', '#ef4444'];
    this.state.charts.traffic = new Chart(this.$.trafficChart, {
      type: 'doughnut',
      data: {
        labels: ['Normal', 'DDoS'],
        datasets: [{
          data: [d.benign_count || 0, d.ddos_count || 0],
          backgroundColor: colors,
          borderColor: surfaceCol,
          borderWidth: 3,
          hoverOffset: 10,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '68%',
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#0f172a',
            borderColor: '#1e293b',
            borderWidth: 1,
            padding: 12,
            titleFont: { weight: '600' },
            callbacks: {
              label: (ctx) => {
                const total = ctx.dataset.data.reduce((a, b) => a + b, 0) || 1;
                const pct = ((ctx.parsed / total) * 100).toFixed(2);
                return ` ${ctx.label}: ${ctx.parsed.toLocaleString()} (${pct}%)`;
              },
            },
          },
        },
      },
    });

    // Custom legend below chart
    this.$.legendRow.innerHTML = [
      { label: 'Normal', value: d.benign_count, pct: d.benign_percent, color: colors[0] },
      { label: 'DDoS',   value: d.ddos_count,   pct: d.ddos_percent,   color: colors[1] },
    ].map(x => `
      <div class="legend-item">
        <span class="legend-dot" style="background:${x.color}"></span>
        <span>${x.label}</span>
        <span class="legend-value">${this.fmtNum(x.value)} · ${x.pct ?? 0}%</span>
      </div>
    `).join('');
  },

  destroyChart(key) {
    if (this.state.charts[key]) {
      this.state.charts[key].destroy();
      this.state.charts[key] = null;
    }
  },

  // ── Model selectors (CM + Perf) ───────────────────────────

  renderModelSelectors(d) {
    const hasGroundTruth = d.has_ground_truth === true;
    const rawModels = (d.models || []);
    const models = rawModels.map(m => ({
      ...m,
      displayName: m.metrics_source === 'training' ? m.name + ' (Training)' : m.name
    }));
    const opts = models.map(m => `<option value="${this.escape(m.name)}">${this.escape(m.displayName)}</option>`).join('');
    this.$.cmSelect.innerHTML   = opts;
    this.$.perfSelect.innerHTML = opts;
    const best = d.best_model || (models?.[0]?.name);
    this.$.cmSelect.value   = best;
    this.$.perfSelect.value = best;
    this.state.selectedModel = best;
  },

  renderConfusionMatrix(modelName) {
    const hasGT = this.state.result?.has_ground_truth;
    const cmSection = document.getElementById('cmSection');
    if (!hasGT) {
      if (cmSection) cmSection.style.display = 'none';
      return;
    }
    if (cmSection) cmSection.style.display = '';

    const m = (this.state.result?.models || []).find(x => x.name === modelName);
    if (!m) return;
    const cm = m.confusion_matrix || [[0, 0], [0, 0]];
    const [tn, fp] = cm[0] || [0, 0];
    const [fn, tp] = cm[1] || [0, 0];
    this.$.cmTN.textContent = this.fmtNum(tn);
    this.$.cmFP.textContent = this.fmtNum(fp);
    this.$.cmFN.textContent = this.fmtNum(fn);
    this.$.cmTP.textContent = this.fmtNum(tp);
  },

  renderPerfCards(modelName) {
    const hasGT = this.state.result?.has_ground_truth;
    const perfSection = document.getElementById('perfSection');
    if (!hasGT) {
      if (perfSection) perfSection.style.display = 'none';
      return;
    }
    if (perfSection) perfSection.style.display = '';

    const m = (this.state.result?.models || []).find(x => x.name === modelName);
    if (!m) return;
    this.$.mcAcc.textContent  = `${m.accuracy}%`;
    this.$.mcPrec.textContent = `${m.precision}%`;
    this.$.mcRec.textContent  = `${m.recall}%`;
  },

  renderTrafficIntel(d) {
    const intel = d.traffic_intel;
    const section = document.getElementById('trafficIntelSection');
    if (!section) return;
    if (!intel) { section.style.display = 'none'; return; }

    section.style.display = '';

    // Protocol breakdown — TCP vs UDP among predicted DDoS flows
    if (intel.protocol_dist) {
      const pd = intel.protocol_dist;
      const total = (pd.TCP || 0) + (pd.UDP || 0) + (pd.Other || 0) || 1;
      document.getElementById('tiTCP').textContent =
        `${pd.TCP || 0} (${((pd.TCP || 0) / total * 100).toFixed(1)}%)`;
      document.getElementById('tiUDP').textContent =
        `${pd.UDP || 0} (${((pd.UDP || 0) / total * 100).toFixed(1)}%)`;
    } else {
      document.getElementById('tiTCP').textContent = '—';
      document.getElementById('tiUDP').textContent = '—';
    }

    // Top destination ports table
    const tbody = document.getElementById('tiPortsTbody');
    if (intel.top_dst_ports && intel.top_dst_ports.length) {
      tbody.innerHTML = intel.top_dst_ports.map(p => `
        <tr>
          <td>${this.escape(String(p.port))}</td>
          <td>${this.fmtNum(p.count)}</td>
        </tr>
      `).join('');
    } else {
      tbody.innerHTML = `<tr><td colspan="2" class="muted">Destination Port column not available</td></tr>`;
    }

    // Flow stats comparison
    if (intel.flow_duration_avg) {
      document.getElementById('tiDurDdos').textContent =
        (intel.flow_duration_avg.ddos != null
          ? this.fmtNum(Math.round(intel.flow_duration_avg.ddos)) + ' µs' : '—');
      document.getElementById('tiDurBenign').textContent =
        (intel.flow_duration_avg.benign != null
          ? this.fmtNum(Math.round(intel.flow_duration_avg.benign)) + ' µs' : '—');
    } else {
      document.getElementById('tiDurDdos').textContent = '—';
      document.getElementById('tiDurBenign').textContent = '—';
    }
    if (intel.packets_per_sec_avg) {
      document.getElementById('tiPpsDdos').textContent =
        (intel.packets_per_sec_avg.ddos != null
          ? this.fmtNum(Math.round(intel.packets_per_sec_avg.ddos)) : '—');
      document.getElementById('tiPpsBenign').textContent =
        (intel.packets_per_sec_avg.benign != null
          ? this.fmtNum(Math.round(intel.packets_per_sec_avg.benign)) : '—');
    } else {
      document.getElementById('tiPpsDdos').textContent = '—';
      document.getElementById('tiPpsBenign').textContent = '—';
    }
  },

  // ── Recommendations ───────────────────────────────────────

  renderRecs(recs, source) {
    if (!recs.length) {
      this.$.recsList.innerHTML = `<p class="muted">No recommendations.</p>`;
    } else {
      this.$.recsList.innerHTML = recs.map(r => `
        <div class="rec-item t-${this.escape(r.type || 'info')}">
          <div class="rec-icon"><i class="fa-solid ${this.escape(r.icon || 'fa-circle-info')}"></i></div>
          <div class="rec-body">
            <h4>${this.escape(r.title || '')}</h4>
            <p>${this.escape(r.text || '')}</p>
            ${r.command ? `<pre class="rec-cmd"><code>${this.escape(r.command)}</code></pre>` : ''}
          </div>
        </div>
      `).join('');
    }

    const pill = this.$.recsSource;
    if (source === 'groq') {
      pill.innerHTML = '<i class="fa-solid fa-wand-sparkles"></i> AI-Based · Dataset-Aware';
    } else if (source === 'static') {
      pill.innerHTML = '<i class="fa-solid fa-rectangle-list"></i> Rule-based';
    } else {
      pill.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Generating…';
    }
  },

  async fetchLLMRecs(d) {
    try {
      const res = await fetch('/api/recommendations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(d),
      });
      const out = await res.json();
      this.renderRecs(out.recommendations || [], out.source || 'static');

      const note = out.note || out.warning;
      if (note) {
        this.$.recsNote.textContent = note;
        this.$.recsNote.hidden = false;
        this.$.recsNote.className = 'caption';
      } else {
        this.$.recsNote.hidden = true;
      }
    } catch (err) {
      this.renderRecs(d.recommendations || [], 'static');
    }
  },

  // ── Settings: API key ─────────────────────────────────────

  async loadSettings() {
    try {
      const res = await fetch('/api/settings');
      const cfg = await res.json();
      this.updateKeyStatus(cfg.has_key, cfg.from_env);
    } catch {}
  },

  updateKeyStatus(hasKey, fromEnv) {
    // Hide the "set up a key" help message once a key is configured
    const help = document.getElementById('keySetupHelp');
    if (help) help.style.display = hasKey ? 'none' : '';
    if (hasKey) {
      this.$.keyStatus.innerHTML = `<i class="fa-solid fa-circle-check" style="color:var(--success)"></i> ${fromEnv ? 'Loaded from env' : 'Configured'}`;
      this.$.keyStatus.style.background = 'var(--success-soft)';
      this.$.keyStatus.style.color = 'var(--success)';
      this.$.keyStatus.style.borderColor = 'rgba(16, 185, 129, 0.25)';
    } else {
      this.$.keyStatus.innerHTML = `<i class="fa-solid fa-circle-xmark"></i> Not configured`;
      this.$.keyStatus.style.background = '';
      this.$.keyStatus.style.color = '';
      this.$.keyStatus.style.borderColor = '';
    }
  },

  async saveKey() {
    const key = this.$.apiKeyInput.value.trim();
    if (!key) { this.toast('Paste an API key first.', 'warn'); return; }
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groq_api_key: key }),
      });
      const out = await res.json();
      this.updateKeyStatus(out.has_key, false);
      this.$.apiKeyInput.value = '';
      this.toast('API key saved', 'success');
      // Re-fetch recommendations with the new key
      if (this.state.result) this.fetchLLMRecs(this.state.result);
    } catch (err) {
      this.toast('Failed to save key.', 'error');
    }
  },

  async clearKey() {
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groq_api_key: '' }),
      });
      const out = await res.json();
      this.updateKeyStatus(out.has_key, false);
      this.toast('API key cleared', 'info');
    } catch {
      this.toast('Failed to clear key.', 'error');
    }
  },

  // ── Models meta ───────────────────────────────────────────

  async loadModelMeta() {
    try {
      const res = await fetch('/models/meta');
      if (!res.ok) throw new Error('not ready');
      const meta = await res.json();
      const count = (meta.results || []).length || 2;
      this.$.modelPillText.textContent = `${count} models loaded`;
    } catch {
      this.$.modelPillText.textContent = 'Models unavailable';
    }
  },

  // ── Export CSV ────────────────────────────────────────────

  exportCSV() {
    const d = this.state.result;
    if (!d) { this.toast('Run an analysis first.', 'warn'); return; }

    const lines = [
      ['Metric', 'Value'],
      ['Filename', d.filename || ''],
      ['File Size (MB)', d.file_size_mb || ''],
      ['Total Records', d.total_records],
      ['DDoS Count', d.ddos_count],
      ['Benign Count', d.benign_count],
      ['DDoS %', d.ddos_percent],
      ['Benign %', d.benign_percent],
      ['Best Model', d.best_model],
      ['Best Accuracy %', d.best_accuracy],
      [],
      ['Model', 'Accuracy', 'Precision', 'Recall', 'F1'],
      ...(d.models || []).map(m => [m.name, m.accuracy, m.precision, m.recall, m.f1_score]),
    ];
    const csv = lines.map(r => r.map(v =>
      `"${(v ?? '').toString().replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'ddos_analysis.csv';
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    this.toast('CSV downloaded', 'success');
  },

  // ── PCAP → CSV standalone tool ────────────────────────────

  pcapToolPick(file) {
    if (!/\.(pcap|pcapng|cap)$/i.test(file.name)) {
      this.toast('Pick a .pcap or .pcapng file.', 'error');
      return;
    }
    if (file.size > 500 * 1024 * 1024) {
      this.toast('File exceeds 500 MB limit.', 'error');
      return;
    }
    this.state.pcapToolFile = file;
    this.$.pcapToolText.textContent = `${file.name} · ${this.fmtBytes(file.size)}`;
    this.$.pcapToolBtn.disabled = false;
  },

  async pcapToolConvert() {
    const file = this.state.pcapToolFile;
    if (!file) return;

    this.$.pcapToolBtn.disabled = true;
    this.$.pcapToolProgress.hidden = false;
    this.$.pcapToolStatus.textContent = 'Extracting flows…';

    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/convert/pcap-to-csv', { method: 'POST', body: form });

      if (!res.ok) {
        let msg = 'Conversion failed.';
        try {
          const j = await res.json();
          msg = j.error || msg;
        } catch {}
        throw new Error(msg);
      }

      const blob = await res.blob();
      const cd = res.headers.get('Content-Disposition') || '';
      const match = cd.match(/filename="?([^"]+)"?/);
      const dlName = match ? match[1]
        : file.name.replace(/\.(pcap|pcapng|cap)$/i, '') + '_flows.csv';

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = dlName;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);

      this.$.pcapToolStatus.textContent = `Downloaded ${dlName}`;
      this.toast('CSV downloaded', 'success');
    } catch (err) {
      this.$.pcapToolStatus.textContent = err.message || 'Conversion failed.';
      this.toast(err.message || 'Conversion failed.', 'error');
    } finally {
      this.$.pcapToolBtn.disabled = false;
      setTimeout(() => { this.$.pcapToolProgress.hidden = true; }, 2500);
    }
  },

  // ── Reset ─────────────────────────────────────────────────

  reset() {
    this.state.result = null;
    this.clearFile();
    this.destroyChart('traffic');
    this.destroyChart('model');
    this.destroyChart('protocol');
    this.$.navReport.disabled = true;
    this.switchView('upload');
  },

  // ── Utils ─────────────────────────────────────────────────

  fmtNum(n) {
    if (n == null || isNaN(n)) return '—';
    return Number(n).toLocaleString();
  },

  fmtBytes(b) {
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
    if (b < 1024 * 1024 * 1024) return (b / 1024 / 1024).toFixed(2) + ' MB';
    return (b / 1024 / 1024 / 1024).toFixed(2) + ' GB';
  },

  escape(s) {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  },

  toast(message, type = 'info') {
    const icons = {
      success: 'fa-circle-check',
      error:   'fa-circle-xmark',
      warn:    'fa-triangle-exclamation',
      info:    'fa-circle-info',
    };
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.innerHTML = `<i class="fa-solid ${icons[type] || icons.info}"></i><span>${this.escape(message)}</span>`;
    this.$.toastContainer.appendChild(el);
    setTimeout(() => {
      el.classList.add('fade-out');
      setTimeout(() => el.remove(), 250);
    }, 3500);
  },
};

document.addEventListener('DOMContentLoaded', () => App.init());
