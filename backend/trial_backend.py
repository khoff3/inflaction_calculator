import pandas as pd
import aiohttp
import asyncio
from flask import Flask, jsonify, request
import json
import numpy as np
import os
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

# Helper functions
async def get_draft_data(draft_id):
    url = f"https://api.sleeper.app/v1/draft/{draft_id}/picks"
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url) as response:
                if response.status == 200:
                    return await response.json()
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

def map_players_to_ev_data(draft_data):
    qb_data = pd.read_csv(os.path.join(LATEST_DATA_DIR, csv_filenames['QB']))
    rb_data = pd.read_csv(os.path.join(LATEST_DATA_DIR, csv_filenames['RB']))
    wr_data = pd.read_csv(os.path.join(LATEST_DATA_DIR, csv_filenames['WR']))
    te_data = pd.read_csv(os.path.join(LATEST_DATA_DIR, csv_filenames['TE']))

    all_data = pd.concat([qb_data, rb_data, wr_data, te_data], ignore_index=True)
    auction_values_data = pd.read_csv(EXPECTED_VALUES_PATH)

    # Merge rankings data with auction values based on player name
    merged_data = pd.merge(all_data, auction_values_data, left_on='PLAYER NAME', right_on='Player', how='left')

    # Log the columns to ensure that everything is loaded correctly
    logging.debug(f"Auction Values DataFrame Columns: {auction_values_data.columns}")
    logging.debug(f"Merged Data DataFrame Columns: {merged_data.columns}")

    unmatched_players = []
    fuzzy_matches = []

    for player in draft_data:
        player_name = player['metadata']['first_name'] + ' ' + player['metadata']['last_name']
        best_match_name = process.extractOne(player_name, merged_data['PLAYER NAME'].tolist())[0]
        matched_row = merged_data[merged_data['PLAYER NAME'] == best_match_name]

        if not matched_row.empty:
            player['Value'] = matched_row.get('Value', np.nan).values[0]
            player['Tier'] = matched_row.get('TIERS', np.nan).values[0]  # Ensure TIERS is correctly assigned
        else:
            best_match, score = process.extractOne(player_name, merged_data['PLAYER NAME'].tolist())
            if score > 50:
                matched_row = merged_data[merged_data['PLAYER NAME'] == best_match]
                player['Value'] = matched_row.get('Value', np.nan).values[0]
                player['Tier'] = matched_row.get('TIERS', np.nan).values[0]
                fuzzy_matches.append({
                    'Original Name': player_name,
                    'Best Match': best_match,
                    'Similarity Score': score
                })
            else:
                unmatched_players.append(player_name)
                player['Value'] = 0
                player['Tier'] = np.nan

    return draft_data, unmatched_players, fuzzy_matches

def get_picks_per_tier(draft_data, expected_values):
    picks_per_tier = {"QB": {}, "RB": {}, "WR": {}, "TE": {}}

    for player in draft_data:
        player_full_name = f"{player['metadata']['first_name']} {player['metadata']['last_name']}"
        player_position = player["metadata"]["position"]
        player_tier = expected_values.loc[expected_values["Player"] == player_full_name, "Tier"]

        if player_position in ["K", "DEF"]:
            continue

        if not player_tier.empty:
            tier = player_tier.values[0]
            if tier in picks_per_tier[player_position]:
                picks_per_tier[player_position][tier] += 1
            else:
                picks_per_tier[player_position][tier] = 1

    return picks_per_tier


def get_avg_tier_cost(draft_data, expected_values):
    """
    Calculate the average cost per tier for each position based on the expected values.
    """
    avg_tier_costs = {}
    
    for position in ["QB", "RB", "WR", "TE"]:
        pos_data = expected_values[expected_values["Position"] == position]

        for tier in pos_data["Tier"].unique():
            tier_data = pos_data[pos_data["Tier"] == tier]
            avg_cost = tier_data["Value"].mean()
            avg_tier_costs[(position, tier)] = avg_cost

    return avg_tier_costs

