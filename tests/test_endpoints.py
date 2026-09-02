"""Every endpoint the dashboard polls, at every stage of a draft.

The stage that matters most is the first one. A draft with no picks is what the
app sees between opening it and the first nomination, and it used to be
indistinguishable from a draft that could not be fetched at all: get_draft_data
returned [] for both, so three endpoints 404'd and three more 500'd until
someone bought a player.

Sleeper is stubbed - these tests are about our own handlers, not the network.

Targets the enhanced FastAPI backend, which is what npm run backend starts.
"""

import csv
import os
import sys
import unittest

sys.path.append(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'backend'))

import fastapi_backend_enhanced as backend  # noqa: E402

try:
    from fastapi.testclient import TestClient
except ImportError as missing:  # httpx, which TestClient needs
    TestClient = None
    IMPORT_ERROR = missing

DRAFT_ID = 'stub'

# Endpoints the dashboard polls, as (method, path, body).
POLLED = [
    ('GET', '/picks', None),
    ('GET', '/picks/count', None),
    ('GET', '/available_players', None),
    ('GET', '/draft_economy', None),
    ('GET', '/team_breakdown', None),
    ('GET', '/scatter_data', None),
    ('POST', '/inflation', {'draft_id': DRAFT_ID}),
]


def picks_from_board(board, n):
    """n picks off the top of the real board, at sheet price."""
    picks = []
    for i, entry in enumerate(board[:n]):
        first, _, last = entry['name'].partition(' ')
        picks.append({
            'draft_id': DRAFT_ID, 'draft_slot': i % 12 + 1, 'round': i // 12 + 1,
            'pick_no': i + 1, 'player_id': str(i),
            'metadata': {'first_name': first, 'last_name': last, 'team': 'FA',
                         'position': entry['position'],
                         'amount': str(int(entry['auction_value']) or 1)},
        })
    return picks


@unittest.skipIf(TestClient is None, 'needs httpx: pip install -r backend/requirements_fastapi.txt')
class EndpointTestCase(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(backend.app)
        cls.board = backend.data_manager._data_cache['board']
        cls.real_fetch = backend.data_manager.get_draft_data

    def tearDown(self):
        backend.data_manager.get_draft_data = self.real_fetch
        backend.data_manager.clear_cache('all')

    def serve(self, picks):
        async def stub(draft_id):
            return picks
        backend.data_manager.get_draft_data = stub

    def call(self, method, path, body):
        url = f'{path}?draft_id={DRAFT_ID}'
        return self.client.post(url, json=body) if method == 'POST' else self.client.get(url)


class TestDraftStages(EndpointTestCase):

    def test_every_endpoint_serves_a_draft_that_has_not_started(self):
        self.serve([])
        for method, path, body in POLLED:
            with self.subTest(endpoint=path):
                response = self.call(method, path, body)
                self.assertEqual(response.status_code, 200, response.text[:200])
                response.json()

    def test_every_endpoint_serves_a_draft_in_progress(self):
        for n in (1, 24, 96):
            self.serve(picks_from_board(self.board, n))
            for method, path, body in POLLED:
                with self.subTest(picks=n, endpoint=path):
                    response = self.call(method, path, body)
                    self.assertEqual(response.status_code, 200, response.text[:200])
                    response.json()
            self.tearDown()

    def test_an_empty_draft_still_prices_the_whole_board(self):
        self.serve([])
        economy = self.call('GET', '/draft_economy', None).json()
        self.assertEqual(economy['slots_filled'], 0)
        self.assertEqual(economy['spent'], 0)
        self.assertAlmostEqual(economy['inflation'], 1.0, delta=0.15)

        available = self.call('GET', '/available_players', None).json()
        self.assertEqual(available['total_drafted'], 0)
        self.assertEqual(available['total_available'], len(self.board))


class TestUnreachableDraft(EndpointTestCase):

    def test_a_draft_that_cannot_be_fetched_is_a_404_not_a_500(self):
        # The 404 is raised inside handlers that also catch Exception. Without
        # an HTTPException guard the catch-all swallowed it and reported a 500
        # with an empty message.
        self.serve(None)
        for method, path, body in POLLED:
            with self.subTest(endpoint=path):
                self.assertEqual(self.call(method, path, body).status_code, 404)


if __name__ == '__main__':
    unittest.main()
