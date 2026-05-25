"""
DDoS Analyzer - Model Training Script
Trains Random Forest and Logistic Regression on CIC-DDoS2019 dataset.
Run once to produce saved models in the models/ directory.
"""

import os
import json
import time
import warnings
import numpy as np
import pandas as pd
import joblib
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import seaborn as sns

from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler, LabelEncoder
from sklearn.metrics import (
    accuracy_score, precision_score, recall_score,
    f1_score, confusion_matrix, classification_report
)

warnings.filterwarnings("ignore")

DATASET_PATH = "Friday-WorkingHours-Afternoon-DDos.pcap_ISCX.csv"
MODELS_DIR = "models"
SAMPLE_SIZE = 300_000   # rows to sample for training (full ~1.4M is slow for LR)
RANDOM_STATE = 42


# ── helpers ──────────────────────────────────────────────────────────────────

def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def load_and_clean(path, sample_size):
    log(f"Loading dataset: {path}")
    df = pd.read_csv(path, encoding="utf-8", low_memory=False)
    log(f"Loaded {len(df):,} rows × {len(df.columns)} columns")

    # strip whitespace from column names
    df.columns = df.columns.str.strip()

    # drop rows with inf / -inf
    df.replace([np.inf, -np.inf], np.nan, inplace=True)

    # drop duplicates
    before = len(df)
    df.drop_duplicates(inplace=True)
    log(f"Removed {before - len(df):,} duplicate rows")

    # drop entirely-null columns
    df.dropna(axis=1, how="all", inplace=True)

    # fill remaining NaN with column median (numeric only)
    num_cols = df.select_dtypes(include=[np.number]).columns
    df[num_cols] = df[num_cols].fillna(df[num_cols].median())

    log(f"Label distribution:\n{df['Label'].value_counts().to_string()}")

    # stratified sample to keep class balance
    if sample_size and len(df) > sample_size:
        df = df.groupby("Label", group_keys=False).apply(
            lambda x: x.sample(min(len(x), int(sample_size * len(x) / len(df))),
                               random_state=RANDOM_STATE)
        )
        log(f"Sampled down to {len(df):,} rows (stratified)")

    return df


def select_features(df):
    # drop non-numeric / identifier columns
    drop_cols = ["Flow ID", "Source IP", "Destination IP",
                 "Timestamp", "Label", "SimillarHTTP"]
    feature_cols = [c for c in df.columns
                    if c not in drop_cols
                    and df[c].dtype in [np.float64, np.float32,
                                        np.int64, np.int32]]
    return feature_cols


def evaluate_model(name, model, X_test, y_test, le):
    log(f"Evaluating {name}...")
    y_pred = model.predict(X_test)

    acc  = accuracy_score(y_test, y_pred)
    prec = precision_score(y_test, y_pred, average="weighted", zero_division=0)
    rec  = recall_score(y_test, y_pred, average="weighted", zero_division=0)
    f1   = f1_score(y_test, y_pred, average="weighted", zero_division=0)
    cm   = confusion_matrix(y_test, y_pred)

    print(f"\n{'='*50}")
    print(f"  {name}")
    print(f"{'='*50}")
    print(f"  Accuracy : {acc:.4f}")
    print(f"  Precision: {prec:.4f}")
    print(f"  Recall   : {rec:.4f}")
    print(f"  F1-Score : {f1:.4f}")
    print(classification_report(y_test, y_pred,
                                target_names=le.classes_, zero_division=0))

    return {
        "name": name,
        "accuracy":  round(acc, 4),
        "precision": round(prec, 4),
        "recall":    round(rec, 4),
        "f1_score":  round(f1, 4),
        "confusion_matrix": cm.tolist(),
    }


def save_confusion_matrix(cm, labels, model_name, out_dir):
    fig, ax = plt.subplots(figsize=(6, 5))
    sns.heatmap(cm, annot=True, fmt="d", cmap="Blues",
                xticklabels=labels, yticklabels=labels, ax=ax)
    ax.set_xlabel("Predicted")
    ax.set_ylabel("Actual")
    ax.set_title(f"Confusion Matrix — {model_name}")
    plt.tight_layout()
    path = os.path.join(out_dir, f"cm_{model_name.lower().replace(' ', '_')}.png")
    plt.savefig(path, dpi=120)
    plt.close()
    log(f"Saved confusion matrix -> {path}")