def calculate_inflation_rates(draft_data):
    rankings = {
        "QB": pd.read_csv(os.path.join(LATEST_DATA_DIR, csv_filenames['QB'])),
        "RB": pd.read_csv(os.path.join(LATEST_DATA_DIR, csv_filenames['RB'])),
        "WR": pd.read_csv(os.path.join(LATEST_DATA_DIR, csv_filenames['WR'])),
        "TE": pd.read_csv(os.path.join(LATEST_DATA_DIR, csv_filenames['TE']))
    }

    auction_values_data = pd.read_csv(EXPECTED_VALUES_PATH)
    auction_values_data['Value'] = pd.to_numeric(auction_values_data['Value'].str.replace('$', ''), errors='coerce').fillna(0)

    # Merge rankings with auction values
    all_rankings = pd.concat(rankings.values(), ignore_index=True)
    expected_values = pd.merge(all_rankings, auction_values_data, left_on='PLAYER NAME', right_on='Player', how='left')

    # Debug the columns to ensure the TIERS column is present
    logging.debug(f"Expected Values DataFrame Columns: {expected_values.columns}")

    # Ensure the 'Tier' column is consistent
    if 'TIERS' in expected_values.columns:
        expected_values.rename(columns={'TIERS': 'Tier'}, inplace=True)

    if 'Tier' not in expected_values.columns:
        logging.error("The 'Tier' column is missing from the expected values data.")
        return {"overall": 0, "positional": {}, "positional_tiered": {}}, expected_values

    total_spent = sum([int(player["metadata"]["amount"]) for player in draft_data if player["metadata"]["position"] not in ['K', 'DEF']])
    total_value = sum(
        expected_values.loc[expected_values["Player"] == (player["metadata"]["first_name"] + " " + player["metadata"]["last_name"]), "Value"].fillna(0).sum() 
        for player in draft_data
    )

    inflation = (total_spent - total_value) / total_value if total_value != 0 else 0
    positional_inflation = {}
    positional_tier_inflation = {}
    
    # Call the function to calculate average tier costs
    avg_tier_costs = get_avg_tier_cost(draft_data, expected_values)

    for position in ["QB", "RB", "WR", "TE"]:
        pos_players = [player for player in draft_data if player["metadata"]["position"] == position]
        pos_spent = sum([int(player["metadata"]["amount"]) for player in pos_players])

        pos_values = sum([
            expected_values.loc[
                expected_values["Player"] == player["metadata"]["first_name"] + " " + player["metadata"]["last_name"],
                "Value"
            ].fillna(0).sum() for player in pos_players
        ])

        positional_inflation[position] = (pos_spent - pos_values) / pos_values if pos_values != 0 else 0

        for tier in range(1, 11):  # Assuming TIER_COUNT is 10
            tier_players = [
                player for player in pos_players 
                if not expected_values.loc[expected_values["Player"] == player["metadata"]["first_name"] + " " + player["metadata"]["last_name"], "Tier"].empty and 
                expected_values.loc[expected_values["Player"] == player["metadata"]["first_name"] + " " + player["metadata"]["last_name"], "Tier"].values[0] == tier
            ]
            tier_spent = sum([int(player["metadata"]["amount"]) for player in tier_players])
            tier_value = sum(
                np.nan_to_num(
                    pd.to_numeric(
                        expected_values.loc[
                            expected_values["Player"] == player["metadata"]["first_name"] + " " + player["metadata"]["last_name"], 
                            "Value"
                        ].values,
                        errors='coerce'
                    )
                )
                for player in tier_players
            )

            positional_tier_inflation[position] = positional_tier_inflation.get(position, {})
            positional_tier_inflation[position][tier] = (tier_spent - tier_value) / tier_value if tier_value != 0 else 0

    return {
        "overall": inflation,
        "positional": positional_inflation,
        "positional_tiered": positional_tier_inflation,
        "avg_tier_costs": avg_tier_costs,
    }, expected_values

def calculate_r2_by_position(draft_data):
    position_r2 = {}

    for position in ["QB", "RB", "WR", "TE"]:
        x = [pick["pick_no"] for pick in draft_data if pick["metadata"]["position"] == position]
        y = [int(pick["metadata"]["amount"]) for pick in draft_data if pick["metadata"]["position"] == position]
        
        if len(x) > 1 and len(set(x)) > 1:
            x = np.array(x).reshape((-1, 1))
            y = np.array(y)

            model = LinearRegression().fit(x, y)
            y_pred = model.predict(x)
            
            r2_value = r2_score(y, y_pred)
            position_r2[position] = {
                "r2": r2_value,
                "cost_of_waiting": {
                    "1_pick": r2_value * 0.005,
                    "5_picks": r2_value * 0.025,
                    "10_picks": r2_value * 0.05,
                    "20_picks": r2_value * 0.10,
                }
            }
        else:
            position_r2[position] = {
                "r2": "N/A",
                "cost_of_waiting": {
                    "1_pick": "N/A",
                    "5_picks": "N/A",
                    "10_picks": "N/A",
                    "20_picks": "N/A",
                }
            }

    return position_r2

