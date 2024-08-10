import React, { createContext, useContext, useState, useEffect } from 'react';
import axios from 'axios';

const DataContext = createContext();

export const useDataContext = () => useContext(DataContext);

export const DataProvider = ({ children }) => {
    const [scatterData, setScatterData] = useState(null);
    const [r2Data, setR2Data] = useState(null);
    const [inflationData, setInflationData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const fetchScatterData = async (draftId, isLive) => {
        try {
            setLoading(true);

            const cachedScatterData = localStorage.getItem(`scatterData_${draftId}`);
            const cachedR2Data = localStorage.getItem(`r2Data_${draftId}`);

            if (!isLive && cachedScatterData && cachedR2Data) {
                setScatterData(JSON.parse(cachedScatterData));
                setR2Data(JSON.parse(cachedR2Data));
            } else {
                const response = await axios.get(`/scatter_data?draft_id=${draftId}&is_live=${isLive}`);
                if (response.data) {
                    setScatterData(response.data.scatterplot);
                    setR2Data(response.data.r2_values);
                    localStorage.setItem(`scatterData_${draftId}`, JSON.stringify(response.data.scatterplot));
                    localStorage.setItem(`r2Data_${draftId}`, JSON.stringify(response.data.r2_values));
                }
            }
        } catch (error) {
            setError('Failed to load scatter data.');
            console.error('Error fetching scatter data:', error);
        } finally {
            setLoading(false);
        }
    };

    const fetchInflationData = async (draftId, isLive) => {
        try {
            setLoading(true);

            const cachedInflationData = localStorage.getItem(`inflationData_${draftId}`);

            if (!isLive && cachedInflationData) {
                setInflationData(JSON.parse(cachedInflationData));
            } else {
                const response = await axios.post('/inflation', { draft_id: draftId });
                if (response.data) {
                    setInflationData(response.data);
                    localStorage.setItem(`inflationData_${draftId}`, JSON.stringify(response.data));
                }
            }
        } catch (error) {
            setError('Failed to load inflation data.');
            console.error('Error fetching inflation data:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        const draftId = 'someId'; // Replace with actual draft ID
        fetchScatterData(draftId, false); // Initially load non-live data
        fetchInflationData(draftId, false); // Initially load non-live data
    }, []);

    return (
        <DataContext.Provider value={{ scatterData, r2Data, inflationData, loading, error, fetchScatterData, fetchInflationData }}>
            {children}
        </DataContext.Provider>
    );
};
