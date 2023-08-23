import requests
import pandas as pd
from flask import Flask, jsonify, request, render_template
from flask import jsonify
from flask import render_template
from fuzzywuzzy import process


app = Flask(__name__, template_folder='C:\\Users\\lasab\\Downloads')

BASE_URL = "https://api.sleeper.app/v1/draft/"
EXPECTED_VALUES_PATH = 'C:\\Users\\lasab\\Downloads\\Standard Auction Values (2).csv'
TIER_COUNT = 10
# ... (rest of the code)

def calculate_inflation_with_logging(draft_data, expected_values):
    unmatched_players = []  # To store players that aren't directly matched
    fuzzy_matches = []  # To store results of fuzzy matching
    
    def get_fuzzy_value(player_full_name, column):
        # Handle known discrepancies
        name_corrections = {
            "DJ Moore": "D.J. Moore"
        }
        player_full_name = name_corrections.get(player_full_name, player_full_name)
        
        best_match, score = process.extractOne(player_full_name, expected_values["Player"])
        if score >= 70:
            fuzzy_matches.append({
                "Original Name": player_full_name,
                "Best Match": best_match,
                "Similarity Score": score
            })
            return expected_values.loc[expected_values["Player"] == best_match, column].values[0]
        else:
            unmatched_players.append(player_full_name)
            return 0
    
    # Place for your other inflation calculations
    total_value = 0
    for player in draft_data:
        player_full_name = player["metadata"]["first_name"] + " " + player["metadata"]["last_name"]
        expected_value = expected_values.loc[expected_values["Player"] == player_full_name, "Value"]
        if expected_value.empty:
            value = get_fuzzy_value(player_full_name, "Value")
            total_value += value
            print(f"Used fuzzy match for {player_full_name}, matched with value: {value}")
        else:
            total_value += expected_value.values[0]

    # Insert the diagnostic code here
    missing_tier_players = expected_values[expected_values['Tier'].isna()]["Player"]
    print(f"Players missing tier info: {len(missing_tier_players)}")
    for player in missing_tier_players:
        print(player)
        
    # Continue with your other calculations

    return {
        "overall": inflation,  # Assuming you calculate this in your function
        "positional": positional_inflation,  # Assuming you calculate this in your function
        "unmatched_players": unmatched_players,
        "fuzzy_matches": fuzzy_matches
    }
    # Calculate tier-based inflation within each position
    unmatched_tier_players = []
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

def get_color_class(value):
    if value < -0.15:
        return "severe-negative"
    elif -0.15 <= value < -0.05:
        return "moderate-negative"
    elif -0.05 <= value < 0:
        return "mild-negative"
    elif 0 <= value < 0.05:
        return "mild-positive"
    elif 0.05 <= value < 0.15:
        return "moderate-positive"
    elif value >= 0.15:
        return "severe-positive"
    else:
        return "neutral"


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


def calculate_inflation_rates(draft_data):
    unmatched_players = []  # To store players that aren't directly matched
    fuzzy_matches = []  # To store results of fuzzy matching
    
    # CHANGED: Moved the helper function for fuzzy matching here
    def get_fuzzy_value(player_full_name, column):
        result = process.extractOne(player_full_name, expected_values["Player"])
        best_match = result[0]
        score = result[1]
        if score >= 90:
            fuzzy_matches.append({
                "Original Name": player_full_name,
                "Best Match": best_match,
                "Similarity Score": score
            })
            return expected_values.loc[expected_values["Player"] == best_match, column].values[0]
        else:
            unmatched_players.append(player_full_name)
            return 0

    # Load the rankings and tiers for each position
    rankings = {
        "QB": pd.read_csv('C:\\Users\\lasab\\Downloads\\FantasyPros_2023_Draft_QB_Rankings.csv'),
        "RB": pd.read_csv('C:\\Users\\lasab\\Downloads\\FantasyPros_2023_Draft_RB_Rankings.csv'),
        "WR": pd.read_csv('C:\\Users\\lasab\\Downloads\\FantasyPros_2023_Draft_WR_Rankings.csv'),
        "TE": pd.read_csv('C:\\Users\\lasab\\Downloads\\FantasyPros_2023_Draft_TE_Rankings.csv')
    }
    
    expected_values = pd.read_csv(EXPECTED_VALUES_PATH)
    expected_values['Value'] = expected_values['Value'].str.replace('$', '').astype(int)

    # Calculate overall inflation
    total_spent = sum([int(player["metadata"]["amount"]) for player in draft_data if "metadata" in player and "amount" in player["metadata"] and player["metadata"]["position"] not in ['K', 'DEF']])
    
    total_value = 0
    for player in draft_data:
        player_full_name = player["metadata"]["first_name"] + " " + player["metadata"]["last_name"]
        expected_value = expected_values.loc[expected_values["Player"] == player_full_name, "Value"]
        if expected_value.empty:
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
    # Check if Patrick Mahomes is in the draft_data
    mahomes_draft_data = [player for player in draft_data if 'Patrick Mahomes' in (player["metadata"]["first_name"] + " " + player["metadata"]["last_name"])]
    mahomes_expected_values = expected_values[expected_values["Player"].str.contains("Mahomes")]

    if mahomes_draft_data:
        print("Mahomes in draft_data:", mahomes_draft_data)
    else:
        print("Patrick Mahomes not found in draft_data.")

    if not mahomes_expected_values.empty:
        print("Mahomes in expected_values:")
        print(mahomes_expected_values)
    else:
        print("Patrick Mahomes not found in expected_values.")

