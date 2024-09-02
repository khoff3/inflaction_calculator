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
    
    # Initialize default values
    auction_value = 'N/A'
    tier = 'N/A'

    # Direct lookup in main datasets first
    auction_value_row = auction_values_df[auction_values_df['Player'] == player_name]
    if not auction_value_row.empty:
        auction_value = auction_value_row['Value'].values[0]
        logging.debug(f"Auction value found directly for {player_name}: {auction_value}")
    else:
        logging.warning(f"No auction value found for {player_name}. Defaulting to $0.")
        auction_value = 0

    if position in positional_rankings:
        ranking_df = positional_rankings[position]
        tier_row = ranking_df[ranking_df['PLAYER NAME'] == player_name]
        if not tier_row.empty:
            tier = tier_row['TIERS'].values[0] if 'TIERS' in ranking_df.columns else 'N/A'
            logging.debug(f"Correct Tier found directly for {player_name}: {tier}")
        else:
            logging.warning(f"No matching tier found for {player_name} in positional rankings.")

    # Check if player name is in mappings (only for anomalies)
    if auction_value == 'N/A' or tier == 'N/A':
        mapped_row = mappings_df[mappings_df['Sleeper Name'] == player_name]
        if not mapped_row.empty:
            auction_name = mapped_row['Auction Value Name'].values[0]
            tier_name_key = mapped_row['Tier Name'].values[0]
            logging.debug(f"Mapping found for anomaly: Auction Name = {auction_name}, Tier Lookup Key = {tier_name_key}")

            # Fetch the auction value using the mapped name
            auction_value_row = auction_values_df[auction_values_df['Player'] == auction_name]
            if not auction_value_row.empty:
                auction_value = auction_value_row['Value'].values[0]
                logging.debug(f"Auction value found for anomaly {auction_name}: {auction_value}")
            else:
                logging.warning(f"No auction value found for anomaly {auction_name}. Defaulting to $0.")
                auction_value = 0

            # Proceed to tier lookup regardless of auction value status
            if position in positional_rankings:
                ranking_df = positional_rankings[position]
                tier_row = ranking_df[ranking_df['PLAYER NAME'] == tier_name_key]
                if not tier_row.empty:
                    tier = tier_row['TIERS'].values[0] if 'TIERS' in ranking_df.columns else 'N/A'
                    logging.debug(f"Correct Tier found for anomaly {tier_name_key}: {tier}")
                else:
                    logging.warning(f"No matching tier found for anomaly {tier_name_key} in positional rankings.")

    # Fallback to $0 if auction value is still 'N/A'
    if auction_value == 'N/A':
        logging.warning(f"Unable to determine auction value for {player_name}. Defaulting to $0.")
        auction_value = 0

    return auction_value, tier


def map_players_to_ev_data(draft_data):
    # Merge player data with auction values data
    all_data = pd.concat([positional_rankings['QB'], positional_rankings['RB'], positional_rankings['WR'], positional_rankings['TE']], ignore_index=True)
    merged_data = pd.merge(all_data, auction_values_df, left_on='PLAYER NAME', right_on='Player', how='left')

    # Collect logs to print once per player
    consolidated_logs = []

    # Initialize lists for unmatched players and fuzzy matches
    unmatched_players = []
    fuzzy_matches = []

    for player in draft_data:
        player_name = player['metadata']['first_name'] + ' ' + player['metadata']['last_name']
        position = player['metadata']['position']
        matched_row = merged_data[merged_data['PLAYER NAME'] == player_name]

        # CSV Lookup or Fuzzy Matching
        if matched_row.empty:
            auction_name, tier_name = get_player_info(player_name, position)
            if auction_name:
                consolidated_logs.append(f"Lookup used for player: {player_name} -> {auction_name}")
                matched_row = merged_data[merged_data['PLAYER NAME'] == auction_name]
                fuzzy_matches.append({
                    'Original Name': player_name,
                    'Best Match': auction_name,
                    'Similarity Score': 100  # Assuming direct match in this case
                })

        # Log the results
        if not matched_row.empty:
            player['Value'] = matched_row['Value'].values[0]
            player['Tier'] = matched_row['TIERS'].values[0] if 'TIERS' in merged_data.columns else 'N/A'
            consolidated_logs.append(f"Matched player: {player_name} with Value: {player['Value']} and Tier: {player['Tier']}")
        else:
            unmatched_players.append(player_name)
            consolidated_logs.append(f"Unmatched Player: {player_name}")
            player['Value'] = 0
            player['Tier'] = 'N/A'

    # Print consolidated logs only once per player
    for log in consolidated_logs:
        logging.debug(log)

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

    # Include tier and value in the expected_values
    expected_values['Tier'] = expected_values['Tier'].fillna('N/A')
    expected_values['Value'] = expected_values['Value'].fillna(0)

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
        "expected_values": expected_values.to_dict(orient='records')  # Include expected values in the response
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
    doe_values = {}
    player_counts = {}

    for player in draft_data:
        player_name = f"{player['metadata']['first_name']} {player['metadata']['last_name']}"
        player_position = player["metadata"]["position"]
        amount_paid = int(player["metadata"]["amount"])
        
        expected_value = expected_values.loc[
            expected_values["Player"] == player_name, "Value"
        ].fillna(0).sum()

        tier = expected_values.loc[
            expected_values["Player"] == player_name, "Tier"
        ].values[0] if not expected_values.loc[
            expected_values["Player"] == player_name, "Tier"
        ].empty else None

        if expected_value > 0:
            doe = amount_paid - expected_value
        else:
            doe = amount_paid  # Assume the entire amount as DOE if no expected value

        if player_position not in doe_values:
            doe_values[player_position] = {}
            player_counts[player_position] = {}

        if tier is not None:
            if tier not in doe_values[player_position]:
                doe_values[player_position][tier] = 0
                player_counts[player_position][tier] = 0
            doe_values[player_position][tier] += doe
            player_counts[player_position][tier] += 1

    # Convert to average DOE
    for position in doe_values:
        for tier in doe_values[position]:
            if player_counts[position][tier] > 0:
                doe_values[position][tier] /= player_counts[position][tier]

    return doe_values


