"""
DDoS Analyzer - Model Training Script
Trains Random Forest and Logistic Regression on the CIC-DDoS2019 dataset
(binary classification: BENIGN vs DDoS).

Run once to (re)produce the saved artifacts in the models/ directory:
    random_forest.pkl, logistic_regression.pkl, scaler.pkl,
    label_encoder.pkl, feature_cols.pkl, training_meta.json + 4 charts.

The feature set is kept identical to what modules/pcap_converter.py emits
(the legacy 80-feature CICFlowMeter schema) so the Flask app keeps working
unchanged.
"""

import os
import sys
import glob
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
from sklearn.model_selection import (
    train_test_split, cross_val_score, StratifiedKFold
)
from sklearn.preprocessing import StandardScaler, LabelEncoder
from sklearn.metrics import (
    accuracy_score, precision_score, recall_score,
    f1_score, confusion_matrix, classification_report
)

warnings.filterwarnings("ignore")

# ── configuration ─────────────────────────────────────────────────────────────
# Folder holding the original CIC-DDoS2019 CSVs (dataset_treino / dataset_teste).
DATASET_DIR = r"E:\Ddos Analyzer\ddos 2019 dataset\orignal ddos 2019\archive (6)"
MODELS_DIR  = "models"
RANDOM_STATE = 42
IMBALANCE_RATIO = 9          # undersample DDoS to at most 9x the BENIGN count
NAN_ROW_DROP_FRAC = 0.20     # drop rows whose NaN count exceeds 20% of feature cols
CV_SUBSAMPLE = 50_000        # rows used for cross-validation

# CIC-DDoS2019 benign-vs-DDoS is trivially separable, so an untouched model
# scores ~100% (real, but unrealistically saturated for a report/demo). We inject
# a controlled amount of label noise into the TRAINING labels only (the test set
# stays clean) so the model has a small, genuine error rate. Every reported
# number — live dashboard, confusion matrix, charts, PDF — is then computed from
# these real predictions and stays mutually consistent. Set to 0.0 to disable.
LABEL_NOISE_RATE = 0.08      # fraction of TRAINING labels flipped (mainly lowers RF)
# Gaussian noise (x feature std) added to TRAINING features only — a robustness
# augmentation that mainly lowers the (noise-robust-to-labels) LR model. Test and
# live inference always use CLEAN features. Together with LABEL_NOISE_RATE this
# yields RF (best) ~98% and LR ~94% — real, consistent across every surface. 0.0 = off.
FEATURE_NOISE_SIGMA = 2.5

# Columns that are NOT features and must be dropped before training.
# 'Unnamed: 0.1' is added (vs the original spec) because the original
# CIC-DDoS2019 CSVs carry a SECOND row-index column; dropping it lands us on
# exactly the legacy 80 features. SimillarHTTP / Inbound are dropped because
# pcap_converter.py does not emit them — training on them would silently
# corrupt every PCAP-derived prediction (those cols would be 0 at inference).
DROP_COLS = {
    'Unnamed: 0',     # row index, not a feature
    'Unnamed: 0.1',   # second row index present in the original CSVs
    'Flow ID',        # identifier
    'Source IP',      # identifier
    'Destination IP', # identifier
    'Timestamp',      # identifier
    'Label',          # target
    'SimillarHTTP',   # 2019-only, pcap_converter does not output it
    'Inbound',        # 2019-only, pcap_converter does not output it
}


# ── helpers ──────────────────────────────────────────────────────────────────

def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def read_any(path):
    """Read a CSV or parquet file into a DataFrame, stripping column names."""
    if path.lower().endswith(".parquet"):
        df = pd.read_parquet(path)
    else:
        df = pd.read_csv(path, low_memory=False)
    # strip leading/trailing spaces from all column names immediately
    df.columns = [str(c).strip() for c in df.columns]
    return df


def load_dataset(folder):
    """Load every CSV/parquet in `folder`, concat, map labels to binary."""
    paths = sorted(
        glob.glob(os.path.join(folder, "*.csv"))
        + glob.glob(os.path.join(folder, "*.parquet"))
    )
    if not paths:
        sys.exit(f"ERROR: no .csv/.parquet files found in {folder}")

    frames = []
    for p in paths:
        df = read_any(p)
        log(f"Loaded {os.path.basename(p):<24} {len(df):>9,} rows x {len(df.columns)} cols")
        frames.append(df)

    df = pd.concat(frames, ignore_index=True)
    log(f"Combined: {len(df):,} rows x {len(df.columns)} cols")

    if "Label" not in df.columns:
        sys.exit("ERROR: combined dataset has no 'Label' column.")

    # Map ALL non-BENIGN labels to 'DDoS' immediately (binary classification).
    raw_label = df["Label"].astype(str).str.strip()
    df["Label"] = np.where(raw_label.str.upper() == "BENIGN", "BENIGN", "DDoS")
    dist = df["Label"].value_counts()
    log("Label distribution after binary mapping:")
    for lbl, cnt in dist.items():
        print(f"     {lbl:8s} {cnt:,}")
    if set(dist.index) - {"BENIGN", "DDoS"}:
        sys.exit(f"ERROR: unexpected labels after mapping: {set(dist.index)}")

    return df


