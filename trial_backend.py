import requests
import pandas as pd
from flask import Flask, jsonify, request, render_template
from flask import jsonify
from flask import render_template


app = Flask(__name__, template_folder='C:\\Users\\lasab\\Downloads')

BASE_URL = "https://api.sleeper.app/v1/draft/"
EXPECTED_VALUES_PATH = 'C:\\Users\\lasab\\Downloads\\Standard Auction Values (2).csv'
TIER_COUNT = 10

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
    total_spent = sum([int(player["metadata"]["amount"]) for player in draft_data if "metadata" in player and "amount" in player["metadata"]])
    
    total_value = sum(
        [expected_values.loc[expected_values["Player"] == player["metadata"]["first_name"] + " " + player["metadata"]["last_name"], "Value"].values[0] 
         if not expected_values.loc[expected_values["Player"] == player["metadata"]["first_name"] + " " + player["metadata"]["last_name"], "Value"].empty 
         else 0 for player in draft_data]
    )
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

    return {
        "overall": inflation, 
        "positional": positional_inflation,
        "positional_tiered": positional_tier_inflation
    }, expected_values  # Return expected_values as well


inflation_rates = None

@app.route('/')
def index():
    if inflation_rates:
        return render_template(
            'inflation.html', 
            overall_inflation=inflation_rates['overall'],
            positional_inflation=inflation_rates['positional'],
            tiered_inflation=inflation_rates['positional_tiered'],
            picks_per_tier=picks_per_tier,
            total_picks=total_picks
        )
    else:
        # Provide default values if inflation_rates is None
            return render_template('inflation.html', inflation_rates={},
            overall_inflation=0,
            positional_inflation={'QB': 0, 'RB': 0, 'WR': 0, 'TE': 0},
            tiered_inflation={'QB': {}, 'RB': {}, 'WR': {}, 'TE': {}},
            picks_per_tier={'QB': {}, 'RB': {}, 'WR': {}, 'TE': {}},
            total_picks={'QB': 0, 'RB': 0, 'WR': 0, 'TE': 0}
        )

@app.route('/get_inflation_rate', methods=['GET', 'POST'])
@app.route('/get_inflation_rate', methods=['GET', 'POST'])
def get_inflation_rate():
    global inflation_rates, picks_per_tier  # declare these as global to modify them

    if request.method == 'POST':
        draft_id = request.form['draft_id']
        draft_data = get_draft_data(draft_id)
        inflation_rates, expected_values = calculate_inflation_rates(draft_data)
        
        # Calculate picks per tier
        picks_per_tier = get_picks_per_tier(draft_data, expected_values)
        
        # Calculate total picks
        total_picks = {pos: sum(tier_counts.values()) for pos, tier_counts in picks_per_tier.items()}

        print(inflation_rates)  # Print the calculated inflation rates
        print(picks_per_tier)   # Print the picks per tier
        
        # Return the template with the new data
        return render_template(
            'inflation.html', 
            inflation_rates=inflation_rates,
            overall_inflation=inflation_rates['overall'],
            positional_inflation=inflation_rates['positional'],
            tiered_inflation=inflation_rates['positional_tiered'],
            picks_per_tier=picks_per_tier,
            total_picks=total_picks,
            draft_id=draft_id
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
            draft_id=""  # default empty string for draft_id
        )

if __name__ == "__main__":
    app.run(debug=True)
