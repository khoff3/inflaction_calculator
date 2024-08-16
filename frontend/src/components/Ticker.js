import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import './ticker.css'; // Assuming your CSS is in this file

const Ticker = ({ draftId, draftOrder = [], isLive }) => {
    const [picks, setPicks] = useState([]);
    const [filteredPicks, setFilteredPicks] = useState([]);
    const [expectedValuesLookup, setExpectedValuesLookup] = useState({});
    const [cachedResults, setCachedResults] = useState({});
    const [filters, setFilters] = useState({
        team: '',
        player: '',
        position: '',
        tier: ''
    });

    const buildExpectedValuesLookup = useCallback((inflationData, playerData) => {
        const lookup = {};

        if (inflationData && inflationData.expected_values) {
            inflationData.expected_values.forEach(player => {
                lookup[`${player.Player}`] = {
                    expectedValue: typeof player.Value === 'string' ? parseFloat(player.Value.replace('$', '')) : player.Value,
                    tier: player.Tier || 'N/A',
                };
            });
        }

        playerData.forEach(player => {
            const name = player.player_name;
            if (!lookup[name]) {
                lookup[name] = {
                    expectedValue: typeof player.auction_value === 'string' ? parseFloat(player.auction_value.replace('$', '')) : player.auction_value,
                    tier: player.tier !== undefined ? player.tier : 'N/A',
                };
            }
        });

        return lookup;
    }, []);

    const computeExpectedValues = (pick) => {
        const playerName = `${pick.metadata.first_name} ${pick.metadata.last_name}`;
        const playerData = expectedValuesLookup[playerName] || {
            expectedValue: 'N/A',
            tier: 'N/A',
        };

        const doe = playerData.expectedValue !== 'N/A' ? (pick.metadata.amount - playerData.expectedValue).toFixed(2) : 'N/A';
        const inflationPercent = playerData.expectedValue !== 'N/A' ? ((doe / playerData.expectedValue) * 100).toFixed(2) : 'N/A';

        return { ...playerData, doe, inflationPercent };
    };

    const fetchPicksAndData = useCallback(async () => {
        if (!isLive && cachedResults[draftId]) {
            const { fetchedPicks, lookup } = cachedResults[draftId];
            setPicks(fetchedPicks);
            setExpectedValuesLookup(lookup);
        } else {
            try {
                const picksResponse = await axios.get(`http://localhost:5050/picks?draft_id=${draftId}`);
                const fetchedPicks = picksResponse.data.sort((a, b) => b.pick_no - a.pick_no);
                setPicks(fetchedPicks);

                const playerList = fetchedPicks.map(pick => ({
                    first_name: pick.metadata.first_name,
                    last_name: pick.metadata.last_name,
                    position: pick.metadata.position
                }));

                const [playerDataResponse, inflationDataResponse] = await Promise.all([
                    axios.post('http://localhost:5050/player_lookup', { players: playerList }),
                    axios.post('http://localhost:5050/inflation', { draft_id: draftId })
                ]);

                const playerData = playerDataResponse.data;
                const inflationData = inflationDataResponse.data;

                const lookup = buildExpectedValuesLookup(inflationData, playerData);
                setExpectedValuesLookup(lookup);

                setCachedResults(prevCache => ({
                    ...prevCache,
                    [draftId]: { fetchedPicks, lookup }
                }));
            } catch (error) {
                console.error("Failed to fetch picks or data:", error);
            }
        }
    }, [draftId, cachedResults, buildExpectedValuesLookup, isLive]);

    const applyFilters = useCallback(() => {
        let filtered = picks;

        if (filters.team) {
            filtered = filtered.filter(pick => {
                const teamIndex = pick.draft_slot - 1;
                const teamName = draftOrder[teamIndex] ? draftOrder[teamIndex] : `Team ${pick.draft_slot}`;
                return teamName.toLowerCase().includes(filters.team.toLowerCase());
            });
        }

        if (filters.player) {
            filtered = filtered.filter(pick =>
                (`${pick.metadata.first_name} ${pick.metadata.last_name}`).toLowerCase().includes(filters.player.toLowerCase())
            );
        }

        if (filters.position) {
            filtered = filtered.filter(pick =>
                pick.metadata.position.toLowerCase().includes(filters.position.toLowerCase())
            );
        }

        if (filters.tier) {
            filtered = filtered.filter(pick => {
                const { tier } = computeExpectedValues(pick);
                return tier.toLowerCase().includes(filters.tier.toLowerCase());
            });
        }

        setFilteredPicks(filtered);
    }, [picks, filters, draftOrder, computeExpectedValues]);

    useEffect(() => {
        applyFilters();
    }, [picks, filters, applyFilters]);

    useEffect(() => {
        fetchPicksAndData();

        if (isLive) {
            const intervalId = setInterval(fetchPicksAndData, 10000);
            return () => clearInterval(intervalId);
        }
    }, [draftId, isLive, fetchPicksAndData]);

    const handleFilterChange = (e) => {
        const { name, value } = e.target;
        setFilters(prevFilters => ({
            ...prevFilters,
            [name]: value
        }));
    };

    return (
        <div className="ticker-container">
            <div className="filters-container">
                <div className="filter-column">
                    <label>Team:</label>
                    <input
                        type="text"
                        name="team"
                        value={filters.team}
                        onChange={handleFilterChange}
                    />
                </div>
                <div className="filter-column">
                    <label>Player:</label>
                    <input
                        type="text"
                        name="player"
                        value={filters.player}
                        onChange={handleFilterChange}
                    />
                </div>
                <div className="filter-column">
                    <label>Position:</label>
                    <input
                        type="text"
                        name="position"
                        value={filters.position}
                        onChange={handleFilterChange}
                    />
                </div>
                <div className="filter-column">
                    <label>Tier:</label>
                    <input
                        type="text"
                        name="tier"
                        value={filters.tier}
                        onChange={handleFilterChange}
                    />
                </div>
            </div>
            <table className="ticker-table">
                <thead>
                    <tr>
                        <th>Pick #</th>
                        <th>Team</th>
                        <th>Player</th>
                        <th>Position</th>
                        <th>Price</th>
                        <th>Expected Price</th>
                        <th>DOE</th>
                        <th>Inflation %</th>
                        <th>Tier</th>
                    </tr>
                </thead>
                <tbody>
                    {filteredPicks.map((pick, index) => {
                        const teamIndex = pick.draft_slot - 1;
                        const teamName = draftOrder[teamIndex] ? draftOrder[teamIndex] : `Team ${pick.draft_slot}`;

                        const { expectedValue, doe, inflationPercent, tier } = computeExpectedValues(pick);

                        return (
                            <tr key={index}>
                                <td>{pick.pick_no}</td>
                                <td>{teamName}</td>
                                <td>{pick.metadata.first_name} {pick.metadata.last_name}</td>
                                <td>{pick.metadata.position}</td>
                                <td>${pick.metadata.amount}</td>
                                <td>{expectedValue !== 'N/A' ? `$${expectedValue}` : 'N/A'}</td>
                                <td>{doe !== 'N/A' ? `${doe}` : 'N/A'}</td>
                                <td>{inflationPercent !== 'N/A' ? `${inflationPercent}%` : 'N/A'}</td>
                                <td>{tier}</td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
};

export default Ticker;