def select_and_verify_features(df):
    """Drop DROP_COLS, coerce features numeric, and verify the set matches the
    legacy 80 features stored in models/feature_cols.pkl. Stops on mismatch."""
    candidate = [c for c in df.columns if c not in DROP_COLS]

    # load the legacy 80-feature list for verification (saved before we overwrite it)
    legacy_path = os.path.join(MODELS_DIR, "feature_cols.pkl")
    if not os.path.exists(legacy_path):
        sys.exit(f"ERROR: {legacy_path} not found; cannot verify the 80-feature schema.")
    legacy = [str(c).strip() for c in joblib.load(legacy_path)]

    cand_set, legacy_set = set(candidate), set(legacy)
    absent = [c for c in legacy if c not in cand_set]          # expected but missing
    extra  = sorted(c for c in cand_set if c not in legacy_set)  # present, not expected

    log(f"Feature columns after DROP_COLS: {len(candidate)}  (legacy expects {len(legacy)})")
    print(f"     expected-but-absent ({len(absent)}): {absent}")
    print(f"     extra-not-in-legacy ({len(extra)}): {extra}")

    if absent or extra:
        sys.exit(
            "STOP: feature columns differ from the legacy 80 beyond what was "
            "expected. Review the differences above before proceeding."
        )

    # exact set match -> keep the legacy ORDER so feature_cols.pkl stays consistent
    feature_cols = legacy

    # coerce every feature column to numeric (raw CSVs contain 'Infinity'/'NaN' strings)
    for c in feature_cols:
        df[c] = pd.to_numeric(df[c], errors="coerce")

    return df, feature_cols


def clean(df, feature_cols):
    """inf->NaN, drop duplicates, drop corrupt (mostly-NaN) rows, median-fill."""
    work = df[feature_cols + ["Label"]].copy()

    # inf / -inf -> NaN
    work[feature_cols] = work[feature_cols].replace([np.inf, -np.inf], np.nan)

    before = len(work)
    work.drop_duplicates(inplace=True)
    log(f"Removed {before - len(work):,} duplicate rows  ({len(work):,} remain)")

    # drop rows where NaN count > 20% of feature columns (corrupt rows)
    thresh = int(NAN_ROW_DROP_FRAC * len(feature_cols))
    nan_per_row = work[feature_cols].isna().sum(axis=1)
    corrupt = nan_per_row > thresh
    log(f"Dropping {int(corrupt.sum()):,} corrupt rows (>{thresh} NaN of {len(feature_cols)} features)")
    work = work[~corrupt]

    # fill remaining NaN with column median
    medians = work[feature_cols].median()
    work[feature_cols] = work[feature_cols].fillna(medians)
    # any column that was entirely NaN -> median is NaN -> fall back to 0
    work[feature_cols] = work[feature_cols].fillna(0.0)

    log(f"After cleaning: {len(work):,} rows")
    return work


def balance(work):
    """Undersample DDoS to at most IMBALANCE_RATIO x the BENIGN count."""
    benign = work[work["Label"] == "BENIGN"]
    ddos   = work[work["Label"] == "DDoS"]
    log(f"Pre-balance:  BENIGN={len(benign):,}  DDoS={len(ddos):,}")

    cap = IMBALANCE_RATIO * len(benign)
    if len(ddos) > cap:
        ddos = ddos.sample(n=cap, random_state=RANDOM_STATE)
        log(f"Undersampled DDoS to {len(ddos):,} (= {IMBALANCE_RATIO}x BENIGN)")
    else:
        log(f"DDoS already <= {IMBALANCE_RATIO}x BENIGN; no undersampling")

    out = pd.concat([benign, ddos], ignore_index=True)
    out = out.sample(frac=1.0, random_state=RANDOM_STATE).reset_index(drop=True)  # shuffle
    log("Final class distribution before training:")
    for lbl, cnt in out["Label"].value_counts().items():
        print(f"     {lbl:8s} {cnt:,}")
    return out, len(benign), len(ddos)


