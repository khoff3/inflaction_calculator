import React, { useState, useEffect } from 'react';
import dataService from './utils/DataService';
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
        const percentage = Math.max(0, (remainingBudget / 200) * 100); // Ensure non-negative
        const filledBars = Math.ceil(percentage / 20); // 5 bars total
        const emptyBars = Math.max(0, 5 - filledBars);
        
        return {
            filled: Math.min(5, filledBars), // Cap at 5
            empty: emptyBars,
            percentage: Math.round(percentage)
        };
    };

    const assignFlexPosition = (players) => {
        // Separate players by position
        const byPosition = {
            QB: players.filter(p => p.position === 'QB').sort((a, b) => b.amount - a.amount),
            RB: players.filter(p => p.position === 'RB').sort((a, b) => b.amount - a.amount),
            WR: players.filter(p => p.position === 'WR').sort((a, b) => b.amount - a.amount),
            TE: players.filter(p => p.position === 'TE').sort((a, b) => b.amount - a.amount),
            K: players.filter(p => p.position === 'K').sort((a, b) => b.amount - a.amount),
            DEF: players.filter(p => p.position === 'DEF').sort((a, b) => b.amount - a.amount)
        };

        // Fill required starting positions first: 1 QB, 2 RB, 3 WR, 1 TE, 1 K, 1 DEF
        const starters = [
            ...byPosition.QB.slice(0, 1),     // 1 QB
            ...byPosition.RB.slice(0, 2),     // 2 RB  
            ...byPosition.WR.slice(0, 3),     // 3 WR
            ...byPosition.TE.slice(0, 1),     // 1 TE
            ...byPosition.K.slice(0, 1),      // 1 K
            ...byPosition.DEF.slice(0, 1)     // 1 DEF
        ];

        // Find remaining flex-eligible players (RB, WR, TE after minimums filled)
        const flexCandidates = [
            ...byPosition.RB.slice(2),        // Extra RBs
            ...byPosition.WR.slice(3),        // Extra WRs  
            ...byPosition.TE.slice(1)         // Extra TEs
        ].sort((a, b) => {
            // Sort by amount descending, then by draft order (assuming lower pick numbers = earlier)
            if (b.amount !== a.amount) return b.amount - a.amount;
            return (a.pick_no || 999) - (b.pick_no || 999); // Earlier pick wins ties
        });

        // Assign highest spending flex candidate
        if (flexCandidates.length > 0) {
            const flexPlayer = { ...flexCandidates[0], position: 'Flex', originalPosition: flexCandidates[0].position };
            starters.push(flexPlayer);

            // Return all players with flex assignment
            return players.map(player => {
                if (player === flexCandidates[0]) {
                    return flexPlayer;
                }
                return player;
            });
        }

        return players;
    };

    const ensureStartingPositions = (starters) => {
        // First, assign flex position intelligently
        const playersWithFlex = assignFlexPosition(starters);
        
        const positionsNeeded = ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'Flex', 'K', 'DEF'];
        const fullStarters = [];
        let remainingPlayers = [...playersWithFlex];

        positionsNeeded.forEach(neededPosition => {
            const playerIndex = remainingPlayers.findIndex(player => 
                player.position === neededPosition
            );
            
            if (playerIndex !== -1) {
                const player = remainingPlayers[playerIndex];
                fullStarters.push(player);
                remainingPlayers.splice(playerIndex, 1);
            } else {
                // Add empty slot
                fullStarters.push({ 
                    name: '', 
                    position: neededPosition, 
                    amount: 0,
                    isEmpty: true 
                });
            }
        });

        return fullStarters;
    };

    const fillBenchSpots = (bench) => {
        const maxBenchSpots = 6; 
        const filledBench = bench.slice(0, maxBenchSpots); 

        while (filledBench.length < maxBenchSpots) {
            filledBench.push({ 
                name: '', 
                position: 'Bench', 
                amount: 0,
                isEmpty: true 
            }); 
        }

        return filledBench;
    };

    const calculateCorrectBudget = (teamData) => {
        // Calculate actual spend and remaining budget
        const totalSpent = [...teamData.starters, ...teamData.bench]
            .reduce((sum, player) => sum + (player.amount || 0), 0);
        
        return {
            totalSpend: totalSpent,
            remainingBudget: Math.max(0, 200 - totalSpent) // Ensure non-negative
        };
    };

    useEffect(() => {
        const fetchTeamBreakdown = async () => {
            console.log("Fetching team breakdown for draft ID:", draftId);
            console.log("Using draft order:", draftOrder);
    
            if (!draftId) {
                console.warn("Draft ID is missing, skipping fetch.");
                return;
            }
    
            setLoading(true);
            setError(null);
    
            try {
                const response = await apiClient.get(`/team_breakdown?draft_id=${draftId}&is_live=${isLive}`);
                const data = response.data;
    
                const allTeams = {};
                for (let i = 1; i <= 12; i++) {
                    const rawTeamData = data[i] || { starters: [], bench: [] };
                    
                    // Calculate correct budget
                    const budgetInfo = calculateCorrectBudget(rawTeamData);
                    
                    allTeams[i] = {
                        teamName: draftOrder[i - 1] || `Team ${i}`,
                        totalSpend: budgetInfo.totalSpend,
                        remainingBudget: budgetInfo.remainingBudget,
                        starters: rawTeamData.starters || [],
                        bench: rawTeamData.bench || [],
                    };
                }
    
                console.log("Final team assignments with corrected budgets:", allTeams);
    
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
    
        const componentId = `teambreakdown-${draftId}`;
        
        // Subscribe to data updates
        const unsubscribe = dataService.subscribe(componentId, (data) => {
            if (data.picks) {
                fetchTeamBreakdown();
            }
        });

        // Start polling through the service
        dataService.startPolling(draftId, isLive);

        // Cleanup
        return () => {
            unsubscribe();
        };
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
        QB: "#8A2BE2",  // Purple
        RB: "#32CD32",  // Green
        WR: "#FF8C00",  // Orange
        TE: "#1E90FF",  // Blue
        K: "#FFD700",   // Gold
        DEF: "#696969", // Gray
        Flex: "#FF69B4" // Pink for flex
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

    const getStrengthIndicator = (status) => {
        if (status === "Strength") return { symbol: "▲", color: "#22c55e", label: "Strength" };
        if (status === "Need") return { symbol: "▼", color: "#ef4444", label: "Need" };
        return { symbol: "●", color: "#6b7280", label: "Neutral" };
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
            <div className="legend-container">
                <div className="legend-item">
                    <span className="indicator-symbol" style={{ color: "#22c55e" }}>▲</span>
                    <span>Strength</span>
                </div>
                <div className="legend-item">
                    <span className="indicator-symbol" style={{ color: "#ef4444" }}>▼</span>
                    <span>Need</span>
                </div>
                <div className="legend-item">
                    <span className="indicator-symbol" style={{ color: "#6b7280" }}>●</span>
                    <span>Neutral</span>
                </div>
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
                                <div className="budget-visual">
                                    {(() => {
                                        const budget = calculateBudgetLeft(remainingBudget);
                                        return (
                                            <div className="budget-bars">
                                                <div className="budget-label">Budget: {budget.percentage}%</div>
                                                <div className="budget-bar-container">
                                                    {[...Array(budget.filled)].map((_, i) => (
                                                        <div key={`filled-${i}`} className="budget-bar filled"></div>
                                                    ))}
                                                    {[...Array(budget.empty)].map((_, i) => (
                                                        <div key={`empty-${i}`} className="budget-bar empty"></div>
                                                    ))}
                                                </div>
                                            </div>
                                        );
                                    })()}
                                </div>
                            </div>
                            <div className="position-grid">
                                <div className="position-labels">
                                    <div>QB</div>
                                    <div>RB</div>
                                    <div>WR</div>
                                    <div>TE</div>
                                </div>
                                <div className="position-indicators">
                                    {['QB', 'RB', 'WR', 'TE'].map(position => {
                                        const status = teamStrengths?.[teamSlot]?.[position];
                                        const indicator = getStrengthIndicator(status);
                                        
                                        if (!filterStrengthsAndNeeds(status)) return <div key={position}></div>;
                                        
                                        return (
                                            <div key={position} className="strength-indicator" title={indicator.label}>
                                                <span 
                                                    className="indicator-symbol"
                                                    style={{ color: indicator.color }}
                                                >
                                                    {indicator.symbol}
                                                </span>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                            <div className="player-card-container">
                                {starters.map((player, index) => {
                                    const backgroundColor = player?.name ? getColorByPositionAndSpend(player.originalPosition || player.position, player.amount) : 'transparent';

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
                                                {player?.name ? `${player.amount}` : ''}
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
                                                {player?.name ? `${player.amount}` : ''}
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