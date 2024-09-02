import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import Select from 'react-select'; // Using react-select for multi-select dropdowns
import './ticker.css';


// Define the getColorSeverity function
const getColorSeverity = (value) => {
    if (Math.abs(value) >= 15) {
        return 'severe';
    } else if (Math.abs(value) >= 10) {
        return 'moderate';
    } else if (Math.abs(value) >= 3) {
        return 'mild';
    } else {
        return 'neutral';
    }
};

const Ticker = ({ draftId, draftOrder = [], isLive }) => {
    const [picks, setPicks] = useState([]);
    const [filteredPicks, setFilteredPicks] = useState([]);
    const [expectedValuesLookup, setExpectedValuesLookup] = useState({});
    const [cachedResults, setCachedResults] = useState({});
    const [filters, setFilters] = useState({
        team: [],
        player: '',
        position: [],
        tier: []
    });

    const buildExpectedValuesLookup = (inflationData, playerData) => {
        const lookup = {};

        if (inflationData && inflationData.expected_values) {
            inflationData.expected_values.forEach(player => {
                lookup[player.Player] = {
                    expectedValue: typeof player.Value === 'string' 
                        ? parseFloat(player.Value.replace('$', '')) 
                        : player.Value,
                    tier: player.Tier || 'N/A',
                };
            });
        }

        playerData.forEach(player => {
            const name = player.player_name;
            if (!lookup[name]) {
                lookup[name] = {
                    expectedValue: typeof player.auction_value === 'string' 
                        ? parseFloat(player.auction_value.replace('$', '')) 
                        : player.auction_value,
                    tier: player.tier !== undefined ? player.tier : 'N/A',
                };
            }
        });

        return lookup;
    };

    const computeExpectedValues = (pick) => {
        const playerName = `${pick.metadata.first_name} ${pick.metadata.last_name}`;
        const playerData = expectedValuesLookup[playerName] || {
            expectedValue: 'N/A',
            tier: 'N/A',
        };

        const doe = playerData.expectedValue !== 'N/A' 
            ? (pick.metadata.amount - playerData.expectedValue).toFixed(2) 
            : 'N/A';

        let inflationPercent;
        if (playerData.expectedValue === 0 || playerData.expectedValue === 'N/A') {
            inflationPercent = 'N/A';
        } else {
            inflationPercent = ((doe / playerData.expectedValue) * 100).toFixed(2);
        }

        return { ...playerData, doe, inflationPercent };
    };

    const fetchPicksAndData = async () => {
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
    };

    const applyFilters = useCallback(() => {
        let filtered = picks;

        if (filters.team.length > 0) {
            filtered = filtered.filter(pick => {
                const teamIndex = pick.draft_slot - 1;
                const teamName = draftOrder[teamIndex] ? draftOrder[teamIndex] : `Team ${pick.draft_slot}`;
                return filters.team.some(team => team.value === teamName);
            });
        }

        if (filters.player) {
            filtered = filtered.filter(pick =>
                (`${pick.metadata.first_name} ${pick.metadata.last_name}`).toLowerCase().includes(filters.player.toLowerCase())
            );
        }

        if (filters.position.length > 0) {
            filtered = filtered.filter(pick =>
                filters.position.some(pos => pos.value === pick.metadata.position)
            );
        }

        if (filters.tier.length > 0) {
            filtered = filtered.filter(pick => {
                const { tier } = computeExpectedValues(pick);
                return filters.tier.some(t => t.value === tier);
            });
        }

        setFilteredPicks(filtered.length > 0 ? filtered : picks);
    }, [picks, filters, draftOrder, computeExpectedValues]);

    useEffect(() => {
        fetchPicksAndData();
        if (isLive) {
            const intervalId = setInterval(fetchPicksAndData, 10000);
            return () => clearInterval(intervalId);
        }
    }, [draftId, isLive]);

    useEffect(() => {
        applyFilters();
    }, [picks, filters]);

    const handleFilterChange = (selectedOptions, action) => {
        const { name } = action;
        setFilters(prevFilters => ({
            ...prevFilters,
            [name]: selectedOptions || []
        }));
    };

    const teamOptions = draftOrder.map((team, index) => ({
        value: team,
        label: team || `Team ${index + 1}`
    }));

    const positionOptions = [
        { value: 'QB', label: 'QB' },
        { value: 'RB', label: 'RB' },
        { value: 'WR', label: 'WR' },
        { value: 'TE', label: 'TE' }
    ];

    const tierOptions = Array.from({ length: 10 }, (_, i) => ({
        value: (i + 1).toString(),
        label: `Tier ${i + 1}`
    }));

    return (
        <div className="ticker-container">
            <div className="filters-container">
                <div className="filter-column">
                    <label>Team:</label>
                    <Select
                        isMulti
                        name="team"
                        options={teamOptions}
                        className="basic-multi-select"
                        classNamePrefix="select"
                        onChange={handleFilterChange}
                    />
                </div>
                <div className="filter-column">
                    <label>Player:</label>
                    <input
                        type="text"
                        name="player"
                        value={filters.player}
                        onChange={(e) => setFilters(prevFilters => ({ ...prevFilters, player: e.target.value }))}
                    />
                </div>
                <div className="filter-column">
                    <label>Position:</label>
                    <Select
                        isMulti
                        name="position"
                        options={positionOptions}
                        className="basic-multi-select"
                        classNamePrefix="select"
                        onChange={handleFilterChange}
                    />
                </div>
                <div className="filter-column">
                    <label>Tier:</label>
                    <Select
                        isMulti
                        name="tier"
                        options={tierOptions}
                        className="basic-multi-select"
                        classNamePrefix="select"
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
                <td 
                    data-doe
                    data-positive={doe > 0 ? "true" : "false"} 
                    data-severity={getColorSeverity(doe)}
                >
                    {doe !== 'N/A' ? `${doe}` : 'N/A'}
                </td>
                <td 
                    data-inflation
                    data-positive={inflationPercent > 0 ? "true" : "false"} 
                    data-severity={getColorSeverity(inflationPercent)}
                >
                    {inflationPercent !== 'N/A' ? `${inflationPercent}%` : 'N/A'}
                </td>
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
