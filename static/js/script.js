/* ── DDoS Analyzer — Frontend Script ───────────────────────────────────────
   Talks to the Flask backend via /analyze, /export/json, /export/pdf, /chart/
   ─────────────────────────────────────────────────────────────────────────── */

"use strict";

// ── state ───────────────────────────────────────────────────────────────────
let selectedFile   = null;
let analysisResult = null;
let trafficChart   = null;
let modelChart     = null;
let featureChart   = null;

// ── clock ────────────────────────────────────────────────────────────────────
function updateClock() {
  const el = document.getElementById("currentTime");
  if (el) el.textContent = new Date().toLocaleTimeString();
}
setInterval(updateClock, 1000);
updateClock();

// ── toast ────────────────────────────────────────────────────────────────────
function showToast(msg, type = "info") {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.className = `toast show ${type}`;
  setTimeout(() => { t.className = "toast"; }, 3500);
}

// ── file selection ───────────────────────────────────────────────────────────
function attachFileInput(inputId) {
  const el = document.getElementById(inputId);
  if (!el) return;
  el.addEventListener("change", e => {
    const file = e.target.files[0];
    if (file) handleFileSelected(file);
  });
}

function handleFileSelected(file) {
  if (!file.name.toLowerCase().endsWith(".csv")) {
    showToast("Only CSV files are supported.", "error");
    return;
  }
  selectedFile = file;
  const sizeMb = (file.size / 1024 / 1024).toFixed(2);

  // update sidebar upload area
  const area = document.getElementById("fileUploadArea");
  if (area) {
    area.innerHTML = `
      <i class="fas fa-check-circle" style="color:var(--success);font-size:2em;"></i>
      <p style="font-weight:600;">${file.name}</p>
      <p class="file-format">${sizeMb} MB — ready to analyze</p>
      <input type="file" id="fileInput" accept=".csv" style="display:none">`;
    attachFileInput("fileInput");
  }

  document.getElementById("analyzeBtn").disabled = false;
  showToast(`File selected: ${file.name} (${sizeMb} MB)`, "success");
}

// drag-and-drop
function setupDragDrop(zoneId, inputId) {
  const zone = document.getElementById(zoneId);
  if (!zone) return;
  zone.addEventListener("dragover",  e => { e.preventDefault(); zone.classList.add("drag-over"); });
  zone.addEventListener("dragleave", ()  => zone.classList.remove("drag-over"));
  zone.addEventListener("drop", e => {
    e.preventDefault();
    zone.classList.remove("drag-over");
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelected(file);
  });
  zone.addEventListener("click", () => document.getElementById(inputId)?.click());
}

// ── analyze ──────────────────────────────────────────────────────────────────
async function analyzeDataset() {
  if (!selectedFile) { showToast("Please select a CSV file first.", "error"); return; }

  setLoading(true, "Uploading and preprocessing dataset…");
  document.getElementById("analyzeBtn").disabled = true;

  const formData = new FormData();
  formData.append("file", selectedFile);

  try {
    const resp = await fetch("/analyze", { method: "POST", body: formData });
    const data = await resp.json();

    if (!data.success) {
      showToast("Error: " + data.error, "error");
      setLoading(false);
      document.getElementById("analyzeBtn").disabled = false;
      return;
    }

    analysisResult = data;
    renderDashboard(data);
    document.getElementById("generateReportBtn").disabled = false;
    showToast("Analysis complete!", "success");

  } catch (err) {
    showToast("Network error: " + err.message, "error");
    document.getElementById("analyzeBtn").disabled = false;
  } finally {
    setLoading(false);
  }
}

function setLoading(on, msg = "") {
  const overlay = document.getElementById("loadingOverlay");
  const initial = document.getElementById("initialState");
  if (!overlay) return;
  if (on) {
    overlay.style.display = "flex";
    document.getElementById("loadingMsg").textContent = msg;
    if (initial) initial.style.display = "none";
  } else {
    overlay.style.display = "none";
  }
}

// ── render dashboard ─────────────────────────────────────────────────────────
function renderDashboard(d) {
  // show content, hide initial state
  document.getElementById("initialState").style.display    = "none";
  document.getElementById("dashboardContent").style.display = "block";

  // stat cards
  setEl("datasetSize",   d.file_size_mb + " MB");
  setEl("recordCount",   d.total_records.toLocaleString() + " records");
  setEl("normalPercent", d.benign_percent + "%");
  setEl("normalRecords", d.benign_count.toLocaleString() + " records");
  setEl("ddosPercent",   d.ddos_percent + "%");
  setEl("ddosRecords",   d.ddos_count.toLocaleString() + " records");
  setEl("bestModelAccuracy", d.best_accuracy + "%");
  setEl("bestModelName",     d.best_model);

  // legend values
  setEl("normalTrafficValue", d.benign_percent + "%");
  setEl("ddosTrafficValue",   d.ddos_percent + "%");

  // system status
  setEl("statusLabel", "Analysis Complete");
  setEl("statusDesc",  d.total_records.toLocaleString() + " records processed");

  // charts
  renderTrafficChart(d);
  renderModelChart(d);
  renderFeatureChart(d);

  // confusion matrix — populate model selector
  populateMatrixSelector(d);

  // summary
  setEl("analysisSummaryText", d.summary);

  // recommendations
  renderRecommendations(d.recommendations);
}

