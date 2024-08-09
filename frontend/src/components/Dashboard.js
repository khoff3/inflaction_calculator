import React, { useState } from 'react';
import ScatterPlot from './ScatterPlot';
import InflationData from './InflationData';

function Dashboard() {
    const [activeTab, setActiveTab] = useState('scatter');  // Track the active tab
    const draftId = new URLSearchParams(window.location.search).get('draft_id');  // Extract draft_id from the URL

    if (!draftId) {
        return <div>Please enter a valid draft ID.</div>;
    }

    return (
        <div>
            <h1>Dashboard</h1>
            <div className="tab">
                <button className="tablinks" onClick={() => setActiveTab('scatter')}>Scatter Plot</button>
                <button className="tablinks" onClick={() => setActiveTab('inflation')}>Inflation Data</button>
            </div>

            {activeTab === 'scatter' && <ScatterPlot draftId={draftId} />}
            {activeTab === 'inflation' && <InflationData draftId={draftId} />}
        </div>
    );
}

export default Dashboard;
