import pandas as pd
import requests
import json
import numpy as np
import math
import os
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import logging
from sklearn.linear_model import LinearRegression
from sklearn.metrics import r2_score
import glob
from fuzzywuzzy import process
from typing import List, Dict, Any, Optional
from pydantic import BaseModel
import uvicorn
import asyncio
from concurrent.futures import ThreadPoolExecutor
from starlette.concurrency import run_in_threadpool
import time
from collections import defaultdict
import pickle
from pathlib import Path

# Define base directory
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

def get_latest_data_folder(base_dir):
    """Retrieve the most recent year folder for data files.

    Selected by folder name, not mtime: a fresh clone stamps every folder with
    the same checkout time, which made the choice between 2025/ and 2026/
    arbitrary.
    """
    year_folders = glob.glob(os.path.join(base_dir, "20[0-9][0-9]"))
    if not year_folders:
        raise FileNotFoundError(f"No 20NN data folder found under {base_dir}")
    return max(year_folders, key=lambda p: os.path.basename(p))

# Use the latest data folder. DATA_YEAR pins a specific one, which is how you
# re-run a prior season's numbers without moving files around.
LATEST_DATA_DIR = (
    os.path.join(BASE_DIR, os.environ['DATA_YEAR'])
    if os.environ.get('DATA_YEAR')
    else get_latest_data_folder(BASE_DIR)
)
LATEST_YEAR = os.path.basename(LATEST_DATA_DIR)

# Dynamic paths
EXPECTED_VALUES_PATH = os.path.join(LATEST_DATA_DIR, 'Standard_Auction_Values.csv')
MAPPINGS_PATH = os.path.join(LATEST_DATA_DIR, 'player_name_mappings.csv')

# Dynamic filenames for CSV data
csv_filenames = {
    'QB': f'FantasyPros_{LATEST_YEAR}_Draft_QB_Rankings.csv',
    'RB': f'FantasyPros_{LATEST_YEAR}_Draft_RB_Rankings.csv',
    'WR': f'FantasyPros_{LATEST_YEAR}_Draft_WR_Rankings.csv',
    'TE': f'FantasyPros_{LATEST_YEAR}_Draft_TE_Rankings.csv'
}

def to_dollars(raw_value) -> float:
    """Auction values arrive as "$25" or bare 25 depending on the export vintage."""
    if isinstance(raw_value, str):
        cleaned = raw_value.replace('$', '').replace(',', '').strip()
        return float(cleaned) if cleaned else 0.0
    try:
        return float(raw_value)
    except (TypeError, ValueError):
        return 0.0


# League shape. Matches the real Sleeper league; the $200 also appears in
# team_breakdown, which predates these constants.
LEAGUE_TEAMS = 12
LEAGUE_BUDGET = 200
# 2026 dropped the kicker slot. The roster stayed 16 deep, so that seat became
# bench; ROSTER_SLOTS overrides it if the league shortened the roster instead.
ROSTER_SLOTS = int(os.environ.get('ROSTER_SLOTS', 16))

# Kickers are not rostered in 2026, so they are dropped from the board entirely
# rather than sitting there as undraftable value. They were worth $1 of
# contested value on the whole sheet, so nothing downstream moves.
UNROSTERED_POSITIONS = {'K'}

# Measured over this league's 60 team-seasons (2021-2025, stag_drafts):
# $1 buys are 33% of all picks but only 2.6% of all dollars, and every roster
# ends up with 5.2 of them on average (median 5, range 0-10). They are roster
# filler rather than a market - including them in an inflation figure just
# drags it toward 1.0 and hides what the contested players are doing.
# One of those 5.2 was the kicker, which 2026 no longer rosters.
TYPICAL_DOLLAR_SLOTS_PER_ROSTER = 4.2

# Starter slots that cost real money. DEF is a starter too but is $1 filler by
# construction (it averages $1.2 a pick here), so it generates no contested
# demand and is left out of the need model; K is no longer rostered at all.
STARTER_SLOTS = {'QB': 1, 'RB': 2, 'WR': 3, 'TE': 1}
FLEX_SLOTS = 1
FLEX_POSITIONS = ('RB', 'WR', 'TE')

# Also measured over the 60 team-seasons, and used only to split an open FLEX
# across the three positions that can fill it:
#   pos   $/team   share  picks/team  $/pick
#    QB     16.7    8.4%        1.5     11.1
#    RB     88.6   44.4%        5.0     17.9
#    WR     77.5   38.9%        6.0     12.8
#    TE     14.0    7.0%        1.4     10.2
HISTORICAL_SPEND_SHARE = {'QB': 0.084, 'RB': 0.444, 'WR': 0.389, 'TE': 0.070}


