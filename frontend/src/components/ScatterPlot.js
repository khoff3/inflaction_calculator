import React, { useState, useEffect } from 'react';
import Plot from 'react-plotly.js';
import { Table } from 'react-bootstrap';
import { useDataContext } from './utils/DataProvider';

function ScatterPlot() {
    const { scatterData, r2Data, loading, fetchScatterData } = useDataContext();
    const draftId = 'someDraftId'; // Replace with dynamic draftId if necessary

    useEffect(() => {
        fetchScatterData(draftId, true); // Pass `true` if it's live, or use your isLive flag
    }, [draftId, fetchScatterData]);

    if (loading) return <div>Loading...</div>;

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
                    autosize: true,
                    margin: { l: 50, r: 50, b: 50, t: 50, pad: 4 },
                }}
                useResizeHandler={true}
                style={{ width: '100%', height: '100%' }}
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
        </div>
    );
}

export default ScatterPlot;
