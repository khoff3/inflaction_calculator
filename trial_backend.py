import requests
import pandas as pd
from flask import Flask, jsonify, request, render_template
from fuzzywuzzy import fuzz, process
import json
import numpy as np
from numpy import float64
import os
from flask_cors import CORS
import logging
from flask_wtf.csrf import CSRFProtect
from flask_session import Session
from sklearn.linear_model import LinearRegression
from sklearn.metrics import r2_score

# Define the path to the folder containing inflation.html relative to the script
TEMPLATE_DIR = os.path.dirname(os.path.abspath(__file__))

# Define paths in a cross-platform way
BASE_DIR = os.path.dirname(os.path.abspath(__file__))  # This gets the directory where the script is located
TEMPLATE_DIR = os.path.join(BASE_DIR, 'templates')  # Assuming your templates are in a 'templates' directory inside your script's directory
EXPECTED_VALUES_PATH = os.path.join(BASE_DIR, '2023', 'Standard_Auction_Values.csv')
MAPPINGS_PATH = os.path.join(BASE_DIR, '2023', 'player_name_mappings.csv')

# Ensure the 2024 folder exists
new_year_folder = os.path.join(BASE_DIR, '2024')
if not os.path.exists(new_year_folder):
    os.makedirs(new_year_folder)

# Test file paths for 2023
file_paths = [
    '2023/player_name_mappings.csv',
    '2023/FantasyPros_2023_Draft_QB_Rankings.csv',
    '2023/FantasyPros_2023_Draft_RB_Rankings.csv',
    '2023/FantasyPros_2023_Draft_WR_Rankings.csv',
    '2023/FantasyPros_2023_Draft_TE_Rankings.csv',
    '2023/Standard_Auction_Values.csv'
]

for file_path in file_paths:
    full_path = os.path.join(BASE_DIR, file_path)
    if os.path.exists(full_path):
        print(f"{full_path} exists!")
    else:
        print(f"{full_path} does not exist!")

# Initializations
app = Flask(__name__, template_folder=TEMPLATE_DIR)
CORS(app, resources={r"/*": {"origins": "*"}})
logging.basicConfig(level=logging.DEBUG)

# Session configuration
app.config['SESSION_TYPE'] = 'filesystem'
Session(app)

# Initialize CSRF protection
csrf = CSRFProtect(app)

BASE_URL = "https://api.sleeper.app/v1/draft/"
TIER_COUNT = 10
exception_list = {}
extended_mapping = pd.read_csv(MAPPINGS_PATH)
exception_list.update(extended_mapping)
app.config['SECRET_KEY'] = 'qZw6G6Zy8EGdgR6UfHMgERGYiEZpvODt'

# position colors
POSITION_COLORS = {
    "QB": "red",
    "RB": "green",
    "WR": "blue",
    "TE": "yellow"
}

# Add hardcoded values to exception_list
hardcoded_exceptions = {
    "D'Andre Swift": "D'Andre Swift",
    "JK Dobbins": "J.K. Dobbins",
    "Kenneth Walker": "Kenneth Walker III",
    "Brian Robinson": "Brian Robinson Jr.",
    "DeVon Achane": "Devon Achane",
    "D'Onta Foreman": "D'Onta Foreman",
    "Jeff Wilson": "Jeff Wilson Jr.",
    "Clyde Edwards-Helaire": "Clyde Edwards-Helaire",
    "Pierre Strong": "Pierre Strong Jr.",
    # WRs
    "Ja'Marr Chase": "Ja'Marr Chase",
    "AJ Brown": "A.J. Brown",
    "Amon-Ra St. Brown": "Amon-Ra St. Brown",
    "Jaxon Smith-Njigba": "Jaxon Smith-Njigba",
    "JuJu Smith-Schuster": "JuJu Smith-Schuster",
    "Marvin Mims": "Marvin Mims",
    "DJ Chark": "D.J. Chark Jr.",
    "John Metchie": "John Metchie III",
    "KJ Osborn": "K.J. Osborn",
    "Donovan Peoples-Jones": "Donovan Peoples-Jones",
    "Marquez Valdes-Scantling": "Marquez Valdes-Scantling"
}
exception_list.update(hardcoded_exceptions)

