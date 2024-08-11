import React, { useState, useEffect, useCallback } from 'react';
import Select from 'react-select';
import Slider from 'rc-slider';
import 'rc-slider/assets/index.css';
import './ticker.css'; // Ensure you have appropriate styling for the Ticker
import axios from 'axios';

const Ticker = ({ draftId, draftOrder = [] }) => {
    const [picks, setPicks] = useState([]);
    const [visiblePicks, setVisiblePicks] = useState([]);
    const [resultsPerPage, setResultsPerPage] = useState(10); // State to manage results per page
    const [inflationData, setInflationData] = useState(null);

    const [filters, setFilters] = useState({
        team: [],
        playerName: '',
        position: [],
        pickNumberRange: [1, 100], // Added state for Pick Number Range
        priceRange: [0, 200],
        expectedPriceRange: [0, 200],
        doeRange: [-50, 50],
        inflationRange: [-100, 100],
        tier: ''
    });

    const teamOptions = draftOrder.map((team, index) => ({ value: team, label: team || `Team ${index + 1}` }));
    const positionOptions = [
        { value: 'QB', label: 'QB' },
        { value: 'RB', label: 'RB' },
        { value: 'WR', label: 'WR' },
        { value: 'TE', label: 'TE' }
    ];

    const tierOptions = [
        { value: '1', label: '1' },
        { value: '2', label: '2' },
        { value: '3', label: '3' },
        { value: '4', label: '4' },
        { value: '5', label: '5' },
        { value: '6', label: '6' },
        { value: '7', label: '7' },
        { value: '8', label: '8' },
        { value: '9', label: '9' },
        { value: '10', label: '10' }
    ];

    const computeExpectedValues = (pick) => {
        if (!inflationData || !inflationData.expected_values) return { expectedValue: 'N/A', doe: 'N/A', inflationPercent: 'N/A', tier: 'N/A' };
    
        const playerName = `${pick.metadata.first_name} ${pick.metadata.last_name}`;
        const expectedValueData = inflationData.expected_values.find(player => {
            // Log player names to see if they match
            console.log(`Checking: ${player.Player} against ${playerName}`);
            return player.Player === playerName;
        });
    
        if (!expectedValueData) {
            console.warn(`No match found for ${playerName}`);
        }
    
        let doe = 'N/A';
        let inflationPercent = 'N/A';
        let tier = 'N/A';
    
        if (expectedValueData) {
            const expectedValue = parseFloat(expectedValueData.Value);
            tier = expectedValueData.Tier || 'N/A';
            if (expectedValue > 0) {
                doe = (pick.metadata.amount - expectedValue).toFixed(2);
                inflationPercent = ((doe / expectedValue) * 100).toFixed(2);
            }
        }
    
        return { expectedValue: expectedValueData ? expectedValueData.Value : 'N/A', doe, inflationPercent, tier };
    };
    

    const applyFilters = useCallback((picks) => {
        return picks.map(pick => {
            const teamIndex = pick.draft_slot - 1;
            const teamName = draftOrder[teamIndex] ? draftOrder[teamIndex] : `Team ${pick.draft_slot}`;
    
            const { expectedValue, doe, inflationPercent, tier } = computeExpectedValues(pick);
    
            if (expectedValue === 'N/A' || tier === 'N/A') {
                console.warn(`Pick #${pick.pick_no}: ${pick.metadata.first_name} ${pick.metadata.last_name} is missing expected values or tier.`);
            }
    
            return {
                ...pick,
                visible: (
                    (filters.team.length === 0 || filters.team.includes(teamName)) &&
                    (filters.playerName === '' || `${pick.metadata.first_name} ${pick.metadata.last_name}`.toLowerCase().includes(filters.playerName.toLowerCase())) &&
                    (filters.position.length === 0 || filters.position.includes(pick.metadata.position)) &&
                    (filters.priceRange[0] <= pick.metadata.amount && pick.metadata.amount <= filters.priceRange[1]) &&
                    (filters.expectedPriceRange[0] <= expectedValue && expectedValue <= filters.expectedPriceRange[1]) &&
                    (filters.doeRange[0] <= doe && doe <= filters.doeRange[1]) &&
                    (filters.inflationRange[0] <= inflationPercent && inflationPercent <= filters.inflationRange[1]) &&
                    (filters.tier.length === 0 || filters.tier.includes(tier)) // Updated for multi-select
                )
            };
        });
    }, [filters, draftOrder, inflationData, computeExpectedValues]);
    
    useEffect(() => {
        const fetchPicks = async () => {
            try {
                const response = await axios.get(`http://localhost:5050/picks?draft_id=${draftId}`);
                const sortedPicks = response.data.sort((a, b) => b.pick_no - a.pick_no); // Sort by pick_no descending
                setPicks(sortedPicks);
                setVisiblePicks(applyFilters(sortedPicks).slice(0, resultsPerPage)); // Show the number of picks based on resultsPerPage

                console.log('Picks:', sortedPicks);
                console.log('Draft Order:', draftOrder);

            } catch (error) {
                console.error("Failed to fetch picks data:", error);
            }
        };

        const fetchInflationData = async () => {
            try {
                const response = await axios.post('http://localhost:5050/inflation', { draft_id: draftId });
                setInflationData(response.data);
            } catch (error) {
                console.error("Failed to fetch inflation data:", error);
            }
        };

        fetchPicks();
        fetchInflationData();
    }, [draftId, draftOrder]);

    useEffect(() => {
        const updatedPicks = applyFilters(picks);
        setVisiblePicks(updatedPicks.filter(pick => pick.visible).slice(0, resultsPerPage)); // Show the number of picks based on resultsPerPage
    }, [filters, picks, applyFilters, resultsPerPage]);
    

    const handleResultsPerPageChange = (e) => {
        setResultsPerPage(parseInt(e.target.value));
    };

    const handleMultiSelectChange = (selectedOptions, actionMeta) => {
        setFilters(prevFilters => ({
            ...prevFilters,
            [actionMeta.name]: selectedOptions ? selectedOptions.map(option => option.value) : []
        }));
    };

    const handleSliderChange = (name, value) => {
        setFilters(prevFilters => ({
            ...prevFilters,
            [name]: value
        }));
    };

    const handleFilterChange = (e) => {
        const { name, value } = e.target;
        setFilters(prevFilters => ({
            ...prevFilters,
            [name]: value,
        }));
    };

    const handleResetFilters = () => {
        setFilters({
            team: [],
            playerName: '',
            position: [],
            pickNumberRange: [1, 100], // Reset pick number range
            priceRange: [0, 200],
            expectedPriceRange: [0, 200],
            doeRange: [-50, 50],
            inflationRange: [-100, 100],
            tier: ''
        });
    };

    return (
        <div className="ticker-container">
            <div className="filters-container">
                <div className="filter-column">
                    <label>
                        Team:
                        <Select
                            isMulti
                            name="team"
                            options={teamOptions}
                            className="basic-multi-select"
                            classNamePrefix="select"
                            value={teamOptions.filter(option => filters.team.includes(option.value))}
                            onChange={handleMultiSelectChange}
                        />
                    </label>
                    <label>
                        Player:
                        <input type="text" name="playerName" value={filters.playerName} onChange={handleFilterChange} placeholder="Player Name" />
                    </label>
                    <label>
                        Position:
                        <Select
                            isMulti
                            name="position"
                            options={positionOptions}
                            className="basic-multi-select"
                            classNamePrefix="select"
                            value={positionOptions.filter(option => filters.position.includes(option.value))}
                            onChange={handleMultiSelectChange}
                        />
                    </label>
                    <label>
                        Tier:
                        <Select
                            isMulti
                            name="tier"
                            options={tierOptions}
                            className="basic-multi-select"
                            classNamePrefix="select"
                            value={tierOptions.filter(option => filters.tier.includes(option.value))}
                            onChange={handleMultiSelectChange}
                        />
                    </label>


                </div>
                <div className="filter-column">
                    <label>
                        Pick Number Range:
                        <Slider
                            range
                            min={1}
                            max={100}
                            value={filters.pickNumberRange}
                            onChange={value => handleSliderChange('pickNumberRange', value)}
                            marks={{ 1: '1', 100: '100' }}
                        />
                    </label>
                    <label>
                        Price Range:
                        <Slider
                            range
                            min={0}
                            max={200}
                            value={filters.priceRange}
                            onChange={value => handleSliderChange('priceRange', value)}
                            marks={{ 0: '$0', 200: '$200' }}
                        />
                    </label>
                    <label>
                        Expected Price Range:
                        <Slider
                            range
                            min={0}
                            max={200}
                            value={filters.expectedPriceRange}
                            onChange={value => handleSliderChange('expectedPriceRange', value)}
                            marks={{ 0: '$0', 200: '$200' }}
                        />
                    </label>
                    <label>
                        DOE Range:
                        <Slider
                            range
                            min={-50}
                            max={50}
                            value={filters.doeRange}
                            onChange={value => handleSliderChange('doeRange', value)}
                            marks={{ '-50': '-$50', 50: '$50' }}
                        />
                    </label>
                    <label>
                        Inflation % Range:
                        <Slider
                            range
                            min={-100}
                            max={100}
                            value={filters.inflationRange}
                            onChange={value => handleSliderChange('inflationRange', value)}
                            marks={{ '-100': '-100%', 100: '100%' }}
                        />
                    </label>
                    <button onClick={handleResetFilters}>Reset Filters</button>
                </div>
            </div>
            <div className="results-per-page">
                <label>
                    Results Per Page:
                    <select value={resultsPerPage} onChange={handleResultsPerPageChange}>
                        <option value="5">5</option>
                        <option value="10">10</option>
                        <option value="20">20</option>
                        <option value="50">50</option>
                    </select>
                </label>
            </div>
            <table className="ticker-table">
                <thead>
                    <tr>
                        <th>Pick #</th> {/* Added Pick Number column */}
                        <th>Team</th>
                        <th>Player</th>
                        <th>Position</th>
                        <th>Price</th>
                        <th>Expected Price</th>
                        <th>DOE</th>
                        <th>Inflation %</th>
                        <th>Tier</th>
                    </tr>
                </thead>
                <tbody>
                    {visiblePicks.map((pick, index) => {
                        const teamIndex = pick.draft_slot - 1;
                        const teamName = draftOrder[teamIndex] ? draftOrder[teamIndex] : `Team ${pick.draft_slot}`;

                        const { expectedValue, doe, inflationPercent, tier } = computeExpectedValues(pick);

                        return (
                            <tr key={index}>
                                <td>{pick.pick_no}</td> {/* Display Pick Number */}
                                <td>{teamName}</td>
                                <td>{pick.metadata.first_name} {pick.metadata.last_name}</td>
                                <td>{pick.metadata.position}</td>
                                <td>${pick.metadata.amount}</td>
                                <td>${expectedValue}</td>
                                <td>{doe}</td>
                                <td>{inflationPercent}%</td>
                                <td>{tier}</td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
};

export default Ticker;
