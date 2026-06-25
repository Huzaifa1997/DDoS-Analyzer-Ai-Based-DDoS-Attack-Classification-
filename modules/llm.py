"""
Groq LLM integration for context-aware security recommendations.

Uses Groq's OpenAI-compatible Chat Completions API — llama-3.3-70b-versatile.
Requires no third-party deps (uses urllib stdlib).
"""

import json
import urllib.request
import urllib.error


class LLMError(Exception):
    pass


GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_MODEL = "llama-3.3-70b-versatile"


def _attack_context(analysis: dict) -> str:
    """Summarise the observed attack so the LLM can tailor concrete mitigations."""
    intel = analysis.get("traffic_intel") or {}
    lines = []
    pd = intel.get("protocol_dist")
    if pd:
        lines.append(f"- DDoS protocol mix: TCP={pd.get('TCP', 0)}, "
                     f"UDP={pd.get('UDP', 0)}, Other={pd.get('Other', 0)}")
    tdp = intel.get("top_dst_ports")
    if tdp:
        ports = ", ".join(f"{p['port']} ({p.get('service', '?')}) x{p['count']}"
                          for p in tdp[:6])
        lines.append(f"- Top targeted destination ports: {ports}")
    tsp = intel.get("top_src_ports")
    if tsp:
        sp = ", ".join(f"{p['port']} x{p['count']}" for p in tsp[:5])
        lines.append(f"- Top source ports (possible reflection/amplification): {sp}")
    pps = intel.get("packets_per_sec_avg")
    if pps and pps.get("ddos") is not None:
        lines.append(f"- Avg packet rate: DDoS {pps['ddos']:.0f}/s vs "
                     f"benign {pps.get('benign') or 0:.0f}/s")
    return "\n".join(lines) if lines else "- No detailed protocol/port breakdown available."


def _prompt(analysis: dict) -> str:
    pct = analysis.get('ddos_percent', 0)
    level = ('critical' if pct >= 50 else 'high' if pct >= 20
             else 'medium' if pct >= 5 else 'low')
    return (
        f"You are a senior network-security / SOC engineer. A DDoS analysis of captured "
        f"network flows found: {analysis.get('total_records', 0):,} flows, "
        f"{analysis.get('ddos_count', 0):,} classified DDoS ({pct}%), "
        f"{analysis.get('benign_count', 0):,} normal. Threat level: {level}.\n\n"
        f"Observed attack characteristics:\n{_attack_context(analysis)}\n\n"
        f"Return ONLY a JSON object: {{\"recommendations\": [ exactly 5 objects ]}}.\n"
        f"Every recommendation MUST be SPECIFIC and ACTIONABLE for THIS attack — tailored to the "
        f"protocol(s) and ports above. Give concrete defensive mitigations such as: exact "
        f"iptables/nftables rules, rate-limiting (iptables hashlimit/connlimit, nginx limit_req), "
        f"sysctl hardening (e.g. SYN cookies, rp_filter), blocking or rate-limiting the specific "
        f"targeted ports / amplification services, dropping spoofed or malformed packets, and "
        f"upstream/ISP blackhole or cloud-scrubbing/WAF actions. Do NOT give vague advice like "
        f"'deploy an IDS' or 'monitor traffic'.\n"
        f"Each object: {{\"type\":\"danger|warning|success|info\","
        f"\"icon\":\"<fontawesome6 solid name, no fa- prefix>\","
        f"\"title\":\"<max 8 words>\","
        f"\"text\":\"<1-2 sentences: the action and why it counters this attack>\","
        f"\"command\":\"<ONE concrete CLI command or single config line that applies it, "
        f"e.g. an iptables rule; empty string if truly not applicable>\"}}. "
        f"No markdown, no code fences."
    )


