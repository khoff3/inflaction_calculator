import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import Select from 'react-select';
import Slider from 'rc-slider';
import 'rc-slider/assets/index.css';
import './ticker.css';

const Ticker = ({ draftId, draftOrder = [], isLive }) => {
    const [picks, setPicks] = useState([]);
    const [filteredPicks, setFilteredPicks] = useState([]);
    const [expectedValuesLookup, setExpectedValuesLookup] = useState({});
    const [cachedResults, setCachedResults] = useState({});
    const [filters, setFilters] = useState({
        team: [],
        player: '',
        position: [],
        tier: [],
        price: [0, 100],
        expectedPrice: [0, 100],
        inflation: [-100, 100],
    });

    const defaultFilters = {
        team: [],
        player: '',
        position: [],
        tier: [],
        price: [0, 100],
        expectedPrice: [0, 100],
        inflation: [-100, 100],
    };

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

        const doe = playerData.expectedValue !== 'N/A' ? (pick.metadata.amount - playerData.expectedValue).toFixed(0) : 'N/A';
        const inflationPercent = playerData.expectedValue !== 'N/A' ? ((doe / playerData.expectedValue) * 100).toFixed(2) : 'N/A';

        const normalizedTier = playerData.tier !== 'N/A' ? playerData.tier.toString().trim() : 'N/A';

        return { ...playerData, doe, inflationPercent, tier: normalizedTier };
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

        if (filters.team.length > 0) {
            filtered = filtered.filter(pick => {
                const teamIndex = pick.draft_slot - 1;
                const teamName = draftOrder[teamIndex] ? draftOrder[teamIndex] : `Team ${pick.draft_slot}`;
                return filters.team.some(selectedTeam => selectedTeam.label === teamName);
            });
        }

        if (filters.player) {
            filtered = filtered.filter(pick =>
                (`${pick.metadata.first_name} ${pick.metadata.last_name}`).toLowerCase().includes(filters.player.toLowerCase())
            );
        }

        if (filters.position.length > 0) {
            filtered = filtered.filter(pick =>
                filters.position.some(selectedPos => selectedPos.label === pick.metadata.position)
            );
        }

        if (filters.tier.length > 0) {
            filtered = filtered.filter(pick => {
                const { tier } = computeExpectedValues(pick);
                return filters.tier.some(selectedTier => selectedTier.label === tier);
            });
        }

        filtered = filtered.filter(pick => {
            const price = parseFloat(pick.metadata.amount);
            return price >= filters.price[0] && price <= filters.price[1];
        });

        filtered = filtered.filter(pick => {
            const { expectedValue, inflationPercent } = computeExpectedValues(pick);
            return (
                expectedValue !== 'N/A' &&
                expectedValue >= filters.expectedPrice[0] &&
                expectedValue <= filters.expectedPrice[1] &&
                inflationPercent >= filters.inflation[0] &&
                inflationPercent <= filters.inflation[1]
            );
        });

        setFilteredPicks(filtered);
    }, [picks, filters, draftOrder, computeExpectedValues]);

    useEffect(() => {
        applyFilters();
    }, [picks, filters]);

    useEffect(() => {
        fetchPicksAndData();

        if (isLive) {
            const intervalId = setInterval(fetchPicksAndData, 10000);
            return () => clearInterval(intervalId);
        }
    }, [draftId, isLive]);

    const handleFilterChange = (name, value) => {
        setFilters(prevFilters => ({
            ...prevFilters,
            [name]: value
        }));
    };

    const resetFilters = () => {
        setFilters(defaultFilters);
    };

    const teamOptions = draftOrder.map((team, index) => ({ label: team || `Team ${index + 1}`, value: index + 1 }));
    const positionOptions = [...new Set(picks.map(pick => pick.metadata.position))].map(position => ({ label: position, value: position }));
    const tierOptions = [...new Set(filteredPicks.map(pick => computeExpectedValues(pick).tier))]
        .sort((a, b) => {
            if (a === 'N/A') return 1;
            if (b === 'N/A') return -1;
            const tierA = parseFloat(a) || a;
            const tierB = parseFloat(b) || b;
            if (typeof tierA === 'number' && typeof tierB === 'number') {
                return tierA - tierB;
            } else {
                return tierA.localeCompare(tierB);
            }
        })
        .map(tier => ({ label: tier, value: tier }));

    const getCellStyle = (value, isInflation = false) => {
        if (isInflation) {
            if (value > 30) {
                return { color: '#800000' }; // Very dark red (bad)
            } else if (value > 20) {
                return { color: '#b30000' }; // Dark red (bad)
            } else if (value > 10) {
                return { color: '#e60000' }; // Medium red (bad)
            } else if (value > 0) {
                return { color: '#ff1a1a' }; // Light red (bad)
            } else if (value < -30) {
                return { color: '#004d00' }; // Very dark green (good)
            } else if (value < -20) {
                return { color: '#006600' }; // Dark green (good)
            } else if (value < -10) {
                return { color: '#009900' }; // Medium green (good)
            } else {
                return { color: '#00cc00' }; // Light green (good)
            }
        } else {
            if (value < -30) {
                return { color: '#004d00' }; // Very dark green (good)
            } else if (value < -20) {
                return { color: '#006600' }; // Dark green (good)
            } else if (value < -10) {
                return { color: '#009900' }; // Medium green (good)
            } else if (value < 0) {
                return { color: '#00cc00' }; // Light green (good)
            } else if (value > 30) {
                return { color: '#800000' }; // Very dark red (bad)
            } else if (value > 20) {
                return { color: '#b30000' }; // Dark red (bad)
            } else if (value > 10) {
                return { color: '#e60000' }; // Medium red (bad)
            } else if (value > 5) {
                return { color: '#ff1a1a' }; // Light red (bad)
            }
        }
        return { color: 'black' };
    };

    return (
        <div className="ticker-container">
            <div className="filters-container">
                <div className="filter-column">
                    <label>Team:</label>
                    <Select
                        isMulti
                        name="team"
                        options={teamOptions}
                        value={filters.team}
                        onChange={value => handleFilterChange('team', value)}
                        className="basic-multi-select"
                        classNamePrefix="select"
                    />
                </div>
                <div className="filter-column">
                    <label>Player:</label>
                    <input
                        type="text"
                        name="player"
                        value={filters.player}
                        onChange={e => handleFilterChange('player', e.target.value)}
                        placeholder="Search player..."
                    />
                </div>
                <div className="filter-column">
                    <label>Position:</label>
                    <Select
                        isMulti
                        name="position"
                        options={positionOptions}
                        value={filters.position}
                        onChange={value => handleFilterChange('position', value)}
                        className="basic-multi-select"
                        classNamePrefix="select"
                    />
                </div>
                <div className="filter-column">
                    <label>Tier:</label>
                    <Select
                        isMulti
                        name="tier"
                        options={tierOptions}
                        value={filters.tier}
                        onChange={value => handleFilterChange('tier', value)}
                        className="basic-multi-select"
                        classNamePrefix="select"
                    />
                </div>
                <div className="filter-column">
                    <label>Price:</label>
                    <Slider
                        range
                        min={0}
                        max={100}
                        value={filters.price}
                        onChange={value => handleFilterChange('price', value)}
                    />
                    <div>{`$${filters.price[0]} - $${filters.price[1]}`}</div>
                </div>
                <div className="filter-column">
                    <label>Expected Price:</label>
                    <Slider
                        range
                        min={0}
                        max={100}
                        value={filters.expectedPrice}
                        onChange={value => handleFilterChange('expectedPrice', value)}
                    />
                    <div>{`$${filters.expectedPrice[0]} - $${filters.expectedPrice[1]}`}</div>
                </div>
                <div className="filter-column">
                    <label>Inflation %:</label>
                    <Slider
                        range
                        min={-100}
                        max={100}
                        value={filters.inflation}
                        onChange={value => handleFilterChange('inflation', value)}
                    />
                    <div>{`Inflation: from ${filters.inflation[0]}% to ${filters.inflation[1]}%`}</div>
                </div>
            </div>
            <button className="reset-button" onClick={resetFilters}>
                Reset Filters
            </button>

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
                                <td style={getCellStyle(doe)}>{doe !== 'N/A' ? `${doe}` : 'N/A'}</td>
                                <td style={getCellStyle(inflationPercent)}>{inflationPercent !== 'N/A' ? `${inflationPercent}%` : 'N/A'}</td>
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
