# Fantasy Football Inflation Calculator

A real-time fantasy football auction draft inflation calculator with enhanced performance, modern architecture, and advanced analytics.

## 🚀 **Enhanced Features**

- **Enhanced FastAPI Backend**: High-performance async API with smart caching
- **Draft Economy**: Forward-looking view of money left against value left, with
  a per-position demand model — see below
- **Real-time Updates**: 3-second polling with change detection via DataService
- **Advanced Analytics**: Trending spend analysis, cost of waiting calculations, and position-based R² analysis
- **Enhanced ScatterPlot**: Linear regression, cost calculations, and position breakdowns
- **Smart Caching**: 1-second draft TTL so each poll gets fresh picks, with a
  pick-count endpoint that skips the work entirely when nothing has sold
- **2026 Data Integration**: ETR standard-scoring auction values and FantasyPros tiers
- **Player Notes System**: Hybrid localStorage + static JSON notes with targets and priorities

## 📁 **Project Structure**

```
inflaction_calculator/
├── backend/
│   ├── fastapi_backend_enhanced.py    # Main Enhanced FastAPI application
│   ├── start_enhanced_backend.py      # Enhanced backend startup script
│   ├── requirements_fastapi.txt       # FastAPI dependencies
│   ├── build_year_data.py             # ETR + FantasyPros exports -> year folder
│   ├── build_player_mappings.py       # Generates the annual name-anomaly file
│   ├── 2026/                          # Latest year data (highest year folder wins)
│   ├── 2025/                          # Historical data
│   ├── 2024/                          # Historical data
│   ├── 2023/                          # Historical data
│   └── archive_old_files/             # Archived old Flask files
├── scripts/
│   ├── run-backend.js                 # Cross-platform backend launcher
│   └── setup-backend.js               # Creates backend/.venv, installs deps
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

Runs on Windows and macOS/Linux. You need **Node 18+** and **Python 3.11+**.

macOS ships Python 3.9 as `python3`, and `brew install python@3.11` installs
alongside it as `python3.11` rather than replacing it — so the bare name is
usually the wrong interpreter on a Mac. `npm run setup` probes `python3.13`,
`python3.12`, `python3.11`, then `python3`, and uses the first that meets the
floor; `BACKEND_PYTHON` overrides the search.

### First time
```bash
npm run setup      # installs node deps, then creates backend/.venv and installs Python deps
```

### Every time after that
```bash
npm start          # frontend on :3000, backend on :5050, concurrently
```

Then open http://localhost:3000 and enter a Sleeper draft ID. The backend's own
docs are at http://localhost:5050/docs, and http://localhost:5050/health reports
which data year it loaded — check that it says the year you expect.

### Running the halves separately
```bash
npm run backend    # FastAPI on :5050
npm run frontend   # React dev server on :3000
```

`npm run backend` goes through `scripts/run-backend.js`, which resolves a Python
that can actually import the dependencies — `$BACKEND_PYTHON` if set, else
`backend/.venv` or `backend/venv` (`bin/python` on macOS/Linux,
`Scripts\python.exe` on Windows), else `python3`/`python` from PATH. If none of
them can, it says so and points at `npm run setup:backend` rather than failing
with an import error halfway through boot.

To use a Python you already have:
```bash
# macOS / Linux
BACKEND_PYTHON=/path/to/python npm run backend
# Windows (PowerShell)
$env:BACKEND_PYTHON="C:\path\to\python.exe"; npm run backend
```

### Manual backend setup
```bash
cd backend
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements_fastapi.txt
python start_enhanced_backend.py
```

## 🧪 **Tests**

```bash
python3 -m pytest tests/            # backend: mappings, draft economy, board
cd frontend && CI=true npm test     # frontend: ticker sorting
```

The backend tests load the real data folder, so they also catch a bad annual
build — a values file whose names stop matching the rankings will fail
`test_player_mappings.py` rather than quietly zeroing out expected values.

## 📅 **Annual Data Update**

Everything the backend reads lives in `backend/<YEAR>/`, and the highest year
folder wins (`DATA_YEAR=2025` pins an older one). Two raw downloads become that
folder:

League shape lives in constants at the top of
`backend/fastapi_backend_enhanced.py` — 12 teams, $200, 16 roster slots, and the
starter shape the demand model needs. 2026 dropped the kicker, and the roster
stayed 16 deep, so that seat is treated as bench; `ROSTER_SLOTS=15` overrides it
if the roster shortened instead.

1. **FantasyPros draft rankings** — the combined ALL-positions export
   (`FantasyPros_<YEAR>_Draft_ALL_Rankings.csv`). FantasyPros stopped shipping
   four separate positional files; the build script splits it back out.
2. **ETR auction values** (`NFL_ETR_Auction_Values.csv`). Their 2026 export
   replaced the single `Value` column with one per scoring format — `ETR Full
   PPR`, `ETR Half PPR`, `ETR Std`, `ETR Superflex Full/Half` — plus ESPN and
   Yahoo ADP and a gsis player id. The league plays **standard (non-PPR)**
   scoring, so `ETR Std` is the default; `--scoring full_ppr` (or `half_ppr`,
   `superflex_full`, ...) picks another.

   Careful: `Standard_Auction_Values.csv` is named for its *role* — it has been
   the canonical values file since 2023 — and that name is unrelated to standard
   scoring. Which column a year folder was actually built from is recorded in
   `<YEAR>/build_info.json`, so you never have to infer it from the filename.

Drop both into `backend/<YEAR>/`, then:

```bash
cd backend
python build_year_data.py --year 2026 \
    --etr 2026/NFL_ETR_Auction_Values.csv \
    --fantasypros 2026/FantasyPros_2026_Draft_ALL_Rankings.csv \
    --scoring standard
