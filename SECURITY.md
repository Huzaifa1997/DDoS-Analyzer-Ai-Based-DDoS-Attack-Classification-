# Security Policy

## Scope & intended use

DDoS Analyzer is an **educational / research tool for defensive security analysis** of network traffic you are **authorized** to inspect. It is **not** a production IDS/IPS. The mitigation commands it suggests (firewall rules, rate limits, sysctl changes) should be **reviewed and tested** before being applied to any live system.

## Data handling

- All traffic analysis runs **locally**. Uploaded files are processed in memory and temporary files under `uploads/` are deleted after each request.
- The **only** optional outbound request is to the Groq API for AI recommendations, and it sends **aggregate statistics only** (flow counts, protocol mix, top ports) — never raw flow data or packet contents.
- API keys live in `config.json` (gitignored) or the `GROQ_API_KEY` environment variable and are never committed or transmitted anywhere except the Groq API.

## Reporting a vulnerability

If you find a security issue (e.g. an upload-handling flaw, a path-traversal, or a way the app could leak data), please **do not open a public issue**. Instead, email the maintainer:

- **huzaifazahid.aps@gmail.com**

Include steps to reproduce and the potential impact. You'll get an acknowledgement, and fixes will be coordinated before any public disclosure.

## Hardening notes for deployment

If you deploy this beyond local use:

- Disable Flask debug mode (`app.run(debug=True)` → off) and serve via a production WSGI server (gunicorn / waitress) behind a reverse proxy.
- Replace the single global `_last_result` with per-session state.
- Add authentication and enforce upload size/type limits at the proxy.
- Rotate any API key that has been shared or committed.