function setEl(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

// ── charts ───────────────────────────────────────────────────────────────────
function renderTrafficChart(d) {
  const ctx = document.getElementById("trafficChart")?.getContext("2d");
  if (!ctx) return;
  if (trafficChart) trafficChart.destroy();

  trafficChart = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: ["Normal Traffic", "DDoS Traffic"],
      datasets: [{
        data: [d.benign_count, d.ddos_count],
        backgroundColor: ["#10b981", "#ef4444"],
        borderWidth: 2,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "bottom" },
        datalabels: {
          formatter: (val, ctx) => {
            const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
            return (val / total * 100).toFixed(1) + "%";
          },
          color: "#fff",
          font: { weight: "bold", size: 13 }
        }
      }
    },
    plugins: [ChartDataLabels]
  });
}

function renderModelChart(d) {
  const ctx = document.getElementById("modelChart")?.getContext("2d");
  if (!ctx) return;
  if (modelChart) modelChart.destroy();

  const labels   = d.models.map(m => m.name);
  const accuracy  = d.models.map(m => m.accuracy);
  const precision = d.models.map(m => m.precision);
  const recall    = d.models.map(m => m.recall);
  const f1        = d.models.map(m => m.f1_score);

  modelChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        { label: "Accuracy",  data: accuracy,  backgroundColor: "#3b82f6" },
        { label: "Precision", data: precision, backgroundColor: "#10b981" },
        { label: "Recall",    data: recall,    backgroundColor: "#f59e0b" },
        { label: "F1-Score",  data: f1,        backgroundColor: "#8b5cf6" },
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: "top" }, datalabels: { display: false } },
      scales: {
        y: { min: 0, max: 100, ticks: { callback: v => v + "%" } }
      }
    }
  });
}

function renderFeatureChart(d) {
  // Load feature importance image from backend
  const ctx = document.getElementById("featureChart")?.getContext("2d");
  if (!ctx) return;

  const img = new Image();
  img.onload = () => {
    if (featureChart) featureChart.destroy();
    // Draw image on canvas
    const canvas = ctx.canvas;
    canvas.width  = img.width;
    canvas.height = img.height;
    ctx.drawImage(img, 0, 0);
  };
  img.src = "/chart/feature_importance_rf?" + Date.now();
}

// ── confusion matrix ─────────────────────────────────────────────────────────
function populateMatrixSelector(d) {
  const sel = document.getElementById("matrixModelSelect");
  if (!sel) return;
  sel.innerHTML = "";
  d.models.forEach(m => {
    const opt = document.createElement("option");
    opt.value = m.name;
    opt.textContent = m.name;
    sel.appendChild(opt);
  });
  sel.addEventListener("change", () => updateMatrix(d));
  updateMatrix(d);   // default: first model
}

function updateMatrix(d) {
  const sel  = document.getElementById("matrixModelSelect");
  const name = sel ? sel.value : d.best_model;
  const m    = d.models.find(x => x.name === name) || d.models[0];
  const cm   = m.confusion_matrix;
  const tn   = cm[0][0], fp = cm[0][1];
  const fn_  = cm[1][0], tp = cm[1][1];

  setEl("trueNegative",  tn.toLocaleString());
  setEl("falsePositive", fp.toLocaleString());
  setEl("falseNegative", fn_.toLocaleString());
  setEl("truePositive",  tp.toLocaleString());

  setEl("accuracyMetric",  m.accuracy  + "%");
  setEl("precisionMetric", m.precision + "%");
  setEl("recallMetric",    m.recall    + "%");
  setEl("f1Metric",        m.f1_score  + "%");
}

// ── recommendations ──────────────────────────────────────────────────────────
function renderRecommendations(recs) {
  const grid = document.getElementById("recommendationsGrid");
  if (!grid) return;
  grid.innerHTML = "";
  recs.forEach(r => {
    const card = document.createElement("div");
    card.className = `recommendation-card ${r.type}`;
    card.innerHTML = `
      <div class="rec-icon"><i class="fas ${r.icon}"></i></div>
      <div class="rec-content">
        <h5>${r.title}</h5>
        <p>${r.text}</p>
      </div>`;
    grid.appendChild(card);
  });
}

