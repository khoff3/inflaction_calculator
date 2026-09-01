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

    const stat = { display: 'inline-block', marginRight: '1.25rem', fontSize: '0.9em' };
    const label = { opacity: 0.6, marginRight: '0.3rem' };
    // Scoped width. The shared .centered-table class is width:100%, which
    // stretches a nine-column ladder across the whole viewport and reads as
    // sparse rather than compact, so these tables opt out of it.
    const tight = { width: 'auto', fontSize: '0.85em', marginBottom: '0.5rem' };
    const half = economy.teams_detail.slice(0, Math.ceil(economy.teams_detail.length / 2));
    const rest = economy.teams_detail.slice(Math.ceil(economy.teams_detail.length / 2));

    const teamTable = (rows) => (
        <Table bordered hover size="sm" style={tight}>
            <thead>
                <tr><th>Tm</th><th>Spent</th><th>Left</th><th>Open</th><th>Max</th></tr>
            </thead>
            <tbody>
                {rows.map((team) => (
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
    );

    return (
        <div style={{ maxWidth: '720px' }}>
            <div>
                <span style={{ fontSize: '1.5em', fontWeight: 'bold' }} className={inflationClass}>
                    {inflation === null ? '—' : `${inflation.toFixed(2)}×`}
                </span>
                <span style={{ marginLeft: '0.5rem', opacity: 0.8, fontSize: '0.9em' }}>
                    on players over $1
                    {inflation !== null && (inflation > 1.02 ? ' — more cash than board'
                        : inflation < 0.98 ? ' — more board than cash' : ' — at par')}
                </span>
            </div>

            <div style={{ margin: '0.4rem 0' }}>
                <span style={stat}><span style={label}>&gt;$1 left</span><strong>{economy.contested_players}</strong></span>
                <span style={stat}><span style={label}>money</span><strong>{money(economy.spendable)}</strong></span>
                <span style={stat}><span style={label}>value</span><strong>{money(economy.value_remaining)}</strong></span>
                <span style={stat}><span style={label}>slots</span>{economy.slots_filled}/{economy.slots_filled + economy.slots_open}</span>
                <span style={stat}><span style={label}>filler</span>{economy.filler_slots}<span style={{ opacity: 0.5 }}>/~{economy.typical_filler_slots}</span></span>
            </div>

            <div style={{ marginBottom: '0.6rem' }}>
                {['QB', 'RB', 'WR', 'TE'].map((position) => (
                    <span key={position} style={stat}>
                        <span style={label}>{position}</span>
                        {money(economy.value_remaining_by_position?.[position] || 0)}
                    </span>
                ))}
                <span style={{ opacity: 0.5, fontSize: '0.8em' }}>left by position</span>
            </div>

            <Table bordered hover size="sm" style={tight}>
                <thead>
                    <tr><th>Sheet</th>{economy.price_ladder.map(r => <th key={r.sheet}>${r.sheet}</th>)}</tr>
                </thead>
                <tbody>
                    <tr>
                        <td style={{ opacity: 0.6 }}>Pays</td>
                        {economy.price_ladder.map(r => (
                            <td key={r.sheet} className={getDeltaClass(r.expected - r.sheet)}>
                                <strong>${r.expected}</strong>
                            </td>
                        ))}
                    </tr>
                </tbody>
            </Table>

            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                {teamTable(half)}
                {teamTable(rest)}
            </div>

            <p style={{ fontSize: '0.78em', opacity: 0.6, marginTop: '0.25rem' }}>
                $1 players excluded both sides — a third of picks here, 2.6% of dollars.
            </p>
        </div>
    );
};

export default DraftEconomy;