class CustomEncoder(json.JSONEncoder):
    def default(self, obj):
        # Convert NumPy types to Python native types
        if isinstance(obj, np.generic):
            return obj.item()
        # Handle other non-serializable types here as needed
        return super(CustomEncoder, self).default(obj)

# Set Flask's JSON encoder to the custom encoder we've defined
app.json_encoder = CustomEncoder

def sanitize_data(data):
    if isinstance(data, dict):
        return {sanitize_data(key): sanitize_data(value) for key, value in data.items()}
    elif isinstance(data, list):
        return [sanitize_data(element) for element in data]
    elif isinstance(data, (int, float)):
        return str(data)
    return data

def get_best_match_name(name, draft_data_names):
    # Check hardcoded exceptions first
    if name in hardcoded_exceptions:
        return hardcoded_exceptions[name]

    # Special handling for Patrick Mahomes
    if name == "Patrick Mahomes II" and "Patrick Mahomes II" in draft_data_names:
        return "Patrick Mahomes II"
    elif name == "Patrick Mahomes II" and "Patrick Mahomes" in draft_data_names:
        return "Patrick Mahomes"
    
    best_match = process.extractOne(name, draft_data_names)
    if best_match and best_match[1] > 40:  # Using a threshold of 85 for match quality
        return best_match[0]
    return None

def get_doe_color_class(doe):
    if doe is None:
        return "neutral"
    if doe >= 10:
        return "severe-overpayment"
    elif doe >= 5:
        return "moderate-overpayment"
    elif doe >= 1:
        return "mild-overpayment"
    elif -1 <= doe <= 0.99:
        return "neutral"
    elif -5 <= doe < -1:
        return "mild-savings"
    elif -10 <= doe < -5:
        return "moderate-savings"
    else:
        return "severe-savings"

def get_avg_tier_cost(draft_data, expected_values):
    avg_tier_cost = {"QB": {}, "RB": {}, "WR": {}, "TE": {}}
    for position in ["QB", "RB", "WR", "TE"]:
        for tier in range(1, TIER_COUNT + 1):
            tier_players = [
                player for player in draft_data 
                if player["metadata"]["position"] == position and 
                not expected_values.loc[expected_values["Player"] == player["metadata"]["first_name"] + " " + player["metadata"]["last_name"], "Tier"].empty and 
                expected_values.loc[expected_values["Player"] == player["metadata"]["first_name"] + " " + player["metadata"]["last_name"], "Tier"].values[0] == tier
            ]
            
            # Calculate the average cost for the tier
            tier_values = [
                expected_values.loc[expected_values["Player"] == player["metadata"]["first_name"] + " " + player["metadata"]["last_name"], "Value"].values[0]
                for player in tier_players
            ]
            total_value = sum(tier_values)
            avg_cost = total_value / len(tier_players) if tier_players else 0
            avg_tier_cost[position][tier] = avg_cost
    print("Average Tier Costs:", avg_tier_cost)
    return avg_tier_cost

# Calculate tier-based inflation within each position
def calculate_positional_tier_inflation(draft_data, expected_values):
    unmatched_tier_players = []
    positional_tier_inflation = {}
    positional_tier_inflation[position] = {}
    tier_spent = sum([int(player["metadata"]["amount"]) for player in tier_players])
    tier_value = sum(
        [expected_values.loc[expected_values["Player"] == player["metadata"]["first_name"] + " " + player["metadata"]["last_name"], "Value"].values[0] 
            if not expected_values.loc[expected_values["Player"] == player["metadata"]["first_name"] + " " + player["metadata"]["last_name"], "Value"].empty 
            else unmatched_tier_players.append(player["metadata"]["first_name"] + " " + player["metadata"]["last_name"]) or 0 
            for player in tier_players]
    )
    positional_tier_inflation[position][tier] = (tier_spent - tier_value) / tier_value if tier_value != 0 else 0
    print("Players not matched for tier data:", unmatched_tier_players)

