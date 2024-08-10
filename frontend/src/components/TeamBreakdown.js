import React, { useState, useEffect } from 'react';
import './style.css';
import apiClient from './utils/apiClient';

const TeamBreakdown = ({ draftId, isLive, draftOrder }) => {
    const [teamData, setTeamData] = useState(null);
    const [teamStrengths, setTeamStrengths] = useState(null);
    const [showStrengths, setShowStrengths] = useState(true);
    const [showNeeds, setShowNeeds] = useState(true);
    const [showNeutral, setShowNeutral] = useState(true);
    const [zoomLevel, setZoomLevel] = useState(1);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(false);

    const calculateStrengthsAndNeeds = (data) => {
        if (!data) return {};
        const positionSpends = { QB: 0, RB: 0, WR: 0, TE: 0, DEF: 0, K: 0 };
        const strengthsAndNeeds = {};

        Object.entries(data).forEach(([teamSlot, team]) => {
            const teamSpends = { ...positionSpends };

            team.starters.forEach(player => {
                if (teamSpends[player.position] !== undefined) {
                    teamSpends[player.position] += player.amount;
                }
            });

            const totalTeams = Object.keys(data).length;
            Object.keys(teamSpends).forEach(position => {
                const avgSpend = Object.values(data).reduce((acc, team) => {
                    const positionSpend = team.starters
                        .filter(player => player.position === position)
                        .reduce((sum, player) => sum + player.amount, 0);
                    return acc + positionSpend / totalTeams;
                }, 0);

                if (teamSpends[position] > avgSpend * 1.2) {
                    strengthsAndNeeds[teamSlot] = { ...strengthsAndNeeds[teamSlot], [position]: 'Strength' };
                } else if (teamSpends[position] < avgSpend * 0.8) {
                    strengthsAndNeeds[teamSlot] = { ...strengthsAndNeeds[teamSlot], [position]: 'Need' };
                } else {
                    strengthsAndNeeds[teamSlot] = { ...strengthsAndNeeds[teamSlot], [position]: 'Neutral' };
                }
            });
        });

        return strengthsAndNeeds;
    };

    const calculateBudgetLeft = (remainingBudget) => {
        const symbols = Math.ceil(remainingBudget / 40);
        return '💵'.repeat(symbols > 5 ? 5 : symbols) + '⚠️'.repeat(5 - symbols);
    };

    const ensureStartingPositions = (starters) => {
        const positionsNeeded = ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'Flex', 'DEF', 'K'];
        const fullStarters = positionsNeeded.map(position => {
            const player = starters.find(player => player.position === position);
            if (player) {
                starters = starters.filter(p => p !== player);
                return player;
            } else {
                return { name: '', position, amount: 0 }; // Placeholder for open slot
            }
        });

        return fullStarters;
    };

    const fillBenchSpots = (bench) => {
        const maxBenchSpots = 6; 
        const filledBench = bench.slice(0, maxBenchSpots); 

        while (filledBench.length < maxBenchSpots) {
            filledBench.push({ name: '', position: 'Bench', amount: 0 }); 
        }

        return filledBench;
    };
    useEffect(() => {
        const fetchTeamBreakdown = async () => {
            if (draftOrder.length !== 12 || draftOrder.includes('')) {
                console.warn("Draft order is not fully populated, skipping fetch.");
                return;
            }
    
            console.log("Fetching team breakdown for draft ID:", draftId);
            console.log("Using draft order:", draftOrder);
    
            if (!draftId) {
                console.warn("Draft ID is missing, skipping fetch.");
                return;
            }
    
            setLoading(true);
            setError(null);
    
            try {
                // Force an API call if live mode is enabled
                const response = await apiClient.get(`/team_breakdown?draft_id=${draftId}&is_live=${isLive}`);
                const data = response.data;  // Use the data from the response
    
                const allTeams = {};
                for (let i = 1; i <= 12; i++) {
                    allTeams[i] = {
                        teamName: draftOrder[i - 1] || `Team ${i}`,
                        totalSpend: data[i]?.totalSpend || 0,
                        remainingBudget: data[i]?.remainingBudget || 200,
                        starters: data[i]?.starters || [],
                        bench: data[i]?.bench || [],
                    };
                }
    
                console.log("Final team assignments with names:", allTeams);
    
                const strengthsAndNeeds = calculateStrengthsAndNeeds(allTeams);
                setTeamStrengths(strengthsAndNeeds);
    
                if (!isLive) {
                    localStorage.setItem(`teamStrengths_${draftId}`, JSON.stringify(strengthsAndNeeds));
                    localStorage.setItem(`teamData_${draftId}`, JSON.stringify(allTeams));
                }
    
                Object.values(allTeams).forEach(team => {
                    team.starters = ensureStartingPositions(team.starters);
                    team.bench = fillBenchSpots(team.bench);
                });
    
                setTeamData(allTeams);
                console.log("Team breakdown loaded successfully:", allTeams);
            } catch (error) {
                console.error('Error fetching team breakdown:', error);
                setError('Failed to load team data. Please try again later.');
            } finally {
                setLoading(false);
            }
        };
    
        fetchTeamBreakdown();
    
        if (isLive) {
            const interval = setInterval(fetchTeamBreakdown, 10000); // Update every 10 seconds if live
            return () => clearInterval(interval);
        }
    }, [draftId, isLive, draftOrder]);
    
    
    const handleZoomIn = () => {
        setZoomLevel(prevZoom => Math.min(prevZoom + 0.1, 2)); 
    };

    const handleZoomOut = () => {
        setZoomLevel(prevZoom => Math.max(prevZoom - 0.1, 0.5)); 
    };

    if (loading && !teamData) {
        return <div>Loading team breakdown...</div>;
    }

    if (error) {
        return <div>{error}</div>;
    }

    const baseColors = {
        QB: "#1E90FF", 
        RB: "#32CD32", 
        WR: "#FF8C00", 
        TE: "#8A2BE2", 
        DEF: "#696969", 
        K: "#FFD700",
    };

    const adjustColorBrightness = (color, amount) => {
        const usePound = color[0] === "#";
        let num = parseInt(color.slice(1), 16);

        let r = ((num >> 16) + amount);
        if (r > 255) r = 255;
        else if (r < 0) r = 0;

        let g = (((num >> 8) & 0x00FF) + amount);
        if (g > 255) g = 255;
        else if (g < 0) g = 0;

        let b = ((num & 0x0000FF) + amount);
        if (b > 255) b = 255;
        else if (b < 0) b = 0;

        return (usePound ? "#" : "") + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
    };

    const getColorByPositionAndSpend = (position, amount) => {
        const baseColor = baseColors[position] || "#FFFFFF";
        let brightnessAdjustment = 0;

        if (amount > 50) brightnessAdjustment = 40;
        else if (amount > 40) brightnessAdjustment = 30;
        else if (amount > 30) brightnessAdjustment = 20;
        else if (amount > 20) brightnessAdjustment = 10;
        else if (amount > 10) brightnessAdjustment = 0;
        else brightnessAdjustment = -10;

        return adjustColorBrightness(baseColor, brightnessAdjustment);
    };

    const getStrengthEmoji = (status) => {
        if (status === "Strength") return "🟢";
        if (status === "Need") return "⭕";
        return "🚧";
    };

    const filterStrengthsAndNeeds = (status) => {
        if (status === "Strength" && showStrengths) return true;
        if (status === "Need" && showNeeds) return true;
        if (status === "Neutral" && showNeutral) return true;
        return false;
    };

    return (
        <div className="team-breakdown-container">
            <h2>Team Breakdown</h2>
            <div className="zoom-controls">
                <button className="zoom-out" onClick={handleZoomOut}>-</button>
                <button className="zoom-in" onClick={handleZoomIn}>+</button>
            </div>
            <div className="checkbox-container">
                <label>
                    <input type="checkbox" checked={showStrengths} onChange={(e) => setShowStrengths(e.target.checked)} />
                    Show Strengths
                </label>
                <label>
                    <input type="checkbox" checked={showNeeds} onChange={(e) => setShowNeeds(e.target.checked)} />
                    Show Needs
                </label>
                <label>
                    <input type="checkbox" checked={showNeutral} onChange={(e) => setShowNeutral(e.target.checked)} />
                    Show Neutral
                </label>
            </div>
            <div className="grid-container" style={{ transform: `scale(${zoomLevel})` }}>
                {teamData && Object.entries(teamData).map(([teamSlot, team]) => {
                    if (!team) {
                        console.warn(`Team data missing for slot ${teamSlot}`);
                        return null;
                    }

                    const { teamName, totalSpend, remainingBudget, starters = [], bench = [] } = team;

                    return (
                        <div key={teamSlot} className="team-column">
                            <h3 className="team-header">{teamName || `Team ${teamSlot}`}</h3>
                            <div className="team-stats">
                                <div className="money"><strong>Spend:</strong> ${totalSpend}</div>
                                <div className="money"><strong>Budget:</strong> ${remainingBudget}</div>
                                <div className="money">{calculateBudgetLeft(remainingBudget)}</div>
                            </div>
                            <div className="position-grid">
                                <div className="position-labels">
                                    <div>QB</div>
                                    <div>RB</div>
                                    <div>WR</div>
                                    <div>TE</div>
                                </div>
                                <div className="position-emojis">
                                    <div>{filterStrengthsAndNeeds(teamStrengths?.[teamSlot]?.QB) ? getStrengthEmoji(teamStrengths[teamSlot]?.QB) : ''}</div>
                                    <div>{filterStrengthsAndNeeds(teamStrengths?.[teamSlot]?.RB) ? getStrengthEmoji(teamStrengths[teamSlot]?.RB) : ''}</div>
                                    <div>{filterStrengthsAndNeeds(teamStrengths?.[teamSlot]?.WR) ? getStrengthEmoji(teamStrengths[teamSlot]?.WR) : ''}</div>
                                    <div>{filterStrengthsAndNeeds(teamStrengths?.[teamSlot]?.TE) ? getStrengthEmoji(teamStrengths[teamSlot]?.TE) : ''}</div>
                                </div>
                            </div>
                            <div className="player-card-container">
                                {starters.map((player, index) => {
                                    const backgroundColor = player?.name ? getColorByPositionAndSpend(player.position, player.amount) : 'transparent';

                                    return (
                                        <div 
                                            key={index} 
                                            className="player-card"
                                            style={{ backgroundColor }}
                                        >
                                            <div className="player-name">
                                                {player?.name || ' '}
                                            </div>
                                            <div className="player-amount">
                                                {player?.name ? `$${player.amount}` : ''}
                                            </div>
                                        </div>
                                    );
                                })}
                                <div className="bench-header">Bench</div>
                                {bench.map((player, index) => {
                                    const backgroundColor = player?.name ? getColorByPositionAndSpend(player.position, player.amount) : 'transparent';

                                    return (
                                        <div 
                                            key={index} 
                                            className="player-card"
                                            style={{ backgroundColor }}
                                        >
                                            <div className="player-name">
                                                {player?.name || ' '}
                                            </div>
                                            <div className="player-amount">
                                                {player?.name ? `$${player.amount}` : ''}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );    
};

export default TeamBreakdown;
