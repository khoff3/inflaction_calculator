# Fantasy Football Inflation Calculator

A real-time fantasy football auction draft inflation calculator with enhanced performance, modern architecture, and advanced analytics.

## 🚀 **Enhanced Features**

- **Enhanced FastAPI Backend**: High-performance async API with smart caching and 2025 data
- **Real-time Updates**: Adaptive polling with change detection via DataService
- **Advanced Analytics**: Trending spend analysis, cost of waiting calculations, and position-based R² analysis
- **Enhanced ScatterPlot**: Linear regression, cost calculations, and position breakdowns
- **Smart Caching**: 30-second draft data TTL with change detection
- **Performance Optimized**: Reduced API calls by ~80% during inactive periods
- **2025 Data Integration**: Latest fantasy football rankings and auction values
- **Player Notes System**: Hybrid localStorage + static JSON notes with targets and priorities

## 📁 **Project Structure**

```
inflaction_calculator/
├── backend/
│   ├── fastapi_backend_enhanced.py    # Main Enhanced FastAPI application
│   ├── start_enhanced_backend.py      # Enhanced backend startup script
│   ├── requirements_fastapi.txt       # FastAPI dependencies
│   ├── 2025/                          # Latest year data (QB, RB, WR, TE rankings)
│   ├── 2024/                          # Historical data
│   ├── 2023/                          # Historical data
│   └── archive_old_files/             # Archived old Flask files
├── frontend/
│   ├── src/components/                # React components
│   │   ├── EnhancedTicker.js          # Advanced ticker with caching
│   │   ├── ScatterPlot.js             # Enhanced with trending analysis
│   │   ├── Dashboard.js               # DataService integration
│   │   ├── InflationData.js           # Real-time inflation calculations
│   │   ├── TeamBreakdown.js           # Team roster analysis
│   │   ├── AvailablePlayers.js        # Available players with notes system
│   │   └── utils/
│   │       └── DataService.js         # Centralized data management
│   ├── package.json                   # Frontend dependencies
│   └── public/                        # Static assets
└── tests/                             # Test files
```

## 🛠️ **Setup & Installation**

### Quick Start (Recommended)
```bash
# Start both frontend and backend concurrently
npm start
```

### Manual Setup

#### Backend Setup
```bash
cd backend
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements_fastapi.txt
python start_enhanced_backend.py
```

#### Frontend Setup
```bash
cd frontend
npm install
npm start
```

## 📅 **Annual Data Update**

Everything the backend reads lives in `backend/<YEAR>/`, and the highest year
folder wins (`DATA_YEAR=2025` pins an older one). Two raw downloads become that
folder:

1. **FantasyPros draft rankings** — the combined ALL-positions export
   (`FantasyPros_<YEAR>_Draft_ALL_Rankings.csv`). FantasyPros stopped shipping
   four separate positional files; the build script splits it back out.
2. **ETR auction values** (`NFL_ETR_Auction_Values.csv`). Their 2026 export
   replaced the single `Value` column with one per scoring format, plus ESPN and
   Yahoo ADP and a gsis player id. Full PPR is the league's scoring and the
   default; `--scoring half_ppr` (or `superflex_full`, ...) picks another.

Drop both into `backend/<YEAR>/`, then:

```bash
cd backend
python build_year_data.py --year 2026 \
    --etr 2026/NFL_ETR_Auction_Values.csv \
    --fantasypros 2026/FantasyPros_2026_Draft_ALL_Rankings.csv
python build_player_mappings.py --year 2026 --draft-id <any completed Sleeper draft>
cd .. && python -m unittest tests.test_player_mappings
```

`build_year_data.py` writes `Standard_Auction_Values.csv` and the four positional
ranking files. FantasyPros' tiers in the ALL export are *overall* (a QB starts at
tier 4), so each position is dense-ranked back to 1..N — the tier breaks are
theirs, only the numbering changes.

`build_player_mappings.py` writes the annual anomaly file. Sleeper drops
generational suffixes, ETR drops periods, and some names differ outright
(`Kenny Gainwell` / `Kenneth Gainwell`); the first two resolve automatically, the
rest come from `KNOWN_ALIASES` in that script. Anything it can't resolve is
printed rather than guessed at, and players the sources genuinely don't cover
land in `unpriced_players.csv` — those price at $0 by design.

