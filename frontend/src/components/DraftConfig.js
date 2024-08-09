import React from 'react';

const DraftConfig = ({ draftConfig }) => {
    if (!draftConfig || draftConfig.length === 0) {
        return <div>No draft configuration available</div>;
    }

    return (
        <div>
            <h2>Draft Configuration</h2>
            <table border="1" style={{ width: '100%', textAlign: 'left', marginTop: '20px' }}>
                <thead>
                    <tr>
                        <th>Year</th>
                        {draftConfig[0].draft_order.map((teamName, index) => (
                            <th key={index}>{teamName}</th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {draftConfig.map((config, index) => (
                        <tr key={index}>
                            <td>{config.year}</td>
                            {config.draft_order.map((teamName, idx) => (
                                <td key={idx}>{teamName}</td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};

export default DraftConfig;
