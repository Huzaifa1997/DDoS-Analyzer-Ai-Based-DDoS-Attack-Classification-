"""
PCAP → CIC-DDoS2019 CSV converter.

This is a self-contained re-implementation of the subset of CICFlowMeter's
flow-feature extraction we need to feed our trained models. It only depends
on scapy + numpy + pandas (no Java, no buggy CLIs).

A "flow" is identified by the canonical 5-tuple (src_ip, src_port, dst_ip,
dst_port, protocol). Packets in the reverse direction are tracked as
"backward". Flows terminate on TCP FIN/RST or after FLOW_TIMEOUT seconds of
inactivity.
"""

import os
import numpy as np
import pandas as pd
from scapy.all import PcapReader, IP, TCP, UDP


# Defaults that match the Java CICFlowMeter (the tool used to build CIC-DDoS2019)
FLOW_TIMEOUT   = 120.0   # seconds — idle gap that terminates a flow
ACTIVE_TIMEOUT = 5.0     # seconds — gap that ends an "active" period
CLUMP_TIMEOUT  = 1.0     # seconds — max gap within a bulk transfer
BULK_BOUND     = 4       # min consecutive payload packets to count as bulk

# Final column order, exactly as the trained model expects
CIC_COLUMNS = [
    "Source IP", "Destination IP", "Timestamp",   # extras for human inspection (ignored by preprocessor)
    "Source Port", "Destination Port", "Protocol", "Flow Duration",
    "Total Fwd Packets", "Total Backward Packets",
    "Total Length of Fwd Packets", "Total Length of Bwd Packets",
    "Fwd Packet Length Max", "Fwd Packet Length Min",
    "Fwd Packet Length Mean", "Fwd Packet Length Std",
    "Bwd Packet Length Max", "Bwd Packet Length Min",
    "Bwd Packet Length Mean", "Bwd Packet Length Std",
    "Flow Bytes/s", "Flow Packets/s",
    "Flow IAT Mean", "Flow IAT Std", "Flow IAT Max", "Flow IAT Min",
    "Fwd IAT Total", "Fwd IAT Mean", "Fwd IAT Std", "Fwd IAT Max", "Fwd IAT Min",
    "Bwd IAT Total", "Bwd IAT Mean", "Bwd IAT Std", "Bwd IAT Max", "Bwd IAT Min",
    "Fwd PSH Flags", "Bwd PSH Flags", "Fwd URG Flags", "Bwd URG Flags",
    "Fwd Header Length", "Bwd Header Length",
    "Fwd Packets/s", "Bwd Packets/s",
    "Min Packet Length", "Max Packet Length",
    "Packet Length Mean", "Packet Length Std", "Packet Length Variance",
    "FIN Flag Count", "SYN Flag Count", "RST Flag Count", "PSH Flag Count",
    "ACK Flag Count", "URG Flag Count", "CWE Flag Count", "ECE Flag Count",
    "Down/Up Ratio", "Average Packet Size",
    "Avg Fwd Segment Size", "Avg Bwd Segment Size",
    "Fwd Header Length.1",
    "Fwd Avg Bytes/Bulk", "Fwd Avg Packets/Bulk", "Fwd Avg Bulk Rate",
    "Bwd Avg Bytes/Bulk", "Bwd Avg Packets/Bulk", "Bwd Avg Bulk Rate",
    "Subflow Fwd Packets", "Subflow Fwd Bytes",
    "Subflow Bwd Packets", "Subflow Bwd Bytes",
    "Init_Win_bytes_forward", "Init_Win_bytes_backward",
    "act_data_pkt_fwd", "min_seg_size_forward",
    "Active Mean", "Active Std", "Active Max", "Active Min",
    "Idle Mean", "Idle Std", "Idle Max", "Idle Min",
]


class PcapConversionError(Exception):
    pass


def is_pcap(filename: str) -> bool:
    return filename.lower().endswith((".pcap", ".pcapng", ".cap"))


# ── Flow object ───────────────────────────────────────────────────────────────