def calculate_doe_values(draft_data, expected_values, tiered_inflation):
    doe_values = {}
    
    for position in ["QB", "RB", "WR", "TE"]:
        doe_values[position] = {}
        for tier in range(1, TIER_COUNT + 1):
            tier_players = [
                player for player in draft_data 
                if player["metadata"]["position"] == position and 
                not expected_values.loc[expected_values["Player"] == player["metadata"]["first_name"] + " " + player["metadata"]["last_name"], "Tier"].empty and 
                expected_values.loc[expected_values["Player"] == player["metadata"]["first_name"] + " " + player["metadata"]["last_name"], "Tier"].values[0] == tier
            ]
            print(f"Calculating tier_value for position {position} and tier {tier}.")
            tier_value = sum(
                [expected_values.loc[expected_values["Player"] == player["metadata"]["first_name"] + " " + player["metadata"]["last_name"], "Value"].values[0] 
                 if not expected_values.loc[expected_values["Player"] == player["metadata"]["first_name"] + " " + player["metadata"]["last_name"], "Value"].empty 
                 else 0 for player in tier_players]
            )
            tier_inflation = tiered_inflation[position][tier]
            doe = tier_value * tier_inflation
            # Divide the total DOE by the number of picks for the tier to get the average
            avg_doe = doe / len(tier_players) if len(tier_players) != 0 else 0
            doe_values[position][tier] = avg_doe

    return doe_values

@app.template_filter('get_color_class')
def get_color_class(value):
    if value is None:
        return "neutral"
    if value < -0.15:
        return "severe-negative"
    elif value < -0.10:
        return "moderate-negative"
    elif value < -0.05:
        return "mild-negative"
    elif value < 0.05:
        return "neutral"
    elif value < 0.10:
        return "mild-positive"
    elif value < 0.15:
        return "moderate-positive"
    else:
        return "severe-positive"
    
def get_picks_per_tier(draft_data, expected_values):
    picks_per_tier = {"QB": {}, "RB": {}, "WR": {}, "TE": {}}
    
    for player in draft_data:
        player_full_name = player["metadata"]["first_name"] + " " + player["metadata"]["last_name"]
        player_position = player["metadata"]["position"]
        player_tier = expected_values.loc[expected_values["Player"] == player_full_name, "Tier"]

        if 'tier' in player and player['tier'] != player['tier']:  # Checking for nan values
            print(f"Player with nan tier: {player['name']}")

        # Skip over Kickers and Defenses
        if player_position == 'K' or player_position in ['D', 'DEF']:
            continue

        if not player_tier.empty:
            tier = player_tier.values[0]
            if tier in picks_per_tier[player_position]:
                picks_per_tier[player_position][tier] += 1
            else:
                picks_per_tier[player_position][tier] = 1

        # Corrected block
        for pos in picks_per_tier:
            tiers_to_replace = [tier for tier in picks_per_tier[pos] if tier != tier]  # Collect nan tiers
            for tier in tiers_to_replace:
                picks_per_tier[pos]['Not Available'] = picks_per_tier[pos].pop(tier)

    return picks_per_tier

def get_draft_data(draft_id):
    url = BASE_URL + f"{draft_id}/picks"
    response = requests.get(url)
    if response.status_code == 200:
        data = response.json()
        return data
    else:
        print(f"Error: Unable to fetch data for draft ID {draft_id}.")
        return []

def fuzzy_match_name(name, name_list, score_cutoff=85):
    """Finds the best match for a given name in a list of names using fuzzy string matching.
    Returns the best match and its similarity score."""
    best_match, score = process.extractOne(name, name_list, scorer=fuzz.token_sort_ratio)
    if score >= score_cutoff:
        return best_match, score
    return None, None

