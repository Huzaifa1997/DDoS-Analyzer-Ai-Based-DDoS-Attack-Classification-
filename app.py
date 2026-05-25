"""
DDoS Analyzer — Flask Backend
Run with:  python app.py
Then open: http://127.0.0.1:5000
"""

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

# ── app setup ────────────────────────────────────────────────────────────────

app = Flask(__name__)
app.secret_key = os.urandom(24)
app.config["UPLOAD_FOLDER"] = "uploads"
app.config["MAX_CONTENT_LENGTH"] = 500 * 1024 * 1024   # 500 MB

ALLOWED_EXT = {"csv"}

os.makedirs("uploads", exist_ok=True)

# in-memory session store (one result per process — fine for single-user offline tool)
_last_result: dict = {}


def allowed_file(filename):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXT


# ── routes ───────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/analyze", methods=["POST"])
def analyze():
    if "file" not in request.files:
        return jsonify({"success": False, "error": "No file uploaded."}), 400

    f = request.files["file"]
    if f.filename == "" or not allowed_file(f.filename):
        return jsonify({"success": False, "error": "Only CSV files are supported."}), 400

    filename = secure_filename(f.filename)
    uid = uuid.uuid4().hex[:8]
    save_path = os.path.join(app.config["UPLOAD_FOLDER"], f"{uid}_{filename}")
    f.save(save_path)

    file_size_mb = round(os.path.getsize(save_path) / (1024 * 1024), 2)

    try:
        scaler, label_enc, feature_cols = load_artifacts()

        df = pd.read_csv(save_path, encoding="utf-8", low_memory=False)
        total_raw = len(df)

        X_scaled, y_raw, missing_count = preprocess_uploaded(df, feature_cols, scaler)

        analysis = run_analysis(X_scaled, y_raw, label_enc)
        analysis["filename"]      = filename
        analysis["file_size_mb"]  = file_size_mb
        analysis["total_raw"]     = total_raw
        analysis["missing_features"] = missing_count

        recs = build_recommendations(analysis)
        analysis["recommendations"] = recs

        summary = (
            f"Analysed {analysis['total_records']:,} records from '{filename}'. "
            f"Detected {analysis['ddos_count']:,} DDoS flows "
            f"({analysis['ddos_percent']}%) and "
            f"{analysis['benign_count']:,} normal flows "
            f"({analysis['benign_percent']}%). "
            f"Best model: {analysis['best_model']} "
            f"({analysis['best_accuracy']}% accuracy)."
        )
        analysis["summary"] = summary

        global _last_result
        _last_result = analysis

        return jsonify({"success": True, **analysis})

    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

    finally:
        try:
            os.remove(save_path)
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
