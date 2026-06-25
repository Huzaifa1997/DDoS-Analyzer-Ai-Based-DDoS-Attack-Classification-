"""
DDoS Analyzer — Flask Backend
Run with:  python app.py
Then open: http://127.0.0.1:5000
"""

import io
import os
import json
import uuid
import pandas as pd
from flask import (
    Flask, render_template, request, jsonify,
    send_file, send_from_directory, abort
)
from werkzeug.utils import secure_filename

from modules.preprocessor import load_artifacts, preprocess_uploaded
from modules.analyzer import run_analysis, build_recommendations
from modules.report import generate_pdf
from modules.llm import generate_llm_recommendations, LLMError
from modules.pcap_converter import convert_pcap_to_csv, is_pcap, PcapConversionError

app = Flask(__name__)
app.config["UPLOAD_FOLDER"] = "uploads"
app.config["MAX_CONTENT_LENGTH"] = 500 * 1024 * 1024   # 500 MB

ALLOWED_EXT = {"csv", "pcap", "pcapng", "cap"}
os.makedirs("uploads", exist_ok=True)

CONFIG_PATH = "config.json"

_last_result: dict = {}


def allowed_file(filename):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXT


# ── Settings / config ─────────────────────────────────────────────────────────

def load_config() -> dict:
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}
    return {}


def save_config(cfg: dict):
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2)


def get_groq_key() -> str:
    return (os.environ.get("GROQ_API_KEY")
            or load_config().get("groq_api_key", "")
            or "").strip()


# ── Pages ────────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html")


# ── Analysis API ─────────────────────────────────────────────────────────────

@app.route("/analyze", methods=["POST"])
def analyze():
    if "file" not in request.files:
        return jsonify({"success": False, "error": "No file uploaded."}), 400

    f = request.files["file"]
    if f.filename == "" or not allowed_file(f.filename):
        return jsonify({"success": False, "error": "Supported formats: CSV, PCAP, PCAPNG."}), 400

    filename = secure_filename(f.filename)
    uid = uuid.uuid4().hex[:8]
    save_path = os.path.join(app.config["UPLOAD_FOLDER"], f"{uid}_{filename}")
    f.save(save_path)
    original_size_mb = round(os.path.getsize(save_path) / (1024 * 1024), 2)

    # Track auxiliary file for cleanup (the converted CSV when input is PCAP)
    csv_path        = save_path
    pcap_path       = None
    converted_from  = None
    converted_flows = None

    try:
        if is_pcap(filename):
            pcap_path = save_path
            csv_path = os.path.join(app.config["UPLOAD_FOLDER"], f"{uid}_{filename}.csv")
            try:
                stats = convert_pcap_to_csv(pcap_path, csv_path)
            except PcapConversionError as e:
                return jsonify({"success": False, "error": f"PCAP conversion failed: {e}"}), 400
            converted_from  = filename
            converted_flows = stats.get("flows")
            filename = filename + ".csv"

        scaler, label_enc, feature_cols = load_artifacts()
        df = pd.read_csv(csv_path, encoding="utf-8", low_memory=False)
        total_raw = len(df)

        # Reported size: converted CSV if PCAP, else original
        file_size_mb = round(os.path.getsize(csv_path) / (1024 * 1024), 2) if converted_from else original_size_mb

        X_scaled, y_raw, missing_count = preprocess_uploaded(df, feature_cols, scaler)
        # preprocess_uploaded strips column names and drops duplicate rows IN PLACE,
        # so `df` is now row-aligned with X_scaled (and the predictions) while still
        # carrying the original Protocol / port / Flow Duration columns needed for
        # traffic-feature extraction.
        df_original = df.reset_index(drop=True)
        analysis = run_analysis(X_scaled, y_raw, label_enc, df_original)
        analysis["filename"]         = filename
        analysis["file_size_mb"]     = file_size_mb
        analysis["total_raw"]        = total_raw
        analysis["missing_features"] = missing_count
        if converted_from:
            analysis["converted_from"]  = converted_from
            analysis["converted_flows"] = converted_flows
            analysis["original_size_mb"] = original_size_mb

        # Rule-based recommendations as a safe immediate baseline
        analysis["recommendations"] = build_recommendations(analysis)

        if analysis["has_ground_truth"]:
            summary = (
                f"Analysed {analysis['total_records']:,} records from '{filename}'. "
                f"Detected {analysis['ddos_count']:,} DDoS flows "
                f"({analysis['ddos_percent']}%) and "
                f"{analysis['benign_count']:,} normal flows "
                f"({analysis['benign_percent']}%). "
                f"Best model: {analysis['best_model']} "
                f"({analysis['best_accuracy']}% accuracy on labeled data)."
            )
        else:
            summary = (
                f"Analysed {analysis['total_records']:,} records from '{filename}'. "
                f"Predicted {analysis['ddos_count']:,} DDoS flows "
                f"({analysis['ddos_percent']}%) and "
                f"{analysis['benign_count']:,} normal flows "
                f"({analysis['benign_percent']}%). "
                f"No Label column — accuracy metrics not available."
            )
        analysis["summary"] = summary

        global _last_result
        _last_result = analysis
        return jsonify({"success": True, **analysis})

    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

    finally:
        for p in (save_path, csv_path if csv_path != save_path else None):
            if not p:
                continue
            try:
                os.remove(p)
            except OSError:
                pass