def map_players_to_ev_data(draft_data):
    # Load positional data and combine into one dataframe
    qb_data = pd.read_csv('2023/FantasyPros_2023_Draft_QB_Rankings.csv')
    rb_data = pd.read_csv('2023/FantasyPros_2023_Draft_RB_Rankings.csv')
    wr_data = pd.read_csv('2023/FantasyPros_2023_Draft_WR_Rankings.csv')
    te_data = pd.read_csv('2023/FantasyPros_2023_Draft_TE_Rankings.csv')
    
    # Combine all positional data into one dataframe
    all_data = pd.concat([qb_data, rb_data, wr_data, te_data], ignore_index=True)
    
    # Load auction values data
    auction_values_data = pd.read_csv('2023/Standard_Auction_Values.csv')
    
    # Merge the two dataframes based on player names
    merged_data = pd.merge(all_data, auction_values_data, left_on='PLAYER NAME', right_on='Player', how='left')
    
    unmatched_players = []
    fuzzy_matches = []
    
    for player in draft_data:
        player_name = player['metadata']['first_name'] + ' ' + player['metadata']['last_name']
        best_match_name = get_best_match_name(player_name, merged_data['PLAYER NAME'].tolist())
        matched_row = merged_data[merged_data['PLAYER NAME'] == best_match_name]

        if not matched_row.empty:
            player['Value'] = matched_row['Value'].values[0]
            player['Tier'] = matched_row['TIERS'].values[0]
        else:
            best_match, score = process.extractOne(player_name, merged_data['PLAYER NAME'].tolist())
            if score > 50:
                player['Value'] = merged_data[merged_data['PLAYER NAME'] == best_match]['Value'].values[0]
                player['Tier'] = merged_data[merged_data['PLAYER NAME'] == best_match]['TIERS'].values[0]
                fuzzy_matches.append({
                    'Original Name': player_name,
                    'Best Match': best_match,
                    'Similarity Score': score
                })
            else:
                unmatched_players.append(player_name)
                player['Value'] = 0
                player['Tier'] = np.nan  # or you can assign a default tier

    return draft_data, unmatched_players, fuzzy_matches

# 2. Modify the tier_mapping function.
def tier_mapping(player_name, position, tier_data):
    for index, tier in tier_data.iterrows():
        if player_name in tier['Players']:
            return tier['Tier']
    print(f"Tier not available for: {player_name}")
    return "Not Available"

# 3. Add logging for players who don't map to a tier.
def get_tiers_for_draft_data(draft_data, tier_data_by_position):
    unmapped_players = []
    for idx, row in draft_data.iterrows():
        player_name = row['metadata_first_name'] + ' ' + row['metadata_last_name']
        position = row['metadata_position']
        tier = tier_mapping(player_name, position, tier_data_by_position[position])
        if tier is None:
            unmapped_players.append(player_name)
        draft_data.at[idx, 'Tier'] = tier
    if unmapped_players:
        print(f"Players not mapped to any tier: {', '.join(unmapped_players)}")
    return draft_data

