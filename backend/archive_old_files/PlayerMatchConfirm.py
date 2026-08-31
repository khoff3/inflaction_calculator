import pandas as pd

# Load the merged player data set
merged_data = pd.read_csv('backend/2024/merged_player_data.csv')

print(merged_data.columns)

# Assuming 'Player', 'Tier', and 'Expected Value' are the columns to check and match nulls
merged_data['Tier'] = merged_data['Tier'].fillna('Unknown')
merged_data['Expected Value'] = merged_data['Expected Value'].fillna(0)

# Save the cleaned data back to the CSV
merged_data.to_csv('backend/2024/merged_player_data_cleaned.csv', index=False)

print("Data cleaned and saved successfully.")
