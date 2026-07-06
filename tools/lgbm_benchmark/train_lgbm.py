#!/usr/bin/env python3
"""Benchmark LightGBM lambdarank (Fase 3 do debug plan) — passo 2/3: TREINO.

Lê data/train.csv e data/eval.csv (gerados por export_lgbm_data.ts),
treina um ranker lambdarank agrupado por corrida e escreve
data/eval_scores.csv (race_horse_id,score) pro passo 3 (eval ROI no
harness Node com regras de prod + comissão).

Decisões:
- label binário: 1 = vencedor (finish_position==1), 0 = resto — mesmo
  target do TF.js (softmax CE), comparação justa.
- split temporal pro early stopping: últimas ~10% das datas do treino.
- missing = NaN nativo do LGBM (sem zero-fill — vantagem estrutural
  sobre o pipeline TF.js atual).

Uso: .venv/bin/python train_lgbm.py
"""

from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd

DATA = Path(__file__).parent / "data"
META_COLS = [
    "race_id",
    "race_date",
    "race_horse_id",
    "finish_position",
    "non_runner",
    "market_odd",
]


def load(name: str) -> pd.DataFrame:
    df = pd.read_csv(DATA / name, parse_dates=["race_date"])
    df = df.sort_values(["race_date", "race_id"]).reset_index(drop=True)
    return df


def groups_of(df: pd.DataFrame) -> np.ndarray:
    return df.groupby("race_id", sort=False).size().to_numpy()


def main() -> None:
    train = load("train.csv")
    evaldf = load("eval.csv")
    feat_cols = [c for c in train.columns if c not in META_COLS]
    print(f"treino: {len(train)} linhas, {train['race_id'].nunique()} corridas")
    print(f"eval:   {len(evaldf)} linhas, {evaldf['race_id'].nunique()} corridas")
    print(f"features: {len(feat_cols)}")

    train["label"] = (train["finish_position"] == 1).astype(int)

    # split temporal: últimas ~10% das datas viram validação de early stopping
    dates = np.sort(train["race_date"].unique())
    cut = dates[int(len(dates) * 0.9)]
    tr = train[train["race_date"] < cut]
    va = train[train["race_date"] >= cut]
    print(f"split: treino até {pd.Timestamp(cut).date()} ({tr['race_id'].nunique()} corridas), "
          f"val {va['race_id'].nunique()} corridas")

    dtr = lgb.Dataset(tr[feat_cols], label=tr["label"], group=groups_of(tr))
    dva = lgb.Dataset(va[feat_cols], label=va["label"], group=groups_of(va), reference=dtr)

    params = {
        "objective": "lambdarank",
        "metric": "ndcg",
        "ndcg_eval_at": [1, 3],
        "label_gain": [0, 1],
        "learning_rate": 0.05,
        "num_leaves": 63,
        "min_data_in_leaf": 50,
        "feature_fraction": 0.9,
        "bagging_fraction": 0.9,
        "bagging_freq": 1,
        "verbosity": -1,
        "seed": 42,
    }

    model = lgb.train(
        params,
        dtr,
        num_boost_round=2000,
        valid_sets=[dva],
        valid_names=["val"],
        callbacks=[lgb.early_stopping(100, verbose=True), lgb.log_evaluation(100)],
    )
    print(f"\nbest_iteration: {model.best_iteration}")
    print(f"best val ndcg@1: {model.best_score['val']['ndcg@1']:.4f}")

    # top-1 accuracy na validação (comparável ao val_top1 do TF.js)
    va = va.copy()
    va["score"] = model.predict(va[feat_cols], num_iteration=model.best_iteration)
    top1 = (
        va.loc[va.groupby("race_id")["score"].idxmax(), ["race_id", "label"]]["label"].mean()
    )
    print(f"val top-1 accuracy: {top1 * 100:.2f}% (TF.js referência: ~29.6-30.2%)")

    # feature importance
    imp = pd.Series(model.feature_importance("gain"), index=feat_cols)
    print("\ntop-20 feature importance (gain):")
    print(imp.sort_values(ascending=False).head(20).to_string())

    # scores pro eval ROI
    scores = model.predict(evaldf[feat_cols], num_iteration=model.best_iteration)
    out = pd.DataFrame({"race_horse_id": evaldf["race_horse_id"], "score": scores})
    out.to_csv(DATA / "eval_scores.csv", index=False)
    print(f"\n✅ {len(out)} scores salvos em data/eval_scores.csv")


if __name__ == "__main__":
    main()
