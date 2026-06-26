import os
import json
import numpy as np
import pandas as pd
import joblib

from sklearn.metrics import (
    accuracy_score, precision_score, recall_score,
    f1_score, confusion_matrix
)

MODELS_DIR = "models"

# Well-known ports → service name (used for traffic-intelligence labelling).
KNOWN_PORTS = {
    80: "HTTP", 443: "HTTPS", 53: "DNS", 123: "NTP", 389: "LDAP",
    1900: "SSDP", 11211: "Memcached", 5353: "mDNS", 19: "CHARGEN",
    161: "SNMP", 3389: "RDP",
}


def load_models():
    rf = joblib.load(os.path.join(MODELS_DIR, "random_forest.pkl"))
    lr = joblib.load(os.path.join(MODELS_DIR, "logistic_regression.pkl"))
    le = joblib.load(os.path.join(MODELS_DIR, "label_encoder.pkl"))
    with open(os.path.join(MODELS_DIR, "training_meta.json")) as f:
        meta = json.load(f)
    return {"Random Forest": rf, "Logistic Regression": lr}, le, meta


def _top_ports(ddos_df, col, n):
    """Top-n ports (by flow count) among DDoS flows for the given column.
    Returns a list of {port, count, service} or None if the column is absent."""
    if ddos_df is None or col not in ddos_df.columns or len(ddos_df) == 0:
        return None
    ports = pd.to_numeric(ddos_df[col], errors="coerce").dropna()
    if len(ports) == 0:
        return None
    counts = ports.astype("int64").value_counts().head(n)
    return [
        {"port": int(port), "count": int(cnt),
         "service": KNOWN_PORTS.get(int(port), "Unknown")}
        for port, cnt in counts.items()
    ]


def extract_traffic_features(df, best_preds, benign_idx, ddos_idx):
    """Derive traffic-intelligence stats from the ORIGINAL (unscaled) dataframe
    and the per-flow predictions. Every field degrades gracefully to None if the
    needed column is missing; this function never raises."""
    intel = {
        "protocol_dist":       None,
        "top_dst_ports":       None,
        "top_src_ports":       None,
        "flow_duration_avg":   None,
        "packets_per_sec_avg": None,
    }
    if df is None or best_preds is None:
        return intel

    try:
        preds = np.asarray(best_preds)
        # predictions must be row-aligned with df; if not, skip rather than mislabel
        if len(preds) != len(df):
            return intel

        df = df.reset_index(drop=True)
        ddos_df   = df[preds == ddos_idx]
        benign_df = df[preds == benign_idx]

        # protocol distribution among predicted DDoS flows (TCP=6, UDP=17)
        if "Protocol" in df.columns:
            proto = pd.to_numeric(ddos_df["Protocol"], errors="coerce")
            tcp = int((proto == 6).sum())
            udp = int((proto == 17).sum())
            other = int(len(ddos_df) - tcp - udp)
            intel["protocol_dist"] = {"TCP": tcp, "UDP": udp, "Other": other}

        # top destination / source ports among DDoS flows
        intel["top_dst_ports"] = _top_ports(ddos_df, "Destination Port", 10)
        intel["top_src_ports"] = _top_ports(ddos_df, "Source Port", 5)

        # average flow duration: DDoS vs benign
        if "Flow Duration" in df.columns:
            dd = pd.to_numeric(ddos_df["Flow Duration"], errors="coerce").mean()
            bb = pd.to_numeric(benign_df["Flow Duration"], errors="coerce").mean()
            intel["flow_duration_avg"] = {
                "ddos":   round(float(dd), 2) if pd.notna(dd) else None,
                "benign": round(float(bb), 2) if pd.notna(bb) else None,
            }

        # average packets/second: DDoS vs benign
        if "Flow Packets/s" in df.columns:
            dd = (pd.to_numeric(ddos_df["Flow Packets/s"], errors="coerce")
                  .replace([np.inf, -np.inf], np.nan).mean())
            bb = (pd.to_numeric(benign_df["Flow Packets/s"], errors="coerce")
                  .replace([np.inf, -np.inf], np.nan).mean())
            intel["packets_per_sec_avg"] = {
                "ddos":   round(float(dd), 2) if pd.notna(dd) else None,
                "benign": round(float(bb), 2) if pd.notna(bb) else None,
            }
    except Exception:
        # traffic intel is best-effort; never let it break the analysis
        return intel

    return intel