def _call_groq(prompt: str, api_key: str, timeout: int = 25) -> str:
    body = json.dumps({
        "model": GROQ_MODEL,
        "messages": [
            {"role": "system",
             "content": "You are a network-security assistant. Output only raw JSON, "
                        "no prose, no markdown."},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.45,
        "max_tokens": 1500,
        "response_format": {"type": "json_object"},
    }).encode("utf-8")

    req = urllib.request.Request(
        GROQ_URL,
        data=body,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
            # Groq sits behind Cloudflare, which blocks the default urllib
            # User-Agent (HTTP 403, error 1010). A normal UA gets through.
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) DDoS-Analyzer/2.0",
            "Accept": "application/json",
        },
    )

    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            data = json.loads(r.read())
    except urllib.error.HTTPError as e:
        msg = e.read().decode("utf-8", "ignore")[:400]
        raise LLMError(f"HTTP {e.code}: {msg}") from e
    except urllib.error.URLError as e:
        raise LLMError(f"Network: {e.reason}") from e
    except Exception as e:
        raise LLMError(f"Unexpected: {e}") from e

    try:
        return data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as e:
        raise LLMError(f"Unexpected Groq response shape: {data}") from e


# Font Awesome 6 Free solid icons that we know render — used to filter LLM picks.
SAFE_ICONS = {
    # security / shield
    "shield-halved", "shield", "shield-virus", "shield-heart",
    # threats
    "triangle-exclamation", "circle-exclamation", "skull-crossbones",
    "skull", "fire", "fire-flame-curved", "bomb", "virus", "bug",
    "biohazard", "radiation",
    # network / infra
    "network-wired", "sitemap", "server", "database", "cloud",
    "tower-broadcast", "satellite-dish", "globe",
    # auth / access
    "lock", "unlock", "key", "user-shield", "user-secret", "fingerprint",
    # action / status
    "bolt", "gauge-high", "magnifying-glass-chart", "chart-line",
    "chart-column", "chart-pie", "eye", "eye-slash", "bell", "bell-slash",
    "ban", "circle-stop", "play", "pause",
    # info / misc
    "circle-info", "circle-check", "circle-xmark", "circle-question",
    "list-check", "clipboard-list", "clipboard-check",
    "gears", "gear", "arrows-rotate", "rotate", "filter",
    "wand-sparkles", "scale-balanced", "robot", "sparkles",
}

ICON_FALLBACK = {
    "danger":  "shield-halved",
    "warning": "triangle-exclamation",
    "success": "circle-check",
    "info":    "circle-info",
}


def _parse_recs(text: str) -> list:
    text = (text or "").strip()
    # strip optional markdown code fences
    if text.startswith("```"):
        lines = text.split("\n")
        if lines and lines[-1].strip().startswith("```"):
            lines = lines[:-1]
        text = "\n".join(lines[1:]).strip()

    try:
        items = json.loads(text)
    except json.JSONDecodeError as e:
        raise LLMError(f"Invalid JSON from LLM: {e}") from e

    # json_object mode returns an object → pull out the recommendations array
    if isinstance(items, dict):
        if isinstance(items.get("recommendations"), list):
            items = items["recommendations"]
        else:
            lists = [v for v in items.values() if isinstance(v, list)]
            items = lists[0] if lists else []

    if not isinstance(items, list):
        raise LLMError("LLM did not return an array")

    cleaned = []
    valid_types = {"danger", "warning", "success", "info"}
    for item in items[:8]:
        if not isinstance(item, dict):
            continue
        t = str(item.get("type", "info")).lower()
        if t not in valid_types:
            t = "info"
        icon = str(item.get("icon", "")).strip().lower()
        if icon.startswith("fa-"):
            icon = icon[3:]
        if icon not in SAFE_ICONS:
            icon = ICON_FALLBACK[t]
        cmd = str(item.get("command", "")).strip()
        # guard against the model wrapping the command in code fences
        if cmd.startswith("`"):
            cmd = cmd.strip("`").strip()
        cleaned.append({
            "type":    t,
            "icon":    f"fa-{icon}",
            "title":   str(item.get("title", "")).strip()[:80],
            "text":    str(item.get("text", "")).strip()[:400],
            "command": cmd[:300],
        })
    if not cleaned:
        raise LLMError("LLM returned no usable items")
    return cleaned


def generate_llm_recommendations(analysis: dict, api_key: str) -> list:
    raw = _call_groq(_prompt(analysis), api_key)
    return _parse_recs(raw)
