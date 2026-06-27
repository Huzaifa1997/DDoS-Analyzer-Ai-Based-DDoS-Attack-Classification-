# Gunicorn config — auto-loaded by `gunicorn app:app` (Render's start command).
#
# CIC-DDoS CSV/PCAP uploads can be large, and model inference over many flows
# can take longer than gunicorn's default 30s worker timeout. When that limit
# is hit the worker is killed mid-request and the browser sees a 502 with a
# non-JSON body. Give analysis requests more headroom.
import os

# Honour Render's WEB_CONCURRENCY (defaults to 1 on the free tier to fit memory).
workers = int(os.environ.get("WEB_CONCURRENCY", "1"))

# Allow up to 2 minutes per request before a worker is recycled.
timeout = 120
graceful_timeout = 30
keepalive = 5