def calculate_inflation_rates(draft_data):
    unmatched_players = []  # To store players that aren't directly matched
    fuzzy_matches = []  # To store results of fuzzy matching
    
    # CHANGED: Moved the helper function for fuzzy matching here
    def get_fuzzy_value(player_full_name, column):
        result = process.extractOne(player_full_name, expected_values["Player"])
        best_match = result[0]
        score = result[1]
        if score >= 86:
            fuzzy_matches.append({
                "Original Name": player_full_name,
                "Best Match": best_match,
                "Similarity Score": score
            })
            print(f"Fetching fuzzy matched value for player {player_full_name} matched with {best_match} using column {column}.")
            return expected_values.loc[expected_values["Player"] == best_match, column].values[0]
        else:
            unmatched_players.append(player_full_name)
            return 0

    # Load the rankings and tiers for each position
    rankings = {
        "QB": pd.read_csv('2023/FantasyPros_2023_Draft_QB_Rankings.csv'),
        "RB": pd.read_csv('2023/FantasyPros_2023_Draft_RB_Rankings.csv'),
        "WR": pd.read_csv('2023/FantasyPros_2023_Draft_WR_Rankings.csv'),
        "TE": pd.read_csv('2023/FantasyPros_2023_Draft_TE_Rankings.csv')
    }
    
    expected_values = pd.read_csv(EXPECTED_VALUES_PATH, delimiter=',')
    print("Columns in expected_values:", expected_values.columns)
    print(expected_values.head())
    if ' Value ' in expected_values.columns or 'Value ' in expected_values.columns or ' Value' in expected_values.columns:
        print("Column 'Value' has extra spaces!")
    expected_values['Value'] = expected_values['Value'].str.replace('$', '').astype(int)

    # Calculate overall inflation
    total_spent = sum([int(player["metadata"]["amount"]) for player in draft_data if "metadata" in player and "amount" in player["metadata"] and player["metadata"]["position"] not in ['K', 'DEF']])
    
    total_value = 0
    for player in draft_data:
        player_full_name = player["metadata"]["first_name"] + " " + player["metadata"]["last_name"]
        print("Calculating expected_value for player:", player_full_name)
        expected_value = expected_values.loc[expected_values["Player"] == player_full_name, "Value"]
        if expected_value.empty:
            print("Attempting fuzzy match for player:", player_full_name)
            value = get_fuzzy_value(player_full_name, "Value")
            total_value += value
            print(f"Used fuzzy match for {player_full_name}, matched with value: {value}")
        else:
            total_value += expected_value.values[0]

    inflation = (total_spent - total_value) / total_value if total_value != 0 else 0

    # Incorporate tier data
    for position, df in rankings.items():
        for index, row in df.iterrows():
            player_name = row['PLAYER NAME']
            tier = row['TIERS']
            expected_values.loc[expected_values["Player"] == player_name, "Tier"] = tier

    # Calculate positional inflation
    positional_inflation = {}
    for position in ["QB", "RB", "WR", "TE"]:
        pos_players = [player for player in draft_data if player["metadata"]["position"] == position]
        pos_spent = sum([int(player["metadata"]["amount"]) for player in pos_players])
        pos_value = sum(
            [expected_values.loc[expected_values["Player"] == player["metadata"]["first_name"] + " " + player["metadata"]["last_name"], "Value"].values[0] 
             if not expected_values.loc[expected_values["Player"] == player["metadata"]["first_name"] + " " + player["metadata"]["last_name"], "Value"].empty 
             else 0 for player in pos_players]
        )
        positional_inflation[position] = (pos_spent - pos_value) / pos_value if pos_value != 0 else 0
    
    # Calculate tier-based inflation within each position
    positional_tier_inflation = {}
    for position in ["QB", "RB", "WR", "TE"]:
        positional_tier_inflation[position] = {}
        for tier in range(1, TIER_COUNT + 1):
            tier_players = [
                player for player in draft_data 
                if player["metadata"]["position"] == position and 
                not expected_values.loc[expected_values["Player"] == player["metadata"]["first_name"] + " " + player["metadata"]["last_name"], "Tier"].empty and 
                expected_values.loc[expected_values["Player"] == player["metadata"]["first_name"] + " " + player["metadata"]["last_name"], "Tier"].values[0] == tier
            ]
            tier_spent = sum([int(player["metadata"]["amount"]) for player in tier_players])
            tier_value = sum(
                [expected_values.loc[expected_values["Player"] == player["metadata"]["first_name"] + " " + player["metadata"]["last_name"], "Value"].values[0] 
                 if not expected_values.loc[expected_values["Player"] == player["metadata"]["first_name"] + " " + player["metadata"]["last_name"], "Value"].empty 
                 else 0 for player in tier_players]
            )
            positional_tier_inflation[position][tier] = (tier_spent - tier_value) / tier_value if tier_value != 0 else 0

    # Print the results
    print("Overall Inflation:", inflation)
    print("Positional Inflation:", positional_inflation)
    print("Tiered Inflation:", positional_tier_inflation)
    print("DOE Values:", calculate_doe_values(draft_data, expected_values, positional_tier_inflation))
    print("Picks per tier:", get_picks_per_tier(draft_data, expected_values))
    print("Average Tier Costs:", get_avg_tier_cost(draft_data, expected_values))
    print("Unmatched players:", unmatched_players)
    print("Fuzzy matches:", fuzzy_matches)
    

    return {
        "overall": inflation, 
        "positional": positional_inflation,
        "positional_tiered": positional_tier_inflation,
        "fuzzy_matches": fuzzy_matches  # CHANGED: Add fuzzy_matches to the returned dictionary
    }, expected_values  # Return expected_values as well

inflation_rates = None

