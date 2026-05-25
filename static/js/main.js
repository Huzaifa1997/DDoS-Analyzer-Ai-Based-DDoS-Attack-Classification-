"use strict";

// ============================================================
//  main.js — Global JS loaded on every page via base.html
//  Covers: sidebar, active nav, theme, clock, toasts,
//          session timer, alerts, counter animation, scroll reveal
// ============================================================


// ── Sidebar Toggle ───────────────────────────────────────────────────────────

function initSidebar() {
    const toggle   = document.getElementById("sidebarToggle");
    const sidebar  = document.querySelector(".sidebar");
    const overlay  = document.querySelector(".sidebar-overlay");

    if (!toggle || !sidebar) return;

    // Restore desktop collapsed state from localStorage
    if (window.innerWidth >= 992) {
        if (localStorage.getItem("sidebar_collapsed") === "true") {
            sidebar.classList.add("collapsed");
        }
    }

    toggle.addEventListener("click", function () {
        if (window.innerWidth >= 992) {
            // Desktop: toggle collapsed class and persist
            sidebar.classList.toggle("collapsed");
            localStorage.setItem("sidebar_collapsed", sidebar.classList.contains("collapsed"));
        } else {
            // Mobile: toggle open + show overlay
            sidebar.classList.toggle("open");
            if (overlay) overlay.classList.toggle("show");
        }
    });

    // Close mobile sidebar when overlay is clicked
    if (overlay) {
        overlay.addEventListener("click", function () {
            sidebar.classList.remove("open");
            overlay.classList.remove("show");
        });
    }

    // On window resize: clean up mobile classes on desktop, restore desktop state
    window.addEventListener("resize", function () {
        if (window.innerWidth >= 992) {
            sidebar.classList.remove("open");
            if (overlay) overlay.classList.remove("show");
            // Re-apply desktop collapsed state
            if (localStorage.getItem("sidebar_collapsed") === "true") {
                sidebar.classList.add("collapsed");
            } else {
                sidebar.classList.remove("collapsed");
            }
        }
    });
}


// ── Active Nav ───────────────────────────────────────────────────────────────

function initActiveNav() {
    const currentPath = window.location.pathname;
    const navItems    = document.querySelectorAll(".nav-item");

    navItems.forEach(function (item) {
        const link = item.querySelector("a");
        if (!link) return;
        const href = link.getAttribute("href");
        if (href && currentPath === href) {
            item.classList.add("active");
        }
    });
}


// ── Theme ────────────────────────────────────────────────────────────────────

// Available theme names (maps to CSS body class  theme-{name})
const THEMES = ["default", "midnight", "forest", "crimson"];

function applyTheme(theme) {
    // Remove all existing theme classes from body
    THEMES.forEach(function (t) {
        document.body.classList.remove("theme-" + t);
    });
    document.body.classList.add("theme-" + theme);
    localStorage.setItem("cy_theme", theme);
}

function initTheme() {
    const saved = localStorage.getItem("cy_theme") || "default";
    applyTheme(saved);
}

// Expose globally so theme pickers in settings page can call it
window.applyTheme = applyTheme;


// ── Clock ────────────────────────────────────────────────────────────────────

function initClock() {
    const el = document.getElementById("currentTime");
    if (!el) return;

    function tick() {
        const now  = new Date();
        let   h    = now.getHours();
        const m    = String(now.getMinutes()).padStart(2, "0");
        const s    = String(now.getSeconds()).padStart(2, "0");
        const ampm = h >= 12 ? "PM" : "AM";
        h = h % 12 || 12;
        el.textContent = String(h).padStart(2, "0") + ":" + m + ":" + s + " " + ampm;
    }

    tick();
    setInterval(tick, 1000);
}


// ── Toast ────────────────────────────────────────────────────────────────────

/**
 * window.showToast(msg, type, duration)
 * type: 'success' | 'danger' | 'warning' | 'info'  (default: 'info')
 * duration: milliseconds before auto-dismiss       (default: 3500)
 */
window.showToast = function (msg, type, duration) {
    type     = type     || "info";
    duration = duration || 3500;

    const container = document.getElementById("toastContainer");
    if (!container) return;

    // Icon map
    const icons = {
        success: "&#10003;",   // check mark
        danger:  "&#10007;",   // cross mark
        warning: "&#9888;",    // warning triangle
        info:    "&#8505;"     // information
    };

    // Color map
    const colors = {
        success: "#00ff9d",
        danger:  "#ff4560",
        warning: "#ffbe0b",
        info:    "#00d4ff"
    };

    const toast = document.createElement("div");
    toast.className  = "cy-toast cy-toast-" + type;
    toast.innerHTML  =
        '<span class="cy-toast-icon" style="color:' + (colors[type] || colors.info) + '">' +
            (icons[type] || icons.info) +
        '</span>' +
        '<span class="cy-toast-msg">' + msg + '</span>';

    // Base styles (project CSS may override these)
    Object.assign(toast.style, {
        display:      "flex",
        alignItems:   "center",
        gap:          "10px",
        background:   "#0d1424",
        border:       "1px solid #1e3a5f",
        borderRadius: "8px",
        padding:      "12px 18px",
        marginBottom: "8px",
        color:        "#e8eff7",
        fontSize:     "14px",
        boxShadow:    "0 4px 20px rgba(0,0,0,0.4)",
        opacity:      "1",
        transition:   "opacity 0.4s ease"
    });

    container.appendChild(toast);

    // Auto-remove after duration with fade-out
    setTimeout(function () {
        toast.style.opacity = "0";
        setTimeout(function () {
            if (toast.parentNode) toast.parentNode.removeChild(toast);
        }, 420);
    }, duration);
};


