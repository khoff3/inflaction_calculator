import requests
import pandas as pd
from flask import Flask, jsonify, request, render_template
from fuzzywuzzy import fuzz, process
import json
import numpy as np
from numpy import float64

app = Flask(__name__, template_folder='C:\\Users\\lasab\\Downloads')
BASE_URL = "https://api.sleeper.app/v1/draft/"
EXPECTED_VALUES_PATH = 'C:\\Users\\lasab\\Downloads\\Standard Auction Values (2).csv'
TIER_COUNT = 10
exception_list = {}
extended_mapping = pd.read_csv("C:\\Users\\lasab\\Downloads\\player_name_mappings.csv").set_index("Original_Name").to_dict()["Mapped_Name"]
exception_list.update(extended_mapping)
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
        # ...
        # Fallback to the super's default method
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

def calculate_inflation_with_logging(draft_data, expected_values):
    unmatched_players = []  # To store players that aren't directly matched
    fuzzy_matches = []  # To store results of fuzzy matching
    def get_fuzzy_value(player_full_name, column):
        # Handle known discrepancies
        
        player_full_name = get_best_match_name(player_full_name)
        best_match, score = process.extractOne(get_best_match_name(player_full_name), expected_values["Player"])
        if score >= 30:
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

def calculate_doe_values(draft_data, expected_values, positional_tier_inflation):
    doe_values = {}
    for player_data in draft_data:
        position = player_data['metadata']['position']
        # ... existing logic for processing players using player_data ...
    return doe_values

    # Assuming draft_data is a dictionary with positions as keys and a list of players as values
    for position, players in draft_data.items():
        doe_values[position] = {}
        for player in players:
            # Extracting player name
            player_name = player["metadata"]["first_name"] + " " + player["metadata"]["last_name"]
            
            # Getting expected value for the player
            value_series = expected_values.loc[expected_values["Player"] == player_name, "Value"]
            tier_value = value_series.iloc[0] if not value_series.empty else 0
            
            # Assuming player has a 'tier' field which tells us the tier of the player
            tier = player['tier']
            
            # Calculate DOE
            tier_inflation = tiered_inflation[position].get(tier, 0)  # Assuming tiered_inflation has position -> tier -> inflation structure
            doe = tier_value * tier_inflation
    
            # Divide the total DOE by the number of players for the tier to get the average
            avg_doe = doe / len(players) if players else 0
            doe_values[position][tier] = avg_doe
    
    return doe_values


@app.template_filter('get_color_class')

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


def get_best_match_name(name, draft_data_names):
    # Special handling for Patrick Mahomes
    if name == "Patrick Mahomes II" and "Patrick Mahomes II" in draft_data_names:
        return "Patrick Mahomes II"
    elif name == "Patrick Mahomes II" and "Patrick Mahomes" in draft_data_names:
        return "Patrick Mahomes"
    
    best_match = process.extractOne(name, draft_data_names)
    if best_match and best_match[1] > 85:  # Using a threshold of 85 for match quality
        return best_match[0]
    return None

# Added the fuzzy matching functions

# Fuzzy matching utilities

def fuzzy_match_name(name, name_list, score_cutoff=85):
    """Finds the best match for a given name in a list of names using fuzzy string matching.
    Returns the best match and its similarity score."""
    best_match, score = process.extractOne(name, name_list, scorer=fuzz.token_sort_ratio)
    if score >= score_cutoff:
        return best_match, score
    return None, None


def map_players_to_ev_data(draft_data, ev_data):
    """Maps players from draft data to their corresponding entries in the EV data using exact and fuzzy matching.
    Returns the updated draft data, a list of unmatched players, and a list of fuzzy matches made."""
    player_names_ev = ev_data['Name'].tolist()
    unmatched_players = []
    fuzzy_matches = []

    for player in draft_data:
        if player['Name'] in player_names_ev:
            # Exact match found
            continue
        else:
            # Try fuzzy matching
            best_match, score = fuzzy_match_name(player['Name'], player_names_ev)
            if best_match:
                fuzzy_matches.append({
                    "Original Name": player['Name'],
                    "Best Match": best_match,
                    "Similarity Score": score
                })
                # Update player name in draft data with the best match
                player['Name'] = best_match
            else:
                unmatched_players.append(player['Name'])

    return draft_data, unmatched_players, fuzzy_matches

# 2. Modify the tier_mapping function.
def tier_mapping(player_name, position, tier_data):
    if player_name in exception_list:
        player_name = exception_list[player_name]
    if player_name in tier_data:
        return tier_data[player_name]
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
            return expected_values.loc[expected_values["Player"] == best_match, column].values[0]
        else:
            unmatched_players.append(player_full_name)
            return 0

    # Load the rankings and tiers for each position
    rankings = {
        "QB": pd.read_csv('C:\\Users\\lasab\\Downloads\\FantasyPros_2023_Draft_QB_Rankings (1).csv'),
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
            
@app.route('/')
def index():
    return render_template('inflation.html', overall_inflation=0)

    # If it's a GET request, render the page normally without expecting the draft_id
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


def map_players_to_ev_data(draft_data, ev_data):
    unmatched_players = []
    fuzzy_matches = []
    
    ev_player_names = ev_data['Player'].tolist()

    for player in draft_data:
        player_name = player['metadata']['first_name'] + ' ' + player['metadata']['last_name']

        if player_name in ev_player_names:
            player['Value'] = ev_data[ev_data['Player'] == player_name]['Value'].values[0]
            player['Tier'] = ev_data[ev_data['Player'] == player_name]['Tier'].values[0]
        else:
            best_match, score = process.extractOne(player_name, ev_player_names)
            if score > 50:
                player['Value'] = ev_data[ev_data['Player'] == best_match]['Value'].values[0]
                player['Tier'] = ev_data[ev_data['Player'] == best_match]['Tier'].values[0]
                fuzzy_matches.append({
                    'Original Name': player_name,
                    'Best Match': best_match,
                    'Similarity Score': score
                })
            else:
                unmatched_players.append(player_name)
                player['Value'] = 0
                player['Tier'] = max(ev_data['Tier'])  # Assign the last tier

    return draft_data, unmatched_players, fuzzy_matches


# Update the function call to map_players_to_ev_data
draft_data, unmatched_players, fuzzy_matches = map_players_to_ev_data(draft_data, ev_data)

# Handle players without tiers
if "Not Available" in picks_per_tier["RB"]:
    del picks_per_tier["RB"]["Not Available"]


if __name__ == "__main__":
    app.run(debug=True, threaded=True)
