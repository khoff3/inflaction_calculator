"""The All Players tab's payload.

A pick that has already sold is still a row on the board, and the tab shows it
alongside the undrafted players. It only looks right if the drafted half
carries the same board columns as the available half.

Targets the enhanced FastAPI backend, which is what npm run backend starts.
"""

import os
import sys
import unittest

sys.path.append(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'backend'))

import fastapi_backend_enhanced as backend  # noqa: E402


class TestAvailablePlayers(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.board = backend.data_manager._data_cache['board']

    def pick_of(self, entry, pick_no, amount):
        first, _, last = entry['name'].partition(' ')
        return {
            'draft_slot': pick_no, 'pick_no': pick_no, 'round': 1,
            'metadata': {'first_name': first, 'last_name': last, 'team': 'FA',
                         'position': entry['position'], 'amount': str(amount)},
        }

    def test_every_available_player_has_a_positional_rank(self):
        result = backend._assemble_available_players([])
        blank = [p['name'] for p in result['available_players']
                 if not p.get('position_rank') or p['position_rank'] == 'N/A']
        self.assertEqual(blank, [])

    def test_a_drafted_player_keeps_his_board_columns(self):
        # The bug: drafted picks came back without rank or tier, so those
        # columns emptied out as the draft filled up.
        top = self.board[0]
        result = backend._assemble_available_players([self.pick_of(top, 1, 50)])
        drafted = result['drafted_players'][0]

        self.assertEqual(drafted['name'], top['name'])
        self.assertEqual(drafted['position_rank'], top['position_rank'])
        self.assertEqual(drafted['tier'], top['tier'])
        self.assertEqual(drafted['expected_value'], top['auction_value'])
        # The frontend's Pick column reads this key.
        self.assertEqual(drafted['pick_no'], 1)

    def test_a_player_off_the_board_degrades_rather_than_raising(self):
        ghost = {'name': 'Nobody Atall', 'position': 'WR', 'position_rank': '', 'tier': ''}
        result = backend._assemble_available_players([self.pick_of(ghost, 1, 3)])
        drafted = result['drafted_players'][0]

        self.assertEqual(drafted['position_rank'], 'N/A')
        self.assertEqual(drafted['expected_value'], 0.0)

    def test_a_drafted_player_leaves_the_available_list(self):
        top = self.board[0]
        result = backend._assemble_available_players([self.pick_of(top, 1, 50)])
        self.assertNotIn(top['name'], [p['name'] for p in result['available_players']])
        self.assertEqual(result['total_available'], len(self.board) - 1)


if __name__ == '__main__':
    unittest.main()