def save_feature_importance(model, feature_cols, out_dir):
    if not hasattr(model, "feature_importances_"):
        return
    importances = model.feature_importances_
    indices = np.argsort(importances)[::-1][:20]  # top 20
    top_features = [feature_cols[i] for i in indices]
    top_values   = importances[indices]

    fig, ax = plt.subplots(figsize=(10, 6))
    ax.barh(range(len(top_features)), top_values[::-1], color="steelblue")
    ax.set_yticks(range(len(top_features)))
    ax.set_yticklabels(top_features[::-1], fontsize=8)
    ax.set_xlabel("Importance")
    ax.set_title("Top 20 Feature Importances — Random Forest")
    plt.tight_layout()
    path = os.path.join(out_dir, "feature_importance_rf.png")
    plt.savefig(path, dpi=120)
    plt.close()
    log(f"Saved feature importance chart -> {path}")


def save_model_comparison(results, out_dir):
    names   = [r["name"] for r in results]
    metrics = ["accuracy", "precision", "recall", "f1_score"]
    labels  = ["Accuracy", "Precision", "Recall", "F1-Score"]
    x = np.arange(len(names))
    width = 0.2

    fig, ax = plt.subplots(figsize=(9, 5))
    for i, (metric, label) in enumerate(zip(metrics, labels)):
        vals = [r[metric] for r in results]
        ax.bar(x + i * width, vals, width, label=label)

    ax.set_xticks(x + width * 1.5)
    ax.set_xticklabels(names)
    ax.set_ylim(0, 1.1)
    ax.set_ylabel("Score")
    ax.set_title("Model Comparison")
    ax.legend()
    plt.tight_layout()
    path = os.path.join(out_dir, "model_comparison.png")
    plt.savefig(path, dpi=120)
    plt.close()
    log(f"Saved model comparison chart -> {path}")


# ── main ─────────────────────────────────────────────────────────────────────

def main():
    os.makedirs(MODELS_DIR, exist_ok=True)

    # 1. load & clean
    df = load_and_clean(DATASET_PATH, SAMPLE_SIZE)

    # 2. encode labels
    le = LabelEncoder()
    y  = le.fit_transform(df["Label"])
    log(f"Classes: {le.classes_}  ->  {list(range(len(le.classes_)))}")

    # 3. select features
    feature_cols = select_features(df)
    X = df[feature_cols].values
    log(f"Feature count: {len(feature_cols)}")

    # 4. train / test split
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=RANDOM_STATE, stratify=y
    )
    log(f"Train: {len(X_train):,}  |  Test: {len(X_test):,}")

    # 5. scale
    scaler = StandardScaler()
    X_train_s = scaler.fit_transform(X_train)
    X_test_s  = scaler.transform(X_test)

    # 6. train models
    models_def = [
        ("Random Forest", RandomForestClassifier(
            n_estimators=100, n_jobs=-1,
            random_state=RANDOM_STATE, class_weight="balanced"
        )),
        ("Logistic Regression", LogisticRegression(
            max_iter=1000, n_jobs=-1,
            random_state=RANDOM_STATE, class_weight="balanced"
        )),
    ]

    results   = []
    trained   = {}

    for name, clf in models_def:
        log(f"Training {name}...")
        t0 = time.time()
        clf.fit(X_train_s, y_train)
        elapsed = time.time() - t0
        log(f"  Done in {elapsed:.1f}s")
        res = evaluate_model(name, clf, X_test_s, y_test, le)
        results.append(res)
        trained[name] = clf

    # 7. pick best model by F1
    best = max(results, key=lambda r: r["f1_score"])
    log(f"\nBest model: {best['name']}  (F1={best['f1_score']})")

    # 8. save artefacts
    joblib.dump(trained["Random Forest"],
                os.path.join(MODELS_DIR, "random_forest.pkl"))
    joblib.dump(trained["Logistic Regression"],
                os.path.join(MODELS_DIR, "logistic_regression.pkl"))
    joblib.dump(scaler,
                os.path.join(MODELS_DIR, "scaler.pkl"))
    joblib.dump(le,
                os.path.join(MODELS_DIR, "label_encoder.pkl"))
    joblib.dump(feature_cols,
                os.path.join(MODELS_DIR, "feature_cols.pkl"))

    # training metadata saved alongside models
    meta = {
        "best_model":    best["name"],
        "classes":       le.classes_.tolist(),
        "feature_count": len(feature_cols),
        "sample_size":   SAMPLE_SIZE,
        "results":       results,
    }
    with open(os.path.join(MODELS_DIR, "training_meta.json"), "w") as f:
        json.dump(meta, f, indent=2)

    log("Models saved to models/")

    # 9. generate charts
    for res in results:
        save_confusion_matrix(
            np.array(res["confusion_matrix"]),
            le.classes_, res["name"], MODELS_DIR
        )

    save_feature_importance(trained["Random Forest"], feature_cols, MODELS_DIR)
    save_model_comparison(results, MODELS_DIR)

    log("\nTraining complete. All artefacts saved to models/")
    print(json.dumps(meta, indent=2))


if __name__ == "__main__":
    main()
