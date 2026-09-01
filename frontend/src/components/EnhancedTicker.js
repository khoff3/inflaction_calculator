import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import axios from 'axios';
import Select from 'react-select';
import './ticker.css';

// Enhanced color severity function
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

// Memory-efficient data cache
class DataCache {
    constructor(maxSize = 100) {
        this.cache = new Map();
        this.maxSize = maxSize;
        this.accessOrder = [];
    }

    set(key, value) {
        if (this.cache.size >= this.maxSize) {
            const oldestKey = this.accessOrder.shift();
            this.cache.delete(oldestKey);
        }
        this.cache.set(key, {
            value,
            timestamp: Date.now(),
            accessCount: 0
        });
        this.accessOrder.push(key);
    }

    get(key) {
        const item = this.cache.get(key);
        if (item) {
            item.accessCount++;
            // Move to end of access order
            this.accessOrder = this.accessOrder.filter(k => k !== key);
            this.accessOrder.push(key);
            return item.value;
        }
        return null;
    }

    clear() {
        this.cache.clear();
        this.accessOrder = [];
    }

    getStats() {
        return {
            size: this.cache.size,
            maxSize: this.maxSize,
            hitRate: this.calculateHitRate()
        };
    }

    calculateHitRate() {
        const totalAccesses = Array.from(this.cache.values())
            .reduce((sum, item) => sum + item.accessCount, 0);
        return totalAccesses > 0 ? totalAccesses / this.cache.size : 0;
    }
}

