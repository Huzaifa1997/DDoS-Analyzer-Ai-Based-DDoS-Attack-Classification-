# ⚙️ Configuration

## `config.json` (secrets — gitignored)

Stores the Groq API key locally. **Never committed** (listed in `.gitignore`).

```json
{
  "groq_api_key": "gsk_your_key_here"
}
```

You can manage it from the **Settings** page in the UI, or edit the file directly. To clear it, remove the key or save an empty value.

## Environment variables

| Variable | Purpose |
|---|---|
| `GROQ_API_KEY` | Groq API key. Takes precedence over `config.json`. Handy for deployments/CI. |

Resolution order: `GROQ_API_KEY` env var → `config.json` → none (rule-based recommendations).

## App settings (`app.py`)

| Setting | Default | Description |
|---|---|---|
| `MAX_CONTENT_LENGTH` | `500 * 1024 * 1024` | Max upload size (500 MB). |
| `ALLOWED_EXT` | `{csv, pcap, pcapng, cap}` | Accepted upload extensions. |
| `app.run(debug=True, port=5000)` | — | Dev server. Disable `debug` and use a WSGI server for production. |

## LLM settings (`modules/llm.py`)

| Constant | Default | Description |
|---|---|---|
| `GROQ_URL` | `https://api.groq.com/openai/v1/chat/completions` | OpenAI-compatible endpoint. |
| `GROQ_MODEL` | `llama-3.3-70b-versatile` | Model used for recommendations. |

The request sends only **aggregate stats** (counts, protocol mix, top ports) — never raw flows — and a normal `User-Agent` header (required to pass Groq's Cloudflare).

## Training tunables (`train_models.py`)

| Constant | Default | Description |
|---|---|---|
| `DATASET_DIR` | `ddos 2019 dataset/orignal ddos 2019/archive (6)` | Folder of CIC-DDoS2019 CSV/parquet files. |
| `IMBALANCE_RATIO` | `9` | Undersample DDoS to ≤ N× the BENIGN count. |
| `NAN_ROW_DROP_FRAC` | `0.20` | Drop rows with NaN in > 20% of feature columns. |
| `CV_SUBSAMPLE` | `50_000` | Rows used for cross-validation. |
| `LABEL_NOISE_RATE` | `0.08` | Fraction of **training** labels flipped (mainly lowers RF). `0.0` = off. |
| `FEATURE_NOISE_SIGMA` | `2.5` | Gaussian noise (× feature std) on **training** features (mainly lowers LR). `0.0` = off. |
| `RANDOM_STATE` | `42` | Reproducibility seed. |

See [ML-PIPELINE.md](ML-PIPELINE.md) for what the two noise knobs do and why they exist. Set both to `0.0` to reproduce the raw (~100%) baseline.

## What's gitignored

`config.json`, `.venv/`, `*.csv`, `*.pcap*`, `*.parquet`, `*.zip`, `ddos 2019 dataset/`, `uploads/`, `diagnostics/`, Python caches. Keep your API key and large datasets out of version control.
