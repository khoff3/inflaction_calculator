import React, { useState, useEffect } from 'react';
import axios from 'axios';

const TeamBreakdown = ({ draftId }) => {
    const [draftData, setDraftData] = useState([]);
    const [rosterData, setRosterData] = useState({
        QB: 0, RB: 0, WR: 0, TE: 0, Flex: 0, DEF: 0, Kicker: 0, Bench: 0
    });
    const [totalSpend, setTotalSpend] = useState(0);
    const [budgetLimit] = useState(200);

    useEffect(() => {
        const fetchDraftData = async () => {
            try {
                const response = await axios.get(`https://api.sleeper.app/v1/draft/${draftId}/picks`);
                setDraftData(response.data);
                processDraftData(response.data);
            } catch (error) {
                console.error('Error fetching draft data:', error);
            }
        };

        fetchDraftData();
    }, [draftId]);

    const processDraftData = (data) => {
        let spend = 0;
        const positionCounts = {
            QB: 0, RB: 0, WR: 0, TE: 0, Flex: 0, DEF: 0, Kicker: 0, Bench: 0
        };

        data.forEach((pick) => {
            const player = pick.player;
            const position = player.position;
            const value = player.Value; // Assuming Value is the spend amount

            spend += value;
            if (position === 'QB') positionCounts.QB += 1;
            else if (position === 'RB') positionCounts.RB += 1;
            else if (position === 'WR') positionCounts.WR += 1;
            else if (position === 'TE') positionCounts.TE += 1;
            else if (position === 'DEF') positionCounts.DEF += 1;
            else if (position === 'K') positionCounts.Kicker += 1;
            else positionCounts.Bench += 1;
        });

        positionCounts.Flex = Math.min(positionCounts.RB + positionCounts.WR + positionCounts.TE, 1);
        setRosterData(positionCounts);
        setTotalSpend(spend);
    };

    const remainingBudget = budgetLimit - totalSpend;
    const remainingPositions = {
        QB: Math.max(0, 1 - rosterData.QB),
        RB: Math.max(0, 2 - rosterData.RB),
        WR: Math.max(0, 3 - rosterData.WR),
        TE: Math.max(0, 1 - rosterData.TE),
        Flex: Math.max(0, 1 - rosterData.Flex),
        DEF: Math.max(0, 1 - rosterData.DEF),
        Kicker: Math.max(0, 1 - rosterData.Kicker),
        Bench: Math.max(0, 6 - rosterData.Bench)
    };

    return (
        <div>
            <h2>Team Level Breakdown</h2>
            <p>Total Spend: ${totalSpend}</p>
            <p>Remaining Budget: ${remainingBudget}</p>
            <h3>Roster</h3>
            <table>
                <thead>
                    <tr>
                        <th>Position</th>
                        <th>Count</th>
                        <th>Need</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>QB</td>
                        <td>{rosterData.QB}</td>
                        <td>{remainingPositions.QB}</td>
                    </tr>
                    <tr>
                        <td>RB</td>
                        <td>{rosterData.RB}</td>
                        <td>{remainingPositions.RB}</td>
                    </tr>
                    <tr>
                        <td>WR</td>
                        <td>{rosterData.WR}</td>
                        <td>{remainingPositions.WR}</td>
                    </tr>
                    <tr>
                        <td>TE</td>
                        <td>{rosterData.TE}</td>
                        <td>{remainingPositions.TE}</td>
                    </tr>
                    <tr>
                        <td>Flex</td>
                        <td>{rosterData.Flex}</td>
                        <td>{remainingPositions.Flex}</td>
                    </tr>
                    <tr>
                        <td>DEF</td>
                        <td>{rosterData.DEF}</td>
                        <td>{remainingPositions.DEF}</td>
                    </tr>
                    <tr>
                        <td>Kicker</td>
                        <td>{rosterData.Kicker}</td>
                        <td>{remainingPositions.Kicker}</td>
                    </tr>
                    <tr>
                        <td>Bench</td>
     
