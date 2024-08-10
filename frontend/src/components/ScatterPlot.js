import React, { useState, useEffect } from 'react';
import axios from 'axios';
import Plot from 'react-plotly.js';
import { Table } from 'react-bootstrap';

function ScatterPlot({ draftId, isLive }) {
    const [scatterData, setScatterData] = useState(null);
    const [r2Data, setR2Data] = useState(null);

    useEffect(() => {
        const fetchScatterData = async () => {
            console.log("Fetching scatter plot data for draft ID:", draftId);

            // Bypass cache if the draft is live
            if (!isLive) {
                const cachedScatterData = localStorage.getItem(`scatterData_${draftId}`);
                const cachedR2Data = localStorage.getItem(`r2Data_${draftId}`);

                if (cachedScatterData && cachedR2Data) {
                    console.log("Loading cached scatter plot data for draft ID:", draftId);
                    setScatterData(JSON.parse(cachedScatterData));
                    setR2Data(JSON.parse(cachedR2Data));
                    return;
                }
            }

            try {
                const response = await axios.get(`/scatter_data?draft_id=${draftId}&is_live=${isLive}`);
                if (response.data) {
                    setScatterData(response.data.scatterplot);
                    setR2Data(response.data.r2_values);

                    // Cache data only if not live
                    if (!isLive) {
                        localStorage.setItem(`scatterData_${draftId}`, JSON.stringify(response.data.scatterplot));
                        localStorage.setItem(`r2Data_${draftId}`, JSON.stringify(response.data.r2_values));
                    }
                    
                    console.log("Scatter plot data loaded successfully.");
                }
            } catch (error) {
                console.error('Error fetching scatter data:', error);
            }
        };

        fetchScatterData();

        if (isLive) {
            const interval = setInterval(fetchScatterData, 10000); // Fetch new data every 10 seconds if live
            return () => clearInterval(interval); // Clear interval on component unmount or when isLive changes
        }
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
        </div>
    );
}

export default ScatterPlot;
