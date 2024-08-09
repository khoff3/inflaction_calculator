import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { Table, Alert, Spinner } from 'react-bootstrap';

function InflationData({ draftId, isLive }) {
    const [inflationData, setInflationData] = useState(null);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        const fetchInflationData = async () => {
            if (!draftId) {
                console.warn("Draft ID is missing, skipping fetch.");
                return;
            }

            setLoading(true);
            setError(null);

            try {
                const formData = new FormData();
                formData.append('draft_id', draftId);

                const response = await axios.post('/inflation', formData, {
                    headers: {
                        'Content-Type': 'multipart/form-data',
                    },
                });

                if (response.data) {
                    setInflationData(response.data);
                } else {
                    setError('No data found');
                }
            } catch (error) {
                console.error('Error fetching inflation data:', error);
                setError('Failed to fetch inflation data');
            } finally {
                setLoading(false);
            }
        };

        fetchInflationData();

        if (isLive) {
            const interval = setInterval(fetchInflationData, 10000);
            return () => clearInterval(interval);
        }
    }, [draftId, isLive]);

    const getColorClass = (value) => {
        if (value > 0.15) return 'severe-positive';
        if (value > 0.1) return 'moderate-positive';
        if (value > 0.05) return 'mild-positive';
        if (value < -0.15) return 'severe-negative';
        if (value < -0.1) return 'moderate-negative';
        if (value < -0.05) return 'mild-negative';
        return 'neutral';
    };

    if (loading) {
        return <Spinner animation="border" />;
    }

    if (error) {
        return <Alert variant="danger">{error}</Alert>;
    }

    if (!inflationData) {
        return <div>No data available.</div>;
    }

    return (
        <div>
            {/* Overall Inflation */}
            <div>
                <h2>Overall Inflation</h2>
                <p id="overall-inflation-display" className={getColorClass(inflationData.overall_inflation)}>
                    Overall Inflation: {(inflationData.overall_inflation * 100).toFixed(2)}%
                </p>
            </div>

            {/* Positional Inflation */}
            {inflationData.positional_inflation && (
                <div>
                    <h2>Positional Inflation</h2>
                    <Table>
                        <thead>
                            <tr>
                                <th>Position</th>
                                <th>Inflation (%)</th>
                                <th>Number of Picks</th>
                            </tr>
                        </thead>
                        <tbody>
                            {Object.keys(inflationData.positional_inflation).map((position) => (
                                <tr key={position}>
                                    <td>{position}</td>
                                    <td className={getColorClass(inflationData.positional_inflation[position])}>
                                        {inflationData.positional_inflation[position] !== 'N/A'
                                            ? `${(inflationData.positional_inflation[position] * 100).toFixed(2)}%`
                                            : 'N/A'}
                                    </td>
                                    <td>{inflationData.total_picks?.[position] || '0'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </Table>
                </div>
            )}

            {/* Tiered Inflation */}
            {inflationData.tiered_inflation && (
                <div className="tiered-inflation">
                    {Object.keys(inflationData.tiered_inflation).map((position) => (
                        <div key={position}>
                            <h3>{position.toUpperCase()}</h3>
                            <Table>
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
                                    {Object.keys(inflationData.tiered_inflation[position]).map((tier) => (
                                        <tr key={tier}>
                                            <td>{tier}</td>
                                            <td
                                                id={`${position}-${tier}-inflation`}
                                                className={getColorClass(inflationData.tiered_inflation[position]?.[tier])}
                                            >
                                                {(inflationData.tiered_inflation[position]?.[tier] * 100).toFixed(2)}%
                                            </td>
                                            <td id={`${position}-${tier}-picks`}>
                                                {inflationData.picks_per_tier?.[position]?.[tier] || '0'}
                                            </td>
                                            <td
                                                id={`${position}-${tier}-doe`}
                                                className={getColorClass(inflationData.doe_values?.[position]?.[tier] || 0)}
                                            >
                                                ${parseFloat(inflationData.doe_values?.[position]?.[tier] || 0).toFixed(2)}
                                            </td>
                                            <td id={`${position}-${tier}-avg_cost`}>
                                                ${parseFloat(inflationData.avg_tier_costs?.[position]?.[tier] || 0).toFixed(2)}
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
}

export default InflationData;
