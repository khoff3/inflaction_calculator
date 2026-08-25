"""Generate the annual player_name_mappings.csv anomaly file.

trial_backend.py looks players up by their *Sleeper* name. When that exact
string is missing from ETR's auction values or FantasyPros' rankings, it falls
back to this mapping file; without a row the player silently gets $0 and no
tier, which quietly corrupts the inflation denominator mid-draft.

The three sources disagree in predictable ways:
  * Sleeper drops generational suffixes  (Kenneth Walker  / Kenneth Walker III)
  * ETR drops periods                    (AJ Brown        / A.J. Brown)
  * nicknames differ outright            (Hollywood Brown / Marquise Brown)

The first two are resolved automatically by normalizing; the third needs a
human, so anything unresolved is reported loudly rather than guessed at.

Usage:
    python build_player_mappings.py --year 2026
    python build_player_mappings.py --year 2026 --draft-id 1392544863014121472

With --draft-id the Sleeper API supplies the names; otherwise they come from
<year>/sleeper_draft_names.csv, a checked-in snapshot of a real draft's picks.
"""

import argparse
import csv
import os

import pandas as pd

from build_year_data import POSITIONS, normalize_name

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# Below this token-similarity we refuse to guess and ask for a manual row.
FUZZY_THRESHOLD = 88

# Nicknames that normalizing and fuzzy matching both miss, because the strings
# genuinely differ. Keyed by normalized Sleeper name; add to this as the room
# turns up new ones. Kept here rather than in the CSV so the CSV stays a
# generated artifact.
KNOWN_ALIASES = {
    "kenny gainwell": "Kenneth Gainwell",
    "hollywood brown": "Marquise Brown",
    "gabe davis": "Gabriel Davis",
    "cam ward": "Cameron Ward",
    "chig okonkwo": "Chigoziem Okonkwo",
}

# Drafted players confirmed absent from BOTH sources, so the $0 price is the
# data talking rather than a broken lookup. Re-check these each year; an entry
# here suppresses the hard failure but not the warning.
KNOWN_ABSENT = {
    "jayden higgins",  # 2026: dropped from the FantasyPros export we pulled; went for $1
}


def _fuzzy_match(name, choices):
    """Best match above FUZZY_THRESHOLD, or None. Prefers fuzzywuzzy, falls back to difflib."""
    try:
        from fuzzywuzzy import fuzz, process
        match = process.extractOne(name, choices, scorer=fuzz.token_sort_ratio)
        if match and match[1] >= FUZZY_THRESHOLD:
            return match[0]
        return None
    except ImportError:
        import difflib
        hits = difflib.get_close_matches(name, choices, n=1, cutoff=FUZZY_THRESHOLD / 100)
        return hits[0] if hits else None


def sleeper_names_from_api(draft_id):
    import requests
    response = requests.get(f"https://api.sleeper.app/v1/draft/{draft_id}/picks", timeout=30)
    response.raise_for_status()
    return [
        (f"{pick['metadata']['first_name']} {pick['metadata']['last_name']}".strip(),
         pick['metadata']['position'])
        for pick in response.json()
    ]


def sleeper_names_from_csv(path):
    frame = pd.read_csv(path)
    return list(zip(frame["Sleeper Name"].astype(str), frame["Position"].astype(str)))


class NameIndex:
    """Exact / normalized / fuzzy lookup over one source's player names."""

    def __init__(self, names):
        self.names = [str(n) for n in names]
        self.exact = set(self.names)
        self.normalized = {}
        for name in self.names:
            self.normalized.setdefault(normalize_name(name), name)

    def resolve(self, name):
        """Return (matched_name, how). how is one of exact/alias/normalized/fuzzy/None."""
        if name in self.exact:
            return name, "exact"
        normalized = self.normalized.get(normalize_name(name))
        if normalized:
            return normalized, "normalized"
        alias = KNOWN_ALIASES.get(normalize_name(name))
        if alias:
            resolved = self.normalized.get(normalize_name(alias))
            if resolved:
                return resolved, "alias"
        fuzzy = _fuzzy_match(name, self.names)
        if fuzzy:
            return fuzzy, "fuzzy"
        return None, None