const EnhancedTicker = ({ draftId, draftOrder = [], isLive }) => {
    // State management with memory optimization
    const [picks, setPicks] = useState([]);
    const [filteredPicks, setFilteredPicks] = useState([]);
    const [expectedValuesLookup, setExpectedValuesLookup] = useState({});
    const [filters, setFilters] = useState({
        team: [],
        player: '',
        position: [],
        tier: []
    });
    const [loading, setLoading] = useState(false);
    // Pick count at the last successful fetch, used to skip no-op refreshes.
    const lastPickCount = useRef(null);
    const [error, setError] = useState(null);
    const [lastUpdate, setLastUpdate] = useState(null);

    // Refs for memory management
    const dataCache = useRef(new DataCache(50));
    const abortController = useRef(null);
    const updateInterval = useRef(null);

    // Memoized computations
    const teamOptions = useMemo(() => 
        draftOrder.map((team, index) => ({
            value: team,
            label: team || `Team ${index + 1}`
        })), [draftOrder]);

    const positionOptions = useMemo(() => [
        { value: 'QB', label: 'QB' },
        { value: 'RB', label: 'RB' },
        { value: 'WR', label: 'WR' },
        { value: 'TE', label: 'TE' }
    ], []);

    const tierOptions = useMemo(() => 
        Array.from({ length: 10 }, (_, i) => ({
            value: (i + 1).toString(),
            label: `Tier ${i + 1}`
        })), []);

    // Optimized expected values lookup
    const buildExpectedValuesLookup = useCallback((inflationData, playerData) => {
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
    }, []);

    // Optimized expected values computation
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

    // Enhanced data fetching with caching
    const fetchPicksAndData = useCallback(async () => {
        if (!draftId) return;

        // Check cache first
        const cacheKey = `draft_${draftId}`;
        const cachedData = dataCache.current.get(cacheKey);
        
        if (!isLive && cachedData) {
            const { fetchedPicks, lookup, timestamp } = cachedData;
            // Use cached data if it's less than 5 minutes old
            if (Date.now() - timestamp < 5 * 60 * 1000) {
                setPicks(fetchedPicks);
                setExpectedValuesLookup(lookup);
                setLastUpdate(new Date(timestamp));
                return;
            }
        }

        // Nothing has sold since the last poll? Then every downstream setState
        // would hand React identical data under new object identities, which is
        // a full re-render of the lot list for no reason. The backend already
        // exposes a cheap count for exactly this.
        try {
            const { data: count } = await axios.get(
                `http://localhost:5050/picks/count?draft_id=${draftId}`
            );
            const pickCount = typeof count === 'object' ? count.count : count;
            if (lastPickCount.current !== null && Number(pickCount) === lastPickCount.current) {
                return;
            }
            lastPickCount.current = Number(pickCount);
        } catch (countError) {
            // The count endpoint is an optimization, not a requirement — if it
            // fails, fall through and fetch normally.
            console.debug('picks/count unavailable, fetching in full', countError);
        }

        setLoading(true);
        setError(null);

        // Cancel previous request if still pending
        if (abortController.current) {
            abortController.current.abort();
        }
        abortController.current = new AbortController();

        try {
            const picksResponse = await axios.get(
                `http://localhost:5050/picks?draft_id=${draftId}`,
                { signal: abortController.current.signal }
            );
            
            const fetchedPicks = picksResponse.data.sort((a, b) => b.pick_no - a.pick_no);
            setPicks(fetchedPicks);

            const playerList = fetchedPicks.map(pick => ({
                first_name: pick.metadata.first_name,
                last_name: pick.metadata.last_name,
                position: pick.metadata.position
            }));

            // Parallel API calls for better performance
            const [playerDataResponse, inflationDataResponse] = await Promise.all([
                axios.post('http://localhost:5050/player_lookup', 
                    { players: playerList },
                    { signal: abortController.current.signal }
                ),
                axios.post('http://localhost:5050/inflation', 
                    { draft_id: draftId },
                    { signal: abortController.current.signal }
                )
            ]);

            const playerData = playerDataResponse.data;
            const inflationData = inflationDataResponse.data;

            const lookup = buildExpectedValuesLookup(inflationData, playerData);
            setExpectedValuesLookup(lookup);

            // Cache the results
            dataCache.current.set(cacheKey, {
                fetchedPicks,
                lookup,
                timestamp: Date.now()
            });

            setLastUpdate(new Date());
            setError(null);

        } catch (error) {
            if (error.name !== 'AbortError') {
                console.error("Failed to fetch picks or data:", error);
                setError(error.message);
            }
        } finally {
            setLoading(false);
        }
    }, [draftId, isLive, buildExpectedValuesLookup]);

    // Optimized filter application
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
            const playerFilter = filters.player.toLowerCase();
            filtered = filtered.filter(pick =>
                (`${pick.metadata.first_name} ${pick.metadata.last_name}`).toLowerCase().includes(playerFilter)
            );
        }

        if (filters.position.length > 0) {
            const positionSet = new Set(filters.position.map(pos => pos.value));
            filtered = filtered.filter(pick => positionSet.has(pick.metadata.position));
        }

        if (filters.tier.length > 0) {
            const tierSet = new Set(filters.tier.map(t => t.value));
            filtered = filtered.filter(pick => {
                const { tier } = computeExpectedValues(pick);
                return tierSet.has(tier.toString());
            });
        }

        setFilteredPicks(filtered.length > 0 ? filtered : picks);
    }, [picks, filters, draftOrder, computeExpectedValues]);

    // Effect for data fetching
    useEffect(() => {
        fetchPicksAndData();
        
        if (isLive) {
            updateInterval.current = setInterval(fetchPicksAndData, 3000);
        }

        return () => {
            if (updateInterval.current) {
                clearInterval(updateInterval.current);
            }
            if (abortController.current) {
                abortController.current.abort();
            }
        };
    }, [draftId, isLive, fetchPicksAndData]);

    // Effect for filter application
    useEffect(() => {
        applyFilters();
    }, [picks, filters, applyFilters]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (updateInterval.current) {
                clearInterval(updateInterval.current);
            }
            if (abortController.current) {
                abortController.current.abort();
            }
        };
    }, []);

    const handleFilterChange = (selectedOptions, action) => {
        const { name } = action;
        setFilters(prevFilters => ({
            ...prevFilters,
            [name]: selectedOptions || []
        }));
    };

    const handlePlayerFilterChange = (event) => {
        setFilters(prevFilters => ({
            ...prevFilters,
            player: event.target.value
        }));
    };

    const clearFilters = () => {
        setFilters({
            team: [],
            player: '',
            position: [],
            tier: []
        });
    };

    const getCacheStats = () => {
        return dataCache.current.getStats();
    };

    if (error) {
        return (
            <div className="error-container">
                <h3>Error Loading Data</h3>
                <p>{error}</p>
                <button onClick={fetchPicksAndData}>Retry</button>
            </div>
        );
    }

    return (
        <div className="ticker-container">
            <div className="header-section">
                <h2>Live Draft Ticker</h2>
                {lastUpdate && (
                    <span className="last-update">
                        Last updated: {lastUpdate.toLocaleTimeString()}
                    </span>
                )}
                {loading && <span className="loading-indicator">🔄 Loading...</span>}
            </div>

            <div className="filters-container">
                <div className="filter-column">
                    <label>Team:</label>
                    <Select
                        isMulti
                        name="team"
                        options={teamOptions}
                        className="basic-multi-select"
                        classNamePrefix="select"
                        value={filters.team}
                        onChange={handleFilterChange}
                        placeholder="Select teams..."
                    />
                </div>

                <div className="filter-column">
                    <label>Player:</label>
                    <input
                        type="text"
                        value={filters.player}
                        onChange={handlePlayerFilterChange}
                        placeholder="Search players..."
                        className="player-filter-input"
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
                        value={filters.position}
                        onChange={handleFilterChange}
                        placeholder="Select positions..."
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
                        value={filters.tier}
                        onChange={handleFilterChange}
                        placeholder="Select tiers..."
                    />
                </div>

                <div className="filter-column">
                    <button onClick={clearFilters} className="clear-filters-btn">
                        Clear Filters
                    </button>
                </div>
            </div>

            <div className="ticker-content">
                {filteredPicks.map((pick, index) => {
                    const playerName = `${pick.metadata.first_name} ${pick.metadata.last_name}`;
                    const { expectedValue, tier, doe, inflationPercent } = computeExpectedValues(pick);
                    const severity = getColorSeverity(parseFloat(doe) || 0);
                    const teamIndex = pick.draft_slot - 1;
                    const teamName = draftOrder[teamIndex] ? draftOrder[teamIndex] : `Team ${pick.draft_slot}`;

                    return (
                        <div key={`${pick.pick_no}-${playerName}`} className={`ticker-item ${severity}`}>
                            <div className="pick-info">
                                <span className="pick-number">#{pick.pick_no}</span>
                                <span className="team-name">{teamName}</span>
                            </div>
                            <div className="player-info">
                                <span className="player-name">{playerName}</span>
                                <span className="position">{pick.metadata.position}</span>
                            </div>
                            <div className="price-info">
                                <span className="amount">${pick.metadata.amount}</span>
                                <span className="expected-value">EV: ${expectedValue}</span>
                            </div>
                            <div className="inflation-info">
                                <span className={`doe ${severity}`}>
                                    {doe !== 'N/A' ? (parseFloat(doe) > 0 ? '+' : '') + doe : 'N/A'}
                                </span>
                                <span className="inflation-percent">
                                    {inflationPercent !== 'N/A' ? `${inflationPercent}%` : 'N/A'}
                                </span>
                            </div>
                            <div className="tier-info">
                                <span className="tier">Tier {tier}</span>
                            </div>
                        </div>
                    );
                })}
            </div>

            <div className="footer-section">
                <div className="cache-stats">
                    <small>Cache: {getCacheStats().size}/{getCacheStats().maxSize} items</small>
                </div>
                <div className="pick-count">
                    <small>{filteredPicks.length} picks shown</small>
                </div>
            </div>
        </div>
    );
};

export default EnhancedTicker; 