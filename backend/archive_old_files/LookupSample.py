import pandas as pd
import logging

# Setup logging
logging.basicConfig(level=logging.DEBUG)

# Paths to your data files
AUCTION_VALUES_PATH = '/Users/khoff/Code/inflaction_calculator/backend/2024/Standard_Auction_Values.csv'
QB_RANKINGS_PATH = '/Users/khoff/Code/inflaction_calculator/backend/2024/FantasyPros_2024_Draft_QB_Rankings.csv'
RB_RANKINGS_PATH = '/Users/khoff/Code/inflaction_calculator/backend/2024/FantasyPros_2024_Draft_RB_Rankings.csv'
WR_RANKINGS_PATH = '/Users/khoff/Code/inflaction_calculator/backend/2024/FantasyPros_2024_Draft_WR_Rankings.csv'
TE_RANKINGS_PATH = '/Users/khoff/Code/inflaction_calculator/backend/2024/FantasyPros_2024_Draft_TE_Rankings.csv'

# Load the player name mappings
mappings_path = '/Users/khoff/Code/inflaction_calculator/backend/2024/player_name_mappings.csv'
mappings_df = pd.read_csv(mappings_path)

# Load the auction values
auction_values_df = pd.read_csv(AUCTION_VALUES_PATH)

# Load the positional rankings
positional_rankings = {
    'QB': pd.read_csv(QB_RANKINGS_PATH),
    'RB': pd.read_csv(RB_RANKINGS_PATH),
    'WR': pd.read_csv(WR_RANKINGS_PATH),
    'TE': pd.read_csv(TE_RANKINGS_PATH)
}

# Mock draft_data
draft_data = [
    {'metadata': {'first_name': 'Isaac', 'last_name': 'Guerendo', 'position': 'RB', 'amount': '10'}},
    {'metadata': {'first_name': 'J.J.', 'last_name': 'McCarthy', 'position': 'QB', 'amount': '20'}},
    {'metadata': {'first_name': 'DeMario', 'last_name': 'Douglas', 'position': 'WR', 'amount': '5'}},
    {'metadata': {'first_name': 'MarShawn', 'last_name': 'Lloyd', 'position': 'RB', 'amount': '15'}},
    {'metadata': {'first_name': 'Joshua', 'last_name': 'Palmer', 'position': 'WR', 'amount': '8'}},
    {'metadata': {'first_name': 'Tyrone', 'last_name': 'Tracy', 'position': 'RB', 'amount': '6'}},
    {'metadata': {'first_name': 'Brian', 'last_name': 'Robinson', 'position': 'RB', 'amount': '12'}},
    {'metadata': {'first_name': 'Brian', 'last_name': 'Thomas', 'position': 'WR', 'amount': '7'}},
    {'metadata': {'first_name': 'Hollywood', 'last_name': 'Brown', 'position': 'WR', 'amount': '14'}},
    {'metadata': {'first_name': 'Pat', 'last_name': 'Freiermuth', 'position': 'TE', 'amount': '9'}},
    {'metadata': {'first_name': 'Kenneth', 'last_name': 'Walker', 'position': 'RB', 'amount': '22'}},
    {'metadata': {'first_name': 'Michael', 'last_name': 'Pittman', 'position': 'WR', 'amount': '18'}},
    {'metadata': {'first_name': 'Patrick', 'last_name': 'Mahomes', 'position': 'QB', 'amount': '30'}},
    {'metadata': {'first_name': 'Deebo', 'last_name': 'Samuel', 'position': 'WR', 'amount': '25'}},
    {'metadata': {'first_name': 'DJ', 'last_name': 'Moore', 'position': 'WR', 'amount': '20'}},
    {'metadata': {'first_name': 'Marvin', 'last_name': 'Harrison', 'position': 'WR', 'amount': '35'}},
    {'metadata': {'first_name': 'Travis', 'last_name': 'Etienne', 'position': 'RB', 'amount': '28'}},
    {'metadata': {'first_name': 'DeVonta', 'last_name': 'Smith', 'position': 'WR', 'amount': '24'}}
]

# Function to get player info based on Sleeper name
def get_player_info(sleeper_name, position):
    # Map the sleeper name to the auction value and tier names
    mapping = mappings_df[mappings_df['Sleeper Name'] == sleeper_name].iloc[0]
    auction_name = mapping['Auction Value Name']
    tier_name = mapping['Tier Name']
    
    # Lookup the auction value
    auction_value_row = auction_values_df[auction_values_df['Player'] == auction_name]
    if not auction_value_row.empty:
        auction_value = auction_value_row['Value'].values[0]
    else:
        auction_value = 'N/A'
    
    # Lookup the tier
    tier = 'N/A'
    if position in positional_rankings:
        tier_row = positional_rankings[position][positional_rankings[position]['PLAYER NAME'] == tier_name]
        if not tier_row.empty and 'TIERS' in tier_row.columns:
            tier = tier_row['TIERS'].values[0]
    
    logging.debug(f"Player: {sleeper_name}, Auction Value: {auction_value}, Tier: {tier}")
    return auction_value, tier

# Function to map players using the logic from map_players_to_ev_data
def map_players_to_ev_data(player_name, position):
    # Initial lookup based on Sleeper Name
    mapping_row = mappings_df[mappings_df['Sleeper Name'] == player_name]
    if mapping_row.empty:
        logging.warning(f"Player {player_name} not found in mappings.")
        return 'N/A', 'N/A'
    
    # Extract corresponding names
    auction_name = mapping_row['Auction Value Name'].values[0]
    tier_name = mapping_row['Tier Name'].values[0]
    
    # Auction Value Lookup
    auction_value_row = auction_values_df[auction_values_df['Player'] == auction_name]
    if not auction_value_row.empty:
        auction_value = auction_value_row['Value'].values[0]
    else:
        auction_value = 'N/A'
    
    # Tier Lookup
    if position in positional_rankings:
        tier_row = positional_rankings[position][positional_rankings[position]['PLAYER NAME'] == tier_name]
        if not tier_row.empty and 'TIERS' in tier_row.columns:
            tier = tier_row['TIERS'].values[0]
        else:
            tier = 'N/A'
    else:
        tier = 'N/A'
    
    logging.debug(f"Player: {player_name}, Auction Value: {auction_value}, Tier: {tier}")
    return auction_value, tier

# Test function that compares the two approaches using draft_data
def test_map_players_with_draft_data():
    for player in draft_data:
        player_name = f"{player['metadata']['first_name']} {player['metadata']['last_name']}"
        position = player['metadata']['position']
        
        # Expected values from the new mapping function
        expected_auction_value, expected_tier = get_player_info(player_name, position)
        
        # Values from the original map_players_to_ev_data logic
        auction_value, tier = map_players_to_ev_data(player_name, position)
        
        logging.info(f"Testing Player: {player_name}, Position: {position}")
        logging.info(f"Expected: Auction Value: {expected_auction_value}, Tier: {expected_tier}")
        logging.info(f"Actual: Auction Value: {auction_value}, Tier: {tier}")
        logging.info("="*50)

# Run the test with draft data
if __name__ == "__main__":
    test_map_players_with_draft_data()
