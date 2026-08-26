"""Build a backend/<YEAR>/ data folder from the two raw sources we download each year.

Inputs (raw, committed alongside the outputs for provenance):
  * NFL_ETR_Auction_Values.csv          - ETR auction values export
  * FantasyPros_<YEAR>_Draft_ALL_Rankings.csv - FantasyPros overall draft rankings

Outputs (what trial_backend.py actually reads):
  * Standard_Auction_Values.csv                 - Player/Team/Position/Value/Position Rank
  * FantasyPros_<YEAR>_Draft_{QB,RB,WR,TE}_Rankings.csv - PLAYER NAME/TIERS per position

Two format changes drove this script:

1. ETR's 2026 export dropped the single "Value" column in favour of one column
   per scoring format ("ETR Full PPR", "ETR Half PPR", ...) plus ADP and a gsis
   player id. We take full PPR (the league's scoring) as Value and keep the rest
   in the raw file.
2. FantasyPros now ships one combined ALL-positions export instead of four
   positional ones. Its TIERS column is an *overall* tier, so a QB starts at
   tier 4 and a TE at tier 3. The backend reasons about tiers within a position
   ("tier 1 RB"), so we dense-rank each position's overall tiers back to 1..N.
   That preserves FantasyPros' own tier breaks and only renumbers them.

Usage:
    python build_year_data.py --year 2026 \
        --etr /path/to/NFL_ETR_Auction_Values.csv \
        --fantasypros /path/to/FantasyPros_2026_Draft_ALL_Rankings.csv
"""

import argparse
import json
import os
import re

import pandas as pd

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

POSITIONS = ["QB", "RB", "WR", "TE"]

# Scoring format -> ETR column. The league is standard (non-PPR) scoring; the
# others are kept in the raw export so a variant only needs a different
# --scoring flag. Note this is unrelated to the Standard_Auction_Values.csv
# filename, which has meant "the canonical values file" since 2023.
SCORING_COLUMNS = {
    "full_ppr": "ETR Full PPR",
    "half_ppr": "ETR Half PPR",
    "standard": "ETR Std",
    "superflex_full": "ETR Superflex Full",
    "superflex_half": "ETR Superflex Half",
}

SUFFIXES = (" jr", " sr", " ii", " iii", " iv", " v")


def normalize_name(name):
    """Lowercase, drop punctuation and generational suffixes.

    Sleeper ships names without suffixes, FantasyPros ships them with, and ETR
    is inconsistent about periods ("AJ Brown" vs "A.J. Brown"). Normalizing all
    three the same way is what lets the mapping builder line them up.
    """
    name = str(name).lower().strip()
    name = re.sub(r"[.'`]", "", name)
    name = re.sub(r"[-]", " ", name)
    name = re.sub(r"\s+", " ", name)
    for suffix in SUFFIXES:
        if name.endswith(suffix):
            name = name[: -len(suffix)].strip()
    return name


def build_auction_values(etr_path, scoring="standard"):
    """Convert the ETR export into the Player/Team/Position/Value/Position Rank schema."""
    etr = pd.read_csv(etr_path)
    value_column = SCORING_COLUMNS[scoring]
    if value_column not in etr.columns:
        raise KeyError(
            f"{etr_path} has no '{value_column}' column. Found: {list(etr.columns)}. "
            "If ETR changed their export again, update SCORING_COLUMNS."
        )

    out = pd.DataFrame({
        "Player": etr["Player"].astype(str).str.strip(),
        "Team": etr["Team"].astype(str).str.strip(),
        "Position": etr["Position"].astype(str).str.strip(),
        "Value": pd.to_numeric(etr[value_column], errors="coerce").fillna(0).astype(int),
    })

    # Position Rank ("RB1", "WR12") is ordered by value within position; the ETR
    # export is already value-sorted, so a stable sort keeps their tiebreaks.
    out = out.sort_values("Value", ascending=False, kind="stable").reset_index(drop=True)
    out["Position Rank"] = out.groupby("Position").cumcount().add(1)
    out["Position Rank"] = out["Position"] + out["Position Rank"].astype(str)

    # Bare numbers, matching the 2025 export. Readers go through to_dollars(),
    # which also accepts the "$76" form used in 2023/2024.
    return out


