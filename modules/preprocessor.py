import numpy as np
import pandas as pd
import joblib
import os


MODELS_DIR = "models"


def load_artifacts():
    scaler       = joblib.load(os.path.join(MODELS_DIR, "scaler.pkl"))
    label_enc    = joblib.load(os.path.join(MODELS_DIR, "label_encoder.pkl"))
    feature_cols = joblib.load(os.path.join(MODELS_DIR, "feature_cols.pkl"))
    return scaler, label_enc, feature_cols


def preprocess_uploaded(df, feature_cols, scaler):
    """Clean an uploaded DataFrame and return scaled feature matrix + any available labels."""
    df.columns = df.columns.str.strip()

    # replace inf
    df.replace([np.inf, -np.inf], np.nan, inplace=True)

    # drop duplicates
    df.drop_duplicates(inplace=True)

    # extract labels if present
    y_raw = None
    if "Label" in df.columns:
        y_raw = df["Label"].str.strip()

    # keep only the feature columns the model was trained on
    available = [c for c in feature_cols if c in df.columns]
    missing   = [c for c in feature_cols if c not in df.columns]

    # warn when the upload is missing a lot of expected features (unreliable predictions)
    # note: `missing` is a list here, so we compare its length (the literal `missing > 10`
    # would raise TypeError); intent and message are otherwise unchanged.
    if len(missing) > 10:
        import warnings
        warnings.warn(
            f"Uploaded file is missing {len(missing)} of {len(feature_cols)} expected features. "
            f"Missing: {[c for c in feature_cols if c not in df.columns][:5]}... "
            f"Predictions may be unreliable.",
            UserWarning
        )

    if len(available) == 0:
        raise ValueError("Uploaded file has no recognisable CICFlowMeter feature columns.")

    X = df[available].copy()

    # fill missing features with 0 (graceful degradation)
    for col in missing:
        X[col] = 0.0
    X = X[feature_cols]   # ensure column order matches training

    # fill NaN
    X.fillna(X.median(numeric_only=True), inplace=True)

    X_scaled = scaler.transform(X.values)
    return X_scaled, y_raw, len(missing)