class _Flow:
    """A single network flow keyed by its canonical forward 5-tuple."""

    __slots__ = (
        "src_ip", "src_port", "dst_ip", "dst_port", "protocol",
        "fwd", "bwd", "start_ts", "last_ts",
        "fwd_init_win", "bwd_init_win",
    )

    def __init__(self, src_ip, src_port, dst_ip, dst_port, protocol, first_ts):
        self.src_ip   = src_ip
        self.src_port = src_port
        self.dst_ip   = dst_ip
        self.dst_port = dst_port
        self.protocol = protocol
        # Per-direction packet records: (ts, total_len, header_len, payload_len, flags, window)
        self.fwd: list = []
        self.bwd: list = []
        self.start_ts = first_ts
        self.last_ts  = first_ts
        self.fwd_init_win = -1
        self.bwd_init_win = -1

    def add(self, ts, total_len, header_len, payload_len, flags, window, direction):
        rec = (ts, total_len, header_len, payload_len, flags, window)
        if direction == "fwd":
            self.fwd.append(rec)
            if self.fwd_init_win == -1:
                self.fwd_init_win = window
        else:
            self.bwd.append(rec)
            if self.bwd_init_win == -1:
                self.bwd_init_win = window
        if ts > self.last_ts:
            self.last_ts = ts


# ── Statistics helpers ────────────────────────────────────────────────────────

def _stats(values):
    """total / max / min / mean / std (population) / var for a numeric list."""
    if not values:
        return (0.0, 0.0, 0.0, 0.0, 0.0, 0.0)
    a = np.asarray(values, dtype=float)
    return (float(a.sum()), float(a.max()), float(a.min()),
            float(a.mean()), float(a.std()), float(a.var()))


def _bulk_stats(direction_packets):
    """
    Compute (bytes_per_bulk_avg, packets_per_bulk_avg, bulk_rate_avg)
    for one direction. A 'bulk' is BULK_BOUND+ consecutive payload-bearing
    packets where each gap < CLUMP_TIMEOUT.
    """
    payload_pkts = [(p[0], p[3]) for p in direction_packets if p[3] > 0]
    if len(payload_pkts) < BULK_BOUND:
        return (0.0, 0.0, 0.0)

    bulk_byte_total = 0
    bulk_pkt_total  = 0
    bulk_duration   = 0.0
    bulk_count      = 0

    i = 0
    n = len(payload_pkts)
    while i < n:
        start_t = payload_pkts[i][0]
        last_t  = start_t
        size    = payload_pkts[i][1]
        count   = 1
        j = i + 1
        while j < n and (payload_pkts[j][0] - last_t) <= CLUMP_TIMEOUT:
            size  += payload_pkts[j][1]
            count += 1
            last_t = payload_pkts[j][0]
            j += 1
        if count >= BULK_BOUND:
            bulk_count      += 1
            bulk_pkt_total  += count
            bulk_byte_total += size
            bulk_duration   += (last_t - start_t)
            i = j
        else:
            i += 1

    if bulk_count == 0:
        return (0.0, 0.0, 0.0)
    bytes_avg = bulk_byte_total / bulk_count
    pkts_avg  = bulk_pkt_total  / bulk_count
    rate_avg  = (bulk_byte_total / bulk_duration) if bulk_duration > 0 else 0.0
    return (bytes_avg, pkts_avg, rate_avg)


# ── Feature extraction ────────────────────────────────────────────────────────