def calculate_avg_tier_costs(expected_values):
    avg_tier_costs = {}

    grouped = expected_values.groupby(['Position', 'Tier'])['Value'].mean().reset_index()

    for _, row in grouped.iterrows():
        position, tier, avg_cost = row['Position'], row['Tier'], row['Value']
        if position not in avg_tier_costs:
            avg_tier_costs[position] = {}
        avg_tier_costs[position][tier] = avg_cost

    return avg_tier_costs

def calculate_team_strengths_and_needs_by_tier(team_data, expected_values):
    strengths_and_needs = {}

    for team, data in team_data.items():
        strengths_and_needs[team] = {}

        for player in data['starters']:
            player_name = player['name']
            position = player['position']
            tier = expected_values.loc[expected_values["Player"] == player_name, "Tier"]
            if not tier.empty:
                tier_value = tier.values[0]
                # Classify the tier
                if tier_value in [1, 2]:
                    strengths_and_needs[team][position] = 'Strong'
                elif tier_value in [3, 4, 5, 6]:
                    strengths_and_needs[team][position] = 'Neutral'
                else:
                    strengths_and_needs[team][position] = 'Need'
            else:
                strengths_and_needs[team][position] = 'Unknown'  # For players not found in the expected values

    return strengths_and_needs

def process_team_breakdown(draft_data):
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

        # Directly append to the bench initially
        team['bench'].append({
            'name': player_name,
            'position': position,
            'amount': amount
        })

        team['totalSpend'] += amount
        team['remainingBudget'] = 200 - team['totalSpend']

    # The section below sorts and categorizes players into starters and bench
    for team in team_data.values():
        positions = {
            'QB': [],
            'RB': [],
            'WR': [],
            'TE': [],
            'DEF': [],
            'K': []
        }

        for player in team['bench']:
            pos = player['position']
            if pos in positions:
                positions[pos].append(player)

        for pos in positions:
            positions[pos].sort(key=lambda x: x['amount'], reverse=True)

        # Assign starters from the sorted positions
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

        # Remove the starters from the bench
        team['bench'] = [player for player in team['bench'] if player not in team['starters']]

    return team_data

