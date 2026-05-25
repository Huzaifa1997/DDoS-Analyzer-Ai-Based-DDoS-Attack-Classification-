"use strict";

// ============================================================
//  upload.js — Upload page specific JS
//  Handles drag-and-drop, file validation, CSV preview,
//  upload progress simulation, and form reset.
// ============================================================

document.addEventListener("DOMContentLoaded", function () {

    // ── Element References ────────────────────────────────────────────────────

    var dropzone    = document.getElementById("dropzone");
    var fileInput   = document.getElementById("fileInput");
    var uploadBtn   = document.getElementById("uploadBtn");
    var clearBtn    = document.getElementById("clearBtn");
    var fileDetails = document.getElementById("fileDetails");
    var dataPreview = document.getElementById("dataPreview");

    // Validation badge IDs
    var BADGE_EXT  = "badgeExt";
    var BADGE_SIZE = "badgeSize";
    var BADGE_COLS = "badgeCols";

    // Currently selected File object
    var selectedFile = null;

    // ── Badge Helper ──────────────────────────────────────────────────────────

    /**
     * updateBadge(id, status, text)
     * status: 'pass' | 'fail' | 'pending'
     * Maps status to Bootstrap badge class and updates element text.
     */
    function updateBadge(id, status, text) {
        var el = document.getElementById(id);
        if (!el) return;

        // Remove all status classes
        el.classList.remove("badge-success", "badge-danger", "badge-warning",
                            "bg-success",    "bg-danger",    "bg-warning",
                            "text-dark");

        if (status === "pass") {
            el.classList.add("badge-success", "bg-success");
        } else if (status === "fail") {
            el.classList.add("badge-danger", "bg-danger");
        } else {
            // pending / unknown
            el.classList.add("badge-warning", "bg-warning", "text-dark");
        }

        el.textContent = text || status;
    }

    // ── Drag-and-Drop Events ──────────────────────────────────────────────────

    if (dropzone) {
        // Prevent browser defaults for drag events
        ["dragenter", "dragover", "dragleave", "drop"].forEach(function (evt) {
            dropzone.addEventListener(evt, function (e) {
                e.preventDefault();
                e.stopPropagation();
            });
        });

        // Highlight on drag-over
        dropzone.addEventListener("dragover", function () {
            dropzone.classList.add("drag-over");
        });

        dropzone.addEventListener("dragenter", function () {
            dropzone.classList.add("drag-over");
        });

        // Remove highlight on leave
        dropzone.addEventListener("dragleave", function () {
            dropzone.classList.remove("drag-over");
        });

        // Handle dropped file
        dropzone.addEventListener("drop", function (e) {
            dropzone.classList.remove("drag-over");
            var files = e.dataTransfer && e.dataTransfer.files;
            if (files && files.length > 0) {
                handleFile(files[0]);
            }
        });

        // Click on dropzone triggers file input
        dropzone.addEventListener("click", function () {
            if (fileInput) fileInput.click();
        });
    }

    // ── File Input Change ────────────────────────────────────────────────────

    if (fileInput) {
        fileInput.addEventListener("change", function () {
            if (fileInput.files && fileInput.files.length > 0) {
                handleFile(fileInput.files[0]);
            }
        });
    }

    // ── handleFile ───────────────────────────────────────────────────────────

    /**
     * handleFile(file)
     * Validates the file (extension + size), updates validation badges,
     * shows the file detail card, and triggers CSV column preview.
     */
    function handleFile(file) {
        if (!file) return;
        selectedFile = file;

        // ── Extension check ───────────────────────────────────────────────
        var ext    = file.name.split(".").pop().toLowerCase();
        var extOk  = ext === "csv";
        updateBadge(BADGE_EXT,  extOk  ? "pass" : "fail",
                    extOk  ? "Pass (.csv)" : "Fail (not .csv)");

        // ── Size check (< 500 MB) ─────────────────────────────────────────
        var MAX_BYTES = 500 * 1024 * 1024;
        var sizeOk    = file.size <= MAX_BYTES;
        var sizeMB    = (file.size / (1024 * 1024)).toFixed(2);
        updateBadge(BADGE_SIZE, sizeOk  ? "pass" : "fail",
                    sizeOk  ? "Pass (" + sizeMB + " MB)" : "Fail (" + sizeMB + " MB > 500 MB)");

        // Reset columns badge to pending until preview completes
        updateBadge(BADGE_COLS, "pending", "Pending");

        // ── File card display ─────────────────────────────────────────────
        if (fileDetails) {
            var nameEl = document.getElementById("fileName");
            var sizeEl = document.getElementById("fileSize");
            if (nameEl) nameEl.textContent = file.name;
            if (sizeEl) sizeEl.textContent = sizeMB + " MB";
            fileDetails.style.display = "block";
        }

        // ── Enable / disable buttons ──────────────────────────────────────
        if (uploadBtn) uploadBtn.disabled = !(extOk && sizeOk);
        if (clearBtn)  clearBtn.disabled  = false;

        // ── CSV column preview ────────────────────────────────────────────
        if (extOk) {
            previewCSV(file);
        } else {
            // Hide preview table if extension is wrong
            if (dataPreview) dataPreview.innerHTML =
                '<p class="text-warning mt-2">Preview unavailable — file must be .csv</p>';
        }
    }

    // ── previewCSV ───────────────────────────────────────────────────────────

    /**
     * previewCSV(file)
     * Reads the first 2 KB of the file, parses the header row,
     * and renders column names in #dataPreview as a table.
     */
    function previewCSV(file) {
        if (!dataPreview) return;

        var reader = new FileReader();

        // Read only the first 2 KB for speed
        var blob = file.slice(0, 2048);

        reader.onload = function (e) {
            var text = e.target.result || "";

            // Find the first newline to isolate the header row
            var newlineIdx = text.indexOf("\n");
            var headerLine = newlineIdx >= 0 ? text.substring(0, newlineIdx) : text;

            // Strip carriage return if present
            headerLine = headerLine.replace(/\r/g, "");

            // Split on comma (basic CSV — handles quoted fields partially)
            var columns = headerLine.split(",").map(function (c) {
                return c.trim().replace(/^"|"$/g, "");
            }).filter(function (c) { return c.length > 0; });

            if (!columns.length) {
                updateBadge(BADGE_COLS, "fail", "Fail (no columns)");
                dataPreview.innerHTML = '<p class="text-danger mt-2">Could not parse CSV headers.</p>';
                return;
            }

            updateBadge(BADGE_COLS, "pass", "Pass (" + columns.length + " columns)");

            // Build preview table
            var html =
                '<div class="table-responsive mt-3">' +
                '<table class="table table-sm table-dark table-bordered">' +
                '<thead><tr><th>#</th><th>Column Name</th></tr></thead>' +
                '<tbody>';

            columns.forEach(function (col, i) {
                html += "<tr><td>" + (i + 1) + "</td><td>" + escapeHtml(col) + "</td></tr>";
            });

            html += "</tbody></table></div>";
            dataPreview.innerHTML = html;
        };

        reader.onerror = function () {
            updateBadge(BADGE_COLS, "fail", "Fail (read error)");
            dataPreview.innerHTML = '<p class="text-danger mt-2">Could not read the file.</p>';
        };

        reader.readAsText(blob);
    }

    // ── Upload Button ────────────────────────────────────────────────────────

    if (uploadBtn) {
        uploadBtn.addEventListener("click", function () {
            if (!selectedFile) return;

            var progressWrap = document.getElementById("progressWrap");
            var progressBar  = document.getElementById("progressBar");
            var alertBox     = document.getElementById("uploadAlert");

            // Hide any previous alerts
            if (alertBox) alertBox.innerHTML = "";

            // Show progress bar
            if (progressWrap) progressWrap.style.display = "block";

            // Disable buttons during upload
            uploadBtn.disabled = true;
            if (clearBtn) clearBtn.disabled = true;

            // ── Simulated progress 0 → 90% ────────────────────────────────
            var fakeProgress = 0;
            var fakeInterval = setInterval(function () {
                fakeProgress += Math.random() * 8 + 2; // 2–10% per tick
                if (fakeProgress >= 90) {
                    fakeProgress = 90;
                    clearInterval(fakeInterval);
                }
                if (progressBar) window.setProgress("progressBar", fakeProgress);
            }, 300);

            // ── FormData POST to /analyze ─────────────────────────────────
            var formData = new FormData();
            formData.append("file", selectedFile);

            fetch("/analyze", {
                method: "POST",
                body:   formData
            })
            .then(function (response) {
                return response.json().then(function (data) {
                    return { status: response.status, data: data };
                });
            })
            .then(function (result) {
                clearInterval(fakeInterval);

                if (result.status === 200 && result.data.success) {
                    // Jump progress to 100%
                    if (progressBar) window.setProgress("progressBar", 100);

                    // Store result in sessionStorage for other pages
                    try {
                        sessionStorage.setItem("ddos_last_result", JSON.stringify(result.data));
                    } catch (_) {}

                    if (typeof window.showToast === "function") {
                        window.showToast("Upload successful! Redirecting…", "success", 2000);
                    }

                    // Redirect to results after a short delay
                    setTimeout(function () {
                        window.location.href = "/results";
                    }, 1800);

                } else {
                    clearInterval(fakeInterval);
                    if (progressBar) window.setProgress("progressBar", 0);
                    if (progressWrap) progressWrap.style.display = "none";

                    var errMsg = (result.data && result.data.error) || "Analysis failed. Please try again.";
                    if (alertBox) {
                        alertBox.innerHTML =
                            '<div class="cy-alert cy-alert-danger" role="alert">' + escapeHtml(errMsg) + '</div>';
                    }

                    uploadBtn.disabled = false;
                    if (clearBtn) clearBtn.disabled = false;
                }
            })
            .catch(function (err) {
                clearInterval(fakeInterval);
                if (progressBar) window.setProgress("progressBar", 0);
                if (progressWrap) progressWrap.style.display = "none";

                var errMsg = "Network error: " + (err.message || "Could not reach server.");
                if (alertBox) {
                    alertBox.innerHTML =
                        '<div class="cy-alert cy-alert-danger" role="alert">' + escapeHtml(errMsg) + '</div>';
                }

                uploadBtn.disabled = false;
                if (clearBtn) clearBtn.disabled = false;
            });
        });
    }

    // ── Clear Button ─────────────────────────────────────────────────────────

    if (clearBtn) {
        clearBtn.addEventListener("click", function () {
            resetAll();
        });
    }

    // ── resetAll ─────────────────────────────────────────────────────────────

    function resetAll() {
        selectedFile = null;

        // Reset file input
        if (fileInput) fileInput.value = "";

        // Hide file details card
        if (fileDetails) fileDetails.style.display = "none";

        // Reset badges to pending
        updateBadge(BADGE_EXT,  "pending", "Pending");
        updateBadge(BADGE_SIZE, "pending", "Pending");
        updateBadge(BADGE_COLS, "pending", "Pending");

        // Clear preview table
        if (dataPreview) dataPreview.innerHTML = "";

        // Hide and reset progress bar
        var progressWrap = document.getElementById("progressWrap");
        var progressBar  = document.getElementById("progressBar");
        if (progressWrap) progressWrap.style.display = "none";
        if (progressBar)  window.setProgress("progressBar", 0);

        // Clear alerts
        var alertBox = document.getElementById("uploadAlert");
        if (alertBox) alertBox.innerHTML = "";

        // Disable buttons
        if (uploadBtn) uploadBtn.disabled = true;
        if (clearBtn)  clearBtn.disabled  = true;
    }

    // ── HTML Escape Utility ───────────────────────────────────────────────────

    function escapeHtml(str) {
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    // ── Initial State ─────────────────────────────────────────────────────────
    resetAll();

}); // end DOMContentLoaded