// ── export ───────────────────────────────────────────────────────────────────
function exportJSON() {
  window.location.href = "/export/json";
}

function exportPDF() {
  showToast("Generating PDF report…", "info");
  window.location.href = "/export/pdf";
}

function exportChart(chartId) {
  let canvas;
  if (chartId === "traffic") canvas = document.getElementById("trafficChart");
  else if (chartId === "model") canvas = document.getElementById("modelChart");
  else if (chartId === "features") canvas = document.getElementById("featureChart");
  if (!canvas) return;

  const link = document.createElement("a");
  link.download = `${chartId}_chart.png`;
  link.href     = canvas.toDataURL("image/png");
  link.click();
  showToast("Chart downloaded.", "success");
}

// ── sidebar nav ──────────────────────────────────────────────────────────────
function setupNav() {
  const dashBtn = document.getElementById("dashboardBtn");
  const settBtn = document.getElementById("settingsBtn");
  const settPanel = document.getElementById("settingsPanel");
  const uploadSection = document.getElementById("uploadSection");

  dashBtn?.addEventListener("click", () => {
    dashBtn.classList.add("active");
    settBtn.classList.remove("active");
    uploadSection.style.display = "";
    settPanel.style.display = "none";
  });

  settBtn?.addEventListener("click", () => {
    settBtn.classList.add("active");
    dashBtn.classList.remove("active");
    uploadSection.style.display = "none";
    settPanel.style.display = "";
  });
}

// ── theme ────────────────────────────────────────────────────────────────────
function applyTheme(theme) {
  document.body.className = theme === "light" ? "" : `theme-${theme}`;
  localStorage.setItem("ddos-theme", theme);
  document.querySelectorAll(".theme-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.theme === theme);
  });
}

function setupTheme() {
  const saved = localStorage.getItem("ddos-theme") || "light";
  applyTheme(saved);
  document.querySelectorAll(".theme-btn").forEach(btn => {
    btn.addEventListener("click", () => applyTheme(btn.dataset.theme));
  });
}

// ── guide tooltip ────────────────────────────────────────────────────────────
function setupGuide() {
  const btn     = document.getElementById("guideBtn");
  const tooltip = document.getElementById("guideTooltip");
  if (!btn || !tooltip) return;
  btn.addEventListener("click", e => {
    e.stopPropagation();
    tooltip.style.display = tooltip.style.display === "block" ? "none" : "block";
  });
  document.addEventListener("click", () => { tooltip.style.display = "none"; });
}

// ── reset ────────────────────────────────────────────────────────────────────
function resetDashboard() {
  selectedFile   = null;
  analysisResult = null;

  document.getElementById("initialState").style.display    = "";
  document.getElementById("dashboardContent").style.display = "none";
  document.getElementById("analyzeBtn").disabled = true;
  document.getElementById("generateReportBtn").disabled = true;
  setEl("statusLabel", "Ready for Analysis");
  setEl("statusDesc",  "No dataset loaded");

  if (trafficChart) { trafficChart.destroy(); trafficChart = null; }
  if (modelChart)   { modelChart.destroy();   modelChart   = null; }

  const area = document.getElementById("fileUploadArea");
  if (area) {
    area.innerHTML = `
      <i class="fas fa-file-csv"></i>
      <p>Click to upload CSV file</p>
      <p class="file-format">CICFlowMeter CSV format</p>
      <input type="file" id="fileInput" accept=".csv">`;
    attachFileInput("fileInput");
  }
  showToast("Dashboard reset.", "info");
}

// ── init ─────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  setupNav();
  setupTheme();
  setupGuide();

  attachFileInput("fileInput");
  attachFileInput("mainFileInput");
  setupDragDrop("uploadZone", "mainFileInput");

  // file upload area click
  document.getElementById("fileUploadArea")?.addEventListener("click", () => {
    document.getElementById("fileInput")?.click();
  });

  // buttons
  document.getElementById("analyzeBtn")?.addEventListener("click", analyzeDataset);
  document.getElementById("generateReportBtn")?.addEventListener("click", exportPDF);
  document.getElementById("exportResultsBtn")?.addEventListener("click", exportJSON);
  document.getElementById("exportPdfBtn")?.addEventListener("click", exportPDF);
  document.getElementById("resetBtn")?.addEventListener("click", resetDashboard);

  // chart download buttons
  document.querySelectorAll(".export-chart").forEach(btn => {
    btn.addEventListener("click", () => exportChart(btn.dataset.chart));
  });
});
