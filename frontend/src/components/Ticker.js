import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Select from 'react-select'; // Using react-select for multi-select dropdowns
import dataService from './utils/DataService';
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

// Define Underdog-style position colors
const getPositionColor = (position) => {
    const colors = {
        'QB': '#8A2BE2',  // Purple
        'RB': '#32CD32',  // Green
        'WR': '#FF8C00',  // Orange
        'TE': '#1E90FF',  // Blue
        'K': '#FFD700',   // Gold
        'DEF': '#696969'  // Gray
    };
    return colors[position] || '#808080'; // Gray fallback
};

const Ticker = ({ draftId, draftOrder = [], isLive }) => {
    const [picks, setPicks] = useState([]);
    const [filteredPicks, setFilteredPicks] = useState([]);
    const [expectedValuesLookup, setExpectedValuesLookup] = useState({});
    const [filters, setFilters] = useState({
        team: [],
        player: '',
        position: [],
        tier: []
    });
    const [sortConfig, setSortConfig] = useState({
        key: 'pick_no',
        direction: 'desc'
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

        // Handle player lookup data - it's now an object with player names as keys
        if (playerData && typeof playerData === 'object' && !Array.isArray(playerData)) {
            Object.keys(playerData).forEach(playerName => {
                const player = playerData[playerName];
                if (!lookup[playerName]) {
                    lookup[playerName] = {
                        expectedValue: typeof player.auction_value === 'string' 
                            ? parseFloat(player.auction_value.replace('$', '')) 
                            : player.auction_value,
                        tier: player.tier !== undefined ? player.tier : 'N/A',
                    };
                }
            });
        } else if (Array.isArray(playerData)) {
            // Fallback for array format
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
        }

        return lookup;
    };

    const computeExpectedValues = useCallback((pick) => {
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
    }, [expectedValuesLookup]);

    // Initialize with cached data if available
    useEffect(() => {
        const cachedData = dataService.getCachedData();
        if (cachedData.picks.length > 0) {
            // Sort picks in descending order (highest pick number first)
            const sortedPicks = [...cachedData.picks].sort((a, b) => b.pick_no - a.pick_no);
            setPicks(sortedPicks);
        }
        if (cachedData.inflation && cachedData.playerLookup) {
            const lookup = buildExpectedValuesLookup(cachedData.inflation, cachedData.playerLookup);
            setExpectedValuesLookup(lookup);
        }
    }, []);

    // Use centralized data service for efficient polling
    useEffect(() => {
        const componentId = `ticker-${draftId}`;
        
        // Subscribe to data updates
        const unsubscribe = dataService.subscribe(componentId, (data) => {
            if (data.picks) {
                // Store raw picks data - sorting will be handled by sortConfig
                setPicks(data.picks);
            }
            if (data.inflation && data.playerLookup) {
                const lookup = buildExpectedValuesLookup(data.inflation, data.playerLookup);
                setExpectedValuesLookup(lookup);
            }
        });

        // Start polling through the service
        dataService.startPolling(draftId, isLive);

        // Cleanup
        return () => {
            unsubscribe();
            // Only stop polling if no other components are using this draft
            if (!isLive) {
                dataService.stopPolling();
            }
        };
    }, [draftId, isLive]);

    const sortPicks = useCallback((picksToSort) => {
        // Pre-compute sort values to avoid repeated lookups
        const picksWithSortValues = picksToSort.map(pick => {
            const playerKey = `${pick.metadata.first_name} ${pick.metadata.last_name}`;
            const playerData = expectedValuesLookup[playerKey] || {};
            
            let sortValue;
            switch (sortConfig.key) {
                case 'pick_no':
                    sortValue = pick.pick_no;
                    break;
                case 'team':
                    const teamIndex = pick.draft_slot - 1;
                    sortValue = draftOrder[teamIndex] || `Team ${pick.draft_slot}`;
                    break;
                case 'player':
                    sortValue = `${pick.metadata.first_name} ${pick.metadata.last_name}`;
                    break;
                case 'position':
                    sortValue = pick.metadata.position;
                    break;
                case 'price':
                    sortValue = pick.metadata.amount;
                    break;
                case 'ep':
                    sortValue = playerData.expectedValue === 'N/A' ? 0 : (playerData.expectedValue || 0);
                    break;
                case 'doe':
                    const expected = playerData.expectedValue || 0;
                    sortValue = expected === 'N/A' ? 0 : (pick.metadata.amount - expected);
                    break;
                case 'inflation':
                    const expForInfl = playerData.expectedValue || 0;
                    sortValue = expForInfl === 'N/A' ? 0 : ((pick.metadata.amount - expForInfl) / expForInfl) * 100;
                    break;
                case 'tier':
                    sortValue = playerData.tier === 'N/A' ? 999 : parseInt(playerData.tier) || 999;
                    break;
                default:
                    sortValue = 0;
            }
            
            return { ...pick, _sortValue: sortValue };
        });

        // Sort by pre-computed values
        return picksWithSortValues.sort((a, b) => {
            if (a._sortValue < b._sortValue) {
                return sortConfig.direction === 'asc' ? -1 : 1;
            }
            if (a._sortValue > b._sortValue) {
                return sortConfig.direction === 'asc' ? 1 : -1;
            }
            return 0;
        });
    }, [sortConfig, expectedValuesLookup, draftOrder]);

    const handleSort = useCallback((key) => {
        setSortConfig(prevConfig => ({
            key,
            direction: prevConfig.key === key && prevConfig.direction === 'asc' ? 'desc' : 'asc'
        }));
    }, []);

    // Memoize filtered and sorted data to prevent unnecessary re-computations
    const filteredAndSortedPicks = useMemo(() => {
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

        return sortPicks(filtered.length > 0 ? filtered : picks);
    }, [picks, filters, draftOrder, computeExpectedValues, sortPicks]);

    // Update filtered picks when memoized data changes
    useEffect(() => {
        setFilteredPicks(filteredAndSortedPicks);
    }, [filteredAndSortedPicks]);

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
                        <th 
                            className="pick-number-column sortable-header" 
                            onClick={() => handleSort('pick_no')}
                        >
                            Pick # {sortConfig.key === 'pick_no' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                        </th>
                        <th 
                            className="sortable-header" 
                            onClick={() => handleSort('team')}
                        >
                            Team {sortConfig.key === 'team' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                        </th>
                        <th 
                            className="player-name-header sortable-header" 
                            onClick={() => handleSort('player')}
                        >
                            Player {sortConfig.key === 'player' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                        </th>
                        <th 
                            className="sortable-header" 
                            onClick={() => handleSort('position')}
                        >
                            Position {sortConfig.key === 'position' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                        </th>
                        <th 
                            className="sortable-header" 
                            onClick={() => handleSort('price')}
                        >
                            Price {sortConfig.key === 'price' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                        </th>
                        <th 
                            className="sortable-header" 
                            onClick={() => handleSort('ep')}
                        >
                            EP {sortConfig.key === 'ep' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                        </th>
                        <th 
                            className="sortable-header" 
                            onClick={() => handleSort('doe')}
                        >
                            DOE {sortConfig.key === 'doe' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                        </th>
                        <th 
                            className="sortable-header" 
                            onClick={() => handleSort('inflation')}
                        >
                            Inflation % {sortConfig.key === 'inflation' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                        </th>
                        <th 
                            className="sortable-header" 
                            onClick={() => handleSort('tier')}
                        >
                            Tier {sortConfig.key === 'tier' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                        </th>
                    </tr>
                </thead>
                <tbody>
                    {filteredPicks.map((pick, index) => {
                        const teamIndex = pick.draft_slot - 1;
                        const teamName = draftOrder[teamIndex] ? draftOrder[teamIndex] : `Team ${pick.draft_slot}`;

                        const { expectedValue, doe, inflationPercent, tier } = computeExpectedValues(pick);

                        return (
                            <tr key={index}>
                                <td className="pick-number-column">{pick.pick_no}</td>
                                <td>{teamName}</td>
                                <td className="player-name-column">{pick.metadata.first_name} {pick.metadata.last_name}</td>
                                <td style={{ color: getPositionColor(pick.metadata.position), fontWeight: 'bold' }}>
                                    {pick.metadata.position}
                                </td>
                                <td>${pick.metadata.amount}</td>
                                <td>{expectedValue !== 'N/A' ? `$${expectedValue}` : 'N/A'}</td>
                                <td 
                                    data-doe
                                    data-positive={doe > 0 ? "true" : "false"} 
                                    data-severity={getColorSeverity(doe)}
                                >
                                    {doe !== 'N/A' ? `$${doe}` : 'N/A'}
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