def _features(flow: _Flow) -> dict:
    fwd, bwd = flow.fwd, flow.bwd
    all_pkts = sorted(fwd + bwd, key=lambda r: r[0])

    n_fwd = len(fwd)
    n_bwd = len(bwd)
    n_all = len(all_pkts)

    duration_s  = flow.last_ts - flow.start_ts
    duration_us = duration_s * 1_000_000

    fwd_lens = [r[1] for r in fwd]
    bwd_lens = [r[1] for r in bwd]
    all_lens = [r[1] for r in all_pkts]

    fwd_hdr_total = sum(r[2] for r in fwd)
    bwd_hdr_total = sum(r[2] for r in bwd)

    fwd_act_data  = sum(1 for r in fwd if r[3] > 0)
    fwd_min_seg   = min((r[2] for r in fwd), default=0)

    fwd_len_total = sum(fwd_lens)
    bwd_len_total = sum(bwd_lens)

    f_tot, f_max, f_min, f_mean, f_std, _    = _stats(fwd_lens)
    b_tot, b_max, b_min, b_mean, b_std, _    = _stats(bwd_lens)
    a_tot, a_max, a_min, a_mean, a_std, a_var = _stats(all_lens)

    # Inter-arrival times (microseconds)
    all_t = [r[0] for r in all_pkts]
    all_iat = [(all_t[i] - all_t[i - 1]) * 1_000_000 for i in range(1, n_all)]
    fwd_t = sorted(r[0] for r in fwd)
    fwd_iat = [(fwd_t[i] - fwd_t[i - 1]) * 1_000_000 for i in range(1, n_fwd)]
    bwd_t = sorted(r[0] for r in bwd)
    bwd_iat = [(bwd_t[i] - bwd_t[i - 1]) * 1_000_000 for i in range(1, n_bwd)]

    _, _, _, ai_mean, ai_std, _ = _stats(all_iat)
    fi_total, fi_max, fi_min, fi_mean, fi_std, _ = _stats(fwd_iat)
    bi_total, bi_max, bi_min, bi_mean, bi_std, _ = _stats(bwd_iat)
    # Flow IAT max/min
    ai_max = max(all_iat) if all_iat else 0.0
    ai_min = min(all_iat) if all_iat else 0.0

    # Active / Idle periods (microseconds)
    active_periods, idle_periods = [], []
    if n_all > 1:
        start_active = all_t[0]
        last_active  = all_t[0]
        for t in all_t[1:]:
            if t - last_active > ACTIVE_TIMEOUT:
                if last_active > start_active:
                    active_periods.append((last_active - start_active) * 1_000_000)
                idle_periods.append((t - last_active) * 1_000_000)
                start_active = t
            last_active = t
        if last_active > start_active:
            active_periods.append((last_active - start_active) * 1_000_000)
    _, act_max, act_min, act_mean, act_std, _ = _stats(active_periods)
    _, idl_max, idl_min, idl_mean, idl_std, _ = _stats(idle_periods)

    fwd_bulk_b, fwd_bulk_p, fwd_bulk_r = _bulk_stats(fwd)
    bwd_bulk_b, bwd_bulk_p, bwd_bulk_r = _bulk_stats(bwd)

    fwd_psh = sum(1 for r in fwd if r[4] & 0x08)
    bwd_psh = sum(1 for r in bwd if r[4] & 0x08)
    fwd_urg = sum(1 for r in fwd if r[4] & 0x20)
    bwd_urg = sum(1 for r in bwd if r[4] & 0x20)

    flags_all = [r[4] for r in all_pkts]
    fin_cnt = sum(1 for f in flags_all if f & 0x01)
    syn_cnt = sum(1 for f in flags_all if f & 0x02)
    rst_cnt = sum(1 for f in flags_all if f & 0x04)
    psh_cnt = sum(1 for f in flags_all if f & 0x08)
    ack_cnt = sum(1 for f in flags_all if f & 0x10)
    urg_cnt = sum(1 for f in flags_all if f & 0x20)
    ece_cnt = sum(1 for f in flags_all if f & 0x40)
    cwr_cnt = sum(1 for f in flags_all if f & 0x80)  # CIC column is "CWE" but actually counts CWR

    ds = duration_s if duration_s > 0 else 1e-6  # avoid divide-by-zero
    flow_bytes_s = (fwd_len_total + bwd_len_total) / ds
    flow_pkts_s  = n_all / ds
    fwd_pkts_s   = n_fwd / ds
    bwd_pkts_s   = n_bwd / ds

    down_up_ratio = (n_bwd / n_fwd) if n_fwd > 0 else 0
    avg_pkt_size  = (sum(all_lens) / n_all) if n_all > 0 else 0

    return {
        "Source IP":                    flow.src_ip,
        "Destination IP":               flow.dst_ip,
        "Timestamp":                    flow.start_ts,
        "Source Port":                  flow.src_port,
        "Destination Port":             flow.dst_port,
        "Protocol":                     flow.protocol,
        "Flow Duration":                duration_us,
        "Total Fwd Packets":            n_fwd,
        "Total Backward Packets":       n_bwd,
        "Total Length of Fwd Packets":  fwd_len_total,
        "Total Length of Bwd Packets":  bwd_len_total,
        "Fwd Packet Length Max":        f_max,
        "Fwd Packet Length Min":        f_min if n_fwd else 0,
        "Fwd Packet Length Mean":       f_mean,
        "Fwd Packet Length Std":        f_std,
        "Bwd Packet Length Max":        b_max,
        "Bwd Packet Length Min":        b_min if n_bwd else 0,
        "Bwd Packet Length Mean":       b_mean,
        "Bwd Packet Length Std":        b_std,
        "Flow Bytes/s":                 flow_bytes_s,
        "Flow Packets/s":               flow_pkts_s,
        "Flow IAT Mean":                ai_mean,
        "Flow IAT Std":                 ai_std,
        "Flow IAT Max":                 ai_max,
        "Flow IAT Min":                 ai_min,
        "Fwd IAT Total":                fi_total,
        "Fwd IAT Mean":                 fi_mean,
        "Fwd IAT Std":                  fi_std,
        "Fwd IAT Max":                  fi_max,
        "Fwd IAT Min":                  fi_min,
        "Bwd IAT Total":                bi_total,
        "Bwd IAT Mean":                 bi_mean,
        "Bwd IAT Std":                  bi_std,
        "Bwd IAT Max":                  bi_max,
        "Bwd IAT Min":                  bi_min,
        "Fwd PSH Flags":                fwd_psh,
        "Bwd PSH Flags":                bwd_psh,
        "Fwd URG Flags":                fwd_urg,
        "Bwd URG Flags":                bwd_urg,
        "Fwd Header Length":            fwd_hdr_total,
        "Bwd Header Length":            bwd_hdr_total,
        "Fwd Packets/s":                fwd_pkts_s,
        "Bwd Packets/s":                bwd_pkts_s,
        "Min Packet Length":            a_min,
        "Max Packet Length":            a_max,
        "Packet Length Mean":           a_mean,
        "Packet Length Std":            a_std,
        "Packet Length Variance":       a_var,
        "FIN Flag Count":               fin_cnt,
        "SYN Flag Count":               syn_cnt,
        "RST Flag Count":               rst_cnt,
        "PSH Flag Count":               psh_cnt,
        "ACK Flag Count":               ack_cnt,
        "URG Flag Count":               urg_cnt,
        "CWE Flag Count":               cwr_cnt,
        "ECE Flag Count":               ece_cnt,
        "Down/Up Ratio":                down_up_ratio,
        "Average Packet Size":          avg_pkt_size,
        "Avg Fwd Segment Size":         f_mean,
        "Avg Bwd Segment Size":         b_mean,
        "Fwd Header Length.1":          fwd_hdr_total,
        "Fwd Avg Bytes/Bulk":           fwd_bulk_b,
        "Fwd Avg Packets/Bulk":         fwd_bulk_p,
        "Fwd Avg Bulk Rate":            fwd_bulk_r,
        "Bwd Avg Bytes/Bulk":           bwd_bulk_b,
        "Bwd Avg Packets/Bulk":         bwd_bulk_p,
        "Bwd Avg Bulk Rate":            bwd_bulk_r,
        "Subflow Fwd Packets":          n_fwd,
        "Subflow Fwd Bytes":            fwd_len_total,
        "Subflow Bwd Packets":          n_bwd,
        "Subflow Bwd Bytes":            bwd_len_total,
        "Init_Win_bytes_forward":       max(flow.fwd_init_win, 0),
        "Init_Win_bytes_backward":      max(flow.bwd_init_win, 0),
        "act_data_pkt_fwd":             fwd_act_data,
        "min_seg_size_forward":         fwd_min_seg,
        "Active Mean":                  act_mean,
        "Active Std":                   act_std,
        "Active Max":                   act_max,
        "Active Min":                   act_min,
        "Idle Mean":                    idl_mean,
        "Idle Std":                     idl_std,
        "Idle Max":                     idl_max,
        "Idle Min":                     idl_min,
    }


