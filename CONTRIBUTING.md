# Contributing to DDoS Analyzer

Thanks for your interest in improving DDoS Analyzer! 🛡️

## Getting started

1. **Fork** and clone the repo.
2. Set up the environment (see **[docs/SETUP.md](docs/SETUP.md)**):
   ```bash
   python -m venv .venv
   .venv\Scripts\activate        # Windows  (use source .venv/bin/activate on macOS/Linux)
   pip install -r requirements.txt
   python app.py
   ```
3. Create a feature branch:
   ```bash
   git checkout -b feature/your-change
   ```

## Project layout

See **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**. In short:

- `app.py` — Flask routes / orchestration
- `modules/` — preprocessor, analyzer, pcap_converter, llm, report
- `train_models.py` — model training pipeline
- `templates/` + `static/` — single-page frontend
- `models/` — trained artifacts
- `docs/` — documentation

## Guidelines

- **Match the surrounding style** — naming, comments, and structure of the file you're editing.
- **Keep the 80-feature schema intact.** The model features must match what `pcap_converter.py` emits — see [docs/ML-PIPELINE.md](docs/ML-PIPELINE.md).
- **Don't commit secrets or large data.** `config.json`, datasets, uploads, and `.venv` are gitignored — keep it that way.
- **Test both modes** when touching analysis/reporting: a *labeled* CSV (has a `Label` column) and an *unlabeled* one.
- **Verify the app still runs** (`python app.py`) and the PDF/JSON exports work before opening a PR.

## Pull requests

1. Keep PRs focused and described clearly (what + why).
2. Reference any related issue.
3. Note how you tested the change.

## Reporting bugs / ideas

Open an issue with steps to reproduce (for bugs) or a short proposal (for features). For anything security-sensitive, see **[SECURITY.md](SECURITY.md)**.