def calculate_doe_values(draft_data, expected_values, positional_tier_inflation):
    doe_values = []
    total_doe = 0
    num_players = 0

    for player in draft_data:
        player_name = f"{player['metadata']['first_name']} {player['metadata']['last_name']}"
        player_position = player["metadata"]["position"]
        amount_paid = int(player["metadata"]["amount"])
        
        expected_value = expected_values.loc[
            expected_values["Player"] == player_name, "Value"
        ].fillna(0).sum()

        if expected_value > 0:
            doe = amount_paid - expected_value
        else:
            doe = amount_paid

        total_doe += doe
        num_players += 1

        doe_values.append({
            "player_name": player_name,
            "position": player_position,
            "amount_paid": amount_paid,
            "expected_value": expected_value,
            "doe": doe
        })

    avg_doe = total_doe / num_players if num_players > 0 else 0
    return doe_values, avg_doe


@app.route('/scatter_data', methods=['GET'])
async def scatter_data():
    draft_id = request.args.get('draft_id')
    if not draft_id:
        return jsonify({"error": "Draft ID is required"}), 400

    draft_data = await get_draft_data(draft_id)
    if not draft_data:
        return jsonify({"error": "No draft data found"}), 404

    draft_data, unmatched_players, fuzzy_matches = map_players_to_ev_data(draft_data)

    scatter_data = {
        "pick_no": [],
        "metadata_amount": [],
        "colors": [],
        "player_names": [],
        "expected_values": []
    }

    for index, player in enumerate(draft_data):
        player_name = player['metadata']['first_name'] + ' ' + player['metadata']['last_name']
        expected_value = player['Value']

        if pd.isna(expected_value):
            expected_value = "$0"

        scatter_data["pick_no"].append(index + 1)
        scatter_data["metadata_amount"].append(int(player['metadata']['amount']))
        player_position = player['metadata']['position']
        color = POSITION_COLORS.get(player_position, "gray")
        scatter_data["colors"].append(color)
        scatter_data["player_names"].append(player_name)
        scatter_data["expected_values"].append(expected_value)

    r2_values = calculate_r2_by_position(draft_data)

    response_data = {
        "scatterplot": scatter_data,
        "r2_values": r2_values
    }

    logging.debug(f"Scatter data response: {response_data}")
    return jsonify(response_data)

@app.route('/inflation', methods=['POST'])
async def get_inflation_rate():
    draft_id = request.form.get('draft_id')
    if not draft_id:
        return jsonify({"error": "Draft ID is required"}), 400

    try:
        draft_data = await get_draft_data(draft_id)
        if not draft_data:
            return jsonify({"error": "No draft data found"}), 404

        # Calculate inflation rates and expected values
        inflation_rates, expected_values = calculate_inflation_rates(draft_data)

        # Check if 'Tier' is missing, and adjust the logic accordingly
        if 'Tier' not in expected_values.columns:
            avg_tier_costs = {}  # or handle the missing column case appropriately
        else:
            avg_tier_costs = get_avg_tier_cost(draft_data, expected_values)

        # Calculate picks per tier and total picks
        picks_per_tier = get_picks_per_tier(draft_data, expected_values)
        total_picks = {pos: sum(tier_counts.values()) for pos, tier_counts in picks_per_tier.items()}

        # Calculate DOE values
        doe_values = calculate_doe_values(draft_data, expected_values, inflation_rates.get('positional_tiered', {}))

        response_data = {
            'overall_inflation': inflation_rates.get('overall', 0),
            'positional_inflation': inflation_rates.get('positional', {}),
            'tiered_inflation': inflation_rates.get('positional_tiered', {}),
            'picks_per_tier': picks_per_tier,
            'total_picks': total_picks,
            'avg_tier_costs': avg_tier_costs,
            'doe_values': doe_values
        }

        response_data = sanitize_data(response_data)
        logging.debug(f"Inflation data response (JSON): {response_data}")
        return jsonify(response_data)
    except Exception as e:
        logging.error(f"Error processing draft ID {draft_id}: {e}", exc_info=True)
        return jsonify({"error": "An error occurred while processing the request"}), 500


@app.after_request
def add_header(response):
    response.cache_control.no_store = True
    return response

if __name__ == "__main__":
    app.run(debug=True, threaded=True, host='0.0.0.0', port=5050)