**Run the test before draft day.** An unmapped name doesn't raise: it resolves to
$0, which shrinks the expected-value denominator and skews every inflation
number on the board. The test walks a real draft's worth of names through the
backend's own lookup and fails on any that don't land. Without `--draft-id` the
mapping builder and the test both read `<YEAR>/sleeper_draft_names.csv`, a
checked-in snapshot of one draft's picks.

## 🎯 **Key Improvements**

- **Enhanced FastAPI Backend**: Better performance, async support, and 2025 data integration
- **Advanced Analytics**: Trending spend analysis with linear regression and R² calculations
- **Cost of Waiting**: Real-time calculations for 1, 5, 10, and 20 pick intervals
- **Position-Based Analysis**: R² values and statistics by position groups
- **Enhanced ScatterPlot**: 400+ lines of advanced analytics and visualizations
- **DataService Integration**: Centralized data management with error handling
- **Smart Caching**: Only fetches new data when changes detected
- **Adaptive Polling**: Dynamic polling frequency based on activity
- **LocalStorage Persistence**: Draft order and settings persistence

## 📊 **API Endpoints**

- `GET /health` - Health check with system information
- `GET /picks` - Draft picks data with caching
- `GET /picks/count` - Lightweight pick count for change detection
- `POST /inflation` - Inflation calculations with caching
- `GET /team_breakdown` - Team roster breakdown
- `GET /scatter_data` - Enhanced scatter plot data
- `GET /cache/stats` - Cache statistics and performance metrics
- `POST /cache/clear` - Clear cache manually
- `POST /player_lookup` - Fuzzy player name matching
- `GET /draft_notes` - Global and draft-specific player notes
- `GET /available_players` - Available players with tier and position data

## 🔧 **Frontend Components**

### Enhanced ScatterPlot
- **Trending Analysis**: Linear regression with slope and R² calculations
- **Cost of Waiting**: Real-time calculations for different pick intervals
- **Position Breakdown**: Average spend, min/max, and R² by position
- **Interactive Visualizations**: Plotly.js integration with responsive design

### EnhancedTicker
- **Advanced Caching**: Smart caching with localStorage persistence
- **Real-time Updates**: DataService integration for live updates
- **Performance Optimized**: Reduced API calls with change detection

### DataService
- **Centralized Management**: Single source of truth for all data operations
- **Error Handling**: Robust error handling and retry logic
- **Rate Limiting**: Prevents API overload during high activity
- **Polling Management**: Adaptive polling based on draft activity

### AvailablePlayers
- **Notes System**: Hybrid localStorage + static JSON notes persistence
- **Target Management**: Mark players as targets with priority levels
- **Global Notes**: Shared notes across all drafts via static JSON
- **Draft-Specific Notes**: Override global notes for specific drafts
- **Filtering**: Filter by targets only, position, tier, and value ranges
- **Real-time Updates**: Notes persist across browser sessions

## 🚀 **Performance Optimizations**

1. **Smart Caching**: Hash-based change detection with TTL
2. **Adaptive Polling**: 30-second draft data cache with change detection
3. **Differential Updates**: Lightweight change detection endpoint
4. **Optimized Lookups**: Pre-built lookup tables and fuzzy matching
5. **Memory Efficiency**: In-memory caching with automatic cleanup
6. **Parallel Processing**: Async operations with thread pool support

## 📈 **Analytics Features**

- **Trending Spend Analysis**: Linear regression on auction spending patterns
- **Cost of Waiting**: Calculate the cost of waiting different numbers of picks
- **Position-Based R²**: Statistical analysis of spending patterns by position
- **Real-time Calculations**: All analytics update in real-time as draft progresses

## 📝 **Player Notes System**

- **Hybrid Storage**: localStorage for immediate persistence + static JSON for sharing
- **Global Notes**: Edit `backend/draft_notes.json` to share notes across all drafts
- **Draft-Specific Overrides**: Local notes override global notes for specific drafts
- **Target Management**: Mark players as targets with ⭐ indicators
- **Priority Levels**: High, Medium, Low priority with color-coded badges
- **Filtering**: "Targets Only" filter to show only marked targets
- **Cross-Draft Persistence**: Notes persist across different draft sessions
- **Manual JSON Editing**: Power users can edit the JSON file directly

## 🌐 **Access Points**

- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:5050
- **API Documentation**: http://localhost:5050/docs
- **Interactive Docs**: http://localhost:5050/redoc
- **Health Check**: http://localhost:5050/health

The application now provides comprehensive fantasy football draft analytics with real-time performance and advanced statistical insights!
