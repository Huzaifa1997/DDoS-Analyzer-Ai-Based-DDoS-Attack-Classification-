import os
import json
import numpy as np
import joblib

from sklearn.metrics import (
    accuracy_score, precision_score, recall_score,
    f1_score, confusion_matrix
)

MODELS_DIR = "models"


def load_models():
    rf = joblib.load(os.path.join(MODELS_DIR, "random_forest.pkl"))
    lr = joblib.load(os.path.join(MODELS_DIR, "logistic_regression.pkl"))
    le = joblib.load(os.path.join(MODELS_DIR, "label_encoder.pkl"))
    with open(os.path.join(MODELS_DIR, "training_meta.json")) as f:
        meta = json.load(f)
    return {"Random Forest": rf, "Logistic Regression": lr}, le, meta


def run_analysis(X_scaled, y_raw, le):
    """
    Run both models on X_scaled.
    If y_raw (ground-truth labels) are available, compute metrics.
    Returns a dict with per-model results and overall traffic counts.
    """
    models, le_trained, meta = load_models()

    # encode ground truth if present
    y_true = None
    if y_raw is not None:
        # map labels to trained encoder; unknown labels default to -1
        known = set(le_trained.classes_)
        y_true = np.array([
            le_trained.transform([lbl])[0] if lbl in known else -1
            for lbl in y_raw
        ])
        # remove rows with unknown labels
        valid_mask = y_true != -1
        X_eval = X_scaled[valid_mask]
        y_true = y_true[valid_mask]
    else:
        X_eval = X_scaled

    results = []
    all_preds = {}

    for name, clf in models.items():
        y_pred = clf.predict(X_scaled)
        all_preds[name] = y_pred

        if y_true is not None and len(y_true) > 0:
            y_pred_eval = clf.predict(X_eval)
            acc  = accuracy_score(y_true, y_pred_eval)
            prec = precision_score(y_true, y_pred_eval,
                                   average="weighted", zero_division=0)
            rec  = recall_score(y_true, y_pred_eval,
                                average="weighted", zero_division=0)
            f1   = f1_score(y_true, y_pred_eval,
                            average="weighted", zero_division=0)
            cm   = confusion_matrix(y_true, y_pred_eval).tolist()
        else:
            # no ground truth — use training-time metrics
            model_meta = next(
                (r for r in meta["results"] if r["name"] == name), {}
            )
            acc  = model_meta.get("accuracy", 0)
            prec = model_meta.get("precision", 0)
            rec  = model_meta.get("recall", 0)
            f1   = model_meta.get("f1_score", 0)
            cm   = model_meta.get("confusion_matrix", [[0, 0], [0, 0]])

        results.append({
            "name":             name,
            "accuracy":         round(float(acc) * 100, 2),
            "precision":        round(float(prec) * 100, 2),
            "recall":           round(float(rec) * 100, 2),
            "f1_score":         round(float(f1) * 100, 2),
            "confusion_matrix": cm,
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

    best_result = next((r for r in results if r["name"] == best_name), results[0])

    return {
        "total_records":    total,
        "benign_count":     benign_count,
        "ddos_count":       ddos_count,
        "benign_percent":   benign_pct,
        "ddos_percent":     ddos_pct,
        "best_model":       best_name,
        "best_accuracy":    best_result["accuracy"],
        "models":           results,
        "has_ground_truth": y_true is not None,
    }


def build_recommendations(analysis):
    recs = []
    ddos_pct = analysis["ddos_percent"]

    if ddos_pct > 50:
        recs.append({
            "type": "danger",
            "icon": "fa-skull-crossbones",
            "title": "Critical DDoS Activity",
            "text": f"{ddos_pct:.1f}% of traffic is malicious. Immediate mitigation required."
        })
    elif ddos_pct > 20:
        recs.append({
            "type": "warning",
            "icon": "fa-exclamation-triangle",
            "title": "Elevated DDoS Traffic",
            "text": f"{ddos_pct:.1f}% DDoS detected. Consider activating rate-limiting."
        })
    else:
        recs.append({
            "type": "success",
            "icon": "fa-check-circle",
            "title": "Low Threat Level",
            "text": f"Only {ddos_pct:.1f}% DDoS traffic. Network appears mostly healthy."
        })

    if analysis["best_accuracy"] >= 99:
        recs.append({
            "type": "success",
            "icon": "fa-brain",
            "title": "High Model Confidence",
            "text": f"Best model ({analysis['best_model']}) achieved {analysis['best_accuracy']}% accuracy."
        })
    elif analysis["best_accuracy"] >= 90:
        recs.append({
            "type": "info",
            "icon": "fa-info-circle",
            "title": "Good Model Confidence",
            "text": f"{analysis['best_model']} at {analysis['best_accuracy']}% — reliable classification."
        })
    else:
        recs.append({
            "type": "warning",
            "icon": "fa-exclamation-circle",
            "title": "Low Model Confidence",
            "text": "Dataset may not match CICFlowMeter format. Ensure correct feature columns."
        })

    recs.append({
        "type": "info",
        "icon": "fa-shield-alt",
        "title": "Security Recommendation",
        "text": "Deploy IDS/IPS systems and monitor anomalous flows in real time."
    })

    recs.append({
        "type": "info",
        "icon": "fa-network-wired",
        "title": "Network Hardening",
        "text": "Apply SYN cookies, connection rate limits, and geo-blocking for suspicious IPs."
    })

    return recs
