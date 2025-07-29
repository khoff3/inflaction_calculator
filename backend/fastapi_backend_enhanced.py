import pandas as pd
import requests
import json
import numpy as np
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
import time
from collections import defaultdict
import pickle
from pathlib import Path

# Define base directory
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

def get_latest_data_folder(base_dir):
    """Retrieve the most recent year folder for data files."""
    year_folders = glob.glob(os.path.join(base_dir, "20[0-9][0-9]"))
    return max(year_folders, key=os.path.getmtime)

# Use the latest data folder
LATEST_DATA_DIR = get_latest_data_folder(BASE_DIR)
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
class DataManager:
    """Centralized data manager with caching and memory optimization."""
    
    def __init__(self):
        self._data_cache = {}
        self._draft_cache = {}
        self._player_lookup_cache = {}
        self._inflation_cache = {}
        self._cache_timestamps = {}
        self._cache_ttl = 300  # 5 minutes TTL
        self._draft_cache_ttl = 5  # 5 seconds for draft data (more responsive for live drafts)
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
        for _, row in self._data_cache['mappings_df'].iterrows():
            sleeper_name = row['Sleeper Name']
            auction_name = row['Auction Value Name']
            tier_name = row['Tier Name']
            self._data_cache['anomaly_mappings'][sleeper_name] = {
                'auction_name': auction_name,
                'tier_name': tier_name
            }
    
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
        
        # Check anomaly mappings for both auction value and tier
        if player_name in self._data_cache['anomaly_mappings']:
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
        
        return auction_value, tier
    
    async def get_inflation_data(self, draft_id: str) -> Dict[str, Any]:
        """Get inflation data with caching."""
        cache_key = f"inflation_{draft_id}"
        
        # Check cache first
        if cache_key in self._inflation_cache:
            timestamp = self._cache_timestamps.get(cache_key, 0)
            if time.time() - timestamp < self._cache_ttl:
                logging.info(f"Returning cached inflation data for {draft_id}")
                return self._inflation_cache[cache_key]
        
        # Calculate fresh data
        async with self._lock:
            draft_data = await self.get_draft_data(draft_id)
            if not draft_data:
                raise HTTPException(status_code=404, detail="No draft data found")
            
            # Calculate inflation rates
            inflation_data = self._calculate_inflation_rates_optimized(draft_data)
            
            # Cache the result
            self._inflation_cache[cache_key] = inflation_data
            self._cache_timestamps[cache_key] = time.time()
            
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
            
            # Get expected value from cache
            expected_value = 0
            if player_name in self._data_cache['player_auction_lookup']:
                raw_value = self._data_cache['player_auction_lookup'][player_name]['value']
                # Convert to numeric value, handling string values like "$25"
                if isinstance(raw_value, str):
                    expected_value = float(raw_value.replace('$', '').replace(',', ''))
                else:
                    expected_value = float(raw_value)
            
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

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=5050, reload=True) 