"use strict";

// ============================================================
//  charts.js — Chart.js configuration helpers
//  Requires Chart.js to be loaded before this script.
// ============================================================


// ── Chart Defaults ───────────────────────────────────────────────────────────

if (typeof Chart !== "undefined") {
    Chart.defaults.color              = "#8a96a8";
    Chart.defaults.font.family        = "Inter, sans-serif";
    Chart.defaults.responsive         = true;
    Chart.defaults.maintainAspectRatio = false;
}


// ── Color Palette ────────────────────────────────────────────────────────────

const COLORS = {
    primary: "#00d4ff",
    accent:  "#00ff9d",
    danger:  "#ff4560",
    warning: "#ffbe0b",
    purple:  "#a78bfa",
    muted:   "rgba(255,255,255,0.1)"
};

const GLOW = {
    primary: "rgba(0,212,255,0.2)",
    accent:  "rgba(0,255,157,0.2)",
    danger:  "rgba(255,69,96,0.2)",
    warning: "rgba(255,190,11,0.2)"
};


// ── Common Tooltip Style ─────────────────────────────────────────────────────

/**
 * cyTooltip() — Returns a Chart.js tooltip options object with the
 * project's dark-panel styling.
 */
function cyTooltip() {
    return {
        backgroundColor: "#0d1424",
        borderColor:     "#1e3a5f",
        borderWidth:     1,
        titleColor:      "#e8eff7",
        bodyColor:       "#8a96a8",
        padding:         12,
        cornerRadius:    8
    };
}


// ── Traffic Doughnut ─────────────────────────────────────────────────────────

/**
 * window.createTrafficChart(canvasId, benignCount, ddosCount)
 * Renders a doughnut chart showing Normal vs DDoS traffic split.
 * Returns the Chart instance.
 */
window.createTrafficChart = function (canvasId, benignCount, ddosCount) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return null;

    const total = (benignCount || 0) + (ddosCount || 0);

    // Center-text plugin — draws total record count inside the doughnut hole
    const centerTextPlugin = {
        id: "centerText_" + canvasId,
        afterDraw: function (chart) {
            const { ctx, chartArea } = chart;
            if (!chartArea) return;
            ctx.save();
            const cx = (chartArea.left + chartArea.right)  / 2;
            const cy = (chartArea.top  + chartArea.bottom) / 2;

            ctx.textAlign    = "center";
            ctx.textBaseline = "middle";

            // Total number — large
            ctx.font      = "bold 22px Inter, sans-serif";
            ctx.fillStyle = "#e8eff7";
            ctx.fillText(total.toLocaleString(), cx, cy - 10);

            // Sub-label — small
            ctx.font      = "12px Inter, sans-serif";
            ctx.fillStyle = "#8a96a8";
            ctx.fillText("Total Records", cx, cy + 14);
            ctx.restore();
        }
    };

    return new Chart(canvas, {
        type: "doughnut",
        data: {
            labels: ["Normal Traffic", "DDoS Traffic"],
            datasets: [{
                data:            [benignCount, ddosCount],
                backgroundColor: [COLORS.accent, COLORS.danger],
                borderColor:     [COLORS.accent, COLORS.danger],
                borderWidth:     2,
                hoverOffset:     6
            }]
        },
        options: {
            cutout: "70%",
            plugins: {
                legend: {
                    position: "bottom",
                    labels:   { padding: 20, usePointStyle: true }
                },
                tooltip: cyTooltip(),
                // datalabels plugin (chartjs-plugin-datalabels) — percentage inside segments
                datalabels: {
                    formatter: function (value, context) {
                        var sum = context.dataset.data.reduce(function (a, b) {
                            return (a || 0) + (b || 0);
                        }, 0);
                        if (!sum) return "0%";
                        return (value / sum * 100).toFixed(1) + "%";
                    },
                    color:     "#fff",
                    font:      { weight: "bold", size: 12 }
                }
            }
        },
        plugins: [centerTextPlugin]
    });
};


// ── Model Bar Chart ──────────────────────────────────────────────────────────

/**
 * window.createModelChart(canvasId, modelsArray)
 * modelsArray: [{ name, accuracy, precision, recall, f1_score }, ...]
 * Renders grouped bar chart comparing Accuracy / Precision / Recall / F1.
 * Returns the Chart instance.
 */
window.createModelChart = function (canvasId, modelsArray) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || !Array.isArray(modelsArray) || !modelsArray.length) return null;

    const labels = modelsArray.map(function (m) { return m.name; });

    function metric(key) {
        return modelsArray.map(function (m) {
            return parseFloat((m[key] * 100).toFixed(2));
        });
    }

    return new Chart(canvas, {
        type: "bar",
        data: {
            labels: labels,
            datasets: [
                {
                    label:           "Accuracy",
                    data:            metric("accuracy"),
                    backgroundColor: COLORS.primary,
                    borderColor:     COLORS.primary,
                    borderWidth:     1,
                    borderRadius:    4
                },
                {
                    label:           "Precision",
                    data:            metric("precision"),
                    backgroundColor: COLORS.accent,
                    borderColor:     COLORS.accent,
                    borderWidth:     1,
                    borderRadius:    4
                },
                {
                    label:           "Recall",
                    data:            metric("recall"),
                    backgroundColor: COLORS.warning,
                    borderColor:     COLORS.warning,
                    borderWidth:     1,
                    borderRadius:    4
                },
                {
                    label:           "F1 Score",
                    data:            metric("f1_score"),
                    backgroundColor: COLORS.purple,
                    borderColor:     COLORS.purple,
                    borderWidth:     1,
                    borderRadius:    4
                }
            ]
        },
        options: {
            plugins: {
                legend:  { position: "top" },
                tooltip: cyTooltip()
            },
            scales: {
                y: {
                    min:  0,
                    max:  100,
                    grid: { color: "rgba(255,255,255,0.05)" },
                    ticks: {
                        callback: function (v) { return v + "%"; },
                        color:    "#8a96a8"
                    }
                },
                x: {
                    grid:  { display: false },
                    ticks: { color: "#8a96a8" }
                }
            }
        }
    });
};


