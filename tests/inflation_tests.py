import unittest
import sys
import os
import logging

# Set up logging to capture debug information during the test
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

# Add the parent directory to sys.path so the backend module can be found
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.trial_backend import calculate_inflation_rates, get_draft_data

class TestInflationCalculationsWithRealData(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.real_draft_id = '1125469001368346624'
        cls.draft_data = get_draft_data(cls.real_draft_id)

    def test_get_draft_data_real(self):
        draft_data = self.draft_data

        # Assert that the draft data is not empty
        logging.info(f"Draft data received. Showing first 5 entries: {draft_data[:5]}")
        self.assertNotEqual(len(draft_data), 0, "Draft data should not be empty.")
        self.assertIsInstance(draft_data, list, "Draft data should be a list.")
        
        # Assert that the total number of picks is 192
        total_picks = len(draft_data)
        self.assertEqual(total_picks, 192, f"Expected 192 picks, but found {total_picks}.")

def test_calculate_inflation_rates_real(self):
    draft_data = self.draft_data

    # Logging the draft data before the function call
    logging.info("Calculating inflation rates...")

    # Calculate inflation rates
    result = calculate_inflation_rates(draft_data)

    # Check if the result is None
    if result is None:
        logging.error("calculate_inflation_rates returned None. This indicates a problem with the function logic.")
        self.fail("calculate_inflation_rates returned None, expected a tuple with inflation_data and expected_values.")

    inflation_data, expected_values = result

    # Log the result
    logging.info("Inflation rates calculation completed.")
    logging.debug(f"Inflation Data: {inflation_data}")
    logging.debug(f"Expected Values (first 5): {expected_values[:5]}")

    # Assert the inflation data is as expected
    self.assertIsInstance(inflation_data, dict, "Inflation data should be a dictionary.")
    self.assertIn('overall', inflation_data)
    self.assertIn('positional', inflation_data)
    self.assertIn('positional_tiered', inflation_data)

    # Check for Tier 1 QBs
    tier1_qbs = []
    for player in draft_data:
        player_name = f"{player['metadata']['first_name']} {player['metadata']['last_name']}"
        player_tier = expected_values.get(player_name, {}).get('Tier', 'N/A')

        # Debugging tier information
        logging.debug(f"Player: {player_name}, Position: {player['metadata']['position']}, Tier: {player_tier}")

        if player['metadata']['position'] == 'QB' and player_tier == 1:
            tier1_qbs.append(player)

    # Always print the results, even if the test passes
    print("\n\n------ Results ------")
    print(f"Found {len(tier1_qbs)} Tier 1 QBs.")

    # Calculate DOE and average cost for Tier 1 QBs
    total_doe = 0
    total_cost = 0
    total_expected_cost = 0
    count = 0

    for qb in tier1_qbs:
        player_name = f"{qb['metadata']['first_name']} {qb['metadata']['last_name']}"
        player_data = expected_values.get(player_name, {'Value': 0})
        expected_value = player_data['Value']
        actual_cost = qb['metadata']['amount']
        doe = actual_cost - expected_value
        total_doe += doe
        total_cost += actual_cost
        total_expected_cost += expected_value
        count += 1

        logging.info(f"Player: {player_name}, Actual Cost: {actual_cost}, Expected Value: {expected_value}, DOE: {doe:.2f}")

    if count > 0:
        average_cost = total_cost / count
        inflation_percentage = (total_doe / total_expected_cost) * 100 if total_expected_cost > 0 else 0
        print(f"Average Cost for Tier 1 QBs: {average_cost:.2f}")
        print(f"Total DOE for Tier 1 QBs: {total_doe:.2f}")
        print(f"Inflation for Tier 1 QBs: {inflation_percentage:.2f}%")
    else:
        print("No Tier 1 QBs found.")
        self.fail("No Tier 1 QBs found, unable to calculate DOE or inflation.")

    # Assert that the calculated values match expected values
    self.assertAlmostEqual(total_doe, -46, delta=1, msg="Total DOE for Tier 1 QBs should be approximately -46.")
    self.assertAlmostEqual(average_cost, 19.75, delta=1, msg="Average cost for Tier 1 QBs should be approximately 19.75.")
    self.assertAlmostEqual(inflation_percentage, -36.8, delta=1, msg="Inflation for Tier 1 QBs should be approximately -36.8%.")


if __name__ == '__main__':
    unittest.main()