def build(year, sleeper_picks, data_dir):
    auction_values = pd.read_csv(os.path.join(data_dir, "Standard_Auction_Values.csv"))
    rankings = {
        position: pd.read_csv(os.path.join(data_dir, f"FantasyPros_{year}_Draft_{position}_Rankings.csv"))
        for position in POSITIONS
    }

    auction_index = NameIndex(auction_values["Player"])
    ranking_index = {p: NameIndex(frame["PLAYER NAME"]) for p, frame in rankings.items()}

    rows, unresolved, low_confidence, unpriced = [], [], [], []

    for name, position in sleeper_picks:
        if position not in POSITIONS:
            continue  # K and DEF carry no value or tier in this league

        auction_name, auction_how = auction_index.resolve(name)
        tier_name, tier_how = ranking_index[position].resolve(name)

        if auction_name is None and tier_name is None:
            # In neither source: the backend prices them at $0 with no tier, so
            # this needs eyes before draft day unless we already signed off.
            if normalize_name(name) not in KNOWN_ABSENT:
                unresolved.append((name, position))
            else:
                unpriced.append((name, position, "auction value and tier"))
            continue

        if auction_name is None or tier_name is None:
            # In one source only — normal for free agents and late-camp risers.
            # Still worth a row so the side that does resolve keeps working; the
            # missing side falls through to the backend's $0 / 'N/A' default.
            unpriced.append((name, position, "auction value" if auction_name is None else "tier"))
            auction_name = auction_name or name
            tier_name = tier_name or name
        elif auction_how == "exact" and tier_how == "exact":
            continue  # no mapping row needed
        elif "fuzzy" in (auction_how, tier_how):
            low_confidence.append((name, position, auction_name, tier_name))

        rows.append({
            "Sleeper Name": name,
            "Position": position,
            "Auction Value Name": auction_name,
            "Tier Name": tier_name,
        })

    return rows, unresolved, low_confidence, unpriced


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--year", required=True)
    parser.add_argument("--draft-id", default=None, help="Fetch names from a live Sleeper draft instead of the snapshot")
    parser.add_argument("--out", default=None, help="Defaults to <year>/player_name_mappings.csv")
    args = parser.parse_args()

    data_dir = os.path.join(BASE_DIR, args.year)
    if args.draft_id:
        picks = sleeper_names_from_api(args.draft_id)
    else:
        picks = sleeper_names_from_csv(os.path.join(data_dir, "sleeper_draft_names.csv"))
    print(f"{len(picks)} picks in")

    rows, unresolved, low_confidence, unpriced = build(args.year, picks, data_dir)

    out_path = args.out or os.path.join(data_dir, "player_name_mappings.csv")
    with open(out_path, "w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=["Sleeper Name", "Position", "Auction Value Name", "Tier Name"])
        writer.writeheader()
        writer.writerows(sorted(rows, key=lambda r: (r["Position"], r["Sleeper Name"])))
    print(f"{out_path}: {len(rows)} anomaly rows")

    # A durable, reviewable record of who the sources don't cover. The mapping
    # tests treat this file as the list of $0 prices we've signed off on, so an
    # unexpected new name shows up as a test failure rather than a silent zero.
    unpriced_path = os.path.join(os.path.dirname(out_path), "unpriced_players.csv")
    with open(unpriced_path, "w", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["Sleeper Name", "Position", "Missing From"])
        writer.writerows(sorted(unpriced))
    print(f"{unpriced_path}: {len(unpriced)} players the sources don't cover")

    for name, position, auction_name, tier_name in low_confidence:
        print(f"  REVIEW   {name} ({position}) -> auction={auction_name!r} tier={tier_name!r} [fuzzy]")
    for name, position, missing in unpriced:
        print(f"  ABSENT   {name} ({position}): not in the {missing} source — defaults to $0/N-A")
    for name, position in unresolved:
        print(f"  MANUAL   {name} ({position}): in neither source — add a KNOWN_ALIASES entry or a row by hand")

    if unresolved or low_confidence:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
