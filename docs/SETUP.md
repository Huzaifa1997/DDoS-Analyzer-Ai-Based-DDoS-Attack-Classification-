# 🚀 Setup Guide

## Prerequisites

- **Python 3.11+** (developed on 3.13)
- `pip` and `venv`
- ~500 MB free disk for dependencies; a CIC-DDoS2019 copy only if you want to retrain

## Installation

```bash
# 1. Clone
git clone https://github.com/Huzaifa1997/DDoS-Analyzer-Ai-Based-DDoS-Attack-Classification-.git
cd DDoS-Analyzer-Ai-Based-DDoS-Attack-Classification-

# 2. Virtual environment
python -m venv .venv
.venv\Scripts\activate          # Windows
# source .venv/bin/activate     # macOS / Linux

# 3. Dependencies
pip install -r requirements.txt
```

> If `scapy` or `pyarrow` aren't pulled in by your `requirements.txt`, install them explicitly:
> `pip install scapy pyarrow`

## Run

```bash
python app.py
```

Open **http://127.0.0.1:5000**. Pre-trained models in `models/` are loaded automatically — no training needed to start.

## Enable AI recommendations (optional)

Recommendations work out of the box with a rule-based engine. To enable the **Groq LLaMA 3.3** AI recommendations:

1. Get a **free** API key at **[console.groq.com/keys](https://console.groq.com/keys)**.
2. Add it either:
   - **In the app:** Settings → *Groq API Key* → paste → Save, **or**
   - **Via file:** create `config.json` in the project root:
     ```json
     { "groq_api_key": "gsk_your_key_here" }
     ```
   - **Via env var:** set `GROQ_API_KEY=gsk_...`

`config.json` is **gitignored** — your key is never committed. See [CONFIGURATION.md](CONFIGURATION.md).

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Port 5000 in use` | Stop the other process, or change `port=` in `app.py`. |
| `sklearn InconsistentVersionWarning` | Harmless version mismatch between the pickling and runtime scikit-learn. Re-pin `scikit-learn` in `requirements.txt` or retrain to silence it. |
| AI recs show "rule-based" + an HTTP error | Check the Groq key is valid and you have network access; the app falls back to rule-based recs automatically. |
| `403 / Cloudflare 1010` from Groq | Already handled — `llm.py` sends a normal User-Agent. If you fork the LLM code, keep that header. |
| PCAP upload fails | Ensure the file is a valid `.pcap/.pcapng`; very large captures take time to parse. |
| Browser shows stale UI after an update | Hard refresh (Ctrl/Cmd + Shift + R) to bypass cached `app.js`. |

## Notes

- The dev server runs with `debug=True` — **for development only**. Use a production WSGI server (gunicorn/waitress) behind a reverse proxy for any real deployment, and disable debug.
- Uploads and the large dataset folders are gitignored; the app writes temporary files under `uploads/` and cleans them up after each request.
