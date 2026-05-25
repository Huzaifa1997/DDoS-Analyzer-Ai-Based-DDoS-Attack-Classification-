"""PDF report generation using ReportLab."""

import io
import os
from datetime import datetime

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable
)


def _header_style():
    s = getSampleStyleSheet()
    title = ParagraphStyle(
        "CustomTitle",
        parent=s["Title"],
        fontSize=20,
        textColor=colors.HexColor("#1e3a5f"),
        spaceAfter=6,
    )
    heading = ParagraphStyle(
        "CustomH2",
        parent=s["Heading2"],
        fontSize=13,
        textColor=colors.HexColor("#1e3a5f"),
        spaceBefore=12,
        spaceAfter=4,
    )
    body = ParagraphStyle(
        "CustomBody",
        parent=s["Normal"],
        fontSize=10,
        leading=14,
    )
    return title, heading, body


def generate_pdf(analysis, filename="upload.csv"):
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=2*cm, rightMargin=2*cm,
        topMargin=2*cm, bottomMargin=2*cm,
    )

    title_style, heading_style, body_style = _header_style()
    story = []

    # ── Title ────────────────────────────────────────────────────────────────
    story.append(Paragraph("DDoS Analyzer — Analysis Report", title_style))
    story.append(Paragraph(
        f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}  |  File: {filename}",
        body_style
    ))
    story.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor("#1e3a5f")))
    story.append(Spacer(1, 0.4*cm))

    # ── Traffic Summary ──────────────────────────────────────────────────────
    story.append(Paragraph("Traffic Classification Summary", heading_style))
    summary_data = [
        ["Metric", "Value"],
        ["Total Records Analysed", f"{analysis['total_records']:,}"],
        ["Normal (BENIGN) Traffic", f"{analysis['benign_count']:,}  ({analysis['benign_percent']}%)"],
        ["DDoS Traffic",           f"{analysis['ddos_count']:,}  ({analysis['ddos_percent']}%)"],
        ["Best Performing Model",  analysis["best_model"]],
        ["Best Model Accuracy",    f"{analysis['best_accuracy']}%"],
    ]
    t = Table(summary_data, colWidths=[8*cm, 9*cm])
    t.setStyle(TableStyle([
        ("BACKGROUND",  (0, 0), (-1, 0), colors.HexColor("#1e3a5f")),
        ("TEXTCOLOR",   (0, 0), (-1, 0), colors.white),
        ("FONTNAME",    (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE",    (0, 0), (-1, 0), 10),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f0f4f8")]),
        ("GRID",        (0, 0), (-1, -1), 0.5, colors.HexColor("#d0d7de")),
        ("FONTSIZE",    (0, 1), (-1, -1), 10),
        ("TOPPADDING",  (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    story.append(t)
    story.append(Spacer(1, 0.4*cm))

    # ── Model Performance ────────────────────────────────────────────────────
    story.append(Paragraph("Model Performance Comparison", heading_style))
    model_header = ["Model", "Accuracy (%)", "Precision (%)", "Recall (%)", "F1-Score (%)"]
    model_rows   = [model_header]
    for m in analysis["models"]:
        model_rows.append([
            m["name"],
            str(m["accuracy"]),
            str(m["precision"]),
            str(m["recall"]),
            str(m["f1_score"]),
        ])
    mt = Table(model_rows, colWidths=[5*cm, 3*cm, 3*cm, 3*cm, 3*cm])
    mt.setStyle(TableStyle([
        ("BACKGROUND",  (0, 0), (-1, 0), colors.HexColor("#1e3a5f")),
        ("TEXTCOLOR",   (0, 0), (-1, 0), colors.white),
        ("FONTNAME",    (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE",    (0, 0), (-1, 0), 10),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f0f4f8")]),
        ("GRID",        (0, 0), (-1, -1), 0.5, colors.HexColor("#d0d7de")),
        ("ALIGN",       (1, 0), (-1, -1), "CENTER"),
        ("FONTSIZE",    (0, 1), (-1, -1), 10),
        ("TOPPADDING",  (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    story.append(mt)
    story.append(Spacer(1, 0.4*cm))

    # ── Confusion Matrices ───────────────────────────────────────────────────
    story.append(Paragraph("Confusion Matrices (Best Model)", heading_style))
    best = next((m for m in analysis["models"] if m["name"] == analysis["best_model"]),
                analysis["models"][0])
    cm_vals = best["confusion_matrix"]
    tn, fp  = cm_vals[0][0], cm_vals[0][1]
    fn, tp  = cm_vals[1][0], cm_vals[1][1]
    cm_data = [
        ["", "Predicted BENIGN", "Predicted DDoS"],
        ["Actual BENIGN", str(tn), str(fp)],
        ["Actual DDoS",   str(fn), str(tp)],
    ]
    cmt = Table(cm_data, colWidths=[5*cm, 5*cm, 5*cm])
    cmt.setStyle(TableStyle([
        ("BACKGROUND",  (0, 0), (-1, 0), colors.HexColor("#1e3a5f")),
        ("BACKGROUND",  (0, 0), (0, -1), colors.HexColor("#1e3a5f")),
        ("TEXTCOLOR",   (0, 0), (-1, 0), colors.white),
        ("TEXTCOLOR",   (0, 0), (0, -1), colors.white),
        ("FONTNAME",    (0, 0), (-1, 0), "Helvetica-Bold"),
        ("BACKGROUND",  (1, 1), (1, 1), colors.HexColor("#d1fae5")),
        ("BACKGROUND",  (2, 2), (2, 2), colors.HexColor("#d1fae5")),
        ("BACKGROUND",  (1, 2), (1, 2), colors.HexColor("#fee2e2")),
        ("BACKGROUND",  (2, 1), (2, 1), colors.HexColor("#fee2e2")),
        ("GRID",        (0, 0), (-1, -1), 0.5, colors.HexColor("#d0d7de")),
        ("ALIGN",       (1, 0), (-1, -1), "CENTER"),
        ("FONTSIZE",    (0, 0), (-1, -1), 10),
        ("TOPPADDING",  (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(cmt)
    story.append(Spacer(1, 0.4*cm))

    # ── Recommendations ──────────────────────────────────────────────────────
    story.append(Paragraph("Security Recommendations", heading_style))
    for rec in analysis.get("recommendations", []):
        story.append(Paragraph(
            f"<b>{rec['title']}</b>: {rec['text']}", body_style
        ))
        story.append(Spacer(1, 0.15*cm))

    # ── Footer ───────────────────────────────────────────────────────────────
    story.append(Spacer(1, 0.5*cm))
    story.append(HRFlowable(width="100%", thickness=0.5, color=colors.grey))
    story.append(Paragraph(
        "Generated by DDoS Analyzer — AI-powered offline traffic analysis platform",
        body_style
    ))

    doc.build(story)
    buf.seek(0)
    return buf
