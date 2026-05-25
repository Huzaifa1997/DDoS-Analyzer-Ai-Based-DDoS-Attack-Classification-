"use strict";

// ============================================================
//  analysis.js — Analysis page specific JS
//  Drives the step-by-step analysis animation, log terminal,
//  progress bar, and abort/restart controls.
// ============================================================

// ── Step Configuration ───────────────────────────────────────────────────────

const STEPS = ["step1", "step2", "step3", "step4"];

// Terminal log lines displayed while each step is "running"
const LOG_LINES = {
    step1: [
        "[INFO]  Loading dataset from session cache…",
        "[INFO]  Validating CSV schema and column types…",
        "[OK]    Dataset validated — proceeding to preprocessing."
    ],
    step2: [
        "[INFO]  Applying MinMax scaler to feature matrix…",
        "[INFO]  Encoding categorical labels with LabelEncoder…",
        "[OK]    Preprocessing complete — feature matrix ready."
    ],
    step3: [
        "[INFO]  Running Random Forest classifier…",
        "[INFO]  Running Logistic Regression classifier…",
        "[OK]    All models scored — selecting best performer."
    ],
    step4: [
        "[INFO]  Building threat-level distribution…",
        "[INFO]  Generating recommendations and summary report…",
        "[OK]    Results packaged and ready for display."
    ]
};

// Step status labels
const STATUS_LABELS = {
    idle:   "Waiting",
    active: "Running…",
    done:   "Complete",
    error:  "Error"
};

// Global abort flag — set to true by the Stop button
var abortFlag = false;

// Current progress percentage
var currentProgress = 0;


// ── Log Terminal ─────────────────────────────────────────────────────────────

/**
 * appendLog(msg, color)
 * Creates a <p> element in #analysisLog and auto-scrolls to bottom.
 * color defaults to var(--accent) (cyan-green).
 */
function appendLog(msg, color) {
    color = color || "var(--accent, #00ff9d)";

    var log = document.getElementById("analysisLog");
    if (!log) return;

    var p = document.createElement("p");
    p.style.margin = "2px 0";
    p.style.color  = color;
    p.style.font   = "13px 'Courier New', monospace";
    p.textContent  = msg;

    log.appendChild(p);

    // Auto-scroll to the bottom
    log.scrollTop = log.scrollHeight;
}


// ── Step State ───────────────────────────────────────────────────────────────

/**
 * setStepState(id, state)
 * Updates the visual state of a pipeline step card.
 * state: 'idle' | 'active' | 'done' | 'error'
 */
function setStepState(id, state) {
    var el = document.getElementById(id);
    if (!el) return;

    // Remove all state classes
    el.classList.remove("step-idle", "step-active", "step-done", "step-error");
    el.classList.add("step-" + state);

    // Update status text inside the step card (if element exists)
    var statusEl = el.querySelector(".step-status");
    if (statusEl) {
        statusEl.textContent = STATUS_LABELS[state] || state;
    }

    // Update step icon
    var iconEl = el.querySelector(".step-icon");
    if (iconEl) {
        iconEl.classList.remove("fa-circle", "fa-spinner", "fa-check-circle", "fa-times-circle",
                                "spin", "text-success", "text-danger", "text-warning", "text-muted");
        if (state === "idle") {
            iconEl.classList.add("fa-circle", "text-muted");
        } else if (state === "active") {
            iconEl.classList.add("fa-spinner", "fa-spin", "text-warning");
        } else if (state === "done") {
            iconEl.classList.add("fa-check-circle", "text-success");
        } else if (state === "error") {
            iconEl.classList.add("fa-times-circle", "text-danger");
        }
    }
}


// ── Delay Helper ─────────────────────────────────────────────────────────────

function delay(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
}


// ── Progress Bar ─────────────────────────────────────────────────────────────

function setAnalysisProgress(pct) {
    currentProgress = pct;
    if (typeof window.setProgress === "function") {
        window.setProgress("analysisProgressBar", pct);
    } else {
        // Fallback if charts.js / main.js not loaded yet
        var bar = document.getElementById("analysisProgressBar");
        if (bar) {
            bar.style.width    = pct + "%";
            bar.style.transition = "width 0.4s ease";
        }
    }
}


// ── Main Analysis Runner ──────────────────────────────────────────────────────

/**
 * runAnalysis()
 * Drives the 4-step pipeline animation using sessionStorage data.
 * Each step: activate → log → delay → complete → advance progress.
 */
