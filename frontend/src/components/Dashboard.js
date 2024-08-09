import React, { useState } from 'react';
import ScatterPlot from './ScatterPlot';
import InflationData from './InflationData';
import TeamBreakdown from './TeamBreakdown';

function Dashboard() {
    const [activeTab, setActiveTab] = useState('scatter');
    const [isLive, setIsLive] = useState(false); // Track whether the draft is live or not
    const draftId = new URLSearchParams(window.location.search).get('draft_id');

    if (!draftId) {
        return <div>Please enter a valid draft ID.</div>;
    }

    const handleLiveToggle = () => {
        setIsLive(prevIsLive => !prevIsLive);
    };

    return (
        <div>
            <h1>Dashboard</h1>
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
            {activeTab === 'teamBreakdown' && <TeamBreakdown draftId={draftId} isLive={isLive} />}
        </div>
    );
}

export default Dashboard;
