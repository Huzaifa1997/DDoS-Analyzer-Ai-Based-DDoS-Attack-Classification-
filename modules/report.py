"""
PDF report generation using ReportLab + matplotlib charts.

ReportLab is used (pure-Python, no system deps — works on Windows out of the box,
unlike WeasyPrint/wkhtmltopdf which need GTK/Cairo). Charts are rendered with
matplotlib (Agg) into in-memory PNGs and embedded as images.

Handles both modes:
  • LABELED  upload → real accuracy, confusion matrix, model comparison.
  • UNLABELED upload → predictions + traffic intelligence (no metrics).
"""

import io
from datetime import datetime

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.lib.utils import ImageReader
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable, Image
)

# ── palette ───────────────────────────────────────────────────────────────────
NAVY       = colors.HexColor("#0f2540")
NAVY_2     = colors.HexColor("#1e3a5f")
GREY_HEAD  = colors.HexColor("#334155")
ROW_ALT    = colors.HexColor("#f1f5f9")
BORDER     = colors.HexColor("#d0d7de")
CARD_BG    = colors.HexColor("#f8fafc")

GREEN = "#10b981"
RED   = "#ef4444"
BLUE  = "#3b82f6"
AMBER = "#f59e0b"
GREY  = "#94a3b8"

REC_TINT = {
    "danger":  ("#fee2e2", "#dc2626"),
    "warning": ("#fef3c7", "#f59e0b"),
    "success": ("#dcfce7", "#16a34a"),
    "info":    ("#eff6ff", "#3b82f6"),
}


def _esc(s):
    return (str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))


def _threat(pct):
    if pct >= 50: return "CRITICAL", colors.HexColor("#dc2626")
    if pct >= 20: return "HIGH",     colors.HexColor("#f97316")
    if pct >= 5:  return "MEDIUM",   colors.HexColor("#f59e0b")
    return "LOW", colors.HexColor("#10b981")


def _styles():
    s = getSampleStyleSheet()
    body = ParagraphStyle("Body", parent=s["Normal"], fontSize=10, leading=14)
    h2 = ParagraphStyle("H2", parent=s["Heading2"], fontSize=13,
                        textColor=NAVY_2, spaceBefore=14, spaceAfter=6)
    small = ParagraphStyle("Small", parent=s["Normal"], fontSize=8,
                           textColor=colors.HexColor("#64748b"), leading=11)
    return body, h2, small


# ── charts (matplotlib → PNG buffer) ──────────────────────────────────────────

def _donut_png(benign, ddos):
    total = benign + ddos
    vals = [benign, ddos] if total > 0 else [1, 0]
    fig, ax = plt.subplots(figsize=(4.8, 3.6), dpi=150)
    wedges, _ = ax.pie(
        vals, colors=[GREEN, RED], startangle=90,
        wedgeprops=dict(width=0.42, edgecolor="white", linewidth=2),
    )
    ax.text(0, 0, f"{total:,}\nflows", ha="center", va="center",
            fontsize=13, fontweight="bold", color="#0f172a")
    bpct = benign / total * 100 if total else 0
    dpct = ddos / total * 100 if total else 0
    ax.legend(wedges,
              [f"Normal:  {benign:,}  ({bpct:.1f}%)", f"DDoS:  {ddos:,}  ({dpct:.1f}%)"],
              loc="lower center", bbox_to_anchor=(0.5, -0.16), ncol=1,
              frameon=False, fontsize=9)
    ax.set(aspect="equal")
    return _fig_buf(fig)


def _protocol_bar_png(pdv):
    cats = ["TCP", "UDP", "Other"]
    vals = [int(pdv.get("TCP", 0)), int(pdv.get("UDP", 0)), int(pdv.get("Other", 0))]
    fig, ax = plt.subplots(figsize=(5.0, 2.1), dpi=150)
    bars = ax.barh(cats[::-1], vals[::-1],
                   color=[GREY, AMBER, BLUE][::-1], height=0.62)
    ax.bar_label(bars, fmt="%d", padding=4, fontsize=9, color="#0f172a")
    ax.set_title("DDoS Flows by Protocol", fontsize=10, fontweight="bold", loc="left")
    for sp in ("top", "right"):
        ax.spines[sp].set_visible(False)
    ax.tick_params(labelsize=9)
    ax.set_xlim(0, max(vals + [1]) * 1.20)
    return _fig_buf(fig)