# ── Driver ────────────────────────────────────────────────────────────────────

def _process_pcap(pcap_path: str) -> list:
    """Stream a PCAP file, build flows, return list of completed _Flow objects."""
    active = {}       # forward 5-tuple → _Flow
    completed = []

    with PcapReader(pcap_path) as reader:
        for pkt in reader:
            if IP not in pkt:
                continue
            ip = pkt[IP]
            if TCP in pkt:
                l4 = pkt[TCP]
                proto = 6
                flags = int(l4.flags)
                window = int(l4.window)
            elif UDP in pkt:
                l4 = pkt[UDP]
                proto = 17
                flags = 0
                window = 0
            else:
                continue

            ts = float(pkt.time)
            sport, dport = int(l4.sport), int(l4.dport)
            total_len    = len(pkt)
            payload_len  = len(l4.payload)
            header_len   = total_len - payload_len

            fwd_key = (ip.src, sport, ip.dst, dport, proto)
            rev_key = (ip.dst, dport, ip.src, sport, proto)

            if fwd_key in active:
                flow = active[fwd_key]
                if ts - flow.last_ts > FLOW_TIMEOUT:
                    completed.append(flow)
                    flow = _Flow(ip.src, sport, ip.dst, dport, proto, ts)
                    active[fwd_key] = flow
                flow.add(ts, total_len, header_len, payload_len, flags, window, "fwd")
                key = fwd_key
            elif rev_key in active:
                flow = active[rev_key]
                if ts - flow.last_ts > FLOW_TIMEOUT:
                    completed.append(flow)
                    # New flow — this packet defines a new forward direction
                    flow = _Flow(ip.src, sport, ip.dst, dport, proto, ts)
                    active[fwd_key] = flow
                    active.pop(rev_key, None)
                    flow.add(ts, total_len, header_len, payload_len, flags, window, "fwd")
                    key = fwd_key
                else:
                    flow.add(ts, total_len, header_len, payload_len, flags, window, "bwd")
                    key = rev_key
            else:
                flow = _Flow(ip.src, sport, ip.dst, dport, proto, ts)
                active[fwd_key] = flow
                flow.add(ts, total_len, header_len, payload_len, flags, window, "fwd")
                key = fwd_key

            # TCP FIN or RST → terminate this flow
            if proto == 6 and (flags & 0x01 or flags & 0x04):
                completed.append(active.pop(key, flow))

    # Capture finished — flush remaining
    completed.extend(active.values())
    return completed


def convert_pcap_to_csv(pcap_path: str, csv_path: str) -> dict:
    """Extract flows from a PCAP and write a CIC-DDoS2019-compatible CSV.

    Returns: {"flows": N, "columns": M}
    Raises:  PcapConversionError on any failure.
    """
    if not os.path.exists(pcap_path):
        raise PcapConversionError(f"PCAP not found: {pcap_path}")
    if os.path.getsize(pcap_path) == 0:
        raise PcapConversionError("PCAP file is empty")

    try:
        flows = _process_pcap(pcap_path)
    except Exception as e:
        raise PcapConversionError(f"PCAP parsing failed: {e}") from e

    if not flows:
        raise PcapConversionError("No TCP/UDP flows found in PCAP")

    rows = [_features(f) for f in flows]
    df = pd.DataFrame(rows, columns=CIC_COLUMNS)
    df.to_csv(csv_path, index=False)

    return {"flows": len(df), "columns": len(df.columns)}
