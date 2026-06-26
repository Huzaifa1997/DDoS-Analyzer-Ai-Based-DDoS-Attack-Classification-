# 🧪 Usage Guide

## Input formats

| Input | Notes |
|---|---|
| **CSV** | Must contain the 80 numeric CICFlowMeter features (e.g. `Flow Duration`, `Total Fwd Packets`, `Flow Bytes/s`, `SYN Flag Count`). An optional **`Label`** column (`BENIGN`/`DDoS`) unlocks live evaluation metrics. |
| **PCAP** | `.pcap` / `.pcapng` / `.cap`. Auto-converted to the 80 features on upload. See [PCAP-CONVERSION.md](PCAP-CONVERSION.md). |

Max upload size: **500 MB**.

## Workflow

1. **Upload** — drag & drop or browse on the Upload page.
2. **Analyze** — click *Analyze Dataset* (or *Convert PCAP & Analyze*).
3. **Review the dashboard**, **read recommendations**, and **export** a report.

## Two modes

### 🏷️ Labeled mode (file has a `Label` column)
For researchers/testing. You get the model's **real** performance on your data:
- Accuracy / Precision / Recall / F1 per model
- A live **confusion matrix**
- Model comparison bar chart

### 🛰️ Unlabeled mode (no `Label` column) — e.g. real captures
For real-world use where you don't have ground truth:
- Prediction counts (BENIGN vs DDoS) + threat level
- Accuracy card shows **N/A** (it can't be measured — by design, no fake numbers)
- **Traffic Intelligence**: a "DDoS Flows by Protocol" chart, top targeted ports, and DDoS-vs-benign flow duration / packets-per-second

## Dashboard sections

| Section | Shows |
|---|---|
| **Summary cards** | Dataset size, normal %, DDoS %, best model/accuracy (or "prediction-only") |
| **Threat banner** | Colour-coded threat level from the DDoS percentage |
| **Traffic Distribution** | Doughnut of BENIGN vs DDoS |
| **Confusion Matrix** *(labeled)* / **Protocol chart** *(unlabeled)* | Right-hand panel adapts to the mode |
| **Model Performance** *(labeled)* | Metric cards + RF-vs-LR bar chart |
| **Traffic Intelligence** | Protocol/port/flow stats |
| **Recommendations** | AI (Groq) or rule-based mitigations with copy-paste commands |
| **Export** | PDF / JSON / CSV |

## AI recommendations

With a Groq key configured (see [SETUP.md](SETUP.md)), recommendations are **tailored to the observed attack** — e.g. blocking the specific amplification port, throttling UDP floods, enabling SYN cookies — each with a concrete command:

```bash
iptables -A INPUT -p udp --dport 53 -m hashlimit --hashlimit-above 50/sec -j DROP
```

Without a key, an attack-aware **rule-based** engine produces the same style of actionable commands.

## Exporting

- **PDF report** — branded report with threat banner, pie chart, protocol chart, model metrics (labeled), traffic intelligence, and recommendations.
- **JSON** — the raw analysis object.
- **CSV** — per-model metrics summary.

## Standalone PCAP → CSV

On the Upload page, the **Convert PCAP to CSV** tool extracts the 80 features from a capture and downloads the CSV — no analysis. Useful to build/share datasets or to inspect features.

## Theming

Settings → Appearance toggles **light / dark** mode (remembered across sessions).
