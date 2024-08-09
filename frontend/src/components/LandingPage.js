import React, { useState } from 'react';
import { useHistory } from 'react-router-dom';

function LandingPage() {
    const [draftId, setDraftId] = useState('');
    const history = useHistory();

    const handleSubmit = (e) => {
        e.preventDefault();
        if (draftId) {
            history.push(`/dashboard?draft_id=${draftId}`);
        }
    };

    return (
        <div>
            <h1>Control Board</h1>
            <form onSubmit={handleSubmit}>
                <label htmlFor="draft_id">Enter Draft ID:</label>
                <input
                    id="draft_id"
                    name="draft_id"
                    type="text"
                    value={draftId}
                    onChange={(e) => setDraftId(e.target.value)}
                />
                <button type="submit">Submit</button>
            </form>
        </div>
    );
}

export default LandingPage;
