"""The forward-looking half of the app: money left against value left.

Two properties have to hold or the numbers on the Draft Economy tab are
decoration. First, every spendable dollar is allocated to exactly one position,
so the per-position multipliers average back to the headline one and can be
read against it. Second, thinning a position while the teams needing it stay
put has to push that position's multiplier up - that is the entire claim the
positional model makes.

Targets the enhanced FastAPI backend, which is what npm run backend starts.
"""

import os
import sys
import unittest

sys.path.append(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'backend'))

import fastapi_backend_enhanced as backend  # noqa: E402


def pick(slot, name, position, amount, pick_no):
    first, _, last = name.partition(' ')
    return {
        'draft_slot': slot, 'pick_no': pick_no, 'round': (pick_no - 1) // 12 + 1,
        'metadata': {'first_name': first, 'last_name': last,
                     'position': position, 'amount': str(amount)},
    }


class TestDraftEconomy(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.manager = backend.DataManager()
        cls.board = cls.manager._data_cache['board']

    def board_by_position(self, position):
        return [p for p in self.board if p['position'] == position]

    def buy(self, plan):
        """plan: [(slot, position, count)] - each team takes the priciest left."""
        taken, picks, pick_no = set(), [], 0
        for slot, position, count in plan:
            pool = [p for p in self.board_by_position(position) if p['name'] not in taken]
            for player in pool[:count]:
                taken.add(player['name'])
                pick_no += 1
                picks.append(pick(slot, player['name'], position,
                                  int(player['auction_value']), pick_no))
        return picks

    def positions(self, economy):
        return {row['position']: row for row in economy['positions']}

    def test_every_spendable_dollar_lands_on_one_position(self):
        for picks in (self.buy([]), self.buy([(s, 'RB', 2) for s in range(1, 13)])):
            economy = self.manager.get_draft_economy(picks)
            allocated = sum(row['demand'] for row in economy['positions'])
            self.assertAlmostEqual(allocated, economy['spendable'], delta=0.5)

    def test_position_multipliers_average_to_the_headline(self):
        economy = self.manager.get_draft_economy(
            self.buy([(s, 'RB', 1) for s in range(1, 13)] + [(s, 'WR', 2) for s in range(1, 13)]))
        rows = economy['positions']
        money = sum(row['demand'] for row in rows)
        supply = sum(row['supply'] for row in rows)
        self.assertAlmostEqual(money / supply, economy['inflation'], delta=0.02)

    def test_thinning_a_position_squeezes_it(self):
        """Two teams hoard 24 WRs. Ten teams still need three each, so the WRs
        left have to get more expensive relative to everything else."""
        before = self.positions(self.manager.get_draft_economy(self.buy([])))
        after = self.positions(self.manager.get_draft_economy(
            self.buy([(1, 'WR', 12), (2, 'WR', 12)])))
        self.assertGreater(after['WR']['vs_board'], before['WR']['vs_board'])
        self.assertLess(after['WR']['players'], before['WR']['players'])
        # And the positions nobody touched should not have moved much.
        self.assertAlmostEqual(after['QB']['vs_board'], before['QB']['vs_board'], delta=0.25)

    def test_a_full_starting_lineup_stops_being_needy(self):
        picks = self.buy([(1, 'QB', 1), (1, 'RB', 3), (1, 'WR', 4), (1, 'TE', 1)])
        team = next(t for t in self.manager.get_draft_economy(picks)['teams_detail']
                    if t['slot'] == 1)
        # 1QB 2RB 3WR 1TE plus a flex, all covered by the surplus RB and WR.
        self.assertEqual(team['needs'], {})

    def test_the_flex_is_split_rather_than_assigned(self):
        picks = self.buy([(1, 'QB', 1), (1, 'RB', 2), (1, 'WR', 3), (1, 'TE', 1)])
        team = next(t for t in self.manager.get_draft_economy(picks)['teams_detail']
                    if t['slot'] == 1)
        self.assertEqual(set(team['needs']), {'RB', 'WR', 'TE'})
        self.assertAlmostEqual(sum(team['needs'].values()), 1.0, places=1)
        self.assertGreater(team['needs']['RB'], team['needs']['TE'])

    def test_a_position_bought_out_is_flagged_not_priced(self):
        # Eleven teams take every TE on the sheet; the twelfth still needs one.
        economy = self.manager.get_draft_economy(
            self.buy([(s, 'TE', 8) for s in range(1, 12)]))
        te = self.positions(economy)['TE']
        self.assertTrue(te['sold_out'])
        self.assertIsNone(te['multiplier'])
        self.assertGreater(te['needy_teams'], 0)

    def test_kickers_are_off_the_board(self):
        self.assertEqual([p for p in self.board if p['position'] == 'K'], [])


if __name__ == '__main__':
    unittest.main()