def _model_bar_png(models):
    metrics = ["accuracy", "precision", "recall", "f1_score"]
    labels = ["Acc", "Prec", "Rec", "F1"]
    fig, ax = plt.subplots(figsize=(5.2, 2.4), dpi=150)
    import numpy as np
    x = np.arange(len(labels)); w = 0.38
    palette = [BLUE, "#8b5cf6"]
    for i, m in enumerate(models[:2]):
        vals = [m.get(k) or 0 for k in metrics]
        ax.bar(x + (i - 0.5) * w, vals, w, label=m["name"], color=palette[i % 2])
    ax.set_xticks(x); ax.set_xticklabels(labels, fontsize=9)
    ax.set_ylim(0, 109); ax.set_ylabel("%", fontsize=9)
    ax.set_title("Model Performance", fontsize=10, fontweight="bold", loc="left")
    ax.legend(fontsize=8, frameon=False, ncol=2, loc="lower center", bbox_to_anchor=(0.5, -0.32))
    for sp in ("top", "right"):
        ax.spines[sp].set_visible(False)
    ax.tick_params(labelsize=8)
    return _fig_buf(fig)


def _fig_buf(fig):
    buf = io.BytesIO()
    fig.savefig(buf, format="png", bbox_inches="tight", transparent=True, dpi=150)
    plt.close(fig)
    buf.seek(0)
    return buf


def _img(buf, width_cm):
    buf.seek(0)
    pw, ph = ImageReader(buf).getSize()
    buf.seek(0)
    w = width_cm * cm
    img = Image(buf, width=w, height=w * ph / pw)
    img.hAlign = "CENTER"
    return img


# ── main ──────────────────────────────────────────────────────────────────────

