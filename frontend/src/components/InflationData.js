import React, { memo } from 'react';
import { Table, Alert, Spinner } from 'react-bootstrap';
import { useDataContext } from './utils/DataProvider';
import './inflation.css';

const MemoizedHeader = memo(() => (
    <div>
        <h2>Overall Inflation</h2>
    </div>
));

const InflationTable = memo(({ inflationData, getColorClass }) => (
    <div>
        {/* Overall Inflation */}
        <div className="mb-4">
            <MemoizedHeader />
            <p
                id="overall-inflation-display"
                className="inflation-percentage"
            >
                Overall Inflation: {(inflationData.overall_inflation * 100).toFixed(1)}%
            </p>
        </div>

        {/* Positional Inflation */}
        {inflationData.positional_inflation && (
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
                        {Object.keys(inflationData.positional_inflation).map((position) => (
                            <tr key={position}>
                                <td>{position}</td>
                                <td className={getColorClass(inflationData.positional_inflation[position])}>
                                    {inflationData.positional_inflation[position] !== 'N/A'
                                        ? `${(inflationData.positional_inflation[position] * 100).toFixed(1)}%`
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
                                {Object.keys(inflationData.tiered_inflation[position]).map((tier) => (
                                    <tr key={tier}>
                                        <td>{tier}</td>
                                        <td
                                            id={`${position}-${tier}-inflation`}
                                            className={getColorClass(inflationData.tiered_inflation[position]?.[tier])}
                                        >
                                            {(inflationData.tiered_inflation[position]?.[tier] * 100).toFixed(1)}%
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
));

function InflationData() {
    const { inflationData, loading, error } = useDataContext();

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
        return (
            <Alert variant="danger">
                {error} <button onClick={() => window.location.reload()}>Retry</button>
            </Alert>
        );
    }

    if (!inflationData) {
        return <div>No data available.</div>;
    }

    return (
        <div>
            <InflationTable inflationData={inflationData} getColorClass={getColorClass} />
        </div>
    );
}

export default InflationData;