python build_player_mappings.py --year 2026 --draft-id <any completed Sleeper draft>
cd .. && python -m unittest tests.test_player_mappings
```

`build_year_data.py` writes `Standard_Auction_Values.csv`, the four positional
ranking files, and `build_info.json` recording the scoring format and sources. FantasyPros' tiers in the ALL export are *overall* (a QB starts at
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
- `GET /available_players` - Available and drafted players with tier, positional rank and value
- `GET /draft_economy` - Money left vs value left, per-position demand, per-team wallets

## 🔧 **Frontend Components**

### Enhanced ScatterPlot
- **Trending Analysis**: Linear regression with slope and R² calculations
- **Cost of Waiting**: Real-time calculations for different pick intervals
- **Position Breakdown**: Average spend, min/max, and R² by position
- **Interactive Visualizations**: Plotly.js integration with responsive design

### Ticker
- **Sortable Columns**: Pick, team, player, position, price, EP, DOE, inflation, tier
- **Real-time Updates**: DataService integration for live updates
- **Sorting Rules**: Money sorts numerically (Sleeper sends prices as strings),
  players the sheet doesn't price sort last rather than as $0, and ties fall
  back to newest first

### DraftEconomy
- **Headline Multiplier**: Spendable cash over buyable value, both measured
  above the $1 floor, so roster filler doesn't drag the number toward 1.00
- **Positional Demand**: Each team's spendable money split across the starter
  slots it still needs, weighted by the going rate at that position. Divided by
  the value left there, it says which positions will run over sheet
- **Team Wallets**: Spent, left, open slots, max bid and remaining needs

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
2. **Adaptive Polling**: 3-second poll against a 1-second cache, short-circuited
   by a pick-count check when nothing has sold
3. **Prebuilt Board**: Tiers resolved once at load rather than per request,
   which took `/available_players` from ~450ms to ~13ms
4. **Differential Updates**: Lightweight change detection endpoint
5. **Optimized Lookups**: Pre-built lookup tables and fuzzy matching
6. **Memory Efficiency**: In-memory caching with automatic cleanup
7. **Parallel Processing**: Async operations with thread pool support

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
