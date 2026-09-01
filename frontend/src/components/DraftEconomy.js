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

    const stat = { display: 'inline-block', margin: '0 0.7rem', fontSize: '0.95em' };
    const label = { opacity: 0.6, marginRight: '0.3rem' };
    // Scoped width. The shared .centered-table class is width:100%, which
    // stretches a nine-column ladder across the whole viewport and reads as
    // sparse rather than compact, so these tables opt out of it.
    const tight = { width: 'auto', margin: '0 auto', fontSize: '0.9em' };
    // Each section sits in its own bordered card so the tab reads as a few
    // discrete panels rather than one long run of numbers.
    const panel = {
        display: 'inline-block',
        border: '1px solid #dee2e6',
        borderRadius: '6px',
        padding: '0.75rem 1rem',
        margin: '0 0.5rem 0.75rem',
        background: '#fff',
        verticalAlign: 'top',
    };
    // A concrete mid-range case reads faster than the whole ladder.
    const example = economy.price_ladder.find(r => r.sheet === 30) || economy.price_ladder[0];
    const half = economy.teams_detail.slice(0, Math.ceil(economy.teams_detail.length / 2));
    const rest = economy.teams_detail.slice(Math.ceil(economy.teams_detail.length / 2));

    const teamTable = (rows) => (
        <Table bordered hover size="sm" style={{ ...tight, marginBottom: 0 }}>
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
        <div style={{ maxWidth: '860px', margin: '0 auto', textAlign: 'center' }}>
            <div style={panel}>
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

                <div style={{ marginTop: '0.5rem' }}>
                    <span style={stat}><span style={label}>&gt;$1 left</span><strong>{economy.contested_players}</strong></span>
                    <span style={stat}><span style={label}>money</span><strong>{money(economy.spendable)}</strong></span>
                    <span style={stat}><span style={label}>value</span><strong>{money(economy.value_remaining)}</strong></span>
                    <span style={stat}><span style={label}>slots</span>{economy.slots_filled}/{economy.slots_filled + economy.slots_open}</span>
                    <span style={stat}><span style={label}>filler</span>{economy.filler_slots}<span style={{ opacity: 0.5 }}>/~{economy.typical_filler_slots}</span></span>
                </div>

                <div style={{ marginTop: '0.35rem' }}>
                    {['QB', 'RB', 'WR', 'TE'].map((position) => (
                        <span key={position} style={stat}>
                            <span style={label}>{position}</span>
                            {money(economy.value_remaining_by_position?.[position] || 0)}
                        </span>
                    ))}
                    <span style={{ opacity: 0.5, fontSize: '0.8em' }}>left by position</span>
                </div>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'flex-start' }}>
                <div style={panel}>
                    <div style={{ fontSize: '0.9em', marginBottom: '0.5rem' }}>
                        <strong>What players are going for</strong>
                    </div>
                    <Table bordered hover size="sm" style={{ ...tight, marginBottom: 0 }}>
                        <thead>
                            <tr><th>ETR value</th><th>Expect to pay</th><th>Diff</th></tr>
                        </thead>
                        <tbody>
                            {economy.price_ladder.map((rung) => {
                                const delta = rung.expected - rung.sheet;
                                return (
                                    <tr key={rung.sheet}>
                                        <td>{money(rung.sheet)}</td>
                                        <td><strong>${rung.expected}</strong></td>
                                        <td className={getDeltaClass(delta)}>
                                            {delta >= 0 ? '+' : '−'}${Math.abs(delta).toFixed(1)}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </Table>
                </div>

                <div style={panel}>{teamTable(half)}</div>
                <div style={panel}>{teamTable(rest)}</div>
            </div>

            <p style={{ fontSize: '0.8em', opacity: 0.6, marginTop: '0.25rem' }}>
                $1 players excluded both sides — a third of picks here, 2.6% of dollars.
            </p>
        </div>
    );
};

export default DraftEconomy;
