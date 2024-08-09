import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './style.css';

const TeamBreakdown = ({ draftId, isLive }) => {
    const [teamData, setTeamData] = useState(null);
    const [teamStrengths, setTeamStrengths] = useState(null);
    const [maxFontSize, setMaxFontSize] = useState("calc(10px + 0.5vw)");

    // Function to calculate team strengths and needs
    const calculateStrengthsAndNeeds = (data) => {
        const positionSpends = { QB: 0, RB: 0, WR: 0, TE: 0, DEF: 0, K: 0 };
        const strengthsAndNeeds = {};

        Object.entries(data).forEach(([teamSlot, team]) => {
            const teamSpends = { ...positionSpends };

            // Calculate spend per position
            team.starters.forEach(player => {
                if (teamSpends[player.position] !== undefined) {
                    teamSpends[player.position] += player.amount;
                }
            });

            // Compare against average spends
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

    useEffect(() => {
        const fetchTeamBreakdown = async () => {
            try {
                const response = await axios.get(`/team_breakdown?draft_id=${draftId}&is_live=${isLive}`);
                const data = response.data;

                // Calculate the longest name length
                const allNames = Object.values(data).flatMap(team =>
                    team.starters.concat(team.bench).map(player => player.name)
                );
                const longestNameLength = Math.max(...allNames.map(name => name.length));

                // Determine the appropriate font size based on the longest name length
                let calculatedFontSize = `calc(10px + ${longestNameLength > 15 ? 0.4 : 0.5}vw)`;
                setMaxFontSize(calculatedFontSize);

                // Calculate team strengths and needs
                const strengthsAndNeeds = calculateStrengthsAndNeeds(data);
                setTeamStrengths(strengthsAndNeeds);

                setTeamData(data);
            } catch (error) {
                console.error('Error fetching team breakdown:', error);
            }
        };

        fetchTeamBreakdown();

        if (isLive) {
            const interval = setInterval(fetchTeamBreakdown, 10000);
            return () => clearInterval(interval);
        }
    }, [draftId, isLive]);

    if (!teamData || !teamStrengths) {
        return <div>Loading team breakdown...</div>;
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

        let r = (num >> 16) + amount;
        if (r > 255) r = 255;
        else if (r < 0) r = 0;

        let g = ((num >> 8) & 0x00FF) + amount;
        if (g > 255) g = 255;
        else if (g < 0) g = 0;

        let b = (num & 0x0000FF) + amount;
        if (b > 255) b = 255;
        else if (b < 0) b = 0;

        return (usePound ? "#" : "") + (r << 16 | g << 8 | b).toString(16).padStart(6, '0');
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

    // Get color based on strength/need status
    const getStrengthColor = (status) => {
        if (status === "Strength") return "#32CD32"; // Green
        if (status === "Need") return "#FF6347"; // Red
        return "#FFD700"; // Yellow for Neutral
    };

    return (
        <div>
            <h2>Team Breakdown</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: '10px' }}>
                {Object.entries(teamData).map(([teamSlot, team]) => {
                    const { totalSpend, remainingBudget, starters, bench } = team;

                    return (
                        <div key={teamSlot} className="team-column">
                            <h3 className="team-header">Team {teamSlot}</h3>
                            <div><strong>Total Spend: ${totalSpend}</strong></div>
                            <div><strong>Remaining Budget: ${remainingBudget}</strong></div>
                            <div>
                                <>Needs:</>
                                <div>
                                    {Object.entries(teamStrengths[teamSlot]).map(([position, status]) => (
                                        <div 
                                            key={position} 
                                            style={{ color: getStrengthColor(status), fontWeight: 'bold' }}
                                        >
                                            {position}: {status}
                                        </div>
                                    ))}
                                </div>
                            </div>
                            <div style={{ display: 'grid', gridTemplateRows: 'repeat(16, 1fr)', gap: '5px' }}>
                                {starters.map((player, index) => {
                                    const backgroundColor = getColorByPositionAndSpend(player.position, player.amount);

                                    return (
                                        <div 
                                            key={index} 
                                            className="player-card"
                                            style={{ backgroundColor, fontSize: maxFontSize }}
                                        >
                                            <div style={{ 
                                                overflow: 'hidden', 
                                                textOverflow: 'ellipsis', 
                                                whiteSpace: 'nowrap' 
                                            }}>
                                                {player.name}
                                            </div>
                                            <div>${player.amount}</div>
                                        </div>
                                    );
                                })}
                                <div className="bench-header">Bench</div>
                                {bench.map((player, index) => {
                                    const backgroundColor = getColorByPositionAndSpend(player.position, player.amount);

                                    return (
                                        <div 
                                            key={index} 
                                            className="player-card"
                                            style={{ backgroundColor, fontSize: maxFontSize }}
                                        >
                                            <div style={{ 
                                                overflow: 'hidden', 
                                                textOverflow: 'ellipsis', 
                                                whiteSpace: 'nowrap' 
                                            }}>
                                                {player.name}
                                            </div>
                                            <div>${player.amount}</div>
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