@app.route("/api/recommendations", methods=["POST"])
def recommendations_api():
    """Return LLM-generated recommendations, with rule-based fallback.

    Caches a successful LLM result on _last_result so repeated calls for the
    same analysis don't burn API quota.
    """
    payload = request.get_json(silent=True) or {}
    if not payload and _last_result:
        payload = _last_result

    if not payload.get("total_records"):
        return jsonify({"source": "static", "recommendations": []})

    # Serve cached LLM result if this is the same analysis we already enriched
    if (_last_result
            and _last_result.get("_llm_source") == "groq"
            and _last_result.get("filename") == payload.get("filename")
            and _last_result.get("total_records") == payload.get("total_records")):
        return jsonify({
            "source": "groq",
            "recommendations": _last_result.get("recommendations", []),
            "cached": True,
        })

    api_key = get_groq_key()
    if not api_key:
        return jsonify({
            "source": "static",
            "recommendations": build_recommendations(payload),
            "note": "Set a Groq API key in Settings to enable AI-generated recommendations.",
        })

    try:
        recs = generate_llm_recommendations(payload, api_key)
        if _last_result:
            _last_result["recommendations"] = recs
            _last_result["_llm_source"]     = "groq"
        return jsonify({"source": "groq", "recommendations": recs})
    except LLMError as e:
        return jsonify({
            "source": "static",
            "recommendations": build_recommendations(payload),
            "warning": f"LLM unavailable ({e}). Showing rule-based recommendations.",
        })
    except Exception as e:
        return jsonify({
            "source": "static",
            "recommendations": build_recommendations(payload),
            "warning": f"LLM error: {str(e)}",
        })


@app.route("/api/settings", methods=["GET", "POST"])
def settings_api():
    if request.method == "GET":
        cfg = load_config()
        has_env_key  = bool(os.environ.get("GROQ_API_KEY"))
        has_file_key = bool(cfg.get("groq_api_key"))
        return jsonify({
            "has_key":     has_env_key or has_file_key,
            "from_env":    has_env_key,
        })

    body = request.get_json(silent=True) or {}
    cfg = load_config()
    if "groq_api_key" in body:
        key = (body.get("groq_api_key") or "").strip()
        if key:
            cfg["groq_api_key"] = key
        else:
            cfg.pop("groq_api_key", None)
    save_config(cfg)
    return jsonify({"success": True, "has_key": bool(cfg.get("groq_api_key"))})


# ── Export ───────────────────────────────────────────────────────────────────

@app.route("/convert/pcap-to-csv", methods=["POST"])
def convert_pcap_endpoint():
    """Standalone utility: PCAP upload → CSV download. No analysis run."""
    if "file" not in request.files:
        return jsonify({"success": False, "error": "No file uploaded."}), 400

    f = request.files["file"]
    if not f.filename or not is_pcap(f.filename):
        return jsonify({"success": False, "error": "Only PCAP / PCAPNG files."}), 400

    filename = secure_filename(f.filename)
    uid = uuid.uuid4().hex[:8]
    pcap_path = os.path.join(app.config["UPLOAD_FOLDER"], f"{uid}_{filename}")
    csv_path  = pcap_path + ".csv"
    f.save(pcap_path)

    try:
        try:
            convert_pcap_to_csv(pcap_path, csv_path)
        except PcapConversionError as e:
            return jsonify({"success": False, "error": str(e)}), 400

        with open(csv_path, "rb") as fh:
            data = fh.read()

        download_name = os.path.splitext(filename)[0] + "_flows.csv"
        return send_file(
            io.BytesIO(data),
            mimetype="text/csv",
            as_attachment=True,
            download_name=download_name,
        )
    finally:
        for p in (pcap_path, csv_path):
            try:
                os.remove(p)
            except OSError:
                pass


@app.route("/export/json")
def export_json():
    if not _last_result:
        abort(404)
    resp = app.response_class(
        response=json.dumps(_last_result, indent=2),
        status=200,
        mimetype="application/json",
    )
    resp.headers["Content-Disposition"] = "attachment; filename=ddos_analysis.json"
    return resp


@app.route("/export/pdf")
def export_pdf():
    if not _last_result:
        abort(404)
    buf = generate_pdf(_last_result, filename=_last_result.get("filename", "upload.csv"))
    return send_file(
        buf,
        mimetype="application/pdf",
        as_attachment=True,
        download_name="ddos_analysis_report.pdf",
    )


@app.route("/docs/guidelines")
def doc_guidelines():
    """Inline PDF view for the Dataset Guidelines document."""
    path = "Dataset Guidelines.pdf"
    if not os.path.exists(path):
        abort(404)
    return send_file(path, mimetype="application/pdf")


@app.route("/docs/guidelines/download")
def doc_guidelines_download():
    path = "Dataset Guidelines.pdf"
    if not os.path.exists(path):
        abort(404)
    return send_file(
        path,
        mimetype="application/pdf",
        as_attachment=True,
        download_name="DDoS-Dataset-Guidelines.pdf",
    )


@app.route("/chart/<name>")
def serve_chart(name):
    allowed = {
        "cm_random_forest", "cm_logistic_regression",
        "feature_importance_rf", "model_comparison",
    }
    if name not in allowed:
        abort(404)
    return send_from_directory("models", f"{name}.png", mimetype="image/png")


@app.route("/models/meta")
def model_meta():
    try:
        with open(os.path.join("models", "training_meta.json")) as f:
            meta = json.load(f)
        return jsonify(meta)
    except FileNotFoundError:
        return jsonify({"error": "Models not trained yet."}), 404


if __name__ == "__main__":
    app.run(debug=True, port=5000)
