import React, { useState, useEffect } from 'react';
import './ticker.css'; // Ensure you have appropriate styling for the Ticker
import axios from 'axios';

const Ticker = ({ draftId, draftOrder }) => {
    const [picks, setPicks] = useState([]);
    const [visiblePicks, setVisiblePicks] = useState([]);
    const [showMore, setShowMore] = useState(false);
    const [inflationData, setInflationData] = useState(null);

    useEffect(() => {
        const fetchPicks = async () => {
            try {
                const response = await axios.get(`http://localhost:5050/picks?draft_id=${draftId}`);
                const sortedPicks = response.data.sort((a, b) => b.pick_no - a.pick_no); // Sort by pick_no descending
                setPicks(sortedPicks);
                setVisiblePicks(sortedPicks.slice(0, 5)); // Show only 5 by default
            } catch (error) {
                console.error("Failed to fetch picks data:", error);
            }
        };

        const fetchInflationData = async () => {
            try {
                const response = await axios.post('http://localhost:5050/inflation', { draft_id: draftId });
                setInflationData(response.data);
            } catch (error) {
                console.error("Failed to fetch inflation data:", error);
            }
        };

        fetchPicks();
        fetchInflationData();
    }, [draftId]);

    const handleShowMore = () => {
        if (showMore) {
            setVisiblePicks(picks.slice(0, 5)); // Show only 5 when toggling off
        } else {
            setVisiblePicks(picks); // Show all picks when toggling on
        }
        setShowMore(!showMore); // Toggle showMore state
    };

    const computeExpectedValues = (pick) => {
        if (!inflationData) return { expectedValue: 'N/A', doe: 'N/A', inflationPercent: 'N/A' };
    
        const playerName = `${pick.metadata.first_name} ${pick.metadata.last_name}`;
        const expectedValueData = inflationData.player_values?.[playerName] || { value: 'N/A', tier: 'N/A' };
    
        let doe = 'N/A';
        let inflationPercent = 'N/A';
    
        if (expectedValueData.value !== 'N/A' && expectedValueData.value > 0) {
            doe = (pick.metadata.amount - expectedValueData.value).toFixed(2);
            inflationPercent = ((doe / expectedValueData.value) * 100).toFixed(2);
        }
    
        // Log data for debugging
        console.log(`Player: ${playerName}, Amount: ${pick.metadata.amount}, Expected Value: ${expectedValueData.value}`);
    
        return { expectedValue: expectedValueData.value, doe, inflationPercent };
    };
    

    return (
        <div className="ticker-container">
            <table className="ticker-table">
                <thead>
                    <tr>
                        <th>Team</th>
                        <th>Player</th>
                        <th>Price</th>
                        <th>Expected Price</th>
                        <th>DOE</th>
                        <th>Inflation %</th>
                    </tr>
                </thead>
                <tbody>
                    {visiblePicks.map((pick, index) => {
                        const teamName = (draftOrder && draftOrder[pick.draft_slot - 1])
                            ? draftOrder[pick.draft_slot - 1]
                            : `Team ${pick.draft_slot}`;
                        const { expectedValue, doe, inflationPercent } = computeExpectedValues(pick);

                        return (
                            <tr key={index}>
                                <td>{teamName}</td>
                                <td>{pick.metadata.first_name} {pick.metadata.last_name}</td>
                                <td>${pick.metadata.amount}</td>
                                <td>${expectedValue}</td>
                                <td>{doe}</td>
                                <td>{inflationPercent}%</td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
            <button onClick={handleShowMore}>
                {showMore ? 'Show Less' : 'Show More'}
            </button>
        </div>
    );
};

export default Ticker;