# Initialize FastAPI app
app = FastAPI(
    title="Fantasy Football Inflation Calculator API (Enhanced)",
    description="Enhanced FastAPI backend with caching and real-time capabilities",
    version="3.0.0"
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Rate limiting removed - frontend is now much more conservative

# Configure logging
logging.basicConfig(level=logging.INFO)

# Define position colors for scatter plot (Underdog style)
POSITION_COLORS = {
    "QB": "#8A2BE2",  # Purple
    "RB": "#32CD32",  # Green
    "WR": "#FF8C00",  # Orange
    "TE": "#1E90FF",  # Blue
    "K": "#FFD700",   # Gold
    "DEF": "#696969"  # Gray
}

# Pydantic models
class PlayerLookupRequest(BaseModel):
    players: List[Dict[str, str]]

class DraftIdRequest(BaseModel):
    draft_id: str

# Enhanced Memory Management and Caching
def _unmet_needs(roster):
    """Starter slots this team still has to fill, in fractional slots.

    The FLEX is the only awkward part. It is covered by whatever spills over
    from RB/WR/TE, so it only creates demand once a team has no surplus - and
    when it does, that demand is not attached to any one position. Splitting it
    across RB/WR/TE by their historical spend share is the honest reading: a
    team with an open flex shops all three, but bids like a room that puts
    44 cents of every dollar into RBs.

    Bench slots are deliberately not need. A bench pick is discretionary
    best-available, which the money model handles separately - counting six
    bench seats as demand at every position would swamp the starter signal.
    """
    needs = {}
    surplus = 0.0
    for position, required in STARTER_SLOTS.items():
        have = roster.get(position, 0)
        needs[position] = float(max(required - have, 0))
        if position in FLEX_POSITIONS:
            surplus += max(have - required, 0)

    flex_open = max(FLEX_SLOTS - surplus, 0)
    if flex_open:
        weight_total = sum(HISTORICAL_SPEND_SHARE[p] for p in FLEX_POSITIONS)
        for position in FLEX_POSITIONS:
            needs[position] += flex_open * HISTORICAL_SPEND_SHARE[position] / weight_total
    return needs


def _positional_market(teams, buyable, spendable):
    """Where the room's remaining money is pointed, position by position.

    The headline multiplier treats the board as one market. It isn't. Twelve
    teams each fill a fixed roster shape, so when eight of them still need a WR
    and the WRs worth having have thinned out, that money has nowhere else to
    go and WR prices run over sheet while another position sits at par.

    Each team's spendable cash is split across the positions it still needs,
    weighted by the going rate there - the average price of the players who
    would actually fill those open slots. Weighting by a historical dollars-per-
    slot constant instead was the first attempt and it was wrong twice over: it
    started every draft off parity (reporting this room's chronic QB overspend
    rather than anything happening now), and in the endgame it pointed a whole
    wallet at a position whose last three players cost $2. A live going rate
    does neither, and it moves the way the effect being modelled moves - as a
    position thins out, the slots still needing filling stay put while the
    value behind them drains.

    A team with its starters already set is not out of the market; its money is
    best-available, so it follows the value still on the board.

    Every spendable dollar is allocated exactly once and the supply side is the
    same pool the headline uses, so these multipliers average to the headline
    number. Read them against it, not against 1.0.
    """
    avail = defaultdict(list)          # descending, buyable is already sorted
    value_by_position = defaultdict(float)
    for value, position in buyable:
        avail[position].append(value)
        value_by_position[position] += value - 1

    needy_teams = defaultdict(int)
    open_starters = defaultdict(float)
    for team in teams:
        for position, slots in team['needs'].items():
            if position in STARTER_SLOTS:
                open_starters[position] += slots
                if slots > 0 and team['slots_open'] > 0:
                    needy_teams[position] += 1

    # What it costs to fill one of those slots: the mean price of the top N
    # available, N being how many the league still has to fill. For WR that
    # averages forty-odd players deep and for QB a dozen, which is the point -
    # each position is priced at its own depth, not at its top.
    going_rate = {}
    for position in STARTER_SLOTS:
        values = avail.get(position, [])
        if not values:
            going_rate[position] = 0.0
            continue
        depth = min(len(values), max(1, int(math.ceil(open_starters.get(position, 0)))))
        going_rate[position] = sum(values[:depth]) / depth

    demand = defaultdict(float)
    for team in teams:
        wallet = team['spendable']
        if wallet <= 0:
            continue
        weights = {p: team['needs'].get(p, 0.0) * going_rate[p] for p in STARTER_SLOTS}
        total = sum(weights.values())
        if total <= 0:
            weights = {p: value_by_position.get(p, 0.0) for p in STARTER_SLOTS}
            total = sum(weights.values())
        if total <= 0:
            continue
        for position, weight in weights.items():
            demand[position] += wallet * weight / total

    # Per-team spendable sums to the league figure in any draft Sleeper would
    # allow, since it caps a bid at what leaves a dollar for each open slot.
    # Scale anyway so the claim above - that these average to the headline -
    # holds whatever the data does.
    allocated = sum(demand.values())
    scale = spendable / allocated if allocated > 0 else 0.0

    # Nobody can pay more than the richest wallet in the room, which is the
    # only hard ceiling on a price. It is what keeps the endgame readable: when
    # seven teams still need a TE and one is left, the multiplier is 20x and
    # meaningless, but the price it implies is just "whatever the biggest stack
    # left will go to".
    ceiling = max((t['max_bid'] for t in teams), default=0)

    rows = []
    for position in STARTER_SLOTS:
        supply = value_by_position.get(position, 0.0)
        money = demand.get(position, 0.0) * scale
        rows.append({
            'position': position,
            'demand': round(money, 1),
            'supply': round(supply, 1),
            'players': len(avail.get(position, [])),
            'going_rate': round(going_rate[position], 1),
            'needy_teams': needy_teams.get(position, 0),
            'open_starters': round(open_starters.get(position, 0.0), 1),
            # Nobody left worth bidding on, and teams that still need one.
            'sold_out': not avail.get(position) and needy_teams.get(position, 0) > 0,
            'multiplier': round(money / supply, 3) if supply > 0 else None,
            # What the next starter at this position actually costs: the going
            # rate marked up by the position's own multiplier, above the $1
            # floor every player costs regardless, and capped by the wallet.
            'expected_next': (
                round(min(1 + (going_rate[position] - 1) * money / supply, ceiling), 1)
                if supply > 0 and going_rate[position] > 0 else None),
        })

    # Rank by how hot each position is relative to the board, which is what
    # tells you where to buy now and where to wait.
    board_money = sum(r['demand'] for r in rows)
    board_supply = sum(r['supply'] for r in rows)
    board = board_money / board_supply if board_supply > 0 else None
    for row in rows:
        row['vs_board'] = (round(row['multiplier'] / board, 3)
                           if board and row['multiplier'] is not None else None)
    rows.sort(key=lambda r: (r['multiplier'] is None, -(r['multiplier'] or 0)))
    return rows


class DataManager:
    """Centralized data manager with caching and memory optimization."""
    
    def __init__(self):
        self._data_cache = {}
        self._draft_cache = {}
        self._player_lookup_cache = {}
        self._inflation_cache = {}
        self._cache_timestamps = {}
        # Ceiling only — inflation is also invalidated whenever the draft changes,
        # so this bounds staleness during idle stretches, not during live bidding.
        self._cache_ttl = 300
        # Kept below the client poll interval (3s) on purpose: if the TTL met or
        # exceeded it, a poll could land on cache that was already a full cycle
        # old and the two delays would stack.
        self._draft_cache_ttl = 1
        self._lock = asyncio.Lock()
        
        # Pre-load static data
        self._load_static_data()
    
    def _load_static_data(self):
        """Load and cache static data files."""
        try:
            # Load mappings
            self._data_cache['mappings_df'] = pd.read_csv(MAPPINGS_PATH)
            self._data_cache['player_name_mappings'] = dict(
                zip(self._data_cache['mappings_df']['Sleeper Name'], 
                    self._data_cache['mappings_df']['Auction Value Name'])
            )
            
            # Load auction values
            self._data_cache['auction_values_df'] = pd.read_csv(EXPECTED_VALUES_PATH)
            
            # Load positional rankings
            self._data_cache['positional_rankings'] = {}
            for position, filename in csv_filenames.items():
                file_path = os.path.join(LATEST_DATA_DIR, filename)
                self._data_cache['positional_rankings'][position] = pd.read_csv(file_path)
            
            # Create optimized lookup tables
            self._create_lookup_tables()
            self._build_board()
            
            logging.info(f"Static data loaded successfully for year {LATEST_YEAR}")
            
        except Exception as e:
            logging.error(f"Error loading static data: {e}")
            raise
    
    def _create_lookup_tables(self):
        """Create optimized lookup tables for faster access."""
        # Player name to auction value lookup
        self._data_cache['player_auction_lookup'] = {}
        for _, row in self._data_cache['auction_values_df'].iterrows():
            self._data_cache['player_auction_lookup'][row['Player']] = {
                'value': row['Value'],
                'position': row.get('Position', 'N/A')
            }
        
        # Positional tier lookups from FantasyPros rankings
        self._data_cache['positional_tier_lookups'] = {}
        for position, df in self._data_cache['positional_rankings'].items():
            self._data_cache['positional_tier_lookups'][position] = {}
            for _, row in df.iterrows():
                player_name = row['PLAYER NAME']
                tier = row.get('TIERS', 'N/A')
                self._data_cache['positional_tier_lookups'][position][player_name] = tier
        
        # Anomaly mappings
        self._data_cache['anomaly_mappings'] = {}
        self._data_cache['player_mappings'] = {}
        for _, row in self._data_cache['mappings_df'].iterrows():
            sleeper_name = row['Sleeper Name']
            auction_name = row['Auction Value Name']
            tier_name = row['Tier Name']
            self._data_cache['anomaly_mappings'][sleeper_name] = {
                'auction_name': auction_name,
                'tier_name': tier_name
            }
            # Create mapping with sleeper name as key for available players logic
            self._data_cache['player_mappings'][sleeper_name] = {
                'auction_name': auction_name,
                'tier_name': tier_name
            }
    
    def _build_board(self):
        """Resolve every auction-value row to its tier once, at load.

        This is the whole board with tiers attached, and none of it changes
        during a draft - only which names are already taken. The available
        players endpoint used to rebuild it per request, rescanning the ranking
        frames and rerunning fuzzy matches for ~360 undrafted players every few
        seconds, which cost about 450ms a call. Doing it once turns that into a
        set difference.
        """
        auction_values = self._data_cache['auction_values_df']
        tier_lookups = self._data_cache['positional_tier_lookups']
        mappings = self._data_cache['player_mappings']
        # Fuzzy matching needs the candidate list; build it per position rather
        # than per player.
        names_by_position = {pos: list(names) for pos, names in tier_lookups.items()}

        board = []
        for _, row in auction_values.iterrows():
            name = str(row['Player'])
            position = str(row['Position']).upper()
            if position in UNROSTERED_POSITIONS:
                continue
            lookup = tier_lookups.get(position, {})

            tier = lookup.get(name)
            if tier is None:
                mapped = mappings.get(name, {}).get('tier_name')
                if mapped:
                    tier = lookup.get(mapped)
            if tier is None and names_by_position.get(position):
                match = process.extractOne(name, names_by_position[position], score_cutoff=80)
                if match:
                    tier = lookup.get(match[0])

            value = to_dollars(row['Value']) if pd.notna(row['Value']) else 0.0
            board.append({
                'name': name,
                'position': position,
                'team': str(row.get('Team', 'N/A')),
                'auction_value': value,
                'expected_value': value,
                'tier': 'N/A' if tier is None or pd.isna(tier) else str(tier),
                'position_rank': str(row.get('Position Rank', 'N/A')),
            })
        board.sort(key=lambda p: p['auction_value'], reverse=True)
        self._data_cache['board'] = board
        # Keyed by name, so a drafted pick can be resolved back to its board
        # row - its value, its tier and its positional rank.
        self._data_cache['board_by_name'] = {p['name']: p for p in board}
        logging.info(f"Prebuilt board of {len(board)} players with tiers")

    def _create_draft_hash(self, draft_data: List[Dict[str, Any]]) -> str:
        """Create a hash of draft data to detect changes."""
        import hashlib
        # Create a simple hash based on pick count and last pick timestamp
        if not draft_data:
            return hashlib.md5("empty".encode()).hexdigest()
        
        # Use pick count and last pick data for hash
        pick_count = len(draft_data)
        last_pick = draft_data[-1] if draft_data else {}
        last_pick_info = f"{pick_count}_{last_pick.get('pick_no', 0)}_{last_pick.get('player_id', '')}"
        
        return hashlib.md5(last_pick_info.encode()).hexdigest()
    
    async def get_draft_data(self, draft_id: str) -> List[Dict[str, Any]]:
        """Get draft data with smart caching and change detection."""
        cache_key = f"draft_{draft_id}"
        
        # Check cache first
        if cache_key in self._draft_cache:
            timestamp = self._cache_timestamps.get(cache_key, 0)
            if time.time() - timestamp < self._draft_cache_ttl:
                logging.info(f"Returning cached draft data for {draft_id}")
                return self._draft_cache[cache_key]
        
        # Fetch fresh data
        async with self._lock:
            try:
                url = f"https://api.sleeper.app/v1/draft/{draft_id}/picks"
                response = requests.get(url, timeout=10)
                
                if response.status_code == 200:
                    draft_data = response.json()
                    
                    # Create hash of current draft state for change detection
                    draft_hash = self._create_draft_hash(draft_data)
                    last_hash = self._data_cache.get(f"draft_hash_{draft_id}")
                    
                    # Only update cache if data has actually changed
                    if draft_hash != last_hash:
                        logging.info(f"New draft data detected for {draft_id}, updating cache")
                        self._draft_cache[cache_key] = draft_data
                        self._cache_timestamps[cache_key] = time.time()
                        self._data_cache[f"draft_hash_{draft_id}"] = draft_hash
                    else:
                        logging.info(f"No changes detected for {draft_id}, extending cache")
                        # Extend cache timestamp even if no changes
                        self._cache_timestamps[cache_key] = time.time()
                    
                    return self._draft_cache[cache_key]
                    
                    logging.info(f"Fetched and cached draft data for {draft_id}")
                    return draft_data
                else:
                    logging.error(f"Error fetching draft data for {draft_id}: {response.status_code}")
                    return []
                    
            except Exception as e:
                logging.error(f"Exception fetching draft data for {draft_id}: {e}")
                return []
    
    def get_player_info_optimized(self, player_name: str, position: str) -> tuple:
        """Optimized player info lookup using cached data."""
        # Direct lookup in auction values
        auction_value = 0
        if player_name in self._data_cache['player_auction_lookup']:
            player_data = self._data_cache['player_auction_lookup'][player_name]
            auction_value = player_data['value']
        
        # Get tier from FantasyPros positional rankings
        tier = 'N/A'
        if position in self._data_cache['positional_tier_lookups']:
            if player_name in self._data_cache['positional_tier_lookups'][position]:
                tier = self._data_cache['positional_tier_lookups'][position][player_name]
        
        # Check player mappings first (most reliable)
        if player_name in self._data_cache['player_mappings']:
            mapping = self._data_cache['player_mappings'][player_name]
            auction_name = mapping.get('auction_name', player_name)
            tier_name = mapping.get('tier_name', player_name)
            
            # Look up auction value using mapped name
            if auction_name in self._data_cache['player_auction_lookup']:
                auction_value = self._data_cache['player_auction_lookup'][auction_name]['value']
            
            # Look up tier using mapped name
            if position in self._data_cache['positional_tier_lookups']:
                if tier_name in self._data_cache['positional_tier_lookups'][position]:
                    tier = self._data_cache['positional_tier_lookups'][position][tier_name]
                    logging.info(f"Mapped '{player_name}' to '{tier_name}' for tier lookup")
        
        # Check anomaly mappings for both auction value and tier (legacy support)
        elif player_name in self._data_cache['anomaly_mappings']:
            anomaly = self._data_cache['anomaly_mappings'][player_name]
            auction_name = anomaly['auction_name']
            tier_name = anomaly['tier_name']
            
            # Look up auction value using mapped name
            if auction_name in self._data_cache['player_auction_lookup']:
                auction_value = self._data_cache['player_auction_lookup'][auction_name]['value']
            
            # Look up tier using mapped name
            if position in self._data_cache['positional_tier_lookups']:
                if tier_name in self._data_cache['positional_tier_lookups'][position]:
                    tier = self._data_cache['positional_tier_lookups'][position][tier_name]
        
        # Add fuzzy matching for tier lookup as last resort
        if tier == 'N/A' and position in self._data_cache['positional_tier_lookups']:
            from fuzzywuzzy import fuzz
            best_match = None
            best_score = 0
            
            for tier_name in self._data_cache['positional_tier_lookups'][position]:
                score = fuzz.ratio(player_name.lower(), tier_name.lower())
                if score > best_score and score >= 80:  # 80% similarity threshold
                    best_score = score
                    best_match = tier_name
            
            if best_match:
                tier = self._data_cache['positional_tier_lookups'][position][best_match]
                logging.info(f"Fuzzy matched '{player_name}' to '{best_match}' (score: {best_score})")
        
        return auction_value, tier
    
    async def get_inflation_data(self, draft_id: str) -> Dict[str, Any]:
        """Get inflation data, recomputed as soon as a pick lands.

        The draft is fetched first, outside the lock, for two reasons. It is
        cheap - get_draft_data has its own short-TTL cache - and it yields the
        current draft hash, which is what decides whether the cached inflation
        is still true. Time alone is not a safe test here: a pick can land a
        second after the cache is written, and a purely clock-based TTL would go
        on serving pre-pick numbers for the rest of the window. During a live
        auction that is the one number nobody can afford to have be stale.

        Fetching outside the lock also avoids a deadlock: asyncio.Lock is not
        reentrant, and get_draft_data acquires this same lock whenever its own
        cache misses.
        """
        cache_key = f"inflation_{draft_id}"
        hash_key = f"inflation_draft_hash_{draft_id}"

        draft_data = await self.get_draft_data(draft_id)
        if not draft_data:
            raise HTTPException(status_code=404, detail="No draft data found")
        draft_hash = self._create_draft_hash(draft_data)

        if cache_key in self._inflation_cache:
            age = time.time() - self._cache_timestamps.get(cache_key, 0)
            if age < self._cache_ttl and self._data_cache.get(hash_key) == draft_hash:
                logging.info(f"Returning cached inflation data for {draft_id}")
                return self._inflation_cache[cache_key]
            if self._data_cache.get(hash_key) != draft_hash:
                logging.info(f"Draft changed for {draft_id}, recalculating inflation")

        async with self._lock:
            inflation_data = self._calculate_inflation_rates_optimized(draft_data)
            self._inflation_cache[cache_key] = inflation_data
            self._cache_timestamps[cache_key] = time.time()
            self._data_cache[hash_key] = draft_hash

            logging.info(f"Calculated and cached inflation data for {draft_id}")
            return inflation_data
    
    def _calculate_inflation_rates_optimized(self, draft_data: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Optimized inflation calculation using cached data."""
        # Use cached auction values
        auction_values_df = self._data_cache['auction_values_df']
        
        # Calculate total spent and expected values
        total_spent = 0
        total_expected = 0
        positional_data = defaultdict(lambda: {'spent': 0, 'expected': 0, 'players': []})
        
        for player in draft_data:
            if player['metadata']['position'] in ['K', 'DEF']:
                continue
                
            player_name = f"{player['metadata']['first_name']} {player['metadata']['last_name']}"
            amount = int(player['metadata']['amount'])
            position = player['metadata']['position']
            
            total_spent += amount
            
            # Expected value must come from the mapping-aware lookup, not a raw
            # dict hit. Sleeper spells names differently from ETR (A.J. Brown /
            # AJ Brown), and a direct-only lookup silently scored every one of
            # those at $0 - shrinking total_expected and inflating the result.
            raw_value, _ = self.get_player_info_optimized(player_name, position)
            expected_value = to_dollars(raw_value)
            
            total_expected += expected_value
            positional_data[position]['spent'] += amount
            positional_data[position]['expected'] += expected_value
            positional_data[position]['players'].append({
                'name': player_name,
                'amount': amount,
                'expected': expected_value
            })
        
        # Calculate overall inflation
        overall_inflation = (total_spent - total_expected) / total_expected if total_expected > 0 else 0
        
        # Calculate positional inflation
        positional_inflation = {}
        for pos, data in positional_data.items():
            if data['expected'] > 0:
                positional_inflation[pos] = (data['spent'] - data['expected']) / data['expected']
            else:
                positional_inflation[pos] = 0
        
        return {
            'overall_inflation': overall_inflation,
            'positional_inflation': dict(positional_inflation),
            'total_spent': total_spent,
            'total_expected': total_expected,
            'positional_data': dict(positional_data)
        }
    
    def get_draft_economy(self, draft_data: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Forward-looking auction state: money left against value left.

        Everything else in this app is backward-looking - it reports what has
        already been paid. The number you bid against is the other one: how much
        cash is still in the room versus how much value is still on the board.

        Two details decide whether that number is honest:

        * Every open roster slot needs a dollar, so a team's spendable money is
          its budget minus its remaining slots, not its remaining balance. The
          same reserve applies league-wide. Ignore it and the multiplier runs
          away exactly in the endgame, when it matters most.
        * Only as many players as there are open slots can still be bought, so
          the value pool is the top N undrafted players, not the whole sheet.
          Summing all 450-odd would understate inflation badly.

        Both sides are measured above the $1 floor so they are comparable.
        """
        mappings = self._data_cache['player_mappings']

        drafted = set()
        spend_by_slot = defaultdict(int)
        picks_by_slot = defaultdict(int)
        roster_by_slot = defaultdict(lambda: defaultdict(int))
        for pick in draft_data:
            meta = pick.get('metadata', {})
            name = f"{meta.get('first_name', '')} {meta.get('last_name', '')}".strip()
            drafted.add(name)
            mapped = mappings.get(name, {}).get('auction_name')
            if mapped:
                drafted.add(mapped)
            slot = pick.get('draft_slot')
            if slot is not None:
                spend_by_slot[slot] += int(meta.get('amount', 0))
                picks_by_slot[slot] += 1
                roster_by_slot[slot][str(meta.get('position', '')).upper()] += 1

        slots = sorted(spend_by_slot) or list(range(1, LEAGUE_TEAMS + 1))
        slots = sorted(set(slots) | set(range(1, LEAGUE_TEAMS + 1)))

        teams = []
        for slot in slots:
            spent = spend_by_slot.get(slot, 0)
            filled = picks_by_slot.get(slot, 0)
            open_slots = max(ROSTER_SLOTS - filled, 0)
            remaining = LEAGUE_BUDGET - spent
            # Hold back a dollar for every slot after the one being bid on.
            max_bid = max(remaining - max(open_slots - 1, 0), 0) if open_slots else 0
            needs = _unmet_needs(roster_by_slot.get(slot, {}))
            teams.append({
                'slot': slot, 'spent': spent, 'remaining': remaining,
                'slots_filled': filled, 'slots_open': open_slots, 'max_bid': max_bid,
                # Money this team can actually put on contested players, holding
                # back a dollar for each of its other open slots.
                'spendable': max(remaining - open_slots, 0),
                'needs': {k: round(v, 2) for k, v in needs.items() if v > 0},
            })

        total_pot = LEAGUE_TEAMS * LEAGUE_BUDGET
        spent_total = sum(t['spent'] for t in teams)
        remaining_total = total_pot - spent_total
        slots_open = sum(t['slots_open'] for t in teams)
        spendable = max(remaining_total - slots_open, 0)

        # Only players worth more than a dollar get bid on. The $1 tail is
        # filler every roster takes regardless of the market, so it belongs on
        # neither side of an inflation ratio.
        # The prebuilt board is already sorted by price and already has the
        # unrostered positions stripped out.
        contested = [(p['auction_value'], p['position'])
                     for p in self._data_cache['board']
                     if p['auction_value'] > 1 and p['name'] not in drafted]
        # No more of them can be bought than there are seats left.
        buyable = contested[:slots_open] if slots_open else []
        by_position = defaultdict(float)
        for value, position in buyable:
            by_position[position] += value - 1
        value_remaining = sum(value - 1 for value, _ in buyable)
        filler_slots = max(slots_open - len(buyable), 0)

        positions = _positional_market(teams, buyable, spendable)

        return {
            'teams': LEAGUE_TEAMS,
            'budget_per_team': LEAGUE_BUDGET,
            'roster_slots': ROSTER_SLOTS,
            'total_pot': total_pot,
            'spent': spent_total,
            'remaining': remaining_total,
            'slots_filled': sum(t['slots_filled'] for t in teams),
            'slots_open': slots_open,
            'spendable': spendable,
            'value_remaining': round(value_remaining, 1),
            'contested_players': len(buyable),
            'filler_slots': filler_slots,
            'typical_filler_slots': round(TYPICAL_DOLLAR_SLOTS_PER_ROSTER * LEAGUE_TEAMS),
            # >1 means the room has more cash than board: everything left goes
            # over sheet. <1 means bargains are coming.
            'inflation': round(spendable / value_remaining, 3) if value_remaining > 0 else None,
            'value_remaining_by_position': {k: round(v, 1) for k, v in sorted(by_position.items())},
            'positions': positions,
            'price_ladder': self._price_ladder(
                spendable / value_remaining if value_remaining > 0 else None),
            'teams_detail': teams,
        }

    @staticmethod
    def _price_ladder(multiplier, rungs=(2, 5, 10, 20, 30, 40, 50, 60)):
        # A bare multiplier is hard to bid against. Every player costs a dollar
        # regardless of the market, so only the amount above that floor
        # inflates: expected = 1 + (sheet - 1) * multiplier.
        if multiplier is None:
            return []
        return [{'sheet': rung, 'expected': round(1 + (rung - 1) * multiplier, 1)}
                for rung in rungs]

    def get_cache_stats(self) -> Dict[str, Any]:
        """Get cache statistics."""
        return {
            'draft_cache_size': len(self._draft_cache),
            'inflation_cache_size': len(self._inflation_cache),
            'static_data_loaded': bool(self._data_cache),
            'cache_timestamps': self._cache_timestamps
        }
    
    def clear_cache(self, cache_type: str = 'all'):
        """Clear specific or all caches."""
        if cache_type == 'all' or cache_type == 'draft':
            self._draft_cache.clear()
        if cache_type == 'all' or cache_type == 'inflation':
            self._inflation_cache.clear()
        if cache_type == 'all':
            self._cache_timestamps.clear()
        
        logging.info(f"Cleared {cache_type} cache")

# Initialize data manager
data_manager = DataManager()

# Thread pool for async operations
executor = ThreadPoolExecutor(max_workers=10)

def sanitize_data(data: Any) -> Any:
    """Convert numpy data types to serializable types."""
    if isinstance(data, dict):
        return {str(sanitize_data(key)): sanitize_data(value) for key, value in data.items()}
    elif isinstance(data, list):
        return [sanitize_data(element) for element in data]
    elif isinstance(data, (np.generic, np.ndarray)):
        return data.tolist() if isinstance(data, np.ndarray) else data.item()
    elif isinstance(data, (int, float)):
        return str(data)
    return data

# FastAPI Routes

@app.get("/")
async def root():
    """Root endpoint with API information."""
    return {
        "message": "Enhanced Fantasy Football Inflation Calculator API",
        "version": "3.0.0",
        "latest_year": LATEST_YEAR,
        "docs": "/docs",
        "features": ["caching", "real-time", "optimized_lookups"]
    }

@app.get("/health")
async def health_check():
    """Health check endpoint with cache stats."""
    cache_stats = data_manager.get_cache_stats()
    return {
        "status": "healthy", 
        "latest_year": LATEST_YEAR,
        "cache_stats": cache_stats
    }

@app.get("/cache/stats")
async def get_cache_stats():
    """Get detailed cache statistics."""
    return data_manager.get_cache_stats()

@app.post("/cache/clear")
async def clear_cache(cache_type: str = 'all'):
    """Clear cache."""
    data_manager.clear_cache(cache_type)
    return {"message": f"Cleared {cache_type} cache"}

@app.get("/picks")
async def get_picks(draft_id: str = Query(..., description="Sleeper draft ID")):
    """Get raw picks data for a draft with caching."""
    draft_data = await data_manager.get_draft_data(draft_id)
    if not draft_data:
        raise HTTPException(status_code=404, detail="No draft data found")
    return draft_data

@app.get("/picks/count")
async def get_picks_count(draft_id: str = Query(..., description="Sleeper draft ID")):
    """Get just the pick count for change detection."""
    try:
        picks = await data_manager.get_draft_data(draft_id)
        return {"count": len(picks), "last_pick_no": picks[-1].get('pick_no', 0) if picks else 0}
    except Exception as e:
        logging.error(f"Error getting picks count for {draft_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/player_lookup")
async def player_lookup(request: PlayerLookupRequest):
    """Look up player auction values and tiers with optimized lookups."""
    try:
        results = []
        for player in request.players:
            player_name = f"{player['first_name']} {player['last_name']}"
            position = player['position']
            
            auction_value, tier = data_manager.get_player_info_optimized(player_name, position)
            
            results.append({
                'player_name': player_name,
                'auction_value': sanitize_data(auction_value),
                'tier': sanitize_data(tier)
            })
        
        return results
    except Exception as e:
        logging.error(f"Error processing player lookup: {str(e)}")
        raise HTTPException(status_code=500, detail="An error occurred while processing the request")

@app.get("/inflation")
async def get_inflation_rate(draft_id: str = Query(..., description="Sleeper draft ID")):
    """Get inflation rate data with caching."""
    try:
        inflation_data = await data_manager.get_inflation_data(draft_id)
        return sanitize_data(inflation_data)
    except Exception as e:
        logging.error(f"Error processing draft ID {draft_id}: {e}")
        raise HTTPException(status_code=500, detail="An error occurred while processing the request")

@app.post("/inflation")
async def get_inflation_rate_post(request: DraftIdRequest):
    """Get inflation rate data for a draft (POST method)."""
    return await get_inflation_rate(request.draft_id)

@app.get("/team_breakdown")
async def team_breakdown(draft_id: str = Query(..., description="Sleeper draft ID")):
    """Get team breakdown for a draft."""
    try:
        draft_data = await data_manager.get_draft_data(draft_id)
        if not draft_data:
            raise HTTPException(status_code=404, detail="No draft data found")
        
        # Process team breakdown
        team_data = {}
        
        for pick in draft_data:
            slot = pick['draft_slot']
            team = team_data.setdefault(slot, {
                'starters': [],
                'bench': [],
                'totalSpend': 0,
                'remainingBudget': 200,
            })

            metadata = pick.get('metadata', {})
            position = metadata.get('position')
            amount = int(metadata.get('amount', 0))
            player_name = f"{metadata.get('first_name', '')} {metadata.get('last_name', '')}"

            # Add to bench initially
            team['bench'].append({
                'name': player_name,
                'position': position,
                'amount': amount
            })

            team['totalSpend'] += amount
            team['remainingBudget'] = 200 - team['totalSpend']

        # Sort and categorize players into starters and bench
        for team in team_data.values():
            positions = {
                'QB': [], 'RB': [], 'WR': [], 'TE': [], 'DEF': [], 'K': []
            }

            for player in team['bench']:
                pos = player['position']
                if pos in positions:
                    positions[pos].append(player)

            for pos in positions:
                positions[pos].sort(key=lambda x: x['amount'], reverse=True)

            # Assign starters
            team['starters'].extend(positions['QB'][:1])
            team['starters'].extend(positions['RB'][:2])
            team['starters'].extend(positions['WR'][:3])
            team['starters'].extend(positions['TE'][:1])

            # Determine Flex position
            flex_candidates = positions['RB'][2:] + positions['WR'][3:] + positions['TE'][1:]
            flex_candidates.sort(key=lambda x: x['amount'], reverse=True)
            team['starters'].extend(flex_candidates[:1])

            team['starters'].extend(positions['DEF'][:1])
            team['starters'].extend(positions['K'][:1])

            # Remove starters from bench
            team['bench'] = [player for player in team['bench'] if player not in team['starters']]

        return team_data

    except Exception as e:
        logging.error(f"Error processing team breakdown for draft ID {draft_id}: {e}")
        raise HTTPException(status_code=500, detail="An error occurred while processing the request")

@app.get("/scatter_data")
async def scatter_data(draft_id: str = Query(..., description="Sleeper draft ID")):
    """Get scatter plot data with optimized processing."""
    try:
        draft_data = await data_manager.get_draft_data(draft_id)
        if not draft_data:
            raise HTTPException(status_code=404, detail="No draft data found")

        scatter_data = {
            "pick_no": [],
            "metadata_amount": [],
            "colors": [],
            "player_names": [],
            "expected_values": []
        }

        for index, player in enumerate(draft_data):
            player_name = f"{player['metadata']['first_name']} {player['metadata']['last_name']}"
            position = player['metadata']['position']
            
            # Get expected value using optimized lookup
            expected_value, _ = data_manager.get_player_info_optimized(player_name, position)
            
            if pd.isna(expected_value):
                expected_value = 0

            scatter_data["pick_no"].append(index + 1)
            scatter_data["metadata_amount"].append(int(player['metadata']['amount']))
            color = POSITION_COLORS.get(position, "gray")
            scatter_data["colors"].append(color)
            scatter_data["player_names"].append(player_name)
            scatter_data["expected_values"].append(expected_value)

        return scatter_data
    except Exception as e:
        logging.error(f"Error processing scatter data request: {e}")
        raise HTTPException(status_code=500, detail="Internal Server Error")

@app.get("/draft_economy")
async def draft_economy(draft_id: str = Query(..., description="Sleeper draft ID")):
    """Money left in the room against value left on the board."""
    try:
        draft_data = await data_manager.get_draft_data(draft_id)
        if not draft_data:
            raise HTTPException(status_code=404, detail="No draft data found")
        return data_manager.get_draft_economy(draft_data)
    except HTTPException:
        raise
    except Exception as e:
        logging.error(f"Error computing draft economy for {draft_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="An error occurred while processing the request")


def _assemble_available_players(draft_data):
    """Split the prebuilt board into undrafted and drafted, with values attached.

    Runs off the event loop (see the handler): even though the prebuilt board
    makes this cheap, this endpoint is polled by every open tab and it is the
    one place where per-request work scales with the size of the board.
    """
    board = data_manager._data_cache['board']
    board_by_name = data_manager._data_cache['board_by_name']
    mappings = data_manager._data_cache['player_mappings']

    # A name counts as taken under its Sleeper spelling and its ETR one.
    drafted = set()
    for pick in draft_data:
        meta = pick.get('metadata', {})
        name = f"{meta.get('first_name', '')} {meta.get('last_name', '')}".strip()
        drafted.add(name)
        mapped = mappings.get(name, {}).get('auction_name')
        if mapped:
            drafted.add(mapped)

    available_players = [p for p in board if p['name'] not in drafted]

    drafted_players_with_values = []
    for pick in draft_data:
        meta = pick.get('metadata', {})
        name = f"{meta.get('first_name', '')} {meta.get('last_name', '')}".strip()
        spent = int(meta.get('amount', 0) or 0)
        # A drafted player is still a board row - the board knows his rank and
        # tier, and dropping them left the All Players tab showing nothing in
        # those columns for every pick that had already sold.
        entry = board_by_name.get(name)
        if entry is None:
            mapped = mappings.get(name, {}).get('auction_name')
            entry = board_by_name.get(mapped) if mapped else None
        expected = entry['auction_value'] if entry else 0.0
        drafted_players_with_values.append({
            'name': name,
            'position': meta.get('position', 'N/A'),
            'team': meta.get('team', 'N/A'),
            'spent_amount': spent,
            'expected_value': expected,
            'difference': spent - expected,
            'position_rank': entry['position_rank'] if entry else 'N/A',
            'tier': entry['tier'] if entry else 'N/A',
            'round': pick.get('round'),
            'pick_no': pick.get('pick_no'),
        })

    return {
        'available_players': available_players,
        'drafted_players': drafted_players_with_values,
        'total_available': len(available_players),
        'total_drafted': len(drafted_players_with_values),
    }


@app.get("/available_players")
async def get_available_players(draft_id: str, is_live: bool = False):
    """Undrafted players with tiers and values, plus what has already gone."""
    try:
        draft_data = await data_manager.get_draft_data(draft_id)
        if not draft_data:
            raise HTTPException(status_code=404, detail="No draft data found")
        # Off the event loop, so a slow assembly can never stall the ticker's
        # requests the way a blocking async handler would.
        return await run_in_threadpool(_assemble_available_players, draft_data)
    except HTTPException:
        raise
    except Exception as e:
        logging.error(f"Error getting available players: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="An error occurred while processing the request")


@app.get("/draft_notes")
async def get_draft_notes():
    """Get global and draft-specific player notes from the static JSON file."""
    try:
        notes_file_path = os.path.join(BASE_DIR, 'draft_notes.json')
        
        if not os.path.exists(notes_file_path):
            # Return empty structure if file doesn't exist
            return {
                "global_notes": {},
                "draft_specific_notes": {}
            }
        
        with open(notes_file_path, 'r') as f:
            notes_data = json.load(f)
        
        return notes_data
        
    except Exception as e:
        logging.error(f"Error loading draft notes: {e}")
        raise HTTPException(status_code=500, detail=f"Error loading draft notes: {str(e)}")

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=5050, reload=True) 