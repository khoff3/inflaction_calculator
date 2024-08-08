import React, { useState } from 'react';
import { Container, Nav, Tab } from 'react-bootstrap';
import InflationData from './components/InflationData';
import ScatterPlot from './components/ScatterPlot';
import 'bootstrap/dist/css/bootstrap.min.css';
import './App.css';

function App() {
  const [draftId, setDraftId] = useState('');
  const [liveUpdate, setLiveUpdate] = useState(false);

  const handleDraftIdChange = (e) => setDraftId(e.target.value);

  const toggleLiveUpdate = () => setLiveUpdate(!liveUpdate);

  return (
    <Container>
      <h1>Control Board</h1>
      <div style={{ margin: '1rem 0' }}>
        <label>Live Update:</label>
        <input
          id="liveUpdateSwitch"
          type="checkbox"
          checked={liveUpdate}
          onChange={toggleLiveUpdate}
        />
      </div>
      <div>
        <label htmlFor="draft_id">Enter Draft ID:</label>
        <input
          id="draft_id"
          name="draft_id"
          type="text"
          value={draftId}
          onChange={handleDraftIdChange}
        />
      </div>
      <Tab.Container defaultActiveKey="InflationData">
        <Nav variant="tabs">
          <Nav.Item>
            <Nav.Link eventKey="InflationData">Inflation Data</Nav.Link>
          </Nav.Item>
          <Nav.Item>
            <Nav.Link eventKey="ScatterPlot">Picks Over Time</Nav.Link>
          </Nav.Item>
        </Nav>
        <Tab.Content>
          <Tab.Pane eventKey="InflationData">
            <InflationData draftId={draftId} liveUpdate={liveUpdate} />
          </Tab.Pane>
          <Tab.Pane eventKey="ScatterPlot">
            <ScatterPlot draftId={draftId} liveUpdate={liveUpdate} />
          </Tab.Pane>
        </Tab.Content>
      </Tab.Container>
    </Container>
  );
}

export default App;