def build_positional_rankings(fantasypros_path):
    """Split the ALL-positions FantasyPros export into per-position frames.

    Returns {position: DataFrame}. TIERS is dense-ranked within the position;
    OVERALL TIER keeps the original value so the transformation is auditable.
    """
    ranks = pd.read_csv(fantasypros_path)
    # FantasyPros interleaves blank tier-separator rows into the export.
    ranks = ranks.dropna(subset=["RK", "PLAYER NAME", "POS"]).copy()
    ranks["RK"] = ranks["RK"].astype(int)
    ranks["POSITION"] = ranks["POS"].astype(str).str.extract(r"^([A-Z]+)")

    frames = {}
    for position in POSITIONS:
        subset = ranks[ranks["POSITION"] == position].copy()
        if subset.empty:
            raise ValueError(f"No {position} rows in {fantasypros_path}")

        subset = subset.sort_values("RK", kind="stable").reset_index(drop=True)
        overall_tiers = subset["TIERS"]
        # Dense-rank: overall tiers [4, 5, 7] at QB become QB tiers [1, 2, 3].
        subset["OVERALL TIER"] = overall_tiers
        subset["OVERALL RK"] = subset["RK"]
        subset["TIERS"] = overall_tiers.rank(method="dense").astype(int)
        subset["RK"] = subset["POS"].astype(str).str.extract(r"(\d+)$").astype(int)

        frames[position] = subset[[
            "RK", "TIERS", "PLAYER NAME", "TEAM", "POS", "BYE WEEK",
            "SOS SEASON", "ECR VS. ADP", "OVERALL RK", "OVERALL TIER",
        ]]
    return frames


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--year", required=True, help="Season year, e.g. 2026")
    parser.add_argument("--etr", required=True, help="Path to the raw ETR auction values export")
    parser.add_argument("--fantasypros", required=True, help="Path to the raw FantasyPros ALL rankings export")
    parser.add_argument("--scoring", default="standard", choices=sorted(SCORING_COLUMNS),
                        help="Which ETR column becomes Value (default: standard, the league's scoring)")
    parser.add_argument("--out-dir", default=None, help="Defaults to backend/<year>/")
    args = parser.parse_args()

    out_dir = args.out_dir or os.path.join(BASE_DIR, args.year)
    os.makedirs(out_dir, exist_ok=True)

    auction_values = build_auction_values(args.etr, args.scoring)
    auction_path = os.path.join(out_dir, "Standard_Auction_Values.csv")
    auction_values.to_csv(auction_path, index=False, quoting=1)
    print(f"{auction_path}: {len(auction_values)} players ({args.scoring})")

    rankings = build_positional_rankings(args.fantasypros)
    for position, frame in rankings.items():
        path = os.path.join(out_dir, f"FantasyPros_{args.year}_Draft_{position}_Rankings.csv")
        frame.to_csv(path, index=False, quoting=1)
        print(f"{path}: {len(frame)} players, tiers 1-{frame['TIERS'].max()}")

    # Which scoring format a year folder was built from is invisible from the
    # files themselves — Standard_Auction_Values.csv is named for its role, not
    # for standard scoring. Record it so nobody has to guess later.
    info = {
        "year": args.year,
        "scoring": args.scoring,
        "value_column": SCORING_COLUMNS[args.scoring],
        "sources": {
            "auction_values": os.path.basename(args.etr),
            "rankings": os.path.basename(args.fantasypros),
        },
        "counts": {"auction_values": len(auction_values),
                   **{position: len(frame) for position, frame in rankings.items()}},
    }
    info_path = os.path.join(out_dir, "build_info.json")
    with open(info_path, "w") as handle:
        json.dump(info, handle, indent=2)
        handle.write("\n")
    print(f"{info_path}: built from {info['value_column']}")


if __name__ == "__main__":
    main()
