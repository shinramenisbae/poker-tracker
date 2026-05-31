# Tribe Poker Tracker

A full-stack web application for tracking home poker game sessions. Manages player buy-ins, rebuys, cash-outs, and automatic settlement calculations.

Built with React + TypeScript on the frontend and Express.js + SQLite on the backend.

## Features

- **Session Management** — Create, track, and complete poker sessions with notes and date tracking
- **Player Tracking** — Add players, record buy-ins (cash or bank), rebuys, and cash-outs per session
- **Quick Buy-In Buttons** — Predefined $50 and $100 buy-in buttons, plus custom amounts
- **Automatic Settlement** — Calculates who owes whom at the end of a session, splitting across cash and bank transfers
- **Bank Player System** — Identifies the biggest winner as the "bank player" who handles settlement distributions
- **Statistics & Leaderboard** — Lifetime player stats, biggest wins/losses, session history, and a global leaderboard
- **Multi-Currency Support** — USD, EUR, GBP, and NZD
- **Common Players** — Quick-add buttons for frequently playing members
- **Responsive Design** — Earth-tone UI optimized for iPad/tablet use

## Tech Stack

| Layer    | Technology                          |
|----------|-------------------------------------|
| Frontend | React 19, TypeScript 5.9, Vite 7.3 |
| Styling  | Tailwind CSS 3.4                    |
| Routing  | React Router 7                      |
| Backend  | Express 4.18, Node.js              |
| Database | SQLite 3 (via sqlite3 5.1)          |
| Dates    | date-fns 4.1                        |

## Project Structure

```
poker-tracker/
├── app/                        # Frontend (React + Vite)
│   ├── src/
│   │   ├── api/index.ts        # API client
│   │   ├── components/         # Reusable UI components
│   │   │   ├── BuyInButtons.tsx
│   │   │   ├── CashOutModal.tsx
│   │   │   ├── PlayerRow.tsx
│   │   │   ├── SessionCard.tsx
│   │   │   └── SettlementView.tsx
│   │   ├── hooks/useStorage.ts # Custom hooks (sessions, settings, localStorage)
│   │   ├── pages/              # Route pages
│   │   │   ├── Home.tsx
│   │   │   ├── NewSession.tsx
│   │   │   ├── SessionDetail.tsx
│   │   │   ├── Results.tsx
│   │   │   ├── Stats.tsx
│   │   │   └── Settings.tsx
│   │   ├── types/index.ts      # TypeScript interfaces
│   │   └── utils/
│   │       ├── calculations.ts # Settlement & P/L logic
│   │       └── id.ts
│   ├── index.html
│   ├── tailwind.config.js
│   └── vite.config.ts
│
├── backend/
│   ├── server.js               # Express API server (port 5001)
│   ├── database.js             # SQLite schema & initialization
│   └── package.json
│
├── deploy.sh                   # Deployment script
├── PROJECT_PLAN.md
├── DESIGN.md
└── SPEC.md
```

## Getting Started

### Prerequisites

- Node.js (v18+)
- npm

### Installation

```bash
# Clone the repository
git clone https://github.com/shinramenisbae/poker-tracker.git
cd poker-tracker

# Install backend dependencies
cd backend
npm install

# Install frontend dependencies
cd ../app
npm install
```

### Running Locally

Start the backend server:

```bash
cd backend
npm run dev    # Runs with nodemon on port 5001
```

In a separate terminal, start the frontend dev server:

```bash
cd app
npm run dev    # Runs Vite dev server
```

### Building for Production

```bash
cd app
npm run build  # Outputs to app/dist/
```

## API Endpoints

All endpoints are served from port `5001` under the `/api` prefix.

### Sessions

| Method | Endpoint            | Description                         |
|--------|---------------------|-------------------------------------|
| GET    | `/api/sessions`     | List all sessions (newest first)    |
| GET    | `/api/sessions/:id` | Get a single session                |
| POST   | `/api/sessions`     | Create a new session                |
| PUT    | `/api/sessions/:id` | Update session (status, notes, etc) |
| DELETE | `/api/sessions/:id` | Delete a session                    |

### Players & Buy-ins

| Method | Endpoint                                        | Description          |
|--------|-------------------------------------------------|----------------------|
| POST   | `/api/sessions/:id/players`                     | Add player to session|
| POST   | `/api/sessions/:id/players/:playerId/buyins`    | Record a buy-in      |
| PUT    | `/api/sessions/:id/players/:playerId/cashout`   | Record a cash-out    |

All mutation endpoints return the full updated session object with nested players and buy-ins.

## Database Schema

Three SQLite tables with foreign key cascading deletes:

- **sessions** — `id`, `date`, `status` (active/completed), `notes`, `bankPlayerId`, `createdAt`, `updatedAt`
- **players** — `id`, `sessionId`, `name`, `paymentMethod`, `cashOutAmount`, `cashOutDate`
- **buyIns** — `id`, `playerId`, `amount`, `timestamp`, `isRebuy`, `method` (cash/bank)

## Settlement Logic

When a session ends, the app calculates settlements:

1. Identifies the **bank player** (biggest winner)
2. Separates buy-ins into **cash pool** (physical cash on table) and **bank transfers**
3. Winners receive proportional shares of the cash pool; any remaining amount owed is settled via bank transfer from the bank player
4. Losers with negative `netWithBank` owe bank transfers to the bank player
5. The results page shows a clear breakdown of who pays whom and by what method

## Deployment

The included `deploy.sh` script builds the frontend, copies it to `/var/www/poker-tracker/`, and restarts the backend service:

- **Frontend** (port 5000) — static build served by nginx from `/var/www/poker-tracker/` (no dedicated systemd unit)
- `tribe-poker-backend.service` — runs the API server (port 5001)

The app is deployed on a Hetzner Cloud VPS, reachable at `https://srv1346724.hstgr.cloud`.

```bash
chmod +x deploy.sh
./deploy.sh
```

Merges to `main` deploy automatically via GitHub Actions — see [docs/cicd.md](docs/cicd.md). `deploy.sh` remains available for manual deploys.

## App Pages

- **Home** (`/`) — View active and completed sessions, create new ones
- **New Session** (`/session/new`) — Set date, add notes, pick players from common list or type new names
- **Session Detail** (`/session/:id`) — Live session management: buy-ins, rebuys, cash-outs
- **Results** (`/session/:id/results`) — Post-session settlements, winners/losers breakdown
- **Stats** (`/stats`) — Lifetime leaderboard, per-player stats, biggest wins/losses
- **Settings** (`/settings`) — Currency, default buy-in amount, common players list
