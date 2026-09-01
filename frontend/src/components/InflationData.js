import React, { useState, useEffect, useCallback, useRef } from 'react';
import dataService from './utils/DataService';
import axios from 'axios';
import { Table, Alert, Spinner } from 'react-bootstrap';
import './inflation.css';

const InflationData = ({ draftId, isLive }) => {
    const [inflationData, setInflationData] = useState(null);
    const [error, setError] = useState(null);
    const cacheRef = useRef({});  // Cache to store fetched data
    const intervalRef = useRef(null);  // Reference to interval for live updates
    const lastFetchedRef = useRef(null); // Store the last fetch time

    const buildExpectedValuesLookup = (inflationData, playerData) => {
        const lookup = {};
        const processPlayer = (player) => {
            const name = player.player_name || player.Player;
            lookup[name] = {
                expectedValue: typeof player.auction_value === 'string' 
                    ? parseFloat(player.auction_value.replace('$', '')) 
                    : player.auction_value || 0,
                tier: player.tier !== undefined ? player.tier : 'N/A',
            };
        };
        if (inflationData && inflationData.expected_values) {
            inflationData.expected_values.forEach(processPlayer);
        }
        if (playerData) {
            playerData.forEach(processPlayer);
        }
        return lookup;
    };

    const aggregateInflationData = (picks, expectedValuesLookup) => {
        const positionInflation = {};
        const tieredInflation = {};
        let totalActualCost = 0;
        let totalExpectedCost = 0;
        let totalDOE = 0;

        picks.forEach(pick => {
            const playerName = `${pick.metadata.first_name} ${pick.metadata.last_name}`;
            const playerData = expectedValuesLookup[playerName] || {
                expectedValue: 0,
                tier: 'N/A',
            };

            const actualCost = parseFloat(pick.metadata.amount) || 0;
            const expectedCost = parseFloat(playerData.expectedValue) || 0;
            const doe = actualCost - expectedCost;
            const inflation = expectedCost !== 0 ? (doe / expectedCost) * 100 : 0;

            totalActualCost += actualCost;
            totalExpectedCost += expectedCost;
            totalDOE += doe;

            const position = pick.metadata.position;
            if (!positionInflation[position]) {
                positionInflation[position] = { totalDOE: 0, picks: 0 };
            }
            positionInflation[position].totalDOE += inflation;
            positionInflation[position].picks += 1;

            const tier = playerData.tier !== 'N/A' ? playerData.tier : pick.metadata.tier || 'N/A';
            if (!tieredInflation[position]) {
                tieredInflation[position] = {};
            }
            if (!tieredInflation[position][tier]) {
                tieredInflation[position][tier] = { actualCost: 0, expectedCost: 0, totalDOE: 0, picks: 0 };
            }
            tieredInflation[position][tier].actualCost += actualCost;
            tieredInflation[position][tier].expectedCost += expectedCost;
            tieredInflation[position][tier].totalDOE += doe;
            tieredInflation[position][tier].picks += 1;
        });

        const overallInflation = totalExpectedCost !== 0 ? (totalDOE / totalExpectedCost * 100).toFixed(2) : 0;

        for (const pos in positionInflation) {
            const posData = positionInflation[pos];
            positionInflation[pos].inflation = posData.picks !== 0 
                ? (posData.totalDOE / posData.picks).toFixed(2) 
                : 0;
        }

        for (const pos in tieredInflation) {
            for (const tier in tieredInflation[pos]) {
                const tierData = tieredInflation[pos][tier];
                tieredInflation[pos][tier].inflation = tierData.expectedCost !== 0 
                    ? ((tierData.totalDOE / tierData.expectedCost) * 100).toFixed(2) 
                    : 0;
                tieredInflation[pos][tier].avgCost = tierData.picks !== 0 
                    ? (tierData.actualCost / tierData.picks).toFixed(2) 
                    : 0;
                tieredInflation[pos][tier].doe = tierData.picks !== 0 
                    ? (tierData.totalDOE / tierData.picks).toFixed(2) 
                    : 0;
            }
        }

        return {
            overallInflation,
            positionInflation,
            tieredInflation,
            totalPicks: picks.length
        };
    };

    const fetchAndAggregateData = useCallback(async (forceRefresh = false) => {
        const now = Date.now();
        const lastFetched = lastFetchedRef.current;
    
        // Matches the poll cadence. This used to be 10s, which meant that even in
        // live mode the inflation numbers could sit five polls stale while the
        // ticker beside them had already moved.
        const MIN_REFETCH_MS = 2000;
        if (cacheRef.current[draftId] && !forceRefresh && (!lastFetched || (now - lastFetched < MIN_REFETCH_MS))) {
            setInflationData(cacheRef.current[draftId]);
            console.log(`Loaded inflation data from cache for draftId ${draftId}`);
            return;
        }
    
        if (cacheRef.current[draftId]) {
            setInflationData(cacheRef.current[draftId]);
            console.log(`Showing cached data while fetching new data for draftId ${draftId}`);
        }
    
        try {
            const picksResponse = await axios.get(`http://localhost:5050/picks?draft_id=${draftId}`);
            const fetchedPicks = picksResponse.data;
    
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
    
            // Use the backend's calculated data and add tiered calculations
            const lookup = buildExpectedValuesLookup(inflationData, playerData);
            
            if (!lookup || Object.keys(lookup).length === 0) {
                setError("Failed to perform player lookups.");
                return;
            }
            
            // Calculate tiered inflation using the backend's data and player lookup
            const tieredInflation = {};
            
            // Process each position's players from backend data
            Object.keys(inflationData.positional_data).forEach(position => {
                const posData = inflationData.positional_data[position];
                tieredInflation[position] = {};
                
                posData.players.forEach(player => {
                    const playerLookup = lookup[player.name];
                    let tier = 'N/A';
                    
                    // FantasyPros tier only. The old fallback bucketed untiered
                    // players by price into '1'..'9', which are not FantasyPros
                    // tiers - a $60 player with no ranking landed in tier 1
                    // beside genuine tier-1s and quietly moved that row's
                    // percentage. Untiered players now sit in their own bucket
                    // where they are visible instead of contaminating a real tier.
                    if (playerLookup && playerLookup.tier && playerLookup.tier !== 'N/A') {
                        tier = playerLookup.tier.toString();
                    }
                    
                    if (!tieredInflation[position][tier]) {
                        tieredInflation[position][tier] = {
                            actualCost: 0,
                            expectedCost: 0,
                            totalDOE: 0,
                            picks: 0,
                            inflation: 0,
                            avgCost: 0,
                            doe: 0
                        };
                    }
                    
                    const actualCost = parseFloat(player.amount);
                    const expectedCost = parseFloat(player.expected);
                    const doe = actualCost - expectedCost;
                    
                    tieredInflation[position][tier].actualCost += actualCost;
                    tieredInflation[position][tier].expectedCost += expectedCost;
                    tieredInflation[position][tier].totalDOE += doe;
                    tieredInflation[position][tier].picks += 1;
                });
                
                // Calculate averages and inflation for each tier
                Object.keys(tieredInflation[position]).forEach(tier => {
                    const tierData = tieredInflation[position][tier];
                    tierData.inflation = tierData.expectedCost !== 0 
                        ? ((tierData.totalDOE / tierData.expectedCost) * 100).toFixed(2) 
                        : 0;
                    tierData.avgCost = tierData.picks !== 0 
                        ? (tierData.actualCost / tierData.picks).toFixed(2) 
                        : 0;
                    tierData.doe = tierData.picks !== 0 
                        ? (tierData.totalDOE / tierData.picks).toFixed(2) 
                        : 0;
                });
            });
            
            // Format the overall inflation as a percentage
            const overallInflationPercent = parseFloat(inflationData.overall_inflation) * 100;
            
            // Convert positional inflation from decimal to percentage
            const formattedPositionInflation = {};
            Object.keys(inflationData.positional_inflation).forEach(position => {
                const inflationValue = parseFloat(inflationData.positional_inflation[position]) * 100;
                formattedPositionInflation[position] = inflationValue.toFixed(2);
            });
            
            // Get pick counts for each position from backend data
            const positionPickCounts = {};
            Object.keys(inflationData.positional_data).forEach(position => {
                positionPickCounts[position] = inflationData.positional_data[position].players.length;
            });
            
            const backendData = {
                overallInflation: overallInflationPercent.toFixed(2),
                positionInflation: formattedPositionInflation,
                positionPickCounts: positionPickCounts,
                tieredInflation: tieredInflation,
                totalPicks: fetchedPicks.length
            };
            
            setInflationData(backendData);
            
            cacheRef.current[draftId] = backendData;
            lastFetchedRef.current = now;
            console.log(`Fetched and aggregated new data for draftId ${draftId}`);
            console.log(`Cache after storing data for draftId ${draftId}:`, cacheRef.current);
    
        } catch (error) {
            console.error("Error fetching or aggregating data:", error);
            setError("Failed to fetch and aggregate inflation data.");
        }
    }, [draftId]);

    useEffect(() => {
        const componentId = `inflation-${draftId}`;
        
        // Subscribe to data updates
        const unsubscribe = dataService.subscribe(componentId, (data) => {
            if (data.picks && data.inflation && data.playerLookup) {
                fetchAndAggregateData();
            }
        });

        // Start polling through the service
        dataService.startPolling(draftId, isLive);

        // Show cached data immediately if available
        if (cacheRef.current[draftId]) {
            setInflationData(cacheRef.current[draftId]);
        } else {
            fetchAndAggregateData();
        }

        // Cleanup
        return () => {
            unsubscribe();
        };
    }, [draftId, isLive]);

    /**
     * Tiers to render for a position: whichever ones actually have picks.
     *
     * This used to be a hardcoded 1..10. FantasyPros publishes up to 16 tiers
     * depending on position and year, so every pick below tier 10 was computed
     * and then silently dropped from the table. 'N/A' sorts last so untiered
     * players stay visible rather than disappearing.
     */
    const tiersFor = (positionTiers) => {
        if (!positionTiers) return [];
        return Object.keys(positionTiers).sort((a, b) => {
            const na = parseInt(a, 10);
            const nb = parseInt(b, 10);
            if (Number.isNaN(na)) return 1;
            if (Number.isNaN(nb)) return -1;
            return na - nb;
        });
    };

    const getColorClass = (value) => {
        if (value > 15) return 'severe-positive';
        if (value > 10) return 'moderate-positive';
        if (value > 3) return 'mild-positive';
        if (value < -15) return 'severe-negative';
        if (value < -10) return 'moderate-negative';
        if (value < -3) return 'mild-negative';
        return 'neutral';
    };

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

    if (!inflationData) {
        return <Spinner animation="border" />;
    }

    if (error) {
        return (
            <Alert variant="danger">
                {error} <button onClick={() => window.location.reload()}>Retry</button>
            </Alert>
        );
    }

    return (
        <div>
            <div className="mb-4">
                <h2>Overall Inflation</h2>
                <p id="overall-inflation-display" className="inflation-percentage">
                    Overall Inflation: {inflationData.overallInflation}%
                </p>
            </div>
    
            {inflationData.positionInflation && (
                <div className="positional-inflation">
                    <h2>Positional Inflation</h2>
                    <Table bordered hover className="centered-table">
                        <thead>
                            <tr>
                                <th>Position</th>
                                <th>Inflation (%)</th>
                                <th>Number of Picks</th>
                            </tr>
                        </thead>
                        <tbody>
                            {["QB", "RB", "WR", "TE"].map((position) => (
                                <tr key={position}>
                                    <td style={{ color: getPositionColor(position), fontWeight: 'bold' }}>{position}</td>
                                    <td className={getColorClass(parseFloat(inflationData.positionInflation[position] || 0))}>
                                        {inflationData.positionInflation[position] || 0}%
                                    </td>
                                    <td>{inflationData.positionPickCounts[position] || 0}</td>
                                </tr>
                            ))}
                        </tbody>
                    </Table>
                </div>
            )}
    
            {inflationData.tieredInflation && (
                <div className="tiered-inflation">
                                                {["QB", "RB", "WR", "TE"].map((position) => (
                                <div key={position} className="tiered-position">
                                    <h3 style={{ color: getPositionColor(position) }}>{position.toUpperCase()}</h3>
                            <Table bordered hover className="centered-table">
                                <thead>
                                    <tr>
                                        <th>Tier</th>
                                        <th>Inflation (%)</th>
                                        <th>Picks</th>
                                        <th>DOE ($)</th>
                                        <th>Avg Cost ($)</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {tiersFor(inflationData.tieredInflation[position]).map((tier) => {
                                        const tierData = inflationData.tieredInflation[position]?.[tier];
                                        return (
                                            <tr key={tier}>
                                                <td>{tier}</td>
                                                <td id={`${position}-${tier}-inflation`}
                                                    className={getColorClass(tierData?.inflation || 0)}>
                                                    {tierData?.inflation || 0}%
                                                </td>
                                                <td id={`${position}-${tier}-picks`}>
                                                    {tierData?.picks || '0'}
                                                </td>
                                                <td id={`${position}-${tier}-doe`}
                                                    className={getColorClass(tierData?.doe || 0)}>
                                                    ${parseFloat(tierData?.doe || 0).toFixed(2)}
                                                </td>
                                                <td id={`${position}-${tier}-avg_cost`}>
                                                    ${parseFloat(tierData?.avgCost || 0).toFixed(2)}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </Table>
                        </div>
                    ))}
                </div>
            )}
    
        </div>
    );
};

export default InflationData;
