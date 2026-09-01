import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Table, Spinner, Alert } from 'react-bootstrap';
import axios from 'axios';
import dataService from './utils/DataService';

/**
 * Money left in the room against value left on the board.
 *
 * The rest of the dashboard is backward-looking — it reports what has already
 * been paid. This is the number you bid against: cash still available divided
 * by value still buyable. Above 1.00 everything left goes over sheet; below it,
 * bargains are coming.
 */
const getDeltaClass = (delta) => {
    if (delta > 3) return 'severe-positive';
    if (delta > 1) return 'moderate-positive';
    if (delta < -3) return 'severe-negative';
    if (delta < -1) return 'moderate-negative';
    return 'neutral';
};

const DraftEconomy = ({ draftId, isLive }) => {
    const [economy, setEconomy] = useState(null);
    const [error, setError] = useState(null);
    const lastPayload = useRef(null);

    const fetchEconomy = useCallback(async () => {
        if (!draftId) return;
        try {
            const { data } = await axios.get(`http://localhost:5050/draft_economy?draft_id=${draftId}`);
            // Only re-render when something actually moved. Identical payloads
            // would otherwise hand React new object identities every poll.
            const fingerprint = JSON.stringify(data);
            if (fingerprint !== lastPayload.current) {
                lastPayload.current = fingerprint;
                setEconomy(data);
            }
            setError(null);
        } catch (err) {
            console.error('Error fetching draft economy:', err);
            setError('Failed to load draft economy.');
        }
    }, [draftId]);

    useEffect(() => {
        fetchEconomy();
        const unsubscribe = dataService.subscribe(`economy-${draftId}`, () => fetchEconomy());
        dataService.startPolling(draftId, isLive);
        return unsubscribe;
    }, [draftId, isLive, fetchEconomy]);

    // Keep the last good numbers on screen while refetching.
    if (!economy && error) return <Alert variant="danger">{error}</Alert>;
    if (!economy) return <Spinner animation="border" />;

    const money = (n) => `$${Number(n).toLocaleString()}`;
    const inflation = economy.inflation;
    const inflationClass = inflation === null ? 'neutral'
        : inflation > 1.15 ? 'severe-positive'
        : inflation > 1.05 ? 'moderate-positive'
        : inflation < 0.85 ? 'severe-negative'
        : inflation < 0.95 ? 'moderate-negative'
        : 'neutral';

    return (
        <div>
            <h2>Draft Economy</h2>

            <p className="inflation-percentage">
                Players over $1 are going for{' '}
                <span className={inflationClass}>
                    {inflation === null ? '—' : `${inflation.toFixed(2)}×`}
                </span>{' '}
                sheet
                {inflation !== null && (
                    <span style={{ fontSize: '0.8em', marginLeft: '0.75rem', opacity: 0.75 }}>
                        {inflation > 1.02 ? 'the room has more cash than board'
                            : inflation < 0.98 ? 'the board is deeper than the cash left'
                            : 'roughly at par'}
                    </span>
                )}
            </p>

            <h3>What Things Should Cost</h3>
            <Table bordered hover className="centered-table">
                <thead>
                    <tr><th>Sheet Value</th><th>Expected Price</th><th>Difference</th></tr>
                </thead>
                <tbody>
                    {economy.price_ladder.map((rung) => {
                        const delta = rung.expected - rung.sheet;
                        return (
                            <tr key={rung.sheet}>
                                <td>{money(rung.sheet)}</td>
                                <td><strong>{money(rung.expected)}</strong></td>
                                <td className={getDeltaClass(delta)}>
                                    {delta >= 0 ? '+' : ''}{delta.toFixed(1)}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </Table>

            <h3>The Contested Pool</h3>
            <Table bordered hover className="centered-table">
                <tbody>
                    <tr>
                        <td>Players left over $1</td>
                        <td><strong>{economy.contested_players}</strong></td>
                    </tr>
                    <tr>
                        <td>Their value above the $1 floor</td>
                        <td>{money(economy.value_remaining)}</td>
                    </tr>
                    <tr>
                        <td>Money chasing them <span style={{ opacity: 0.6 }}>(after $1 per open slot)</span></td>
                        <td>{money(economy.spendable)}</td>
                    </tr>
                    <tr>
                        <td>Slots that will take $1 filler</td>
                        <td>
                            {economy.filler_slots}
                            <span style={{ opacity: 0.6 }}> (this league averages {economy.typical_filler_slots})</span>
                        </td>
                    </tr>
                </tbody>
            </Table>

            <h3>Value Left by Position</h3>
            <Table bordered hover className="centered-table">
                <thead>
                    <tr><th>Position</th><th>Value Above $1</th></tr>
                </thead>
                <tbody>
                    {['QB', 'RB', 'WR', 'TE'].map((position) => (
                        <tr key={position}>
                            <td>{position}</td>
                            <td>{money(economy.value_remaining_by_position?.[position] || 0)}</td>
                        </tr>
                    ))}
                </tbody>
            </Table>

            <h3>Team Budgets</h3>
            <Table bordered hover className="centered-table">
                <thead>
                    <tr>
                        <th>Team</th><th>Spent</th><th>Remaining</th>
                        <th>Slots Open</th><th>Max Bid</th>
                    </tr>
                </thead>
                <tbody>
                    {economy.teams_detail.map((team) => (
                        <tr key={team.slot}>
                            <td>{team.slot}</td>
                            <td>{money(team.spent)}</td>
                            <td>{money(team.remaining)}</td>
                            <td>{team.slots_open}</td>
                            <td><strong>{money(team.max_bid)}</strong></td>
                        </tr>
                    ))}
                </tbody>
            </Table>

            <p style={{ fontSize: '0.85em', opacity: 0.7, marginTop: '1rem' }}>
                Totals exclude $1 players on both sides. They are a third of every
                draft here but 2.6% of the dollars, so counting them drags the
                multiplier toward 1.00 and hides what the contested players do.
            </p>
        </div>
    );
};

export default DraftEconomy;
