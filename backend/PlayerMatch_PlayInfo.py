import pandas as pd
import requests
import json
import numpy as np
import os
from flask import Flask, jsonify, request
from flask_cors import CORS
import logging
from sklearn.linear_model import LinearRegression
from sklearn.metrics import r2_score
import glob
from fuzzywuzzy import process

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

# Load the player name mappings CSV
mappings_df = pd.read_csv(MAPPINGS_PATH)

# Load Auction Values
auction_values_df = pd.read_csv(EXPECTED_VALUES_PATH)

# Load Positional Rankings into a dictionary
positional_rankings = {position: pd.read_csv(os.path.join(LATEST_DATA_DIR, filename))
                       for position, filename in csv_filenames.items()}

# Convert the mappings to a dictionary for easy lookup
player_name_mappings = dict(zip(mappings_df['Sleeper Name'], mappings_df['Auction Value Name']))

# Initialize Flask app
app = Flask(__name__)
CORS(app)
logging.basicConfig(level=logging.DEBUG)
app.config['SECRET_KEY'] = 'qZw6G6Zy8EGdgR6UfHMgERGYiEZpvODt'

# Define position colors for scatter plot
POSITION_COLORS = {
    "QB": "red",
    "RB": "green",
    "WR": "blue",
    "TE": "yellow"
}

class CustomEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, np.generic):
            return obj.item()
        return super().default(obj)

app.json_encoder = CustomEncoder

def get_draft_data(draft_id):
    url = f"https://api.sleeper.app/v1/draft/{draft_id}/picks"
    try:
        response = requests.get(url)
        logging.debug(f"Response Status Code: {response.status_code}")
        if response.status_code == 200:
            logging.debug(f"Response Data: {response.json()}")
            return response.json()
        else:
            logging.error(f"Error: Unable to fetch data for draft ID {draft_id}.")
            return []
    except Exception as e:
        logging.error(f"Exception occurred while fetching draft data: {e}")
        return []

def sanitize_data(data):
    if isinstance(data, dict):
        return {str(sanitize_data(key)): sanitize_data(value) for key, value in data.items()}
    elif isinstance(data, list):
        return [sanitize_data(element) for element in data]
    elif isinstance(data, (np.generic, np.ndarray)):
        return data.tolist() if isinstance(data, np.ndarray) else data.item()
    elif isinstance(data, (int, float)):
        return str(data)
    return data


# Load the player name mappings CSV
mappings_df = pd.read_csv(MAPPINGS_PATH)

# Convert the mappings to a dictionary for easy lookup
player_name_mappings = dict(zip(mappings_df['Sleeper Name'], mappings_df['Auction Value Name']))

def get_player_info(player_name, position):
    logging.debug(f"Looking up info for player: {player_name}, Position: {position}")
    
    # Try direct CSV mapping
    mapped_row = mappings_df[mappings_df['Sleeper Name'] == player_name]
    if not mapped_row.empty:
        auction_name = mapped_row['Auction Value Name'].values[0]
        tier_name = mapped_row['Tier Name'].values[0]
        logging.debug(f"Direct mapping found: Auction Name = {auction_name}, Tier = {tier_name}")

        # Now, fetch the auction value using the mapped name
        auction_value_row = auction_values_df[auction_values_df['Player'] == auction_name]
        if not auction_value_row.empty:
            auction_value = auction_value_row['Value'].values[0]
            
            # Lookup the tier from the positional rankings file based on position and player name
            if position in positional_rankings:
                ranking_df = positional_rankings[position]
                tier_row = ranking_df[ranking_df['PLAYER NAME'] == player_name]
                if not tier_row.empty:
                    correct_tier = tier_row['TIERS'].values[0] if 'TIERS' in ranking_df.columns else 'N/A'
                    logging.debug(f"Correct Tier found: {correct_tier}")
                    return auction_value, correct_tier
                else:
                    logging.warning(f"No matching tier found for {player_name} in positional rankings.")
                    return auction_value, 'N/A'
            
    logging.debug(f"No match found for player: {player_name}")
    return 'N/A', 'N/A'



def test_get_player_info():
    # Test case for Joshua Palmer, WR
    player_name = "Joshua Palmer"
    position = "WR"
    
    # Call the function
    auction_value, tier = get_player_info(player_name, position)
    
    # Print the output
    print(f"Player: {player_name}, Position: {position}")
    print(f"Auction Value: {auction_value}")
    print(f"Tier: {tier}")

# Run the test
test_get_player_info()