def run_analysis(X_scaled, y_raw, le, df_original=None):
    """
    Run both models on X_scaled.

    LABELED mode  (y_raw has recognised labels): compute live accuracy / CM /
                  precision / recall / F1.
    UNLABELED mode (no Label column): metrics are NOT available — set to None
                  (never copy training-time metrics, which would be fake) and
                  surface traffic-intelligence stats instead.

    Returns a dict with per-model results, overall traffic counts, and
    traffic_intel (derived from df_original when provided).
    """
    models, le_trained, meta = load_models()

    # encode ground truth if present
    y_true = None
    X_eval = X_scaled
    if y_raw is not None:
        known = set(le_trained.classes_)
        y_true_all = np.array([
            le_trained.transform([lbl])[0] if lbl in known else -1
            for lbl in y_raw
        ])
        valid_mask = y_true_all != -1
        if valid_mask.any():
            X_eval = X_scaled[valid_mask]
            y_true = y_true_all[valid_mask]
        # labels present but none recognised → treat as unlabeled (y_true stays None)

    has_live = y_true is not None and len(y_true) > 0

    results = []
    all_preds = {}

    for name, clf in models.items():
        y_pred = clf.predict(X_scaled)
        all_preds[name] = y_pred

        if has_live:
            y_pred_eval = clf.predict(X_eval)
            acc  = accuracy_score(y_true, y_pred_eval)
            prec = precision_score(y_true, y_pred_eval,
                                   average="weighted", zero_division=0)
            rec  = recall_score(y_true, y_pred_eval,
                                average="weighted", zero_division=0)
            f1   = f1_score(y_true, y_pred_eval,
                            average="weighted", zero_division=0)
            # pass all known label indices so the matrix is always 2x2,
            # even when the uploaded file contains a single class
            cm   = confusion_matrix(
                y_true, y_pred_eval,
                labels=list(range(len(le_trained.classes_)))
            ).tolist()
            metrics_source = "live"
        else:
            # NO ground truth — metrics genuinely cannot be computed.
            # Do NOT fall back to training_meta (that would be a fake number).
            acc, prec, rec, f1 = None, None, None, None
            cm = None
            metrics_source = "none"

        results.append({
            "name":             name,
            "accuracy":         round(float(acc)  * 100, 2) if acc  is not None else None,
            "precision":        round(float(prec) * 100, 2) if prec is not None else None,
            "recall":           round(float(rec)  * 100, 2) if rec  is not None else None,
            "f1_score":         round(float(f1)   * 100, 2) if f1   is not None else None,
            "confusion_matrix": cm,
            "metrics_source":   metrics_source,
        })

    # use best model's predictions for traffic counts
    best_name  = meta["best_model"]
    best_preds = all_preds.get(best_name, list(all_preds.values())[0])

    classes      = le_trained.classes_   # ['BENIGN', 'DDoS']
    benign_idx   = list(classes).index("BENIGN") if "BENIGN" in classes else 0
    ddos_idx     = 1 - benign_idx

    benign_count = int(np.sum(best_preds == benign_idx))
    ddos_count   = int(np.sum(best_preds == ddos_idx))
    total        = len(best_preds)

    benign_pct = round(benign_count / total * 100, 2) if total else 0
    ddos_pct   = round(ddos_count   / total * 100, 2) if total else 0

    best_result   = next((r for r in results if r["name"] == best_name), results[0])
    best_accuracy = best_result["accuracy"]   # None when unlabeled

    traffic_intel = extract_traffic_features(df_original, best_preds, benign_idx, ddos_idx)

    return {
        "total_records":    total,
        "benign_count":     benign_count,
        "ddos_count":       ddos_count,
        "benign_percent":   benign_pct,
        "ddos_percent":     ddos_pct,
        "best_model":       best_name,
        "best_accuracy":    best_accuracy,
        "models":           results,
        "has_ground_truth": has_live,
        "traffic_intel":    traffic_intel,
    }


# UDP amplification/reflection services keyed by port.
_AMP_SERVICES = {53: "DNS", 123: "NTP", 1900: "SSDP", 11211: "Memcached",
                 19: "CHARGEN", 389: "LDAP", 161: "SNMP", 5353: "mDNS", 17: "QOTD"}


