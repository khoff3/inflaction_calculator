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
                Live multiplier:{' '}
                <span className={inflationClass}>
                    {inflation === null ? '—' : `${inflation.toFixed(2)}×`}
                </span>
                {inflation !== null && (
                    <span style={{ fontSize: '0.8em', marginLeft: '0.75rem', opacity: 0.75 }}>
                        {inflation > 1
                            ? 'more cash than board — expect overpays'
                            : 'more board than cash — bargains ahead'}
                    </span>
                )}
            </p>

            <Table bordered hover className="centered-table">
                <tbody>
                    <tr><td>Total pot</td><td>{money(economy.total_pot)}</td></tr>
                    <tr><td>Spent</td><td>{money(economy.spent)}</td></tr>
                    <tr><td>Remaining</td><td>{money(economy.remaining)}</td></tr>
                    <tr>
                        <td>Spendable <span style={{ opacity: 0.6 }}>(after $1 per open slot)</span></td>
                        <td>{money(economy.spendable)}</td>
                    </tr>
                    <tr>
                        <td>Value left <span style={{ opacity: 0.6 }}>(top {economy.players_buyable} above $1)</span></td>
                        <td>{money(economy.value_remaining)}</td>
                    </tr>
                    <tr>
                        <td>Roster slots</td>
                        <td>{economy.slots_filled} filled / {economy.slots_open} open</td>
                    </tr>
                </tbody>
            </Table>

            <h3>Value Left by Position</h3>
            <Table bordered hover className="centered-table">
                <thead>
                    <tr><th>Position</th><th>Value Left ($)</th></tr>
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
        </div>
    );
};

export default DraftEconomy;
