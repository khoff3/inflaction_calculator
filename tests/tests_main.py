import unittest
from unittest.mock import patch
import json
import sys
import os
import pandas as pd

# Add the parent directory to sys.path so the backend module can be found
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.trial_backend import calculate_inflation_rates, calculate_doe_values

class TestInflationCalculations(unittest.TestCase):

    def setUp(self):
        # Load the picks_output.json file
        with open('/Users/khoff/Code/inflaction_calculator/picks_output.json', 'r') as file:
            self.draft_data = json.load(file)

    @patch('backend.trial_backend.get_draft_data')
    def test_inflation_rates(self, mock_get_draft_data):
        # Use the loaded JSON data as mock return value
        mock_get_draft_data.return_value = self.draft_data

        # Expected values mock setup
        expected_values_mock = pd.DataFrame([
            {'Player': 'John Doe', 'Value': 20, 'Position': 'QB', 'Tier': 1},
            # Add more expected values if needed
        ])

        # Call the function under test
        inflation_data, expected_values = calculate_inflation_rates(mock_get_draft_data.return_value)

        # Use the correct expected inflation rate in the assertion
        self.assertAlmostEqual(inflation_data['overall'], 0.09019426456984274, places=2)
        self.assertEqual(inflation_data['positional']['QB'], -0.062146892655367235)
        self.assertEqual(inflation_data['positional_tiered']['QB'][1], -0.36363636363636365)
@patch('backend.trial_backend.get_draft_data')
def test_doe_calculations(self, mock_get_draft_data):
    # Simplified mock draft data to ensure DOE calculation is triggered
    mock_get_draft_data.return_value = [
        {
            'metadata': {
                'first_name': 'John',
                'last_name': 'Doe',
                'position': 'QB',
                'amount': '25'
            }
        },
        {
            'metadata': {
                'first_name': 'Jane',
                'last_name': 'Smith',
                'position': 'QB',
                'amount': '30'
            }
        }
    ]

    # Simplified expected values to match the mock draft data
    expected_values_mock = pd.DataFrame([
        {'Player': 'John Doe', 'Value': 20, 'Position': 'QB', 'Tier': 1},
        {'Player': 'Jane Smith', 'Value': 25, 'Position': 'QB', 'Tier': 1},
    ])

    # Call the function under test
    doe_values = calculate_doe_values(mock_get_draft_data.return_value, expected_values_mock, {})

    # Print doe_values for inspection
    print(doe_values)

    # Assertions to check if DOE is calculated correctly
    self.assertIn('QB', doe_values)
    self.assertIn(1, doe_values['QB'])
    self.assertEqual(doe_values['QB'][1], 5)  # DOE = 25 (paid) - 20 (expected) = 5 for John Doe

if __name__ == '__main__':
    unittest.main()




