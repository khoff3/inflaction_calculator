import React, { useEffect, useState } from 'react';
import axios from 'axios';
import Plot from 'react-plotly.js';
import { Table } from 'react-bootstrap';

function ScatterPlot({ draftId }) {
    const [scatterData, setScatterData] = useState(null);
    const [r2Data, setR2Data] = useState(null);

    useEffect(() => {
        const fetchScatterData = async () => {
            try {
                const response = await axios.get(`/scatter_data?draft_id=${draftId}`);
                if (response.data) {
                    setScatterData(response.data.scatterplot);
                    setR2Data(response.data.r2_values);
                }
            } catch (error) {
                console.error('Error fetching scatter data:', error);
            }
        };

        fetchScatterData();
    }, [draftId]);

    if (!scatterData) return <div>Loading...</div>;

    return (
        <div>
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
                layout={{ xaxis: { title: 'Pick Number' }, yaxis: { title: 'Amount' } }}
            />
            
            {/* R^2 Values Table */}
            {r2Data && (
                <div>
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
                                    <td>{r2Data[position].r2.toFixed(2)}</td>
                                    <td>{r2Data[position].cost_of_waiting['1_pick'].toFixed(2)}</td>
                                    <td>{r2Data[position].cost_of_waiting['5_picks'].toFixed(2)}</td>
                                    <td>{r2Data[position].cost_of_waiting['10_picks'].toFixed(2)}</td>
                                    <td>{r2Data[position].cost_of_waiting['20_picks'].toFixed(2)}</td>
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