// ── Feature Importance ───────────────────────────────────────────────────────

/**
 * window.createFeatureChart(canvasId)
 * Loads the pre-generated feature importance image from the server and
 * draws it onto the canvas.  Falls back to placeholder text on error.
 */
window.createFeatureChart = function (canvasId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    const img = new Image();

    img.onload = function () {
        // Size canvas to image aspect ratio
        canvas.width  = img.naturalWidth  || canvas.offsetWidth  || 600;
        canvas.height = img.naturalHeight || canvas.offsetHeight || 350;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    };

    img.onerror = function () {
        ctx.save();
        ctx.fillStyle    = "#8a96a8";
        ctx.font         = "14px Inter, sans-serif";
        ctx.textAlign    = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(
            "Feature importance chart not available.",
            canvas.offsetWidth  / 2 || 300,
            canvas.offsetHeight / 2 || 175
        );
        ctx.restore();
    };

    img.src = "/chart/feature_importance_rf";
};


// ── Threat Summary Bar ───────────────────────────────────────────────────────

/**
 * window.createThreatChart(canvasId, data)
 * data = { low: n, medium: n, high: n, critical: n }
 * Renders a horizontal bar chart of threat severity distribution.
 * Returns the Chart instance.
 */
window.createThreatChart = function (canvasId, data) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || !data) return null;

    const orange = "#ff7c40"; // orange sits between warning and danger

    return new Chart(canvas, {
        type: "bar",
        data: {
            labels: ["Low", "Medium", "High", "Critical"],
            datasets: [{
                label:           "Threat Count",
                data:            [data.low || 0, data.medium || 0, data.high || 0, data.critical || 0],
                backgroundColor: [COLORS.accent, COLORS.warning, orange, COLORS.danger],
                borderColor:     [COLORS.accent, COLORS.warning, orange, COLORS.danger],
                borderWidth:     1,
                borderRadius:    4
            }]
        },
        options: {
            indexAxis: "y",   // horizontal bars
            plugins: {
                legend:  { display: false },
                tooltip: cyTooltip()
            },
            scales: {
                x: {
                    grid:  { color: "rgba(255,255,255,0.05)" },
                    ticks: { color: "#8a96a8" }
                },
                y: {
                    grid:  { display: false },
                    ticks: { color: "#8a96a8" }
                }
            }
        }
    });
};


// ── Update Confusion Matrix DOM ──────────────────────────────────────────────

/**
 * window.updateConfusionMatrix(cm, metrics)
 * cm      = [[TN, FP], [FN, TP]]
 * metrics = { accuracy, precision, recall, f1_score }  (values 0-1 or 0-100)
 *
 * Updates the confusion matrix cells and metric display elements.
 */
window.updateConfusionMatrix = function (cm, metrics) {
    if (!cm || !cm[0] || !cm[1]) return;

    var TN = cm[0][0], FP = cm[0][1],
        FN = cm[1][0], TP = cm[1][1];

    // Update cell text content (elements may or may not exist on the page)
    function setText(id, val) {
        var el = document.getElementById(id);
        if (el) el.textContent = val.toLocaleString();
    }

    setText("cmTN", TN);
    setText("cmFP", FP);
    setText("cmFN", FN);
    setText("cmTP", TP);

    if (!metrics) return;

    // Metrics may arrive as fractions (0-1) — normalise to percentage string
    function toPercent(v) {
        if (v === undefined || v === null) return "—";
        var num = parseFloat(v);
        if (isNaN(num)) return "—";
        return (num <= 1 ? (num * 100).toFixed(2) : num.toFixed(2)) + "%";
    }

    function setMetric(id, val) {
        var el = document.getElementById(id);
        if (el) el.textContent = toPercent(val);
    }

    setMetric("cmAccuracy",  metrics.accuracy);
    setMetric("cmPrecision", metrics.precision);
    setMetric("cmRecall",    metrics.recall);
    setMetric("cmF1",        metrics.f1_score);
};


// ── Destroy and Recreate ─────────────────────────────────────────────────────

/**
 * window.destroyChart(chartVar)
 * Safely destroys a Chart.js instance if it exists.
 * Pass the variable holding the chart reference.
 * Usage: myChart = window.destroyChart(myChart);
 * Returns null so you can reassign the variable cleanly.
 */
window.destroyChart = function (chartVar) {
    if (chartVar && typeof chartVar.destroy === "function") {
        chartVar.destroy();
    }
    return null;
};


// ── Progress Bar Helper ───────────────────────────────────────────────────────

/**
 * window.setProgress(barId, pct)
 * Sets the width of a progress bar element to pct% with a CSS transition.
 * pct: number 0–100
 */
window.setProgress = function (barId, pct) {
    var bar = document.getElementById(barId);
    if (!bar) return;
    bar.style.transition = "width 0.4s ease";
    bar.style.width      = Math.min(Math.max(pct, 0), 100) + "%";
    bar.setAttribute("aria-valuenow", pct);
};
