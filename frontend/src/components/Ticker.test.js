import { sortValueFor, comparePicks, sortPicksBy } from './Ticker';

// Sleeper sends every metadata field as a string, which is the whole reason
// this file exists: "9" sorts ahead of "155" unless something says otherwise.
const pick = (pick_no, name, position, amount, draft_slot = 1) => ({
    pick_no,
    draft_slot,
    metadata: {
        first_name: name.split(' ')[0],
        last_name: name.split(' ').slice(1).join(' '),
        position,
        amount: String(amount),
    },
});

const PICKS = [
    pick(1, 'Big Spend', 'RB', 155),
    pick(2, 'Mid Spend', 'WR', 23),
    pick(3, 'Small Spend', 'TE', 9),
    pick(4, 'Off Sheet', 'QB', 40),
];

const LOOKUP = {
    'Big Spend': { expectedValue: 100, tier: '1' },
    'Mid Spend': { expectedValue: 30, tier: '3' },
    'Small Spend': { expectedValue: 4, tier: '10' },
    // Off Sheet is deliberately absent - an unmatched name.
};

const order = (rows) => rows.map(p => p.pick_no);
const sorted = (key, direction) => order(sortPicksBy(PICKS, { key, direction }, LOOKUP, []));

describe('ticker sorting', () => {
    test('price sorts as money, not as text', () => {
        expect(sorted('price', 'desc')).toEqual([1, 4, 2, 3]);
        expect(sorted('price', 'asc')).toEqual([3, 2, 4, 1]);
    });

    test('an unpriced player has no DOE and sorts last either way', () => {
        expect(sortValueFor(PICKS[3], 'doe', LOOKUP)).toBeNull();
        expect(sorted('doe', 'desc')).toEqual([1, 3, 2, 4]);
        expect(sorted('doe', 'asc')).toEqual([2, 3, 1, 4]);
    });

    test('inflation does not divide by a missing expected value', () => {
        expect(sortValueFor(PICKS[3], 'inflation', LOOKUP)).toBeNull();
        expect(sorted('inflation', 'desc')).toEqual([3, 1, 2, 4]);
    });

    test('pick number sorts newest first when descending', () => {
        expect(sorted('pick_no', 'desc')).toEqual([4, 3, 2, 1]);
    });

    test('ties inside a text sort still read newest first', () => {
        const twoRBs = [pick(5, 'Early RB', 'RB', 10), pick(9, 'Late RB', 'RB', 10)];
        expect(order(sortPicksBy(twoRBs, { key: 'position', direction: 'asc' }, {}, [])))
            .toEqual([9, 5]);
    });

    test('missing values never win a comparison', () => {
        const withValue = { pick_no: 1, _sortValue: -999 };
        const without = { pick_no: 2, _sortValue: null };
        expect(comparePicks(withValue, without, 'asc')).toBeLessThan(0);
        expect(comparePicks(withValue, without, 'desc')).toBeLessThan(0);
    });

    test('tier sorts numerically with unranked players last', () => {
        expect(sorted('tier', 'asc')).toEqual([1, 2, 3, 4]);
    });
});
