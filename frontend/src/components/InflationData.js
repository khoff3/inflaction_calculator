import React, { useState, useEffect, useCallback, useRef } from 'react';
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
    
        if (cacheRef.current[draftId] && !forceRefresh && (!lastFetched || (now - lastFetched < 10000))) {
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
    
            const lookup = buildExpectedValuesLookup(inflationData, playerData);
    
            if (!lookup || Object.keys(lookup).length === 0) {
                setError("Failed to perform player lookups.");
                return;
            }
    
            const aggregatedData = aggregateInflationData(fetchedPicks, lookup);
            setInflationData(aggregatedData);
    
            cacheRef.current[draftId] = aggregatedData;
            lastFetchedRef.current = now;
            console.log(`Fetched and aggregated new data for draftId ${draftId}`);
            console.log(`Cache after storing data for draftId ${draftId}:`, cacheRef.current);
    
        } catch (error) {
            console.error("Error fetching or aggregating data:", error);
            setError("Failed to fetch and aggregate inflation data.");
        }
    }, [draftId]);

    useEffect(() => {
        console.log(`Tab activated or draftId changed: Checking cache for draftId ${draftId}`);
        
        console.log(`Current cacheRef before setting inflation data:`, cacheRef.current);
        if (cacheRef.current[draftId]) {
            console.log(`Showing cached data immediately for draftId ${draftId}`);
            setInflationData(cacheRef.current[draftId]);
        } else {
            console.log(`No cached data found for draftId ${draftId}, fetching new data.`);
            fetchAndAggregateData(); // Fetch new data if live or no cache available
        }
    
        if (isLive) {
            intervalRef.current = setInterval(() => fetchAndAggregateData(true), 10000);
            return () => clearInterval(intervalRef.current);
        }
    }, [draftId, isLive, fetchAndAggregateData]);

    const getColorClass = (value) => {
        if (value > 15) return 'severe-positive';
        if (value > 10) return 'moderate-positive';
        if (value > 3) return 'mild-positive';
        if (value < -15) return 'severe-negative';
        if (value < -10) return 'moderate-negative';
        if (value < -3) return 'mild-negative';
        return 'neutral';
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
                                    <td>{position}</td>
                                    <td className={getColorClass(inflationData.positionInflation[position]?.inflation || 0)}>
                                        {inflationData.positionInflation[position]?.inflation || 0}%
                                    </td>
                                    <td>{inflationData.positionInflation[position]?.picks || '0'}</td>
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
                            <h3>{position.toUpperCase()}</h3>
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
                                    {Array.from({ length: 10 }, (_, i) => i + 1).map((tier) => (
                                        <tr key={tier}>
                                            <td>{tier}</td>
                                            <td id={`${position}-${tier}-inflation`}
                                                className={getColorClass(inflationData.tieredInflation[position]?.[tier]?.inflation || 0)}>
                                                {inflationData.tieredInflation[position]?.[tier]?.inflation || 0}%
                                            </td>
                                            <td id={`${position}-${tier}-picks`}>
                                                {inflationData.tieredInflation[position]?.[tier]?.picks || '0'}
                                            </td>
                                            <td id={`${position}-${tier}-doe`}
                                                className={getColorClass(inflationData.tieredInflation[position]?.[tier]?.doe || 0)}>
                                                ${parseFloat(inflationData.tieredInflation[position]?.[tier]?.doe || 0).toFixed(2)}
                                            </td>
                                            <td id={`${position}-${tier}-avg_cost`}>
                                                ${parseFloat(inflationData.tieredInflation[position]?.[tier]?.avgCost || 0).toFixed(2)}
                                            </td>
                                        </tr>
                                    ))}
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
