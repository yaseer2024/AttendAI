import os
import pickle
import pandas as pd
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.metrics import classification_report, roc_auc_score
import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

try:
    from scripts.preprocess import load_and_preprocess, build_features
except ImportError:
    from preprocess import load_and_preprocess, build_features

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODELS_DIR = os.path.join(BASE_DIR, "models")
os.makedirs(MODELS_DIR, exist_ok=True)

def train():
    print("Loading data & generating features...")
    _, _, _, _, merged = load_and_preprocess()
    df = build_features(merged)

    df["Target_Absent"] = 1 - df["Is_Present"]

    # One-hot encode categoricals
    categorical_cols = ["Subject_Code", "Type", "Day"]
    df_encoded = pd.get_dummies(df, columns=categorical_cols, drop_first=True)

    numeric_features = ["Hist_Rate", "DOW_Rate", "Post_Holiday_Rate", "Period", "Is_Before_Holiday", "Is_After_Holiday"]
    encoded_features = [c for c in df_encoded.columns if any(c.startswith(prefix + "_") for prefix in categorical_cols)]
    all_features = numeric_features + encoded_features

    # Chronological split (80% training on older dates, 20% test on recent dates)
    dates = df_encoded["Date"].drop_duplicates().sort_values()
    split_date = dates.iloc[int(len(dates) * 0.8)]

    train_data = df_encoded[df_encoded["Date"] < split_date]
    test_data = df_encoded[df_encoded["Date"] >= split_date]

    X_train, y_train = train_data[all_features].fillna(0), train_data["Target_Absent"]
    X_test, y_test = test_data[all_features].fillna(0), test_data["Target_Absent"]

    model = GradientBoostingClassifier(n_estimators=100, learning_rate=0.05, max_depth=4, random_state=42)
    model.fit(X_train, y_train)

    y_pred = model.predict(X_test)
    y_prob = model.predict_proba(X_test)[:, 1]

    print("\n--- Test Set Evaluation ---")
    print(classification_report(y_test, y_pred, target_names=["Present", "Absent"]))
    print(f"ROC-AUC Score: {roc_auc_score(y_test, y_prob):.4f}")

    # Save model and feature names
    with open(os.path.join(MODELS_DIR, "absence_gb.pkl"), "wb") as f:
        pickle.dump({"model": model, "features": all_features}, f)
    print("Model saved to backend/models/absence_gb.pkl")

if __name__ == "__main__":
    train()