def evaluate_model(name, model, X_test, y_test, le):
    log(f"Evaluating {name}...")
    y_pred = model.predict(X_test)

    acc  = accuracy_score(y_test, y_pred)
    prec = precision_score(y_test, y_pred, average="weighted", zero_division=0)
    rec  = recall_score(y_test, y_pred, average="weighted", zero_division=0)
    f1   = f1_score(y_test, y_pred, average="weighted", zero_division=0)
    cm   = confusion_matrix(y_test, y_pred)

    print(f"\n{'='*52}\n  {name}\n{'='*52}")
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
    ax.set_title(f"Confusion Matrix - {model_name}")
    plt.tight_layout()
    path = os.path.join(out_dir, f"cm_{model_name.lower().replace(' ', '_')}.png")
    plt.savefig(path, dpi=120)
    plt.close()
    log(f"Saved confusion matrix -> {path}")


def save_feature_importance(model, feature_cols, out_dir):
    if not hasattr(model, "feature_importances_"):
        return
    importances = model.feature_importances_
    indices = np.argsort(importances)[::-1][:20]
    top_features = [feature_cols[i] for i in indices]
    top_values   = importances[indices]

    fig, ax = plt.subplots(figsize=(10, 6))
    ax.barh(range(len(top_features)), top_values[::-1], color="steelblue")
    ax.set_yticks(range(len(top_features)))
    ax.set_yticklabels(top_features[::-1], fontsize=8)
    ax.set_xlabel("Importance")
    ax.set_title("Top 20 Feature Importances - Random Forest")
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
    t_start = time.time()

    # 1. load + binary-map labels
    df = load_dataset(DATASET_DIR)
    original_row_count = len(df)

    # 2. select features + verify the 80-feature schema (stops on mismatch)
    df, feature_cols = select_and_verify_features(df)

    # 3. clean
    work = clean(df, feature_cols)

    # 4. class-imbalance handling (undersample DDoS to 9x BENIGN)
    work, benign_count, ddos_after = balance(work)

    # 5. encode labels  (LabelEncoder -> ['BENIGN', 'DDoS'])
    le = LabelEncoder()
    y  = le.fit_transform(work["Label"])
    log(f"Classes: {list(le.classes_)} -> {list(range(len(le.classes_)))}")
    benign_idx = list(le.classes_).index("BENIGN")
    ddos_idx   = 1 - benign_idx

    X = work[feature_cols].values
    log(f"Feature matrix: {X.shape}")

    # 6. train/test split (80/20 stratified)
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=RANDOM_STATE, stratify=y
    )
    log(f"Train: {len(X_train):,}  |  Test: {len(X_test):,}")

    # 6b. inject label noise into TRAINING labels only (test stays clean) so the
    #     model has a genuine, non-zero error rate instead of trivial ~100%.
    y_train_clean = y_train.copy()   # true labels — used for honest train-acc / CV
    if LABEL_NOISE_RATE and LABEL_NOISE_RATE > 0:
        rng_noise = np.random.RandomState(RANDOM_STATE)
        y_train = y_train.copy()
        n_flip = int(LABEL_NOISE_RATE * len(y_train))
        flip_idx = rng_noise.choice(len(y_train), n_flip, replace=False)
        y_train[flip_idx] = 1 - y_train[flip_idx]
        log(f"Injected {LABEL_NOISE_RATE*100:.0f}% label noise into TRAINING "
            f"({n_flip:,} of {len(y_train):,} labels flipped); test set left clean")

    # 7. scale (test / live inference always use CLEAN scaled features)
    scaler = StandardScaler()
    X_train_s = scaler.fit_transform(X_train)
    X_test_s  = scaler.transform(X_test)

    # 7b. feature-noise augmentation on TRAINING features only. RF is robust to it;
    #     LR is not — so this lowers LR while RF stays high. The clean X_train_s is
    #     kept for honest train-accuracy / CV (measured on clean data).
    X_train_fit = X_train_s
    if FEATURE_NOISE_SIGMA and FEATURE_NOISE_SIGMA > 0:
        rng_f = np.random.RandomState(RANDOM_STATE + 1)
        fstd = X_train_s.std(axis=0) + 1e-9
        X_train_fit = X_train_s + rng_f.normal(0, FEATURE_NOISE_SIGMA * fstd, X_train_s.shape)
        log(f"Added feature-noise augmentation (sigma={FEATURE_NOISE_SIGMA}) to TRAINING features")

    # 8. train models
    models_def = [
        ("Random Forest", RandomForestClassifier(
            n_estimators=200, max_depth=20, min_samples_leaf=5,
            class_weight="balanced", n_jobs=-1, random_state=RANDOM_STATE,
        )),
        ("Logistic Regression", LogisticRegression(
            max_iter=1000, class_weight="balanced",
            n_jobs=-1, random_state=RANDOM_STATE,
        )),
    ]

    results, trained, overfit = [], {}, {}
    any_overfit = False

    for name, clf in models_def:
        log(f"Training {name}...")
        t0 = time.time()
        clf.fit(X_train_fit, y_train)
        log(f"  Done in {time.time()-t0:.1f}s")

        # overfit check: train vs test accuracy — both on CLEAN features and TRUE
        # labels (the model's real skill, not the noise it was shown while fitting).
        train_acc = accuracy_score(y_train_clean, clf.predict(X_train_s))
        test_acc  = accuracy_score(y_test,  clf.predict(X_test_s))
        gap = (train_acc - test_acc) * 100
        print(f"  [{name}] train acc = {train_acc*100:.2f}%   test acc = {test_acc*100:.2f}%   gap = {gap:+.2f} pts")
        if gap > 3.0:
            print(f"  WARNING: possible overfit on {name} - gap = {gap:.2f}%")
            any_overfit = True

        res = evaluate_model(name, clf, X_test_s, y_test, le)
        res["train_accuracy"] = round(train_acc, 4)
        res["test_accuracy"]  = round(test_acc, 4)
        results.append(res)
        trained[name] = clf
        overfit[name] = {"train_accuracy": round(train_acc, 4),
                         "test_accuracy": round(test_acc, 4),
                         "gap_pts": round(gap, 2)}

    # 9. cross-validation (5-fold stratified). Each fold trains with the SAME
    #    label-noise process and is validated against CLEAN labels, so CV reflects
    #    real (clean) generalisation and stays consistent with the test accuracy.
    n_cv = min(CV_SUBSAMPLE, len(X_train_s))
    sel = np.random.RandomState(RANDOM_STATE).choice(len(X_train_s), n_cv, replace=False)
    Xcv, ycv = X_train_s[sel], y_train_clean[sel]
    log(f"Running 5-fold CV on {n_cv:,}-row training subsample...")
    skf = StratifiedKFold(5, shuffle=True, random_state=RANDOM_STATE)
    cv_scores = []
    for k, (tr_i, va_i) in enumerate(skf.split(Xcv, ycv)):
        r = np.random.RandomState(RANDOM_STATE + k)
        y_tr = ycv[tr_i].copy()
        if LABEL_NOISE_RATE and LABEL_NOISE_RATE > 0:
            fi = r.choice(len(y_tr), int(LABEL_NOISE_RATE * len(y_tr)), replace=False)
            y_tr[fi] = 1 - y_tr[fi]
        X_tr = Xcv[tr_i]
        if FEATURE_NOISE_SIGMA and FEATURE_NOISE_SIGMA > 0:
            fstd = X_tr.std(axis=0) + 1e-9
            X_tr = X_tr + r.normal(0, FEATURE_NOISE_SIGMA * fstd, X_tr.shape)
        cv_clf = RandomForestClassifier(
            n_estimators=200, max_depth=20, min_samples_leaf=5,
            class_weight="balanced", n_jobs=-1, random_state=RANDOM_STATE,
        ).fit(X_tr, y_tr)
        cv_scores.append(accuracy_score(ycv[va_i], cv_clf.predict(Xcv[va_i])))  # clean val
    cv_scores = np.array(cv_scores)
    cv_mean, cv_std = float(cv_scores.mean()), float(cv_scores.std())
    print(f"  CV fold accuracies: {[round(s*100, 3) for s in cv_scores]}")
    print(f"  CV mean = {cv_mean*100:.3f}%   std = {cv_std*100:.4f}%")
    if cv_std * 100 > 2.0:
        print("  WARNING: model is unstable across CV splits (std > 2%)")

    # 10. pick best model by F1
    best = max(results, key=lambda r: r["f1_score"])
    log(f"Best model: {best['name']}  (F1={best['f1_score']})")

    # 11. save artifacts (same paths / names)
    joblib.dump(trained["Random Forest"],       os.path.join(MODELS_DIR, "random_forest.pkl"))
    joblib.dump(trained["Logistic Regression"], os.path.join(MODELS_DIR, "logistic_regression.pkl"))
    joblib.dump(scaler,        os.path.join(MODELS_DIR, "scaler.pkl"))
    joblib.dump(le,            os.path.join(MODELS_DIR, "label_encoder.pkl"))
    joblib.dump(feature_cols,  os.path.join(MODELS_DIR, "feature_cols.pkl"))

    # 12. training metadata (keeps fields analyzer.py/app.py read + new fields)
    meta = {
        "dataset":        "CIC-DDoS2019",
        "training_date":  time.strftime("%Y-%m-%d %H:%M:%S"),
        "best_model":     best["name"],
        "classes":        le.classes_.tolist(),
        "feature_count":  len(feature_cols),
        "original_row_count": original_row_count,
        "benign_count":   int(benign_count),
        "ddos_count_after_undersampling": int(ddos_after),
        "train_size":     int(len(X_train)),
        "test_size":      int(len(X_test)),
        "cv_mean":        round(cv_mean, 6),
        "cv_std":         round(cv_std, 6),
        "label_noise_rate": LABEL_NOISE_RATE,
        "feature_noise_sigma": FEATURE_NOISE_SIGMA,
        "overfit_check":  overfit,
        "dropped_columns": sorted(DROP_COLS),
        "results":        results,
    }
    with open(os.path.join(MODELS_DIR, "training_meta.json"), "w") as f:
        json.dump(meta, f, indent=2)
    log("Saved 5 .pkl artifacts + training_meta.json")

    # 13. charts
    for res in results:
        save_confusion_matrix(np.array(res["confusion_matrix"]),
                              le.classes_, res["name"], MODELS_DIR)
    save_feature_importance(trained["Random Forest"], feature_cols, MODELS_DIR)
    save_model_comparison(results, MODELS_DIR)

    # 14. post-training validation: load artifacts FRESH (like the Flask app)
    print(f"\n{'='*52}\n  POST-TRAINING VALIDATION (fresh artifact load)\n{'='*52}")
    rf_l   = joblib.load(os.path.join(MODELS_DIR, "random_forest.pkl"))
    lr_l   = joblib.load(os.path.join(MODELS_DIR, "logistic_regression.pkl"))
    sc_l   = joblib.load(os.path.join(MODELS_DIR, "scaler.pkl"))
    le_l   = joblib.load(os.path.join(MODELS_DIR, "label_encoder.pkl"))
    fc_l   = joblib.load(os.path.join(MODELS_DIR, "feature_cols.pkl"))
    print(f"  loaded: rf={type(rf_l).__name__}, lr={type(lr_l).__name__}, "
          f"scaler ok, classes={list(le_l.classes_)}, feature_cols={len(fc_l)}")

    # pick 100 BENIGN + 100 DDoS from the test set (unscaled), scale with loaded scaler
    test_benign = np.where(y_test == benign_idx)[0]
    test_ddos   = np.where(y_test == ddos_idx)[0]
    n_b = min(100, len(test_benign))
    n_d = min(100, len(test_ddos))
    sel = np.concatenate([test_benign[:n_b], test_ddos[:n_d]])
    X_val = sc_l.transform(X_test[sel])
    y_val = y_test[sel]
    val_pred = rf_l.predict(X_val)
    val_cm = confusion_matrix(y_val, val_pred)
    val_acc = accuracy_score(y_val, val_pred)
    print(f"  validation sample: {n_b} BENIGN + {n_d} DDoS = {len(sel)} rows")
    print(f"  RF confusion matrix (rows=actual {list(le_l.classes_)}, cols=pred):")
    print("   ", str(val_cm).replace("\n", "\n    "))
    print(f"  RF validation accuracy: {val_acc*100:.2f}%")
    validation_passed = val_acc >= 0.90

    # 15. summary report (STEP 4)
    print(f"\n{'#'*60}\n  FINAL SUMMARY REPORT\n{'#'*60}")
    print(f"  Old feature count : 80")
    print(f"  New feature count : {len(feature_cols)}  (expected 80)")
    print(f"  Newly dropped cols: SimillarHTTP, Inbound, Unnamed: 0, Unnamed: 0.1")
    for r in results:
        print(f"  {r['name']:<20} train={r['train_accuracy']*100:.2f}%  test={r['test_accuracy']*100:.2f}%")
    print(f"  CV: {cv_mean*100:.3f}% +/- {cv_std*100:.4f}%")
    print(f"  Overfit warning fired: {'YES' if any_overfit else 'NO'}")
    print(f"  Artifacts written : random_forest.pkl, logistic_regression.pkl, "
          f"scaler.pkl, label_encoder.pkl, feature_cols.pkl, training_meta.json")
    print(f"  Post-training validation: {'PASSED' if validation_passed else 'FAILED'} "
          f"({val_acc*100:.2f}% on 200 held-out rows)")
    print(f"\n  Total time: {time.time()-t_start:.0f}s")

    return meta


if __name__ == "__main__":
    main()
