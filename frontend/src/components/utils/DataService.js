class DataService {
    constructor() {
        this.subscribers = new Map();
        this.cache = new Map();
        this.isPolling = false;
        this.pollingInterval = null;
        this.lastPickCount = 0;
        this.draftId = null;
        this.isLive = false;
    }

    // Subscribe to data updates
    subscribe(componentId, callback) {
        this.subscribers.set(componentId, callback);
        return () => this.subscribers.delete(componentId);
    }

    // Unsubscribe from data updates
    unsubscribe(componentId) {
        this.subscribers.delete(componentId);
    }

    // Notify specific subscriber
    notifySubscriber(componentId, data) {
        const callback = this.subscribers.get(componentId);
        if (callback) {
            try {
                callback(data);
            } catch (error) {
                console.error('Error in subscriber callback:', error);
            }
        }
    }

    // Notify all subscribers of data updates
    notifySubscribers(data) {
        this.subscribers.forEach((callback, componentId) => {
            try {
                callback(data);
            } catch (error) {
                console.error('Error in subscriber callback:', error);
            }
        });
    }

    // Start polling for a specific draft
    startPolling(draftId, isLive = false) {
        if (this.draftId === draftId && this.isLive === isLive && this.isPolling) {
            return; // Already polling for this draft
        }

        this.stopPolling();
        this.draftId = draftId;
        this.isLive = isLive;

        if (!isLive) {
            this.fetchDataOnce();
            return;
        }

        // Initial fetch
        this.fetchDataOnce();

        // Start polling every 30 seconds to avoid rate limiting
        this.pollingInterval = setInterval(() => {
            this.fetchDataOnce();
        }, 30000);

        this.isPolling = true;
    }

    // Stop polling
    stopPolling() {
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
            this.pollingInterval = null;
        }
        this.isPolling = false;
    }

    // Fetch specific data type once
    async fetchDataOnce(dataType, draftId = this.draftId) {
        if (!draftId) return null;

        try {
            switch (dataType) {
                case 'picks':
                    const picksResponse = await fetch(`/picks?draft_id=${draftId}`);
                    return await picksResponse.json();
                
                case 'inflation':
                    const inflationResponse = await fetch('/inflation', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ draft_id: draftId })
                    });
                    return await inflationResponse.json();
                
                case 'teamBreakdown':
                    const teamResponse = await fetch(`/team_breakdown?draft_id=${draftId}&is_live=${this.isLive}`);
                    return await teamResponse.json();
                
                case 'scatterData':
                    const scatterResponse = await fetch(`/scatter_data?draft_id=${draftId}&is_live=${this.isLive}`);
                    return await scatterResponse.json();
                
                default:
                    console.warn(`Unknown data type: ${dataType}`);
                    return null;
            }
        } catch (error) {
            console.error(`Error fetching ${dataType}:`, error);
            return null;
        }
    }

    // Fetch data once (legacy method)
    async fetchDataOnce() {
        if (!this.draftId) return;

        try {
            // Use lightweight endpoint first to check for changes
            const countResponse = await fetch(`/picks/count?draft_id=${this.draftId}`);
            const countData = await countResponse.json();

            if (countData.count === this.lastPickCount) {
                // No changes, extend cache timestamps but don't fetch full data
                this.extendCacheTimestamps();
                return;
            }

            // Changes detected, fetch full data
            this.lastPickCount = countData.count;
            await this.fetchFullData();

        } catch (error) {
            console.error('Error fetching data:', error);
            // On error, slow down polling
            if (this.pollingInterval) {
                clearInterval(this.pollingInterval);
                this.pollingInterval = setInterval(() => {
                    this.fetchDataOnce();
                }, 60000); // Slow down to 60 seconds on error
            }
        }
    }

    // Fetch full data
    async fetchFullData() {
        if (!this.draftId) return;

        try {
            // First get picks to extract player list
            const picksResponse = await fetch(`/picks?draft_id=${this.draftId}`);
            const picks = await picksResponse.json();

            // Extract player list for player_lookup
            const playerList = picks.map(pick => ({
                first_name: pick.metadata.first_name,
                last_name: pick.metadata.last_name,
                position: pick.metadata.position
            }));

            // Fetch inflation and player lookup in parallel
            const [inflationResponse, playerLookupResponse] = await Promise.all([
                fetch('/inflation', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ draft_id: this.draftId })
                }),
                fetch('/player_lookup', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ players: playerList })
                })
            ]);

            const [inflation, playerLookup] = await Promise.all([
                inflationResponse.json(),
                playerLookupResponse.json()
            ]);

            // Cache the data
            this.cache.set('picks', picks);
            this.cache.set('inflation', inflation);
            this.cache.set('playerLookup', playerLookup);
            this.cache.set('lastUpdate', Date.now());

            // Notify subscribers
            this.notifySubscribers({
                picks,
                inflation,
                playerLookup,
                lastUpdate: Date.now()
            });

        } catch (error) {
            console.error('Error fetching full data:', error);
        }
    }

    // Extend cache timestamps without fetching new data
    extendCacheTimestamps() {
        const lastUpdate = this.cache.get('lastUpdate');
        if (lastUpdate) {
            this.cache.set('lastUpdate', Date.now());
        }
    }

    // Get cached data
    getCachedData() {
        return {
            picks: this.cache.get('picks') || [],
            inflation: this.cache.get('inflation') || {},
            playerLookup: this.cache.get('playerLookup') || {},
            lastUpdate: this.cache.get('lastUpdate') || 0
        };
    }

    // Clear cache
    clearCache() {
        this.cache.clear();
        this.lastPickCount = 0;
    }
}

// Create singleton instance
const dataService = new DataService();
export { dataService }; 