def diagnose_mahomes(draft_data, expected_values):
    # Check for both Patrick Mahomes and Patrick Mahomes II
    mahomes_names = ["Patrick Mahomes", "Patrick Mahomes II"]
    for name in mahomes_names:
        mahomes_draft_data = [player for player in draft_data if name in (player["metadata"]["first_name"] + " " + player["metadata"]["last_name"])]
        mahomes_expected_values = expected_values[expected_values["Player"].str.contains("Mahomes")]
        if mahomes_draft_data:
            print(name, "in draft_data:", mahomes_draft_data)
            print(name, "not found in draft_data.")
        if not mahomes_expected_values.empty:
            print(name, "in expected_values:")
            print(mahomes_expected_values)
            print(name, "not found in expected_values.")
            
def calculate_r2(x, y):
    try:
        x = np.array(x).reshape((-1, 1))
        y = np.array(y)
        
        if len(np.unique(x)) < 2:
            # If fewer than 2 unique x-values, return "N/A"
            return "N/A"
        
        if np.isnan(x).any() or np.isnan(y).any() or np.isinf(x).any() or np.isinf(y).any():
            # Check for NaN or infinity values in x or y
            return "N/A"

    except ValueError as e:
        print(f"Error when reshaping x and y: {e}")
        return "N/A"  # Return a default value for R2 if conversion fails

    model = LinearRegression().fit(x, y)
    y_pred = model.predict(x)
    
    return r2_score(y, y_pred)

def calculate_r2_by_position(raw_data):
    position_r2 = {}
    position_colors = {
        "RB": "blue",
        "WR": "green",
        "QB": "red",
        "TE": "orange",
    }

    for position, color in position_colors.items():
        x = [pick["pick_no"] for pick in raw_data if pick["metadata"]["position"] == position]
        
        y_raw = [pick["metadata"]["amount"] for pick in raw_data if pick["metadata"]["position"] == position]
        y = []
        
        for val in y_raw:
            try:
                y.append(int(val))
            except ValueError:
                print(f"Cannot convert to integer: {val}")
                y.append(val)  # Keep the original value; this might cause errors downstream
        
        r2_value = calculate_r2(x, y)
        if r2_value != "N/A":
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
                "r2": "0",
                "cost_of_waiting": {
                    "1_pick": "0",
                    "5_picks": "0",
                    "10_picks": "0",
                    "20_picks": "0",
                }
            }

    return position_r2

@app.route('/')
def index():
    # Default structures
    default_positions = ['QB', 'RB', 'WR', 'TE']
    
    default_positional_inflation = {pos: 0 for pos in default_positions}
    default_tiered_inflation = {pos: {tier: 0 for tier in range(1, 10)} for pos in default_positions}
    default_picks_per_tier = {pos: {tier: 0 for tier in range(1, 10)} for pos in default_positions}
    default_total_picks = sum([default_picks_per_tier[pos][tier] for pos in default_positions for tier in range(1, 10)])
    default_doe_values = {pos: {tier: 0 for tier in range(1, 10)} for pos in default_positions}
    default_average_tier_costs = {pos: {tier: 0 for tier in range(1, 10)} for pos in default_positions}
    default_avg_tier_costs = {pos: {tier: 0 for tier in range(1, 10)} for pos in default_positions}

    return render_template(
        'inflation.html', 
        overall_inflation=0, 
        positional_inflation=default_positional_inflation, 
        tiered_inflation=default_tiered_inflation,
        picks_per_tier=default_picks_per_tier,
        total_picks=default_total_picks,
        doe_values=default_doe_values,
        average_tier_costs=default_average_tier_costs,
        avg_tier_costs=default_avg_tier_costs,
        get_color_class=get_color_class
    )