def generate_pdf(analysis, filename="upload.csv"):
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=2*cm, rightMargin=2*cm, topMargin=1.5*cm, bottomMargin=1.5*cm,
        title="DDoS Analyzer Report",
    )
    body, h2, small = _styles()
    W = 17 * cm
    story = []

    labeled    = analysis.get("has_ground_truth", False)
    ddos_pct   = analysis.get("ddos_percent", 0) or 0
    benign     = analysis.get("benign_count", 0) or 0
    ddos       = analysis.get("ddos_count", 0) or 0
    total      = analysis.get("total_records", 0) or 0
    ts         = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    def fmt(v, suf="%"):
        return "N/A" if v is None else f"{v}{suf}"

    # ── Header band ───────────────────────────────────────────────────────────
    header = Table([[Paragraph(
        f'<font size=18 color="white"><b>DDoS Analyzer &nbsp;&#183;&nbsp; Threat Report</b></font><br/>'
        f'<font size=9 color="#cbd5e1">{_esc(filename)} &nbsp;&#124;&nbsp; Generated {ts}</font>',
        body)]], colWidths=[W])
    header.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), NAVY),
        ("LEFTPADDING", (0, 0), (-1, -1), 16), ("RIGHTPADDING", (0, 0), (-1, -1), 16),
        ("TOPPADDING", (0, 0), (-1, -1), 14), ("BOTTOMPADDING", (0, 0), (-1, -1), 14),
        ("ROUNDEDCORNERS", [6, 6, 6, 6]),
    ]))
    story.append(header)
    story.append(Spacer(1, 0.35*cm))

    # ── Threat banner ─────────────────────────────────────────────────────────
    tname, tcol = _threat(ddos_pct)
    mode_txt = ("Labeled dataset — metrics measured against the file's Label column."
                if labeled else
                "Unlabeled dataset — model predictions only (no ground-truth labels).")
    threat = Table([[Paragraph(
        f'<font size=12 color="white"><b>THREAT LEVEL: {tname}</b></font><br/>'
        f'<font size=9 color="white">{ddos_pct}% of analysed flows classified as DDoS. {mode_txt}</font>',
        body)]], colWidths=[W])
    threat.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), tcol),
        ("LEFTPADDING", (0, 0), (-1, -1), 14), ("RIGHTPADDING", (0, 0), (-1, -1), 14),
        ("TOPPADDING", (0, 0), (-1, -1), 10), ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
        ("ROUNDEDCORNERS", [6, 6, 6, 6]),
    ]))
    story.append(threat)
    story.append(Spacer(1, 0.4*cm))

    # ── Key metric cards ──────────────────────────────────────────────────────
    def card(label, value, vcolor, sub):
        return Paragraph(
            f'<font size=8 color="#64748b">{_esc(label)}</font><br/>'
            f'<font size=16 color="{vcolor}"><b>{_esc(value)}</b></font><br/>'
            f'<font size=7 color="#94a3b8">{_esc(sub)}</font>', body)

    if labeled:
        c4 = card("BEST MODEL", fmt(analysis.get("best_accuracy")), "#8b5cf6",
                  analysis.get("best_model", "—"))
    else:
        c4 = card("MODE", "Predict", "#8b5cf6", "no labels in file")
    cards = Table([[
        card("TOTAL FLOWS", f"{total:,}", "#0f172a", filename[:22]),
        card("NORMAL", f"{analysis.get('benign_percent', 0)}%", GREEN, f"{benign:,} flows"),
        card("DDoS", f"{ddos_pct}%", RED, f"{ddos:,} flows"),
        c4,
    ]], colWidths=[W/4.0]*4)
    cards.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), CARD_BG),
        ("GRID", (0, 0), (-1, -1), 3, colors.white),
        ("BOX", (0, 0), (-1, -1), 0.5, BORDER),
        ("LEFTPADDING", (0, 0), (-1, -1), 10), ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 10), ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    story.append(cards)

    # ── Traffic distribution (donut pie) ──────────────────────────────────────
    story.append(Paragraph("Traffic Distribution", h2))
    story.append(_img(_donut_png(benign, ddos), 9.5))

    # ── Model performance ─────────────────────────────────────────────────────
    story.append(Paragraph("Model Performance", h2))
    models = analysis.get("models", []) or []
    if labeled and any(m.get("accuracy") is not None for m in models):
        rows = [["Model", "Accuracy", "Precision", "Recall", "F1-Score"]]
        for m in models:
            rows.append([m["name"], fmt(m.get("accuracy")), fmt(m.get("precision")),
                         fmt(m.get("recall")), fmt(m.get("f1_score"))])
        mt = Table(rows, colWidths=[5*cm, 3*cm, 3*cm, 3*cm, 3*cm])
        mt.setStyle(_table_style())
        story.append(mt)
        story.append(Spacer(1, 0.3*cm))
        story.append(_img(_model_bar_png(models), 11))
    else:
        story.append(_note(
            "Accuracy, precision, recall and a confusion matrix require a "
            "<b>Label</b> column. This file has none, so the report shows model "
            "predictions and traffic intelligence instead.", body))

    # ── Confusion matrix (labeled only) ───────────────────────────────────────
    best = next((m for m in models if m["name"] == analysis.get("best_model")),
                models[0] if models else None)
    cm_vals = best.get("confusion_matrix") if best else None
    if (cm_vals and len(cm_vals) == 2
            and len(cm_vals[0]) == 2 and len(cm_vals[1]) == 2):
        story.append(Paragraph(f"Confusion Matrix — {best['name']}", h2))
        tn, fp = cm_vals[0][0], cm_vals[0][1]
        fn, tp = cm_vals[1][0], cm_vals[1][1]
        cm_data = [
            ["", "Predicted BENIGN", "Predicted DDoS"],
            ["Actual BENIGN", str(tn), str(fp)],
            ["Actual DDoS",   str(fn), str(tp)],
        ]
        cmt = Table(cm_data, colWidths=[5*cm, 6*cm, 6*cm])
        cmt.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), NAVY_2),
            ("BACKGROUND", (0, 0), (0, -1), NAVY_2),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("TEXTCOLOR", (0, 0), (0, -1), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
            ("BACKGROUND", (1, 1), (1, 1), colors.HexColor("#d1fae5")),
            ("BACKGROUND", (2, 2), (2, 2), colors.HexColor("#d1fae5")),
            ("BACKGROUND", (1, 2), (1, 2), colors.HexColor("#fee2e2")),
            ("BACKGROUND", (2, 1), (2, 1), colors.HexColor("#fee2e2")),
            ("GRID", (0, 0), (-1, -1), 0.5, BORDER),
            ("ALIGN", (1, 0), (-1, -1), "CENTER"),
            ("FONTSIZE", (0, 0), (-1, -1), 10),
            ("TOPPADDING", (0, 0), (-1, -1), 8), ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ]))
        story.append(cmt)

    # ── Traffic intelligence ──────────────────────────────────────────────────
    intel = analysis.get("traffic_intel") or {}
    pdv = intel.get("protocol_dist")
    fda = intel.get("flow_duration_avg")
    pps = intel.get("packets_per_sec_avg")
    tdp = intel.get("top_dst_ports")
    if any([pdv, fda, pps, tdp]):
        story.append(Paragraph("Traffic Intelligence (DDoS Flows)", h2))

        if pdv and (pdv.get("TCP") or pdv.get("UDP") or pdv.get("Other")):
            story.append(_img(_protocol_bar_png(pdv), 11))
            story.append(Spacer(1, 0.2*cm))

        stat_rows = []
        if fda:
            stat_rows.append(["Avg Flow Duration (DDoS)",
                              "N/A" if fda.get("ddos") is None else f"{fda['ddos']:,.1f} us"])
            stat_rows.append(["Avg Flow Duration (Benign)",
                              "N/A" if fda.get("benign") is None else f"{fda['benign']:,.1f} us"])
        if pps:
            stat_rows.append(["Avg Packets/s (DDoS)",
                              "N/A" if pps.get("ddos") is None else f"{pps['ddos']:,.1f}"])
            stat_rows.append(["Avg Packets/s (Benign)",
                              "N/A" if pps.get("benign") is None else f"{pps['benign']:,.1f}"])
        if stat_rows:
            st = Table([["Metric", "Value"]] + stat_rows, colWidths=[8.5*cm, 8.5*cm])
            st.setStyle(_table_style())
            story.append(st)
            story.append(Spacer(1, 0.25*cm))

        if tdp:
            story.append(Paragraph("<b>Top Targeted Ports</b>", body))
            port_rows = [["Port", "Flow Count"]] + [
                [str(p["port"]), f"{p['count']:,}"] for p in tdp
            ]
            pt = Table(port_rows, colWidths=[8.5*cm, 8.5*cm])
            pt.setStyle(_table_style(head_bg=GREY_HEAD, fontsize=9))
            story.append(pt)

    # ── Recommendations ───────────────────────────────────────────────────────
    recs = analysis.get("recommendations", []) or []
    if recs:
        story.append(Paragraph("Security Recommendations", h2))
        for rec in recs:
            bg, accent = REC_TINT.get(rec.get("type", "info"), REC_TINT["info"])
            cmd = rec.get("command")
            cmd_html = (f'<br/><font name="Courier" size=8 color="#0f2540">$ {_esc(cmd)}</font>'
                        if cmd else '')
            rt = Table([[Paragraph(
                f'<font size=10 color="#0f172a"><b>{_esc(rec.get("title", ""))}</b></font><br/>'
                f'<font size=9 color="#334155">{_esc(rec.get("text", ""))}</font>'
                f'{cmd_html}', body)]],
                colWidths=[W])
            rt.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor(bg)),
                ("LINEBEFORE", (0, 0), (0, -1), 3, colors.HexColor(accent)),
                ("LEFTPADDING", (0, 0), (-1, -1), 12), ("RIGHTPADDING", (0, 0), (-1, -1), 12),
                ("TOPPADDING", (0, 0), (-1, -1), 7), ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ]))
            story.append(rt)
            story.append(Spacer(1, 0.12*cm))

    # ── Footer ────────────────────────────────────────────────────────────────
    story.append(Spacer(1, 0.5*cm))
    story.append(HRFlowable(width="100%", thickness=0.5, color=colors.grey))
    story.append(Paragraph(
        '<font size=8 color="#94a3b8">Generated by DDoS Analyzer &#183; AI-powered offline '
        'traffic analysis &#183; Random Forest &amp; Logistic Regression &#183; CIC-DDoS2019</font>',
        body))

    doc.build(story)
    buf.seek(0)
    return buf


def _table_style(head_bg=NAVY_2, fontsize=10):
    return TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), head_bg),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, ROW_ALT]),
        ("GRID", (0, 0), (-1, -1), 0.5, BORDER),
        ("ALIGN", (1, 0), (-1, -1), "CENTER"),
        ("FONTSIZE", (0, 0), (-1, -1), fontsize),
        ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
    ])


def _note(html, body):
    t = Table([[Paragraph(f'<font size=9 color="#1e3a5f">{html}</font>', body)]],
              colWidths=[17*cm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#eff6ff")),
        ("LINEBEFORE", (0, 0), (0, -1), 3, colors.HexColor("#3b82f6")),
        ("LEFTPADDING", (0, 0), (-1, -1), 12), ("RIGHTPADDING", (0, 0), (-1, -1), 12),
        ("TOPPADDING", (0, 0), (-1, -1), 8), ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    return t
