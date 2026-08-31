import pandas as pd
from fuzzywuzzy import process, fuzz
import requests
import logging

# Function to fetch draft data
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

# Function to normalize player names
def normalize_name(name):
    name = name.lower()
    suffixes = [' jr.', ' sr.', ' iii', ' ii']
    for suffix in suffixes:
        name = name.replace(suffix, '')
    return name.strip()

# Function to apply manual name mappings
def apply_name_mappings(name, mappings):
    return mappings.get(name, name)

# Function to match player names using fuzzy matching
def match_player_name(name, choices, threshold=85):
    match, score = process.extractOne(name, choices, scorer=fuzz.token_sort_ratio)
    return match if score >= threshold else None

# Draft ID to test with
draft_id = "1125469001368346624"

# Fetch draft data
draft_data = get_draft_data(draft_id)

# Check if data was fetched successfully
if draft_data:
    print(f"Fetched {len(draft_data)} picks for draft ID {draft_id}.")
else:
    print("No data fetched. Please check the draft ID and try again.")

# Load the provided files
qb_rankings = pd.read_csv('backend/2024/FantasyPros_2024_Draft_QB_Rankings.csv')
rb_rankings = pd.read_csv('backend/2024/FantasyPros_2024_Draft_RB_Rankings.csv')
wr_rankings = pd.read_csv('backend/2024/FantasyPros_2024_Draft_WR_Rankings.csv')
te_rankings = pd.read_csv('backend/2024/FantasyPros_2024_Draft_TE_Rankings.csv')
auction_values = pd.read_csv('backend/2024/Standard_Auction_Values.csv')
name_mappings = pd.read_csv('backend/2024/player_name_mappings.csv')

# Check column names to ensure they match
print("Columns in auction_values:")
print(auction_values.columns)
print("Columns in name_mappings:")
print(name_mappings.columns)

# Concatenate all positional rankings into one dataframe
all_rankings = pd.concat([qb_rankings, rb_rankings, wr_rankings, te_rankings])

# Normalize names in all datasets
all_rankings['Normalized Name'] = all_rankings['PLAYER NAME'].apply(normalize_name)
auction_values['Normalized Name'] = auction_values['Player'].apply(normalize_name)

# Use the actual column names from name_mappings
manual_mappings = dict(zip(name_mappings['Original_Name'].apply(normalize_name), name_mappings['Mapped_Name'].apply(normalize_name)))

# Apply manual mappings
all_rankings['Mapped Name'] = all_rankings['Normalized Name'].apply(lambda x: apply_name_mappings(x, manual_mappings))

# Merge auction values with rankings using mapped names
merged_data = pd.merge(all_rankings, auction_values, left_on='Mapped Name', right_on='Normalized Name', how='left')

# Handle unmatched names with fuzzy matching
unmatched = merged_data[merged_data['Player'].isna()]
for index, row in unmatched.iterrows():
    normalized_name = row['Mapped Name']
    match = match_player_name(normalized_name, auction_values['Normalized Name'].tolist())
    if match:
        # Get the row from auction_values where the match is found
        matching_row = auction_values[auction_values['Normalized Name'] == match]
        # Update the `Player` and other relevant columns in `merged_data`
        merged_data.at[index, 'Player'] = matching_row['Player'].values[0]
        merged_data.at[index, 'Value'] = matching_row['Value'].values[0]
        merged_data.at[index, 'Position Rank'] = matching_row['Position Rank'].values[0]

# Save the final merged data for review
merged_data.to_csv('final_merged_player_data.csv', index=False)

# Check if there are still unmatched players
unmatched_after_fuzzy = merged_data[merged_data['Player'].isna()]
if unmatched_after_fuzzy.empty:
    print("All players matched successfully.")
else:
    print(f"Unmatched players after fuzzy matching: {len(unmatched_after_fuzzy)}")
    print(unmatched_after_fuzzy[['PLAYER NAME', 'Mapped Name']])

# Debug output to check the merged data
#print(merged_data.head())
