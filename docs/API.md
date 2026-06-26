# 🔌 API Reference

All endpoints are served by [`app.py`](../app.py) on `http://127.0.0.1:5000`. Max upload size: **500 MB**. Allowed upload types: `csv`, `pcap`, `pcapng`, `cap`.

## Pages

### `GET /`
Returns the single-page dashboard (`templates/index.html`).

---

## Analysis

### `POST /analyze`
Run the full pipeline on an uploaded file.

- **Body:** `multipart/form-data` with a `file` field (CSV or PCAP).
- **Behavior:** PCAP is auto-converted; data is preprocessed and classified by both models.
- **Returns:** JSON.

```jsonc
{
  "success": true,
  "total_records": 6210,
  "benign_count": 570, "ddos_count": 5640,
  "benign_percent": 9.18, "ddos_percent": 90.82,
  "best_model": "Random Forest",
  "best_accuracy": 0.0,             // % — computed LIVE on your labeled data (varies); null if no Label column
  "has_ground_truth": true,
  "models": [
    { "name": "Random Forest", "accuracy": 0.0, "precision": 0.0,
      "recall": 0.0, "f1_score": 0.0,   // example shape only — real values are live
      "confusion_matrix": [[0,0],[0,0]], "metrics_source": "live" }
    // ...Logistic Regression
  ],
  "traffic_intel": {
    "protocol_dist": { "TCP": 12, "UDP": 5600, "Other": 28 },
    "top_dst_ports": [ { "port": 53, "count": 1200, "service": "DNS" } ],
    "top_src_ports": [ /* ... */ ],
    "flow_duration_avg": { "ddos": 2.9, "benign": 8091746.6 },
    "packets_per_sec_avg": { "ddos": 1786246.3, "benign": 349330.8 }
  },
  "recommendations": [ /* rule-based baseline */ ],
  "summary": "Analysed 6,210 records ...",
  "filename": "traffic.csv", "file_size_mb": 12.8
}
```

- **Labeled file** (`Label` column present) → live metrics + confusion matrix, `metrics_source: "live"`.
- **Unlabeled file** → metrics are `null`, `has_ground_truth: false`; `traffic_intel` is the useful output.

### `POST /api/recommendations`
Return AI-generated mitigation recommendations (with a rule-based fallback).

- **Body:** JSON analysis payload (or empty `{}` to reuse the last analysis).
- **Returns:** `{ "source": "groq" | "static", "recommendations": [...] }`. Each recommendation: `{ type, icon, title, text, command }` where `command` is a concrete CLI/firewall line.
- Falls back to rule-based recs if no Groq key or the API errors.

---

## Settings

### `GET /api/settings`
Returns `{ "has_key": bool, "from_env": bool }` (whether a Groq key is configured).

### `POST /api/settings`
Body `{ "groq_api_key": "gsk_..." }` to save, or `""` to clear. Returns `{ "success": true, "has_key": bool }`.

---

## Utilities & Export

### `POST /convert/pcap-to-csv`
Standalone PCAP → CSV. Body: `multipart/form-data` `file` (PCAP). Returns the feature CSV as a download.

### `GET /export/json`
Download the last analysis as JSON.

### `GET /export/pdf`
Download a formatted PDF threat report of the last analysis.

### `GET /chart/<name>`
Serve a training chart PNG. Allowed `name`: `cm_random_forest`, `cm_logistic_regression`, `feature_importance_rf`, `model_comparison`.

### `GET /models/meta`
Return `models/training_meta.json` (metrics, best model, dataset info, noise rates).

### `GET /docs/guidelines` · `GET /docs/guidelines/download`
View / download the bundled "Dataset Guidelines" PDF.

---

## Quick examples

```bash
# Analyze a CSV
curl -F "file=@traffic.csv" http://127.0.0.1:5000/analyze

# Get AI recommendations for the last analysis
curl -X POST -H "Content-Type: application/json" -d '{}' \
     http://127.0.0.1:5000/api/recommendations

# Download the PDF report
curl -o report.pdf http://127.0.0.1:5000/export/pdf
```
