import React, { useState, useEffect } from 'react';
import ScatterPlot from './ScatterPlot';
import InflationData from './InflationData';
import TeamBreakdown from './TeamBreakdown';

function Dashboard() {
    const draftIdFromUrl = new URLSearchParams(window.location.search).get('draft_id');
    const isLiveFromUrl = new URLSearchParams(window.location.search).get('is_live') === 'true';
    const [draftId, setDraftId] = useState(draftIdFromUrl || '');
    const [isLocked, setIsLocked] = useState(true); // Lock draft ID by default
    const [activeTab, setActiveTab] = useState('scatter');
    const [isLive, setIsLive] = useState(isLiveFromUrl); // Track whether the draft is live or not
    const [draftOrder, setDraftOrder] = useState(''); // State to hold draft order input
    const [parsedDraftOrder, setParsedDraftOrder] = useState([]); // Holds the parsed array of names

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        if (draftId) {
            params.set('draft_id', draftId);
        }
        params.set('is_live', isLive);
        window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);
    }, [draftId, isLive]);

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
        const draftOrderArray = draftOrder.split(',').map(name => name.trim());
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
        </div>
    );
}

export default Dashboard;
