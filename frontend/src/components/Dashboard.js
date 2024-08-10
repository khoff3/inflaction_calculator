import React, { useState, useEffect } from 'react';
import ScatterPlot from './ScatterPlot';
import InflationData from './InflationData';
import TeamBreakdown from './TeamBreakdown';
import Ticker from './Ticker';
import axios from 'axios'; // Add this import

function Dashboard() {
    const draftIdFromUrl = new URLSearchParams(window.location.search).get('draft_id');
    const isLiveFromUrl = new URLSearchParams(window.location.search).get('is_live') === 'true';
    const [draftId, setDraftId] = useState(draftIdFromUrl || '');
    const [isLocked, setIsLocked] = useState(true); // Lock draft ID by default
    const [activeTab, setActiveTab] = useState('scatter');
    const [isLive, setIsLive] = useState(isLiveFromUrl); // Track whether the draft is live or not
    const [draftOrder, setDraftOrder] = useState(''); // State to hold draft order input
    const [parsedDraftOrder, setParsedDraftOrder] = useState([]); // Holds the parsed array of names
    const [picks, setPicks] = useState([]); // State to hold fetched picks

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        if (draftId) {
            params.set('draft_id', draftId);
        }
        params.set('is_live', isLive);
        window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);
    }, [draftId, isLive]);

    useEffect(() => {
        if (draftId) {
            const fetchPicks = async () => {
                try {
                    const response = await axios.get(`http://localhost:5050/picks?draft_id=${draftId}`);
                    setPicks(response.data);
                } catch (error) {
                    console.error("Failed to fetch picks data:", error);
                }
            };
            fetchPicks();
        }
    }, [draftId]); // Fetch picks whenever draftId changes

    const handleLiveToggle = () => {
        setIsLive(prevIsLive => !prevIsLive);
    };

    const handleUnlockDraftId = () => {
        setIsLocked(!isLocked); // Toggle lock state
        if (isLocked) {
            console.log('Draft ID is now locked and active:', draftId);
        }
    };

    const handleDraftOrderChange = (event) => {
        setDraftOrder(event.target.value);
    };

    const handleDraftOrderSubmit = () => {
        const draftOrderArray = draftOrder
            .split(',')
            .map(name => name.trim()); // Split by commas and trim spaces
    
        setParsedDraftOrder(draftOrderArray); // Store the parsed array
        console.log('Draft Order:', draftOrderArray);
    };    

    const handleDraftIdSubmit = () => {
        console.log('Draft ID submitted:', draftId);
    };

    return (
        <div>
            <h1>Ctrl Brd</h1>

            <div>
                <label>
                    Draft ID:
                    <input
                        type="text"
                        value={draftId}
                        onChange={(e) => setDraftId(e.target.value)}
                        disabled={isLocked}
                    />
                </label>
                <button onClick={handleUnlockDraftId}>
                    {isLocked ? 'Unlock' : 'Lock'}
                </button>
                {!isLocked && (
                    <button onClick={handleDraftIdSubmit}>
                        Submit Draft ID
                    </button>
                )}
            </div>

            <div>
                <label>
                    Draft Order (comma-separated names):
                    <input
                        type="text"
                        value={draftOrder}
                        onChange={handleDraftOrderChange}
                    />
                </label>
                <button onClick={handleDraftOrderSubmit}>Submit Draft Order</button>
            </div>

            <div className="tab">
                <button className="tablinks" onClick={() => setActiveTab('scatter')}>Scatter Plot</button>
                <button className="tablinks" onClick={() => setActiveTab('inflation')}>Inflation Data</button>
                <button className="tablinks" onClick={() => setActiveTab('teamBreakdown')}>Team Breakdown</button>
                <button className="tablinks" onClick={() => setActiveTab('ticker')}>Ticker</button>
            </div>

            <div>
                <label>
                    <input
                        type="checkbox"
                        checked={isLive}
                        onChange={handleLiveToggle}
                    />
                    Live Draft
                </label>
            </div>

            {activeTab === 'scatter' && <ScatterPlot draftId={draftId} isLive={isLive} />}
            {activeTab === 'inflation' && <InflationData draftId={draftId} isLive={isLive} />}
            {activeTab === 'teamBreakdown' && <TeamBreakdown draftId={draftId} isLive={isLive} draftOrder={parsedDraftOrder} />}
            {activeTab === 'ticker' && <Ticker draftId={draftId} picks={picks} />} {/* Pass draftId and fetched picks */}
        </div>
    );
}

export default Dashboard;