@app.route('/')
def index():
    if inflation_rates:
        return render_template(
            'inflation.html', 
            overall_inflation=inflation_rates['overall'],
            positional_inflation=inflation_rates['positional'],
            tiered_inflation=inflation_rates['positional_tiered'],
            picks_per_tier=picks_per_tier,
            total_picks=total_picks,
            get_color_class=get_color_class,
            doe_values={}
        )
    else:
        # Provide default values if inflation_rates is None
        return render_template(
            'inflation.html', 
            inflation_rates={},
            overall_inflation=0,
            positional_inflation={'QB': 0, 'RB': 0, 'WR': 0, 'TE': 0},
            tiered_inflation={'QB': {}, 'RB': {}, 'WR': {}, 'TE': {}},
            picks_per_tier={'QB': {}, 'RB': {}, 'WR': {}, 'TE': {}},
            total_picks={'QB': 0, 'RB': 0, 'WR': 0, 'TE': 0},
            get_color_class={},  
            doe_values={}
        )

@app.route('/get_inflation_rate', methods=['GET', 'POST'])
def get_inflation_rate():
    if request.method == 'POST':
        draft_id = request.form['draft_id']
        draft_data = get_draft_data(draft_id)
        inflation_rates, expected_values = calculate_inflation_rates(draft_data)
        
        # Diagnose Mahomes situation
        diagnose_mahomes(draft_data, expected_values)

        # Calculate picks per tier
        picks_per_tier = get_picks_per_tier(draft_data, expected_values)
        
        # Calculate total picks
        total_picks = {pos: sum(tier_counts.values()) for pos, tier_counts in picks_per_tier.items()}

        # Calculate the DOE values
        doe_values = calculate_doe_values(draft_data, expected_values, inflation_rates['positional_tiered'])
        
        # Return the template with the new data
        return render_template(
            'inflation.html', 
            inflation_rates=inflation_rates,
            overall_inflation=inflation_rates['overall'],
            positional_inflation=inflation_rates['positional'],
            tiered_inflation=inflation_rates['positional_tiered'],
            picks_per_tier=picks_per_tier,
            total_picks=total_picks,
            draft_id=draft_id,
            get_color_class=get_color_class,
            doe_values=doe_values  # pass doe_values here
        )
    else:
        return render_template(
            'inflation.html', 
            inflation_rates={},
            overall_inflation=0,
            positional_inflation={'QB': 0, 'RB': 0, 'WR': 0, 'TE': 0},
            tiered_inflation={'QB': {}, 'RB': {}, 'WR': {}, 'TE': {}},
            picks_per_tier={'QB': {}, 'RB': {}, 'WR': {}, 'TE': {}},
            total_picks={'QB': 0, 'RB': 0, 'WR': 0, 'TE': 0},
            draft_id="",  # default empty string for draft_id
            get_color_class={},
            doe_values={}
        )

if __name__ == "__main__":
    app.run(debug=True)