@app.route('/team_breakdown', methods=['GET'])
def team_breakdown():
    draft_id = request.args.get('draft_id')
    if not draft_id:
        return jsonify({"error": "Draft ID is required"}), 400
    
    try:
        draft_data = get_draft_data(draft_id)
        if not draft_data:
            return jsonify({"error": "No draft data found"}), 404
        
        # Retrieve the auction values with expected tiers
        _, expected_values = calculate_inflation_rates(draft_data)
        
        # Process team breakdown
        team_data = process_team_breakdown(draft_data)
        
        # Calculate strengths and needs based on the tiers
        strengths_and_needs = calculate_team_strengths_and_needs_by_tier(team_data, expected_values)
        
        # Attach the strengths and needs data to team_data
        for team, data in team_data.items():
            data['strengths_and_needs'] = strengths_and_needs.get(team, {})

        return jsonify(team_data)

    except KeyError as e:
        logging.error(f"KeyError: Missing key in draft data - {e}")
        return jsonify({"error": f"KeyError: Missing key in draft data - {e}"}), 500

    except ValueError as e:
        logging.error(f"ValueError: Invalid data format - {e}")
        return jsonify({"error": f"ValueError: Invalid data format - {e}"}), 500

    except Exception as e:
        logging.error(f"An unexpected error occurred: {e}", exc_info=True)
        return jsonify({"error": "An unexpected error occurred"}), 500

@app.route('/scatter_data', methods=['GET'])
def scatter_data():
    try:
        draft_id = request.args.get('draft_id')
        if not draft_id:
            return jsonify({"error": "Draft ID is required"}), 400

        draft_data = get_draft_data(draft_id)
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
    except Exception as e:
        logging.error(f"Error processing scatter data request: {e}", exc_info=True)
        return jsonify({"error": "Internal Server Error"}), 500
    draft_id = request.args.get('draft_id')
    if not draft_id:
        return jsonify({"error": "Draft ID is required"}), 400

    draft_data = get_draft_data(draft_id)
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

@app.route('/picks', methods=['GET'])
def get_picks():
    draft_id = request.args.get('draft_id')
    if not draft_id:
        return jsonify({"error": "Draft ID is required"}), 400

    draft_data = get_draft_data(draft_id)
    if not draft_data:
        return jsonify({"error": "No draft data found"}), 404

    return jsonify(draft_data)


def convert_to_serializable(obj):
    """Convert numpy data types to serializable types."""
    if isinstance(obj, np.generic):
        return obj.item()
    elif isinstance(obj, (np.ndarray, pd.Series)):
        return obj.tolist()
    else:
        return obj

@app.route('/player_lookup', methods=['POST'])
def player_lookup():
    try:
        players = request.json.get('players', [])
        results = []
        for player in players:
            player_name = f"{player['first_name']} {player['last_name']}"
            position = player['position']
            
            # Call get_player_info with the correct arguments
            auction_value, tier = get_player_info(player_name, position)
            
            # Convert data to serializable types
            auction_value = convert_to_serializable(auction_value)
            tier = convert_to_serializable(tier)
            
            results.append({
                'player_name': player_name,
                'auction_value': auction_value,
                'tier': tier
            })
        
        return jsonify(results)
    except Exception as e:
        logging.error(f"Error processing player lookup: {str(e)}")
        return jsonify({"error": "An error occurred while processing the request"}), 500
    
@app.route('/inflation', methods=['GET', 'POST'])
def get_inflation_rate():
    if request.method == 'POST':
        data = request.get_json()  # This will parse the incoming JSON data
        draft_id = data.get('draft_id')  # Extract 'draft_id' from JSON
    elif request.method == 'GET':
        draft_id = request.args.get('draft_id')

    if not draft_id:
        return jsonify({"error": "Draft ID is required"}), 400

    try:
        draft_data = get_draft_data(draft_id)
        if not draft_data:
            return jsonify({"error": "No draft data found"}), 404

        # Calculate inflation rates and expected values
        inflation_rates, expected_values = calculate_inflation_rates(draft_data)

        # Calculate picks per tier
        picks_per_tier = get_picks_per_tier(draft_data, expected_values)
        
        # Calculate total picks per position
        total_picks = {pos: sum(tier_counts.values()) for pos, tier_counts in picks_per_tier.items()}

        # Calculate average tier costs
        avg_tier_costs = calculate_avg_tier_costs(expected_values)

        # Calculate DOE values
        doe_values = calculate_doe_values(draft_data, expected_values, inflation_rates.get('positional_tiered', {}))

        # Prepare response data
        response_data = {
            'overall_inflation': inflation_rates.get('overall', 0),
            'positional_inflation': inflation_rates.get('positional', {}),
            'tiered_inflation': inflation_rates.get('positional_tiered', {}),
            'picks_per_tier': picks_per_tier,
            'total_picks': total_picks,
            'avg_tier_costs': avg_tier_costs,
            'doe_values': doe_values,
            'expected_values': inflation_rates['expected_values'],  # Include expected values in the response
        }

        # Sanitize the response data
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