@app.route('/scatter_data', methods=['GET'])
def scatter_data():
    draft_id = request.args.get('draft_id')
    if not draft_id:
        return jsonify({"error": "Draft ID is required"}), 400

    # Fetch draft data
    draft_data = get_draft_data(draft_id)

    # Load the expected values data
    ev_data = pd.read_csv(EXPECTED_VALUES_PATH)

    # Map players in the draft data to their expected values
    draft_data, unmatched_players, fuzzy_matches = map_players_to_ev_data(draft_data)

    # Prepare the data for scatter plot
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
        
        # Handle NaN values for expected value
        if pd.isna(expected_value):
            expected_value = "$0"  # or whatever default value you prefer
        
        scatter_data["pick_no"].append(index + 1)  # Assuming index starts from 0
        scatter_data["metadata_amount"].append(int(player['metadata']['amount']))
        player_position = player['metadata']['position']
        color = POSITION_COLORS.get(player_position, "gray")  # Use gray as a default color for any other positions
        scatter_data["colors"].append(color)
        scatter_data["player_names"].append(player_name)
        scatter_data["expected_values"].append(expected_value)

    # Calculate R^2 values for each position
    r2_values = calculate_r2_by_position(draft_data)

    response_data = {
        "scatterplot": scatter_data,
        "r2_values": r2_values
    }

    return jsonify(response_data)

@app.route('/inflation', methods=['GET', 'POST'])
def get_inflation_rate():
    # Check if request is for JSON data (e.g., AJAX request for live updates)
    is_json_request = request.headers.get('X-Requested-With') == 'XMLHttpRequest'

    # Initialize default values
    draft_id = None
    inflation_rates = {}
    overall_inflation = 0
    positional_inflation = {'QB': 0, 'RB': 0, 'WR': 0, 'TE': 0}
    tiered_inflation = {'QB': {}, 'RB': {}, 'WR': {}, 'TE': {}}
    picks_per_tier = {'QB': {}, 'RB': {}, 'WR': {}, 'TE': {}}
    total_picks = {'QB': 0, 'RB': 0, 'WR': 0, 'TE': 0}
    avg_tier_costs = {"QB": {}, "RB": {}, "WR": {}, "TE": {}}
    doe_values = {}

    # Process the draft_id if it's a POST request
    if request.method == 'POST':
        draft_id = request.form.get('draft_id')
        if draft_id:
            draft_data = get_draft_data(draft_id)
            inflation_rates, expected_values = calculate_inflation_rates(draft_data)
            avg_tier_costs = get_avg_tier_cost(draft_data, expected_values)

            # Diagnose Mahomes situation
            diagnose_mahomes(draft_data, expected_values)
            # Calculate picks per tier
            picks_per_tier = get_picks_per_tier(draft_data, expected_values)
            # Calculate total picks
            total_picks = {pos: sum(tier_counts.values()) for pos, tier_counts in picks_per_tier.items()}
            # Calculate the DOE values
            doe_values = calculate_doe_values(draft_data, expected_values, inflation_rates['positional_tiered'])
            # Update the inflation values based on calculations
            overall_inflation = inflation_rates.get('overall', 0)
            positional_inflation = inflation_rates.get('positional', {'QB': 0, 'RB': 0, 'WR': 0, 'TE': 0})
            tiered_inflation = inflation_rates.get('positional_tiered', {'QB': {}, 'RB': {}, 'WR': {}, 'TE': {}})

    # If the client is expecting a JSON response, return the JSON data
    if is_json_request:
        sanitized_data = sanitize_data({
            'overall_inflation': overall_inflation,
            'positional_inflation': positional_inflation,
            'tiered_inflation': tiered_inflation,
            'picks_per_tier': picks_per_tier,
            'total_picks': total_picks,
            'avg_tier_costs': avg_tier_costs,
            'doe_values': doe_values
        })
        return jsonify(sanitized_data)

    # Default return (this will always provide a response)
    return render_template(
        'inflation.html', 
        inflation_rates=inflation_rates,
        overall_inflation=overall_inflation,
        positional_inflation=positional_inflation,
        tiered_inflation=tiered_inflation,
        picks_per_tier=picks_per_tier,
        total_picks=total_picks,
        draft_id=draft_id,
        get_color_class=get_color_class,
        avg_tier_costs=avg_tier_costs,
        doe_values=doe_values
    )

@app.after_request
def add_header(response):
    response.cache_control.no_store = True
    return response

if __name__ == "__main__":
    app.run(debug=True, threaded=True, host='0.0.0.0', port=5050)