async function runAnalysis() {
    // ── 1. Check for dataset ──────────────────────────────────────────────────
    var raw = sessionStorage.getItem("ddos_last_result");
    if (!raw) {
        if (typeof window.showToast === "function") {
            window.showToast("Please upload a dataset first.", "warning", 4000);
        }
        return;
    }

    // ── 2. Reset state ────────────────────────────────────────────────────────
    abortFlag = false;
    setAnalysisProgress(0);

    var startBtn = document.getElementById("startAnalysisBtn");
    var stopBtn  = document.getElementById("stopBtn");

    if (startBtn) startBtn.disabled = true;
    if (stopBtn)  stopBtn.style.display = "inline-block";

    // Reset all steps to idle
    STEPS.forEach(function (id) { setStepState(id, "idle"); });

    // Clear log
    var logEl = document.getElementById("analysisLog");
    if (logEl) logEl.innerHTML = "";

    appendLog("[SYS]   Analysis pipeline started at " + new Date().toLocaleTimeString(), "#00d4ff");

    // ── 3. Run each step ──────────────────────────────────────────────────────
    for (var i = 0; i < STEPS.length; i++) {
        if (abortFlag) break;

        var stepId = STEPS[i];
        var lines  = LOG_LINES[stepId] || [];

        // Mark step as active
        setStepState(stepId, "active");

        // Append each log line with a small gap
        for (var j = 0; j < lines.length; j++) {
            if (abortFlag) break;
            appendLog(lines[j], j === lines.length - 1 ? "#00ff9d" : "#8a96a8");
            await delay(350);
        }

        if (abortFlag) {
            setStepState(stepId, "error");
            break;
        }

        // Wait a moment before marking done
        await delay(1200 - lines.length * 350); // total ~1200 ms per step

        setStepState(stepId, "done");

        // Advance progress bar by 25% per step
        setAnalysisProgress((i + 1) * 25);
    }

    // ── 4. Handle abort ───────────────────────────────────────────────────────
    if (abortFlag) {
        appendLog("[WARN]  Analysis aborted by user.", "#ffbe0b");
        if (stopBtn)  stopBtn.style.display = "none";
        if (startBtn) startBtn.disabled     = false;
        return;
    }

    // ── 5. Completion ─────────────────────────────────────────────────────────
    appendLog("[SYS]   Pipeline complete. Preparing results…", "#00d4ff");

    // Update status icon and text
    var statusIcon = document.getElementById("statusIcon");
    var statusText = document.getElementById("statusText");

    if (statusIcon) {
        statusIcon.className = "fas fa-check-circle fa-3x text-success";
    }
    if (statusText) {
        statusText.textContent = "Analysis Complete!";
        statusText.style.color = "#00ff9d";
    }

    if (typeof window.showToast === "function") {
        window.showToast("Analysis complete — redirecting to results", "success", 3000);
    }

    if (stopBtn) stopBtn.style.display = "none";

    // Redirect to results after 2 seconds
    await delay(2000);
    window.location.href = "/results";
}


// ── DOMContentLoaded Setup ───────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", function () {

    // ── Populate stat from sessionStorage ─────────────────────────────────────
    var raw = sessionStorage.getItem("ddos_last_result");
    if (raw) {
        try {
            var result     = JSON.parse(raw);
            var recordsEl  = document.getElementById("statRecords");
            if (recordsEl && result.total_records !== undefined) {
                if (typeof window.animateCounter === "function") {
                    window.animateCounter(recordsEl, result.total_records, "", 1200);
                } else {
                    recordsEl.textContent = Number(result.total_records).toLocaleString();
                }
            }
        } catch (_) {}
    }

    // ── Start button ──────────────────────────────────────────────────────────
    var startBtn = document.getElementById("startAnalysisBtn");
    if (startBtn) {
        startBtn.addEventListener("click", function () {
            runAnalysis();
        });
    }

    // ── Stop button ───────────────────────────────────────────────────────────
    var stopBtn = document.getElementById("stopBtn");
    if (stopBtn) {
        stopBtn.style.display = "none"; // hidden by default

        stopBtn.addEventListener("click", function () {
            abortFlag = true;

            // Reset all non-done steps to idle
            STEPS.forEach(function (id) {
                var el = document.getElementById(id);
                if (el && !el.classList.contains("step-done")) {
                    setStepState(id, "idle");
                }
            });

            setAnalysisProgress(0);
            stopBtn.style.display = "none";

            var startBtnInner = document.getElementById("startAnalysisBtn");
            if (startBtnInner) startBtnInner.disabled = false;

            // Reset status indicators
            var statusIcon = document.getElementById("statusIcon");
            var statusText = document.getElementById("statusText");
            if (statusIcon) statusIcon.className = "fas fa-hourglass-half fa-3x text-muted";
            if (statusText) {
                statusText.textContent = "Awaiting analysis…";
                statusText.style.color = "";
            }
        });
    }

    // ── Initial step states ───────────────────────────────────────────────────
    STEPS.forEach(function (id) { setStepState(id, "idle"); });

}); // end DOMContentLoaded
