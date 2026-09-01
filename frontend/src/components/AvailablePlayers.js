import React, { useState, useEffect, useMemo, useCallback } from 'react';
import axios from 'axios';
import dataService from './utils/DataService';

const AvailablePlayers = ({ draftId, isLive }) => {
    const [allPlayers, setAllPlayers] = useState([]);
    const [draftedPlayers, setDraftedPlayers] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [filters, setFilters] = useState({
        position: [],
        tier: [],
        search: '',
        minValue: '',
        maxValue: '',
        targetsOnly: false,
        playerStatus: 'all' // 'all', 'available', 'drafted'
    });
    const [sortConfig, setSortConfig] = useState({
        key: 'auction_value',
        direction: 'desc'
    });
    
    // Notes state
    const [notes, setNotes] = useState({});
    const [globalNotes, setGlobalNotes] = useState({});
    const [draftSpecificNotes, setDraftSpecificNotes] = useState({});
    const [editingNote, setEditingNote] = useState(null);
    const [notesLoading, setNotesLoading] = useState(false);

    // Position colors for consistent styling
    const getPositionColor = (position) => {
        const colors = {
            'QB': '#8B5CF6',  // Purple
            'RB': '#22C55E',  // Green
            'WR': '#F97316',  // Orange
            'TE': '#3B82F6',  // Blue
            'K': '#FFD700',   // Gold
            'DST': '#696969'  // Gray
        };
        return colors[position] || '#808080';
    };

    // Tier colors for visual hierarchy
    const getTierColor = (tier) => {
        const tierNum = parseInt(tier);
        if (isNaN(tierNum)) return '#6B7280';
        
        const colors = {
            1: '#DC2626', // Red - Elite
            2: '#EA580C', // Orange - Very Good
            3: '#D97706', // Amber - Good
            4: '#65A30D', // Lime - Above Average
            5: '#16A34A', // Green - Average
            6: '#0D9488', // Teal - Below Average
            7: '#0891B2', // Cyan - Depth
            8: '#7C3AED'  // Purple - Deep Depth
        };
        return colors[tierNum] || '#6B7280';
    };

    const fetchAllPlayers = useCallback(async () => {
        if (!draftId) return;

        setLoading(true);
        setError(null);

        try {
            // Fetch available players and drafted players with values
            const availableResponse = await axios.get(`/available_players?draft_id=${draftId}&is_live=${isLive}`);
            const availablePlayers = availableResponse.data.available_players;
            const draftedPlayersWithValues = availableResponse.data.drafted_players || [];
            
            // Transform drafted players to match our format
            const draftedPlayers = draftedPlayersWithValues.map(player => ({
                name: player.name,
                position: player.position,
                team: player.team || 'N/A',
                auction_value: 0, // Drafted players don't have auction values
                tier: 'Drafted',
                position_rank: 'N/A',
                status: 'drafted',
                pick_number: player.pick_number,
                round: player.round,
                team_name: player.team || 'N/A',
                expected_value: player.expected_value || 0,
                spent_amount: player.spent_amount || 0
            }));
            
            // Add expected_value to available players
            const availablePlayersWithEV = availablePlayers.map(player => ({
                ...player,
                expected_value: player.expected_value || player.auction_value || 0
            }));
            
            // Combine all players
            const allPlayers = [...availablePlayersWithEV, ...draftedPlayers];
            setAllPlayers(allPlayers);
            setDraftedPlayers(draftedPlayers);
        } catch (error) {
            console.error('Error fetching players:', error);
            setError('Failed to load players');
        } finally {
            setLoading(false);
        }
    }, [draftId, isLive]);

    // Notes functionality
    const loadNotesFromLocalStorage = useCallback(() => {
        if (!draftId) return;
        
        try {
            const storedNotes = localStorage.getItem(`draft_notes_${draftId}`);
            if (storedNotes) {
                const parsedNotes = JSON.parse(storedNotes);
                setNotes(parsedNotes);
            }
        } catch (error) {
            console.error('Error loading notes from localStorage:', error);
        }
    }, [draftId]);

    const saveNotesToLocalStorage = useCallback((newNotes) => {
        if (!draftId) return;
        
        try {
            localStorage.setItem(`draft_notes_${draftId}`, JSON.stringify(newNotes));
        } catch (error) {
            console.error('Error saving notes to localStorage:', error);
        }
    }, [draftId]);

    const fetchGlobalNotes = useCallback(async () => {
        setNotesLoading(true);
        try {
            const response = await axios.get('/draft_notes');
            setGlobalNotes(response.data.global_notes || {});
            setDraftSpecificNotes(response.data.draft_specific_notes || {});
        } catch (error) {
            console.error('Error fetching global notes:', error);
        } finally {
            setNotesLoading(false);
        }
    }, []);

    const getPlayerNote = useCallback((playerName) => {
        // Check draft-specific notes first, then global notes
        const draftNote = draftSpecificNotes[draftId]?.[playerName];
        const globalNote = globalNotes[playerName];
        
        // Draft-specific notes override global notes
        return draftNote || globalNote || null;
    }, [draftId, draftSpecificNotes, globalNotes]);

    const updatePlayerNote = useCallback((playerName, noteData) => {
        const newNotes = { ...notes };
        newNotes[playerName] = {
            ...newNotes[playerName],
            ...noteData,
            last_updated: new Date().toISOString()
        };
        
        setNotes(newNotes);
        saveNotesToLocalStorage(newNotes);
        setEditingNote(null);
    }, [notes, saveNotesToLocalStorage]);

    const deletePlayerNote = useCallback((playerName) => {
        const newNotes = { ...notes };
        delete newNotes[playerName];
        
        setNotes(newNotes);
        saveNotesToLocalStorage(newNotes);
        setEditingNote(null);
    }, [notes, saveNotesToLocalStorage]);

    const getPriorityColor = (priority) => {
        const colors = {
            'high': '#DC2626',    // Red
            'medium': '#D97706',  // Amber
            'low': '#16A34A'      // Green
        };
        return colors[priority] || '#6B7280';
    };

    useEffect(() => {
        const componentId = `available-players-${draftId}`;
        
        // Subscribe to data updates
        const unsubscribe = dataService.subscribe(componentId, (data) => {
            if (data.picks) {
                fetchAllPlayers();
            }
        });

        // Start polling through the service
        dataService.startPolling(draftId, isLive);

        // Initial fetch
        fetchAllPlayers();
        
        // Load notes
        loadNotesFromLocalStorage();
        fetchGlobalNotes();

        return () => {
            unsubscribe();
        };
    }, [draftId, isLive, fetchAllPlayers, loadNotesFromLocalStorage, fetchGlobalNotes]);

    // Filter and sort players
    const filteredAndSortedPlayers = useMemo(() => {
        let filtered = allPlayers.filter(player => {
            // Player status filter
            if (filters.playerStatus === 'available' && player.status === 'drafted') {
                return false;
            }
            if (filters.playerStatus === 'drafted' && player.status !== 'drafted') {
                return false;
            }

            // Position filter
            if (filters.position.length > 0 && !filters.position.includes(player.position)) {
                return false;
            }

            // Tier filter
            if (filters.tier.length > 0 && !filters.tier.includes(player.tier.toString())) {
                return false;
            }

            // Search filter
            if (filters.search && !player.name.toLowerCase().includes(filters.search.toLowerCase())) {
                return false;
            }

            // Value range filter (only for available players)
            if (player.status !== 'drafted') {
                if (filters.minValue && player.auction_value < parseFloat(filters.minValue)) {
                    return false;
                }
                if (filters.maxValue && player.auction_value > parseFloat(filters.maxValue)) {
                    return false;
                }
            }

            // Targets only filter
            if (filters.targetsOnly) {
                const playerNote = getPlayerNote(player.name);
                const localNote = notes[player.name];
                if (!playerNote?.target && !localNote?.target) {
                    return false;
                }
            }

            return true;
        });

        // Sort players
        filtered.sort((a, b) => {
            let aValue = a[sortConfig.key];
            let bValue = b[sortConfig.key];

            // Handle different sorting scenarios
            if (sortConfig.key === 'tier') {
                // For tier, handle "Drafted" vs numeric tiers
                if (a.tier === 'Drafted' && b.tier !== 'Drafted') {
                    return 1; // Drafted players go to the end
                }
                if (a.tier !== 'Drafted' && b.tier === 'Drafted') {
                    return -1; // Available players go first
                }
                // Both same type, sort by tier number
                aValue = parseFloat(aValue) || 0;
                bValue = parseFloat(bValue) || 0;
            } else if (sortConfig.key === 'pick_number') {
                // For pick_number, only drafted players have this
                aValue = a.pick_number || 999;
                bValue = b.pick_number || 999;
            } else if (sortConfig.key === 'expected_value') {
                // For expected_value, only drafted players have this
                aValue = a.expected_value || 0;
                bValue = b.expected_value || 0;
            } else if (sortConfig.key === 'spent_amount') {
                // For spent_amount, only drafted players have this
                aValue = a.spent_amount || 0;
                bValue = b.spent_amount || 0;
            } else {
                // For other fields (name, position, team), use string comparison
                aValue = String(aValue || '').toLowerCase();
                bValue = String(bValue || '').toLowerCase();
            }

            if (sortConfig.direction === 'asc') {
                return aValue > bValue ? 1 : -1;
            } else {
                return aValue < bValue ? 1 : -1;
            }
        });

        return filtered;
    }, [allPlayers, filters, sortConfig, getPlayerNote, notes]);

    const handleSort = (key) => {
        setSortConfig(prev => ({
            key,
            direction: prev.key === key && prev.direction === 'desc' ? 'asc' : 'desc'
        }));
    };

    const handleFilterChange = (filterType, value) => {
        setFilters(prev => ({
            ...prev,
            [filterType]: value
        }));
    };

    const clearFilters = () => {
        setFilters({
            position: [],
            tier: [],
            search: '',
            minValue: '',
            maxValue: '',
            targetsOnly: false,
            playerStatus: 'all'
        });
    };

    const positionOptions = [
        { value: 'QB', label: 'QB' },
        { value: 'RB', label: 'RB' },
        { value: 'WR', label: 'WR' },
        { value: 'TE', label: 'TE' },
        { value: 'K', label: 'K' },
        { value: 'DST', label: 'DST' }
    ];

    const tierOptions = Array.from({ length: 8 }, (_, i) => ({
        value: (i + 1).toString(),
        label: `Tier ${i + 1}`
    }));

    // Only blank the screen before there is anything to show. Gating on `loading`
    // alone tore the whole table down on every poll, resetting scroll, sort and
    // filters several times a minute.
    if (loading && allPlayers.length === 0) {
        return (
            <div style={{ textAlign: 'center', padding: '2rem' }}>
                <div style={{ 
                    display: 'inline-block',
                    width: '2rem',
                    height: '2rem',
                    border: '0.25rem solid #f3f3f3',
                    borderTop: '0.25rem solid #3498db',
                    borderRadius: '50%',
                    animation: 'spin 1s linear infinite'
                }}></div>
                <p style={{ marginTop: '1rem' }}>Loading all players...</p>
                <style>{`
                    @keyframes spin {
                        0% { transform: rotate(0deg); }
                        100% { transform: rotate(360deg); }
                    }
                `}</style>
            </div>
        );
    }

    if (error) {
        return (
            <div style={{
                padding: '1rem',
                marginBottom: '1rem',
                border: '1px solid #f5c6cb',
                borderRadius: '0.375rem',
                backgroundColor: '#f8d7da',
                color: '#721c24'
            }}>
                <h4>Error</h4>
                <p>{error}</p>
            </div>
        );
    }

    return (
        <div>
            <div style={{
                border: '1px solid #dee2e6',
                borderRadius: '0.375rem',
                marginBottom: '1.5rem'
            }}>
                <div style={{
                    padding: '1rem',
                    backgroundColor: '#f8f9fa',
                    borderBottom: '1px solid #dee2e6',
                    borderTopLeftRadius: '0.375rem',
                    borderTopRightRadius: '0.375rem'
                }}>
                    <h3>All Players</h3>
                    <p style={{ marginBottom: 0 }}>
                        Showing {filteredAndSortedPlayers.length} of {allPlayers.length} total players
                        {notesLoading && <span style={{ marginLeft: '1rem', fontSize: '0.875rem', color: '#6c757d' }}>Loading notes...</span>}
                    </p>
                </div>
                <div style={{ padding: '1rem' }}>
                    {/* Filters */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.5rem' }}>
                        <div style={{ flex: '1', minWidth: '200px' }}>
                            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                                Search Players
                            </label>
                            <input
                                type="text"
                                placeholder="Search by name..."
                                value={filters.search}
                                onChange={(e) => handleFilterChange('search', e.target.value)}
                                style={{
                                    width: '100%',
                                    padding: '0.375rem 0.75rem',
                                    border: '1px solid #ced4da',
                                    borderRadius: '0.375rem'
                                }}
                            />
                        </div>
                        <div style={{ flex: '1', minWidth: '150px' }}>
                            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                                Player Status
                            </label>
                            <select
                                value={filters.playerStatus}
                                onChange={(e) => handleFilterChange('playerStatus', e.target.value)}
                                style={{
                                    width: '100%',
                                    padding: '0.375rem 0.75rem',
                                    border: '1px solid #ced4da',
                                    borderRadius: '0.375rem'
                                }}
                            >
                                <option value="all">All Players</option>
                                <option value="available">Available Only</option>
                                <option value="drafted">Drafted Only</option>
                            </select>
                        </div>
                        <div style={{ flex: '1', minWidth: '150px' }}>
                            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                                Position
                            </label>
                            <select
                                value=""
                                onChange={(e) => {
                                    if (e.target.value && !filters.position.includes(e.target.value)) {
                                        handleFilterChange('position', [...filters.position, e.target.value]);
                                    }
                                }}
                                style={{
                                    width: '100%',
                                    padding: '0.375rem 0.75rem',
                                    border: '1px solid #ced4da',
                                    borderRadius: '0.375rem'
                                }}
                            >
                                <option value="">Select Position</option>
                                {positionOptions.map(option => (
                                    <option key={option.value} value={option.value}>
                                        {option.label}
                                    </option>
                                ))}
                            </select>
                            {filters.position.length > 0 && (
                                <div style={{ marginTop: '0.5rem' }}>
                                    {filters.position.map(pos => (
                                        <span 
                                            key={pos} 
                                            style={{ 
                                                display: 'inline-block',
                                                backgroundColor: '#0d6efd',
                                                color: 'white',
                                                cursor: 'pointer',
                                                padding: '4px 8px',
                                                borderRadius: '4px',
                                                fontSize: '12px',
                                                marginRight: '0.25rem',
                                                marginBottom: '0.25rem'
                                            }}
                                            onClick={() => handleFilterChange('position', filters.position.filter(p => p !== pos))}
                                        >
                                            {pos} ×
                                        </span>
                                    ))}
                                </div>
                            )}
                        </div>
                        <div style={{ flex: '1', minWidth: '150px' }}>
                            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                                Tier
                            </label>
                            <select
                                value=""
                                onChange={(e) => {
                                    if (e.target.value && !filters.tier.includes(e.target.value)) {
                                        handleFilterChange('tier', [...filters.tier, e.target.value]);
                                    }
                                }}
                                style={{
                                    width: '100%',
                                    padding: '0.375rem 0.75rem',
                                    border: '1px solid #ced4da',
                                    borderRadius: '0.375rem'
                                }}
                            >
                                <option value="">Select Tier</option>
                                {tierOptions.map(option => (
                                    <option key={option.value} value={option.value}>
                                        {option.label}
                                    </option>
                                ))}
                            </select>
                            {filters.tier.length > 0 && (
                                <div style={{ marginTop: '0.5rem' }}>
                                    {filters.tier.map(tier => (
                                        <span 
                                            key={tier} 
                                            style={{ 
                                                display: 'inline-block',
                                                backgroundColor: '#0d6efd',
                                                color: 'white',
                                                cursor: 'pointer',
                                                padding: '4px 8px',
                                                borderRadius: '4px',
                                                fontSize: '12px',
                                                marginRight: '0.25rem',
                                                marginBottom: '0.25rem'
                                            }}
                                            onClick={() => handleFilterChange('tier', filters.tier.filter(t => t !== tier))}
                                        >
                                            Tier {tier} ×
                                        </span>
                                    ))}
                                </div>
                            )}
                        </div>
                        <div style={{ flex: '1', minWidth: '120px' }}>
                            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                                Min Value
                            </label>
                            <input
                                type="number"
                                placeholder="Min $"
                                value={filters.minValue}
                                onChange={(e) => handleFilterChange('minValue', e.target.value)}
                                style={{
                                    width: '100%',
                                    padding: '0.375rem 0.75rem',
                                    border: '1px solid #ced4da',
                                    borderRadius: '0.375rem'
                                }}
                            />
                        </div>
                        <div style={{ flex: '1', minWidth: '120px' }}>
                            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                                Max Value
                            </label>
                            <input
                                type="number"
                                placeholder="Max $"
                                value={filters.maxValue}
                                onChange={(e) => handleFilterChange('maxValue', e.target.value)}
                                style={{
                                    width: '100%',
                                    padding: '0.375rem 0.75rem',
                                    border: '1px solid #ced4da',
                                    borderRadius: '0.375rem'
                                }}
                            />
                        </div>
                        <div style={{ flex: '0 0 auto', alignSelf: 'end', marginTop: '1.5rem' }}>
                            <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                                <input
                                    type="checkbox"
                                    checked={filters.targetsOnly}
                                    onChange={(e) => handleFilterChange('targetsOnly', e.target.checked)}
                                    style={{ marginRight: '0.5rem' }}
                                />
                                <span style={{ fontWeight: 'bold' }}>Targets Only</span>
                            </label>
                        </div>
                        <div style={{ flex: '0 0 auto', alignSelf: 'end' }}>
                            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                                &nbsp;
                            </label>
                            <button 
                                onClick={clearFilters}
                                style={{
                                    padding: '0.375rem 0.75rem',
                                    border: '1px solid #6c757d',
                                    borderRadius: '0.375rem',
                                    backgroundColor: 'transparent',
                                    color: '#6c757d',
                                    cursor: 'pointer'
                                }}
                            >
                                Clear
                            </button>
                        </div>
                    </div>

                    {/* Players Table */}
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{
                            width: '100%',
                            borderCollapse: 'collapse',
                            border: '1px solid #dee2e6'
                        }}>
                            <thead>
                                <tr style={{ backgroundColor: '#f8f9fa' }}>
                                    <th 
                                        onClick={() => handleSort('name')} 
                                        style={{ 
                                            cursor: 'pointer',
                                            padding: '0.75rem',
                                            border: '1px solid #dee2e6',
                                            textAlign: 'left'
                                        }}
                                    >
                                        Player Name
                                        {sortConfig.key === 'name' && (
                                            <span style={{ marginLeft: '0.25rem' }}>
                                                {sortConfig.direction === 'asc' ? '↑' : '↓'}
                                            </span>
                                        )}
                                    </th>
                                    <th 
                                        onClick={() => handleSort('position')} 
                                        style={{ 
                                            cursor: 'pointer',
                                            padding: '0.75rem',
                                            border: '1px solid #dee2e6',
                                            textAlign: 'left'
                                        }}
                                    >
                                        Position
                                        {sortConfig.key === 'position' && (
                                            <span style={{ marginLeft: '0.25rem' }}>
                                                {sortConfig.direction === 'asc' ? '↑' : '↓'}
                                            </span>
                                        )}
                                    </th>
                                    <th style={{ padding: '0.75rem', border: '1px solid #dee2e6', textAlign: 'left' }}>
                                        Team
                                    </th>
                                    <th style={{ padding: '0.75rem', border: '1px solid #dee2e6', textAlign: 'left' }}>
                                        Status
                                    </th>
                                    <th 
                                        onClick={() => handleSort('tier')} 
                                        style={{ 
                                            cursor: 'pointer',
                                            padding: '0.75rem',
                                            border: '1px solid #dee2e6',
                                            textAlign: 'left'
                                        }}
                                    >
                                        Tier
                                        {sortConfig.key === 'tier' && (
                                            <span style={{ marginLeft: '0.25rem' }}>
                                                {sortConfig.direction === 'asc' ? '↑' : '↓'}
                                            </span>
                                        )}
                                    </th>
                                    
                                    <th 
                                        onClick={() => handleSort('pick_number')} 
                                        style={{ 
                                            cursor: 'pointer',
                                            padding: '0.75rem',
                                            border: '1px solid #dee2e6',
                                            textAlign: 'left'
                                        }}
                                    >
                                        Pick #
                                        {sortConfig.key === 'pick_number' && (
                                            <span style={{ marginLeft: '0.25rem' }}>
                                                {sortConfig.direction === 'asc' ? '↑' : '↓'}
                                            </span>
                                        )}
                                    </th>
                                                                         <th 
                                         onClick={() => handleSort('expected_value')} 
                                         style={{ 
                                             cursor: 'pointer',
                                             padding: '0.75rem',
                                             border: '1px solid #dee2e6',
                                             textAlign: 'left'
                                         }}
                                     >
                                         Expected Value
                                         {sortConfig.key === 'expected_value' && (
                                             <span style={{ marginLeft: '0.25rem' }}>
                                                 {sortConfig.direction === 'asc' ? '↑' : '↓'}
                                             </span>
                                         )}
                                     </th>
                                                                         <th 
                                         onClick={() => handleSort('spent_amount')} 
                                         style={{ 
                                             cursor: 'pointer',
                                             padding: '0.75rem',
                                             border: '1px solid #dee2e6',
                                             textAlign: 'left'
                                         }}
                                     >
                                         Amount Spent
                                         {sortConfig.key === 'spent_amount' && (
                                             <span style={{ marginLeft: '0.25rem' }}>
                                                 {sortConfig.direction === 'asc' ? '↑' : '↓'}
                                             </span>
                                         )}
                                     </th>
                                    <th style={{ padding: '0.75rem', border: '1px solid #dee2e6', textAlign: 'left' }}>
                                        Position Rank
                                    </th>
                                    <th style={{ padding: '0.75rem', border: '1px solid #dee2e6', textAlign: 'left' }}>
                                        Notes
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredAndSortedPlayers.map((player, index) => (
                                    <tr key={`${player.name}-${player.position}-${index}`} style={{
                                        backgroundColor: index % 2 === 0 ? '#ffffff' : '#f8f9fa'
                                    }}>
                                        <td style={{ padding: '0.75rem', border: '1px solid #dee2e6' }}>
                                            <strong>{player.name}</strong>
                                        </td>
                                        <td style={{ padding: '0.75rem', border: '1px solid #dee2e6' }}>
                                            <span 
                                                style={{ 
                                                    backgroundColor: getPositionColor(player.position),
                                                    color: 'white',
                                                    padding: '4px 8px',
                                                    borderRadius: '4px',
                                                    fontSize: '12px'
                                                }}
                                            >
                                                {player.position}
                                            </span>
                                        </td>
                                        <td style={{ padding: '0.75rem', border: '1px solid #dee2e6' }}>
                                            {player.team}
                                        </td>
                                        <td style={{ padding: '0.75rem', border: '1px solid #dee2e6' }}>
                                            {player.status === 'drafted' ? (
                                                <span style={{
                                                    backgroundColor: '#DC2626',
                                                    color: 'white',
                                                    padding: '4px 8px',
                                                    borderRadius: '4px',
                                                    fontSize: '12px'
                                                }}>
                                                    Drafted
                                                </span>
                                            ) : (
                                                <span style={{
                                                    backgroundColor: '#16A34A',
                                                    color: 'white',
                                                    padding: '4px 8px',
                                                    borderRadius: '4px',
                                                    fontSize: '12px'
                                                }}>
                                                    Available
                                                </span>
                                            )}
                                        </td>
                                        <td style={{ padding: '0.75rem', border: '1px solid #dee2e6' }}>
                                            {player.tier !== 'N/A' ? (
                                                <span 
                                                    style={{ 
                                                        backgroundColor: getTierColor(player.tier),
                                                        color: 'white',
                                                        padding: '4px 8px',
                                                        borderRadius: '4px',
                                                        fontSize: '12px'
                                                    }}
                                                >
                                                    Tier {player.tier}
                                                </span>
                                            ) : (
                                                <span style={{ color: '#6c757d' }}>N/A</span>
                                            )}
                                        </td>
                                        
                                        <td style={{ padding: '0.75rem', border: '1px solid #dee2e6' }}>
                                            {player.status === 'drafted' ? (
                                                <strong>{player.pick_number}</strong>
                                            ) : (
                                                <span style={{ color: '#6c757d' }}>—</span>
                                            )}
                                        </td>
                                                                                 <td style={{ padding: '0.75rem', border: '1px solid #dee2e6' }}>
                                             <strong>${player.expected_value}</strong>
                                         </td>
                                        <td style={{ padding: '0.75rem', border: '1px solid #dee2e6' }}>
                                            {player.status === 'drafted' ? (
                                                <div>
                                                    <strong>${player.spent_amount}</strong>
                                                    {player.expected_value > 0 && (
                                                        <div style={{ 
                                                            fontSize: '11px', 
                                                            color: player.spent_amount > player.expected_value ? '#DC2626' : '#16A34A',
                                                            fontWeight: 'bold'
                                                        }}>
                                                            {player.spent_amount > player.expected_value ? '+' : ''}
                                                            ${player.spent_amount - player.expected_value}
                                                        </div>
                                                    )}
                                                </div>
                                            ) : (
                                                <span style={{ color: '#6c757d' }}>—</span>
                                            )}
                                        </td>
                                        <td style={{ padding: '0.75rem', border: '1px solid #dee2e6' }}>
                                            {player.position_rank}
                                        </td>
                                        <td style={{ padding: '0.75rem', border: '1px solid #dee2e6' }}>
                                            {/* Notes Column */}
                                            {editingNote === player.name ? (
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                                    <textarea
                                                        placeholder="Add note..."
                                                        defaultValue={notes[player.name]?.note || ''}
                                                        style={{
                                                            width: '100%',
                                                            minHeight: '60px',
                                                            padding: '0.375rem',
                                                            border: '1px solid #ced4da',
                                                            borderRadius: '0.375rem',
                                                            fontSize: '12px',
                                                            resize: 'vertical'
                                                        }}
                                                        onBlur={(e) => {
                                                            const note = e.target.value.trim();
                                                            if (note) {
                                                                updatePlayerNote(player.name, { note });
                                                            }
                                                        }}
                                                    />
                                                    <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
                                                        <select
                                                            defaultValue={notes[player.name]?.priority || 'medium'}
                                                            onChange={(e) => updatePlayerNote(player.name, { priority: e.target.value })}
                                                            style={{
                                                                padding: '0.25rem',
                                                                border: '1px solid #ced4da',
                                                                borderRadius: '0.25rem',
                                                                fontSize: '11px'
                                                            }}
                                                        >
                                                            <option value="high">High</option>
                                                            <option value="medium">Medium</option>
                                                            <option value="low">Low</option>
                                                        </select>
                                                        <button
                                                            onClick={() => updatePlayerNote(player.name, { target: !notes[player.name]?.target })}
                                                            style={{
                                                                padding: '0.25rem 0.5rem',
                                                                border: '1px solid #ced4da',
                                                                borderRadius: '0.25rem',
                                                                backgroundColor: notes[player.name]?.target ? '#DC2626' : 'transparent',
                                                                color: notes[player.name]?.target ? 'white' : '#6c757d',
                                                                fontSize: '11px',
                                                                cursor: 'pointer'
                                                            }}
                                                        >
                                                            {notes[player.name]?.target ? '⭐ Target' : '🎯 Target'}
                                                        </button>
                                                        <button
                                                            onClick={() => setEditingNote(null)}
                                                            style={{
                                                                padding: '0.25rem 0.5rem',
                                                                border: '1px solid #ced4da',
                                                                borderRadius: '0.25rem',
                                                                backgroundColor: 'transparent',
                                                                fontSize: '11px',
                                                                cursor: 'pointer'
                                                            }}
                                                        >
                                                            ✓
                                                        </button>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                                    {/* Display existing note */}
                                                    {(notes[player.name] || getPlayerNote(player.name)) && (
                                                        <div style={{ fontSize: '12px' }}>
                                                            {notes[player.name]?.note || getPlayerNote(player.name)?.note}
                                                        </div>
                                                    )}
                                                    
                                                    {/* Display target and priority indicators */}
                                                    <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
                                                        {(notes[player.name]?.target || getPlayerNote(player.name)?.target) && (
                                                            <span style={{
                                                                backgroundColor: '#DC2626',
                                                                color: 'white',
                                                                padding: '2px 6px',
                                                                borderRadius: '4px',
                                                                fontSize: '10px'
                                                            }}>
                                                                ⭐ Target
                                                            </span>
                                                        )}
                                                        {(notes[player.name]?.priority || getPlayerNote(player.name)?.priority) && (
                                                            <span style={{
                                                                backgroundColor: getPriorityColor(notes[player.name]?.priority || getPlayerNote(player.name)?.priority),
                                                                color: 'white',
                                                                padding: '2px 6px',
                                                                borderRadius: '4px',
                                                                fontSize: '10px'
                                                            }}>
                                                                {notes[player.name]?.priority || getPlayerNote(player.name)?.priority}
                                                            </span>
                                                        )}
                                                    </div>
                                                    
                                                    {/* Edit button */}
                                                    <button
                                                        onClick={() => setEditingNote(player.name)}
                                                        style={{
                                                            padding: '0.25rem 0.5rem',
                                                            border: '1px solid #ced4da',
                                                            borderRadius: '0.25rem',
                                                            backgroundColor: 'transparent',
                                                            fontSize: '11px',
                                                            cursor: 'pointer',
                                                            alignSelf: 'flex-start'
                                                        }}
                                                    >
                                                        {notes[player.name] || getPlayerNote(player.name) ? '✏️ Edit' : '📝 Add Note'}
                                                    </button>
                                                </div>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {filteredAndSortedPlayers.length === 0 && (
                        <div style={{ textAlign: 'center', padding: '2rem' }}>
                            <p style={{ color: '#6c757d' }}>No players match your current filters.</p>
                            <button 
                                onClick={clearFilters}
                                style={{
                                    padding: '0.375rem 0.75rem',
                                    border: '1px solid #0d6efd',
                                    borderRadius: '0.375rem',
                                    backgroundColor: 'transparent',
                                    color: '#0d6efd',
                                    cursor: 'pointer'
                                }}
                            >
                                Clear Filters
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default AvailablePlayers; 