// ── Session Timer ────────────────────────────────────────────────────────────

const SESSION_DURATION = 30 * 60; // 30 minutes in seconds

(function initSessionTimer() {
    let remaining   = SESSION_DURATION;
    let warningShown = false;
    let countdownId  = null;
    let tickId       = null;

    const modal          = document.getElementById("sessionModal");
    const countdownEl    = document.getElementById("countdown");

    function resetTimer() {
        remaining    = SESSION_DURATION;
        warningShown = false;
        if (modal) modal.style.display = "none";
        if (countdownId) {
            clearInterval(countdownId);
            countdownId = null;
        }
    }

    function startCountdownDisplay() {
        if (countdownId) return; // already running
        if (!countdownEl) return;

        function updateDisplay() {
            const m = Math.floor(remaining / 60);
            const s = remaining % 60;
            countdownEl.textContent =
                String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
        }
        updateDisplay();
        countdownId = setInterval(updateDisplay, 1000);
    }

    function tick() {
        remaining -= 1;

        if (remaining <= 0) {
            clearInterval(tickId);
            // Force logout
            window.location.href = "/logout";
            return;
        }

        // Show warning modal at 5 minutes remaining
        if (remaining <= 5 * 60 && !warningShown) {
            warningShown = true;
            if (modal) {
                modal.style.display = "flex";
                startCountdownDisplay();
            }
        }
    }

    tickId = setInterval(tick, 1000);

    // Reset on user activity
    ["mousemove", "keydown", "click"].forEach(function (evt) {
        document.addEventListener(evt, resetTimer, { passive: true });
    });

    // stayLoggedIn: close modal and ping /keep-alive
    window.stayLoggedIn = function () {
        resetTimer();
        fetch("/keep-alive", { method: "POST" }).catch(function () {});
    };
})();


// ── Alerts ───────────────────────────────────────────────────────────────────

/**
 * window.showAlert(containerId, type, message)
 * Injects a dismissible .cy-alert into a container element.
 * type: 'success' | 'danger' | 'warning' | 'info'
 */
window.showAlert = function (containerId, type, message) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML =
        '<div class="cy-alert cy-alert-' + type + '" role="alert">' +
            '<span class="cy-alert-msg">' + message + '</span>' +
            '<button class="cy-alert-close" onclick="window.hideAlert(\'' + containerId + '\')">&times;</button>' +
        '</div>';
};

/**
 * window.hideAlert(containerId)
 * Clears any alert from the container.
 */
window.hideAlert = function (containerId) {
    const container = document.getElementById(containerId);
    if (container) container.innerHTML = "";
};


// ── Counter Animation ────────────────────────────────────────────────────────

/**
 * window.animateCounter(el, target, suffix, duration)
 * Ease-out cubic animation counting from 0 to target.
 * suffix:   string appended after the number (default: '')
 * duration: ms for the animation                (default: 1200)
 */
window.animateCounter = function (el, target, suffix, duration) {
    suffix   = suffix   !== undefined ? suffix : "";
    duration = duration !== undefined ? duration : 1200;

    if (!el) return;

    const startTime = performance.now();

    function easeOutCubic(t) {
        return 1 - Math.pow(1 - t, 3);
    }

    function step(now) {
        const elapsed  = now - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const value    = Math.round(easeOutCubic(progress) * target);
        el.textContent = value.toLocaleString() + suffix;

        if (progress < 1) {
            requestAnimationFrame(step);
        }
    }

    requestAnimationFrame(step);
};


// ── Scroll Reveal ────────────────────────────────────────────────────────────

function initScrollReveal() {
    if (!("IntersectionObserver" in window)) return;

    const cards = document.querySelectorAll(".cy-card, .stat-card");
    if (!cards.length) return;

    const observer = new IntersectionObserver(
        function (entries) {
            entries.forEach(function (entry) {
                if (entry.isIntersecting) {
                    entry.target.classList.add("fade-in");
                    observer.unobserve(entry.target); // animate once
                }
            });
        },
        { threshold: 0.12 }
    );

    cards.forEach(function (card) {
        observer.observe(card);
    });
}


// ── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", function () {
    initSidebar();
    initActiveNav();
    initTheme();
    initClock();
    initScrollReveal();
    // Session timer is initialized via the IIFE above (runs immediately)
});
