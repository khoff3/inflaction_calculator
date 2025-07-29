import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import Plot from 'react-plotly.js';
import { Table } from 'react-bootstrap';
import dataService from './utils/DataService';

function ScatterPlot({ draftId, isLive }) {
    const [scatterData, setScatterData] = useState(null);
    const [r2Data, setR2Data] = useState(null);

    // Calculate trending spend analysis
    const trendingAnalysis = useMemo(() => {
        if (!scatterData || !scatterData.pick_no || scatterData.pick_no.length < 2) {
            return null;
        }

        const { pick_no, metadata_amount } = scatterData;
        
        // Calculate linear regression for the entire dataset
        const n = pick_no.length;
        const sumX = pick_no.reduce((sum, x) => sum + x, 0);
        const sumY = metadata_amount.reduce((sum, y) => sum + y, 0);
        const sumXY = pick_no.reduce((sum, x, i) => sum + x * metadata_amount[i], 0);
        const sumX2 = pick_no.reduce((sum, x) => sum + x * x, 0);
        
        const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
        const intercept = (sumY - slope * sumX) / n;
        
        // Calculate R-squared
        const meanY = sumY / n;
        const ssRes = metadata_amount.reduce((sum, y, i) => {
            const predicted = slope * pick_no[i] + intercept;
            return sum + Math.pow(y - predicted, 2);
        }, 0);
        const ssTot = metadata_amount.reduce((sum, y) => sum + Math.pow(y - meanY, 2), 0);
        const rSquared = 1 - (ssRes / ssTot);
        
        // Calculate cost of waiting for different pick intervals
        const costOfWaiting = {
            1: Math.abs(slope),
            5: Math.abs(slope * 5),
            10: Math.abs(slope * 10),
            20: Math.abs(slope * 20)
        };
        
        // Calculate average spend and R² by position groups
        const positionGroups = {};
        scatterData.player_names.forEach((player, i) => {
            const position = scatterData.colors[i];
            if (!positionGroups[position]) {
                positionGroups[position] = {
                    amounts: [],
                    pickNumbers: []
                };
            }
            positionGroups[position].amounts.push(metadata_amount[i]);
            positionGroups[position].pickNumbers.push(pick_no[i]);
        });
        
        const avgByPosition = {};
        Object.keys(positionGroups).forEach(position => {
            const { amounts, pickNumbers } = positionGroups[position];
            
            // Calculate R² for this position group
            let positionR2 = 0;
            if (amounts.length >= 2) {
                const n = amounts.length;
                const sumX = pickNumbers.reduce((sum, x) => sum + x, 0);
                const sumY = amounts.reduce((sum, y) => sum + y, 0);
                const sumXY = pickNumbers.reduce((sum, x, i) => sum + x * amounts[i], 0);
                const sumX2 = pickNumbers.reduce((sum, x) => sum + x * x, 0);
                
                const posSlope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
                const posIntercept = (sumY - posSlope * sumX) / n;
                
                const meanY = sumY / n;
                const ssRes = amounts.reduce((sum, y, i) => {
                    const predicted = posSlope * pickNumbers[i] + posIntercept;
                    return sum + Math.pow(y - predicted, 2);
                }, 0);
                const ssTot = amounts.reduce((sum, y) => sum + Math.pow(y - meanY, 2), 0);
                positionR2 = ssTot > 0 ? 1 - (ssRes / ssTot) : 0;
            }
            
            avgByPosition[position] = {
                average: amounts.reduce((sum, val) => sum + val, 0) / amounts.length,
                count: amounts.length,
                min: Math.min(...amounts),
                max: Math.max(...amounts),
                r2: positionR2
            };
        });
        
        return {
            slope: slope,
            intercept: intercept,
            rSquared: rSquared,
            costOfWaiting: costOfWaiting,
            avgByPosition: avgByPosition,
            totalPicks: n,
            totalSpent: sumY,
            averageSpend: sumY / n
        };
    }, [scatterData]);

    useEffect(() => {
        const fetchScatterData = async () => {
            console.log("Fetching scatter plot data for draft ID:", draftId);

            // Load cached data first if available
            const cachedScatterData = localStorage.getItem(`scatterData_${draftId}`);
            const cachedR2Data = localStorage.getItem(`r2Data_${draftId}`);

            if (cachedScatterData && cachedScatterData !== "undefined" && cachedR2Data && cachedR2Data !== "undefined") {
                try {
                    console.log("Loading cached scatter plot data for draft ID:", draftId);
                    setScatterData(JSON.parse(cachedScatterData));
                    setR2Data(JSON.parse(cachedR2Data));
                } catch (error) {
                    console.error("Error parsing cached scatter data:", error);
                    // Clear invalid cache
                    localStorage.removeItem(`scatterData_${draftId}`);
                    localStorage.removeItem(`r2Data_${draftId}`);
                }
            }

            try {
                const response = await axios.get(`/scatter_data?draft_id=${draftId}&is_live=${isLive}`);
                if (response.data) {
                    // Our backend returns the scatter data directly, not nested under 'scatterplot'
                    setScatterData(response.data);
                    // We don't have r2_values in our current backend, so set to null
                    setR2Data(null);

                    // Cache the updated data even if it's live
                    localStorage.setItem(`scatterData_${draftId}`, JSON.stringify(response.data));
                    localStorage.setItem(`r2Data_${draftId}`, JSON.stringify(null));
                    
                    console.log("Scatter plot data loaded and cached successfully.");
                }
            } catch (error) {
                console.error('Error fetching scatter data:', error);
            }
        };

        const componentId = `scatterplot-${draftId}`;
        
        // Subscribe to data updates
        const unsubscribe = dataService.subscribe(componentId, (data) => {
            if (data.picks) {
                fetchScatterData();
            }
        });

        // Start polling through the service
        dataService.startPolling(draftId, isLive);

        // Cleanup
        return () => {
            unsubscribe();
        };
    }, [draftId, isLive]);

    if (!scatterData) return <div>Loading...</div>;

    return (
        <div style={{ width: '100%', height: '100%' }}>
            <Plot
                data={[
                    {
                        x: scatterData.pick_no,
                        y: scatterData.metadata_amount,
                        mode: 'markers',
                        marker: { color: scatterData.colors, size: 10 },
                        text: scatterData.player_names,
                    },
                ]}
                layout={{
                    xaxis: { title: 'Pick Number' },
                    yaxis: { title: 'Amount' },
                    autosize: true, // Enable autosizing to fit the plot to the container
                    margin: { l: 50, r: 50, b: 50, t: 50, pad: 4 },
                }}
                useResizeHandler={true}
                style={{ width: '100%', height: '100%' }} // Make sure the plot uses the full container
            />

            {r2Data && (
                <div style={{ marginTop: '20px' }}>
                    <h2>R^2 Values by Position</h2>
                    <Table striped bordered hover>
                        <thead>
                            <tr>
                                <th>Position</th>
                                <th>R^2 Value</th>
                                <th>Cost of Waiting (1 Pick)</th>
                                <th>Cost of Waiting (5 Picks)</th>
                                <th>Cost of Waiting (10 Picks)</th>
                                <th>Cost of Waiting (20 Picks)</th>
                            </tr>
                        </thead>
                        <tbody>
                            {Object.keys(r2Data).map((position) => (
                                <tr key={position}>
                                    <td>{position}</td>
                                    <td>{r2Data[position].r2 !== 'N/A' ? r2Data[position].r2.toFixed(2) : 'N/A'}</td>
                                    <td>{r2Data[position].cost_of_waiting['1_pick'] !== 'N/A' ? r2Data[position].cost_of_waiting['1_pick'].toFixed(2) : 'N/A'}</td>
                                    <td>{r2Data[position].cost_of_waiting['5_picks'] !== 'N/A' ? r2Data[position].cost_of_waiting['5_picks'].toFixed(2) : 'N/A'}</td>
                                    <td>{r2Data[position].cost_of_waiting['10_picks'] !== 'N/A' ? r2Data[position].cost_of_waiting['10_picks'].toFixed(2) : 'N/A'}</td>
                                    <td>{r2Data[position].cost_of_waiting['20_picks'] !== 'N/A' ? r2Data[position].cost_of_waiting['20_picks'].toFixed(2) : 'N/A'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </Table>
                </div>
            )}

            {trendingAnalysis && (
                <div style={{ marginTop: '20px' }}>
                    <h2>Trending Spend Analysis</h2>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '20px' }}>
                        <div style={{ padding: '15px', backgroundColor: '#f8f9fa', borderRadius: '8px', border: '1px solid #e9ecef' }}>
                            <h4>Overall Trend</h4>
                            <p><strong>Slope:</strong> {trendingAnalysis.slope.toFixed(2)} $/pick</p>
                            <p><strong>R²:</strong> {trendingAnalysis.rSquared.toFixed(3)}</p>
                            <p><strong>Total Picks:</strong> {trendingAnalysis.totalPicks}</p>
                            <p><strong>Total Spent:</strong> ${trendingAnalysis.totalSpent.toLocaleString()}</p>
                            <p><strong>Average Spend:</strong> ${trendingAnalysis.averageSpend.toFixed(2)}</p>
                        </div>
                        <div style={{ padding: '15px', backgroundColor: '#f8f9fa', borderRadius: '8px', border: '1px solid #e9ecef' }}>
                            <h4>Cost of Waiting</h4>
                            <p><strong>1 Pick:</strong> ${trendingAnalysis.costOfWaiting[1].toFixed(2)}</p>
                            <p><strong>5 Picks:</strong> ${trendingAnalysis.costOfWaiting[5].toFixed(2)}</p>
                            <p><strong>10 Picks:</strong> ${trendingAnalysis.costOfWaiting[10].toFixed(2)}</p>
                            <p><strong>20 Picks:</strong> ${trendingAnalysis.costOfWaiting[20].toFixed(2)}</p>
                        </div>
                    </div>
                    
                    <Table striped bordered hover>
                        <thead>
                            <tr>
                                <th>Position</th>
                                <th>Count</th>
                                <th>Average Spend</th>
                                <th>Min Spend</th>
                                <th>Max Spend</th>
                                <th>R²</th>
                            </tr>
                        </thead>
                        <tbody>
                            {Object.keys(trendingAnalysis.avgByPosition).map((position) => {
                                const data = trendingAnalysis.avgByPosition[position];
                                // Map hex colors to position names and proper colors
                                let positionName, positionColor;
                                switch(position) {
                                    case '#8B5CF6':
                                        positionName = 'QB';
                                        positionColor = '#8B5CF6';
                                        break;
                                    case '#22C55E':
                                        positionName = 'RB';
                                        positionColor = '#22C55E';
                                        break;
                                    case '#F97316':
                                        positionName = 'WR';
                                        positionColor = '#F97316';
                                        break;
                                    case '#3B82F6':
                                        positionName = 'TE';
                                        positionColor = '#3B82F6';
                                        break;
                                    case '#32CD32':
                                        positionName = 'RB';
                                        positionColor = '#22C55E';
                                        break;
                                    case '#FF8C00':
                                        positionName = 'WR';
                                        positionColor = '#F97316';
                                        break;
                                    case '#1E90FF':
                                        positionName = 'TE';
                                        positionColor = '#3B82F6';
                                        break;
                                    case '#8A2BE2':
                                        positionName = 'QB';
                                        positionColor = '#8B5CF6';
                                        break;
                                    case '#FFD700':
                                        positionName = 'K';
                                        positionColor = '#FFD700';
                                        break;
                                    case '#696969':
                                        positionName = 'DEF';
                                        positionColor = '#696969';
                                        break;
                                    default:
                                        positionName = position;
                                        positionColor = position;
                                }
                                return (
                                    <tr key={position}>
                                        <td style={{ color: positionColor, fontWeight: 'bold' }}>{positionName}</td>
                                        <td>{data.count}</td>
                                        <td>${data.average.toFixed(2)}</td>
                                        <td>${data.min}</td>
                                        <td>${data.max}</td>
                                        <td>{data.r2.toFixed(3)}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </Table>
                </div>
            )}
        </div>
    );
}

export default ScatterPlot;