def build_recommendations(analysis):
    """Concrete, attack-tailored defensive recommendations (rule-based baseline,
    also used as the LLM fallback). Each item may carry a `command` — an exact
    CLI rule / config line the operator can apply."""
    recs = []
    ddos_pct = analysis.get("ddos_percent", 0) or 0
    intel = analysis.get("traffic_intel") or {}
    pd = intel.get("protocol_dist") or {}
    tdp = intel.get("top_dst_ports") or []
    tcp, udp = int(pd.get("TCP", 0)), int(pd.get("UDP", 0))
    top_port = int(tdp[0]["port"]) if tdp else None
    top_svc = tdp[0].get("service", "Unknown") if tdp else None

    # 1. severity headline + edge hardening
    if ddos_pct > 50:
        recs.append({
            "type": "danger", "icon": "fa-skull-crossbones",
            "title": "Critical DDoS — Activate Mitigation",
            "text": f"{ddos_pct:.1f}% of traffic is malicious. Engage upstream/ISP blackhole "
                    f"or cloud scrubbing for the targeted IP and drop invalid packets at the edge.",
            "command": "iptables -A INPUT -m conntrack --ctstate INVALID -j DROP",
        })
    elif ddos_pct > 20:
        recs.append({
            "type": "warning", "icon": "fa-fire",
            "title": "Elevated DDoS — Rate-Limit Now",
            "text": f"{ddos_pct:.1f}% DDoS detected. Drop malformed packets and prepare "
                    f"upstream scrubbing before volume grows.",
            "command": "iptables -A INPUT -m conntrack --ctstate INVALID -j DROP",
        })
    else:
        recs.append({
            "type": "success", "icon": "fa-shield-halved",
            "title": "Low Threat — Maintain Hardening",
            "text": f"Only {ddos_pct:.1f}% DDoS. Keep baseline edge hardening and per-IP "
                    f"connection limits in place as a precaution.",
            "command": "",
        })

    # 2. protocol-specific mitigation
    if udp >= tcp and udp > 0:
        recs.append({
            "type": "danger", "icon": "fa-bolt",
            "title": "Throttle UDP Flood (per-source)",
            "text": "UDP dominates this attack. Rate-limit UDP per source IP and drop bursts "
                    "above threshold at the firewall.",
            "command": "iptables -A INPUT -p udp -m hashlimit --hashlimit-name udpflood "
                       "--hashlimit-above 200/sec --hashlimit-mode srcip -j DROP",
        })
    elif tcp > 0:
        recs.append({
            "type": "danger", "icon": "fa-bolt",
            "title": "Mitigate SYN Flood",
            "text": "TCP attack traffic indicates a SYN flood. Enable SYN cookies and "
                    "rate-limit new half-open connections.",
            "command": "sysctl -w net.ipv4.tcp_syncookies=1 && iptables -A INPUT -p tcp --syn "
                       "-m limit --limit 2/s --limit-burst 5 -j ACCEPT",
        })

    # 3. targeted-port specific (amplification vs generic)
    if top_port is not None:
        if top_port in _AMP_SERVICES:
            svc = _AMP_SERVICES[top_port]
            recs.append({
                "type": "warning", "icon": "fa-tower-broadcast",
                "title": f"Block {svc} Amplification (port {top_port})",
                "text": f"Port {top_port} ({svc}) is the top target — a classic reflection/"
                        f"amplification vector. Strictly rate-limit or block it from untrusted sources.",
                "command": f"iptables -A INPUT -p udp --dport {top_port} -m hashlimit "
                           f"--hashlimit-name amp{top_port} --hashlimit-above 50/sec -j DROP",
            })
        else:
            recs.append({
                "type": "warning", "icon": "fa-network-wired",
                "title": f"Protect Targeted Port {top_port}",
                "text": f"Port {top_port} ({top_svc}) receives the most DDoS flows. Cap "
                        f"concurrent connections per source IP to this port.",
                "command": f"iptables -A INPUT -p tcp --dport {top_port} -m connlimit "
                           f"--connlimit-above 50 --connlimit-mask 32 -j DROP",
            })

    # 4. application-layer rate limiting
    recs.append({
        "type": "info", "icon": "fa-gauge-high",
        "title": "Application-Layer Rate Limiting",
        "text": "Add per-client request rate limits at the reverse proxy to absorb HTTP-layer floods.",
        "command": "limit_req_zone $binary_remote_addr zone=ddos:10m rate=10r/s;   # nginx",
    })

    # 5. anti-spoofing (BCP38)
    recs.append({
        "type": "info", "icon": "fa-user-shield",
        "title": "Enable Anti-Spoofing (rp_filter)",
        "text": "Turn on reverse-path filtering to drop spoofed source addresses commonly "
                "used in reflection attacks.",
        "command": "sysctl -w net.ipv4.conf.all.rp_filter=1",
    })

    return recs[:6]
