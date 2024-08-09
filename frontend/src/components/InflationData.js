import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { Table, Alert, Spinner } from 'react-bootstrap';

function InflationData({ draftId, liveUpdate }) {
  const [inflationData, setInflationData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fetchInflationData = async () => {
        if (!draftId) {
          console.warn("Draft ID is missing, skipping fetch.");
          return;
        }
      
        console.log(`Fetching inflation data for draft ID: ${draftId}`);
        setLoading(true);
        setError(null);
      
        try {
          // Create a FormData object
          const formData = new FormData();
          formData.append('draft_id', draftId);
      
          // Send the request using axios
          const response = await axios.post(
            'http://localhost:5050/inflation',
            formData,
            {
              headers: {
                'Content-Type': 'multipart/form-data',  // Ensure correct content type
              },
            }
          );
      
          if (response.headers['content-type'] && response.headers['content-type'].includes('application/json')) {
            console.log('Inflation data fetched successfully:', response.data);
            setInflationData(response.data);
          } else {
            console.error('Received HTML instead of JSON. Possible routing issue.');
            setError('Received HTML instead of JSON. Possible routing issue.');
          }
      
        } catch (error) {
          console.error('Error fetching inflation data:', error);
          setError('Error fetching inflation data');
        } finally {
          setLoading(false);
        }
      };
      

    fetchInflationData();

    if (liveUpdate) {
      console.log('Live update is enabled. Setting up interval.');
      const interval = setInterval(fetchInflationData, 10000);
      return () => {
        console.log('Clearing interval for live updates.');
        clearInterval(interval);
      };
    }
  }, [draftId, liveUpdate]);

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
    console.log('Loading inflation data...');
    return <Spinner animation="border" />;
  }

  if (error) {
    console.error('Displaying error alert:', error);
    return <Alert variant="danger">{error}</Alert>;
  }

  if (!inflationData) {
    console.log('No inflation data available.');
    return <div>No data available.</div>;
  }

  console.log('Rendering inflation data to the UI.');

  return (
    <div>
      <h2>Overall Inflation</h2>
      <p id="overall-inflation-display">
        Overall Inflation: {(inflationData.overall_inflation * 100).toFixed(2)}%
      </p>
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
              <td>{inflationData.total_picks[position]}</td>
            </tr>
          ))}
        </tbody>
      </Table>
      <h2>Tiered Inflation</h2>
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
                      className={getColorClass(inflationData.tiered_inflation[position][tier])}
                    >
                      {(inflationData.tiered_inflation[position][tier] * 100).toFixed(2)}%
                    </td>
                    <td id={`${position}-${tier}-picks`}>
                      {inflationData.picks_per_tier[position]?.[tier] || '0'}
                    </td>
                    <td
                      id={`${position}-${tier}-doe`}
                      className={getColorClass(inflationData.doe_values[position]?.[tier] || 0)}
                    >
                      ${inflationData.doe_values[position]?.[tier].toFixed(2)}
                    </td>
                    <td id={`${position}-${tier}-avg_cost`}>
                      ${inflationData.avg_tier_costs[position]?.[tier].toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        ))}
      </div>
    </div>
  );
}

export default InflationData;