import unittest
import pandas as pd
import os

class TestPlayerNameMappings(unittest.TestCase):

    def setUp(self):
        # Load the mappings file
        mappings_path = 'backend/2024/player_name_mappings.csv'
        self.mappings_df = pd.read_csv(mappings_path)

        # Load your draft data, auction values, and tier rankings
        self.draft_data = self.load_draft_data()
        self.auction_values = self.load_auction_values()
        self.tier_rankings = self.load_tier_rankings()

    def load_draft_data(self):
        # Mock function to load draft data (replace with actual data loading code)
        return [
            {'Sleeper Name': 'Isaac Guerendo'},
            {'Sleeper Name': 'J.J. McCarthy'},
            # Add more players as needed
        ]

    def load_auction_values(self):
        # Mock function to load auction values (replace with actual data loading code)
        return {
            'Isaac Guerendo': 10,
            'J.J. McCarthy': 0,
            # Add more players as needed
        }

    def load_tier_rankings(self):
        # Mock function to load tier rankings (replace with actual data loading code)
        return {
            'Isaac Guerendo': 'Tier 3',
            'J.J. McCarthy': 'Tier 5',
            # Add more players as needed
        }

    def test_player_name_mappings(self):
        # Check that every player in the draft data has a corresponding entry in the mappings file
        for player in self.draft_data:
            sleeper_name = player['Sleeper Name']
            mapping_row = self.mappings_df[self.mappings_df['Sleeper Name'] == sleeper_name]

            self.assertFalse(mapping_row.empty, f"No mapping found for Sleeper Name: {sleeper_name}")

            auction_value_name = mapping_row['Auction Value Name'].values[0]
            tier_name = mapping_row['Tier Name'].values[0]

            # Check if the auction value name and tier name exist in the auction values and tier rankings
            self.assertIn(auction_value_name, self.auction_values, f"No auction value found for: {auction_value_name}")
            self.assertIn(tier_name, self.tier_rankings, f"No tier ranking found for: {tier_name}")

if __name__ == '__main__':
    unittest.main()
