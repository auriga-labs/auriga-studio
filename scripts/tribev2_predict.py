#!/usr/bin/env python3
# ======================================================
# Auriga Studio — TRIBE v2 解析スクリプト
#
# 動画（または音声・テキスト）を TRIBE v2 に通して脳反応を予測し、
# タイムラインのレーンが読み込める JSON へ要約して書き出す。
#
# TRIBE v2 本体は Python 3.11 以上と専用の依存関係を必要とするため、
# Auriga Studio（Electron / ブラウザ）からは直接呼ばず、
# ユーザーが自分の Python 環境でこのスクリプトを実行して
# 生成された .tribe.json をアプリのレーンへ読み込ませる。
#
# 使い方:
#   python scripts/tribev2_predict.py 素材.mp4
#   python scripts/tribev2_predict.py 素材.mp4 -o 素材.tribe.json --roi
# ======================================================
"""TRIBE v2 の予測を Auriga Studio のタイムライン用 JSON に変換する。"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

import numpy as np

# リポジトリのルート（このファイルの 1 つ上）
REPO_ROOT = Path(__file__).resolve().parent.parent
# ベンダーした TRIBE v2 本体と、ローカルに置いた学習済み重み
VENDOR_DIR = REPO_ROOT / "assets" / "vendor" / "tribev2"
CHECKPOINT_DIR = VENDOR_DIR / "huggingface"

# 出力 JSON の形式（tribev2.js 側と合わせる）
FORMAT_ID = "auriga.tribev2.timeline"
FORMAT_VERSION = 1

# 血行動態遅れ（秒）。TRIBE v2 の予測は既にこの分だけ過去へずらされている
HEMODYNAMIC_LAG = 5.0

# --roi を付けたときにまとめる HCP-MMP の領野（本家 utils.get_hcp_roi_indices の名前）
ROI_GROUPS = [
    {
        "key": "visual",
        "label": "視覚野",
        "color": "#3a6df0",
        "rois": ["V1", "V2", "V3", "V4", "MT"],
    },
    {
        "key": "auditory",
        "label": "聴覚野",
        "color": "#00cec9",
        "rois": ["A1", "A4", "LBelt", "MBelt", "PBelt"],
    },
    {
        "key": "language",
        "label": "言語野",
        "color": "#f368e0",
        "rois": ["44", "45", "STSdp", "STSvp", "TPOJ1"],
    },
]


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="TRIBE v2 で素材の脳反応を予測し、Auriga Studio 用の JSON を書き出す",
    )
    p.add_argument("input", help="解析する素材（動画 / 音声 / テキスト）")
    p.add_argument(
        "-o", "--output",
        default=None,
        help="出力する JSON のパス（既定: 入力と同じ場所に <名前>.tribe.json）",
    )
    p.add_argument(
        "--checkpoint",
        default=str(CHECKPOINT_DIR),
        help="config.yaml と best.ckpt があるフォルダ、または HuggingFace のリポジトリ ID",
    )
    p.add_argument(
        "--cache",
        default=str(REPO_ROOT / ".tribev2-cache"),
        help="特徴量の抽出結果を貯めるフォルダ",
    )
    p.add_argument(
        "--device",
        default="auto",
        help="torch のデバイス（auto / cuda / cpu）",
    )
    p.add_argument(
        "--roi",
        action="store_true",
        help="視覚野・聴覚野・言語野ごとの曲線も出す（mne と HCP-MMP のダウンロードが要る）",
    )
    return p.parse_args()


def resolve_input_kind(path: Path) -> str:
    """拡張子から get_events_dataframe に渡す引数名を決める。"""
    suffix = path.suffix.lower()
    if suffix in {".mp4", ".avi", ".mkv", ".mov", ".webm"}:
        return "video_path"
    if suffix in {".wav", ".mp3", ".flac", ".ogg"}:
        return "audio_path"
    if suffix == ".txt":
        return "text_path"
    raise SystemExit(f"対応していない拡張子です: {path.suffix}")


def normalize(values: np.ndarray) -> list[float]:
    """レーン表示用に 0〜1 へ正規化する（外れ値は 99 パーセンタイルで頭打ち）。"""
    if values.size == 0:
        return []
    finite = values[np.isfinite(values)]
    if finite.size == 0:
        return [0.0] * int(values.size)
    lo = float(np.min(finite))
    hi = float(np.percentile(finite, 99))
    if hi - lo < 1e-9:
        return [0.0] * int(values.size)
    scaled = (values - lo) / (hi - lo)
    return [round(float(v), 4) for v in np.clip(scaled, 0.0, 1.0)]


def build_overall_series(preds: np.ndarray) -> dict:
    """全頂点の反応の強さ（絶対値の平均）を 1 本の曲線にする。"""
    return {
        "key": "overall",
        "label": "反応強度",
        "color": "#f0a93a",
        "values": normalize(np.abs(preds).mean(axis=1)),
    }


def build_change_series(preds: np.ndarray) -> dict:
    """1 TR 前との脳活動パターンの違い（コサイン距離）を曲線にする。

    場面転換やカットのように「見え方が切り替わる」ところで大きくなるので、
    編集点の当たりを付けるのに使える。
    """
    if preds.shape[0] < 2:
        return {
            "key": "change",
            "label": "変化量",
            "color": "#8e5cf7",
            "values": [0.0] * int(preds.shape[0]),
        }
    a = preds[:-1]
    b = preds[1:]
    norm = np.linalg.norm(a, axis=1) * np.linalg.norm(b, axis=1)
    norm[norm < 1e-9] = 1e-9
    cos = np.sum(a * b, axis=1) / norm
    # 先頭は「1 つ前」が無いので 0 で埋めて長さを揃える
    change = np.concatenate([[0.0], 1.0 - cos])
    return {
        "key": "change",
        "label": "変化量",
        "color": "#8e5cf7",
        "values": normalize(change),
    }


def build_roi_series(preds: np.ndarray) -> list[dict]:
    """領野ごとの平均反応を曲線にする（取得に失敗したら空リスト）。"""
    try:
        from tribev2.utils import get_hcp_roi_indices
    except Exception as err:  # noqa: BLE001 — 依存が無いだけなので落とさない
        print(f"[警告] 領野の取得をとばします（{err}）", file=sys.stderr)
        return []

    series = []
    for group in ROI_GROUPS:
        indices = []
        for roi in group["rois"]:
            try:
                indices.append(get_hcp_roi_indices(roi))
            except Exception as err:  # noqa: BLE001 — 名前が無い領野はとばす
                print(f"[警告] 領野 {roi} をとばします（{err}）", file=sys.stderr)
        if not indices:
            continue
        idx = np.concatenate(indices)
        idx = idx[idx < preds.shape[1]]
        if idx.size == 0:
            continue
        series.append({
            "key": group["key"],
            "label": group["label"],
            "color": group["color"],
            "values": normalize(np.abs(preds[:, idx]).mean(axis=1)),
        })
    return series


def main() -> int:
    args = parse_args()

    source = Path(args.input).expanduser().resolve()
    if not source.is_file():
        raise SystemExit(f"素材が見つかりません: {source}")
    kind = resolve_input_kind(source)

    # `pip install -e .` をしていなくても動くように、ベンダーしたパッケージを import 対象へ足す
    if VENDOR_DIR.is_dir():
        sys.path.insert(0, str(VENDOR_DIR))

    try:
        from tribev2.demo_utils import TribeModel
    except ImportError as err:
        raise SystemExit(
            f"TRIBE v2 を読み込めません（{err}）。\n"
            f"Python 3.11 以上で次を実行してから、もう一度お試しください:\n"
            f"  pip install -e \"{VENDOR_DIR}\""
        ) from err

    print(f"[1/3] モデルを読み込みます: {args.checkpoint}")
    model = TribeModel.from_pretrained(
        args.checkpoint,
        cache_folder=args.cache,
        device=args.device,
        # 出力を 1 TR ずつ隙間なく並べたいので、空の区間も落とさずに残す
        config_update={"remove_empty_segments": False},
    )

    print(f"[2/3] 素材を解析します: {source.name}")
    events = model.get_events_dataframe(**{kind: str(source)})
    preds, segments = model.predict(events=events)
    preds = np.asarray(preds, dtype=np.float32)
    if preds.ndim != 2 or preds.shape[0] == 0:
        raise SystemExit(f"予測の形が想定と違います: {preds.shape}")

    tr = float(model.data.TR)
    series = [build_overall_series(preds), build_change_series(preds)]
    if args.roi:
        series.extend(build_roi_series(preds))

    payload = {
        "format": FORMAT_ID,
        "version": FORMAT_VERSION,
        "source": source.name,
        "sourcePath": str(source),
        # 1 点あたりの秒数。i 番目の値は再生時刻 i * tr 秒に対応する
        "tr": tr,
        "duration": round(preds.shape[0] * tr, 3),
        "lag": HEMODYNAMIC_LAG,
        "vertices": int(preds.shape[1]),
        "segments": len(segments),
        "generated": datetime.now().isoformat(timespec="seconds"),
        "series": series,
    }

    out_path = Path(args.output) if args.output else source.with_suffix(".tribe.json")
    out_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"[3/3] 書き出しました: {out_path}")
    print(f"      {preds.shape[0]} 点 / {payload['duration']} 秒 / TR {tr} 秒")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
