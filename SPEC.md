# Poker Tracker - Technical Specification

## Overview
A mobile-first web application for tracking poker buy-ins and cash-outs during home games. Optimized for iPad/tablet use with an earth-tone aesthetic.

---

## 1. Data Models

### Session
```typescript
interface Session {
  id: string;                    // UUID v4
  createdAt: number;             // Unix timestamp (ms)
  updatedAt: number;             // Unix timestamp (ms)
  date: string;                  // ISO 8601 date (YYYY-MM-DD)
  status: 'active' | 'completed';
  players: Player[];
  bankPlayerId: string | null;   // ID of player handling settlements
  notes: string;                 // Optional session notes
}
```

### Player
```typescript
interface Player {
  id: string;                    // UUID v4
  name: string;                  // Display name
  buyIns: BuyIn[];               // Array of all buy-ins
  cashOut: CashOut | null;       // Final cash-out amount
  paymentMethod: 'cash' | 'bank'; // Preferred settlement method
}
```

### BuyIn
```typescript
interface BuyIn {
  id: string;                    // UUID v4
  amount: number;                // Buy-in amount (positive integer)
  method: 'cash' | 'bank';       // How the buy-in was paid
  timestamp: number;             // Unix timestamp (ms)
  notes: string;                 // Optional notes
}
```

### CashOut
```typescript
interface CashOut {
  amount: number;                // Final chip count/value
  timestamp: number;             // Unix timestamp (ms)
}
```

### Example Data Structure
```json
{
  "id": "sess_abc123",
  "createdAt": 1709876543210,
  "updatedAt": 1709898765432,
  "date": "2024-03-08",
  "status": "completed",
  "bankPlayerId": "player_xyz789",
  "notes": "Friday night game",
  "players": [
    {
      "id": "player_xyz789",
      "name": "Alice",
      "paymentMethod": "bank",
      "buyIns": [
        { "id": "buy_1", "amount": 100, "method": "bank", "timestamp": 1709876600000, "notes": "" },
        { "id": "buy_2", "amount": 100, "method": "bank", "timestamp": 1709880200000, "notes": "Rebuy" }
      ],
      "cashOut": { "amount": 350, "timestamp": 1709898000000 }
    }
  ]
}
```

---

## 2. Core Calculations

### 2.1 Total Buy-In Per Player
```typescript
function getTotalBuyIn(player: Player): number {
  return player.buyIns.reduce((sum, buyIn) => sum + buyIn.amount, 0);
}
```

### 2.2 Profit/Loss Calculation
```typescript
function getProfitLoss(player: Player): number | null {
  const totalBuyIn = getTotalBuyIn(player);
  if (player.cashOut === null) return null;
  return player.cashOut.amount - totalBuyIn;
}
```

### 2.3 Session Totals
```typescript
interface SessionTotals {
  totalPot: number;              // Sum of all buy-ins
  totalCashOut: number;          // Sum of all cash-outs
  isBalanced: boolean;           // totalPot === totalCashOut
}

function getSessionTotals(session: Session): SessionTotals {
  const totalPot = session.players.reduce(
    (sum, p) => sum + getTotalBuyIn(p), 0
  );
  const totalCashOut = session.players.reduce(
    (sum, p) => sum + (p.cashOut?.amount ?? 0), 0
  );
  return {
    totalPot,
    totalCashOut,
    isBalanced: totalPot === totalCashOut
  };
}
```

### 2.4 Bank Settlement Logic

The "bank" player is the session's biggest winner who handles all settlements.

#### Identifying the Bank Player
```typescript
function identifyBankPlayer(session: Session): string | null {
  const playersWithResults = session.players
    .map(p => ({ id: p.id, profit: getProfitLoss(p) }))
    .filter(p => p.profit !== null && p.profit > 0)
    .sort((a, b) => b.profit! - a.profit!);
  
  return playersWithResults.length > 0 ? playersWithResults[0].id : null;
}
```

#### Settlement Calculations

For each player, calculate what they owe or are owed:

```typescript
interface Settlement {
  playerId: string;
  playerName: string;
  amount: number;        // Positive = receives money, Negative = pays money
  method: 'cash' | 'bank';
  netFlow: 'to_bank' | 'from_bank' | 'even';
}

function calculateSettlements(session: Session): Settlement[] {
  const bankId = session.bankPlayerId;
  if (!bankId) return [];
  
  return session.players.map(player => {
    const profit = getProfitLoss(player);
    const totalBuyIn = getTotalBuyIn(player);
    
    if (profit === null) {
      return { playerId: player.id, playerName: player.name, amount: 0, method: player.paymentMethod, netFlow: 'even' };
    }
    
    // Cash players: get their full stack back (they paid cash in, get cash out)
    // Bank players: only settle profit/loss via bank transfer
    
    if (player.paymentMethod === 'cash') {
      // Cash player paid cash for buy-ins, receives cash for cash-out
      // Net settlement with bank = profit (if positive, bank pays them; if negative, they pay bank)
      return {
        playerId: player.id,
        playerName: player.name,
        amount: profit,
        method: 'cash',
        netFlow: profit > 0 ? 'from_bank' : profit < 0 ? 'to_bank' : 'even'
      };
    } else {
      // Bank player: settle the difference
      // If profit > 0: bank pays them their winnings
      // If profit < 0: they pay bank their losses
      return {
        playerId: player.id,
        playerName: player.name,
        amount: profit,
        method: 'bank',
        netFlow: profit > 0 ? 'from_bank' : profit < 0 ? 'to_bank' : 'even'
      };
    }
  });
}
```

#### Settlement Summary
```typescript
interface SettlementSummary {
  bankPlayerId: string;
  bankPlayerName: string;
  settlements: Settlement[];
  cashToCollect: number;      // Total cash the bank needs to collect from losers
  cashToDistribute: number;   // Total cash the bank needs to give to winners
  bankTransfersOut: number;   // Total bank transfers bank needs to send
  bankTransfersIn: number;    // Total bank transfers bank needs to receive
}

function getSettlementSummary(session: Session): SettlementSummary | null {
  const bankId = session.bankPlayerId;
  const bankPlayer = session.players.find(p => p.id === bankId);
  if (!bankId || !bankPlayer) return null;
  
  const settlements = calculateSettlements(session);
  
  return {
    bankPlayerId: bankId,
    bankPlayerName: bankPlayer.name,
    settlements,
    cashToCollect: settlements
      .filter(s => s.method === 'cash' && s.netFlow === 'to_bank')
      .reduce((sum, s) => sum + Math.abs(s.amount), 0),
    cashToDistribute: settlements
      .filter(s => s.method === 'cash' && s.netFlow === 'from_bank')
      .reduce((sum, s) => sum + s.amount, 0),
    bankTransfersOut: settlements
      .filter(s => s.method === 'bank' && s.netFlow === 'from_bank')
      .reduce((sum, s) => sum + s.amount, 0),
    bankTransfersIn: settlements
      .filter(s => s.method === 'bank' && s.netFlow === 'to_bank')
      .reduce((sum, s) => sum + Math.abs(s.amount), 0)
  };
}
```

---

## 3. UI/UX Design

### 3.1 Color Palette (Earth Tones)

| Token | Hex | Usage |
|-------|-----|-------|
| `--bg-primary` | `#FAF9F7` | Main background (warm off-white/cream) |
| `--bg-secondary` | `#F5F3EF` | Card backgrounds, secondary surfaces |
| `--bg-tertiary` | `#EDE9E3` | Input fields, elevated surfaces |
| `--surface-hover` | `#E8E4DE` | Hover states |
| `--border` | `#D9D4CC` | Borders, dividers |
| `--border-strong` | `#C4BDB2` | Focused borders |
| `--text-primary` | `#2D2A26` | Primary text (soft black) |
| `--text-secondary` | `#6B6560` | Secondary text, labels |
| `--text-muted` | `#9A948D` | Placeholder text, hints |
| `--accent-brown` | `#8B7355` | Primary accent (warm brown) |
| `--accent-brown-hover` | `#6B5A45` | Accent hover state |
| `--accent-green` | `#5A7D5A` | Positive/profit (muted sage) |
| `--accent-red` | `#A65D5D` | Negative/loss (muted terracotta) |
| `--accent-amber` | `#C4A35A` | Warning, attention (muted gold) |

### 3.2 Typography

- **Font Family**: System UI stack (`-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`)
- **Base Size**: 16px (accessible default)
- **Scale**: 
  - Display: 2rem (32px)
  - H1: 1.5rem (24px)
  - H2: 1.25rem (20px)
  - H3: 1.125rem (18px)
  - Body: 1rem (16px)
  - Small: 0.875rem (14px)
  - Caption: 0.75rem (12px)

### 3.3 Spacing Scale

- `xs`: 0.25rem (4px)
- `sm`: 0.5rem (8px)
- `md`: 1rem (16px)
- `lg`: 1.5rem (24px)
- `xl`: 2rem (32px)
- `2xl`: 3rem (48px)

### 3.4 Touch Targets

- Minimum touch target: 44x44px
- Button height: 56px (primary), 48px (secondary)
- Input height: 56px
- Card padding: 1.5rem
- List item padding: 1rem vertical, 1.25rem horizontal

### 3.5 Border Radius

- Small (inputs, badges): 8px
- Medium (cards, buttons): 12px
- Large (modals, sheets): 16px
- Full (pills, avatars): 9999px

### 3.6 Shadows

```css
--shadow-sm: 0 1px 2px rgba(45, 42, 38, 0.05);
--shadow-md: 0 4px 6px -1px rgba(45, 42, 38, 0.08), 0 2px 4px -1px rgba(45, 42, 38, 0.04);
--shadow-lg: 0 10px 15px -3px rgba(45, 42, 38, 0.08), 0 4px 6px -2px rgba(45, 42, 38, 0.04);
```

### 3.7 Component Styles

#### Buttons
- **Primary**: `bg-accent-brown`, white text, 56px height, 12px radius
- **Secondary**: `bg-transparent`, `border-border`, `text-primary`, 48px height
- **Danger**: `bg-accent-red`, white text
- **Ghost**: Transparent, `text-secondary`, hover `bg-surface-hover`

#### Cards
- Background: `bg-secondary`
- Border: 1px solid `border`
- Border radius: 12px
- Padding: 1.5rem
- Shadow: `shadow-sm`

#### Inputs
- Background: `bg-tertiary`
- Border: 1px solid transparent (1px solid `border-strong` when focused)
- Border radius: 8px
- Height: 56px
- Padding: 0 1rem
- Font size: 1rem

#### Chips/Badges
- Background: `bg-tertiary`
- Border radius: 9999px (pill)
- Padding: 0.25rem 0.75rem
- Font size: 0.875rem

---

## 4. Pages/Routes

### 4.1 Home (`/`)
**Purpose**: Session list and app entry point

**Layout**:
- Header with app title "Poker Tracker" and settings icon
- Scrollable list of sessions (newest first)
- Floating Action Button (FAB) to create new session

**Session Card**:
- Date (formatted: "Today", "Yesterday", "Monday, Mar 8")
- Status badge (Active/Completed)
- Player count and total pot
- Tap to view session

**Empty State**:
- Illustration/icon
- "No sessions yet"
- "Start your first game" CTA button

**Actions**:
- Tap session → Navigate to Session Detail
- Tap FAB → Navigate to New Session
- Swipe session (optional) → Delete with confirmation

---

### 4.2 New Session (`/session/new`)
**Purpose**: Create a new poker session

**Layout**:
- Header with back button and "New Session" title
- Form content
- Sticky footer with "Create Session" button

**Form Fields**:
1. Date picker (default: today)
2. Notes textarea (optional)

**Quick Start Options**:
- "Add players now" → Go to Session Detail after creation
- "Start with common players" → Show checklist of previously used players

**Actions**:
- Back → Return to Home
- Create Session → Create and navigate to Session Detail

---

### 4.3 Session Detail (`/session/:id`)
**Purpose**: Active game management - add players, track buy-ins, cash out

**States**:
- **Active**: Can add buy-ins, edit players
- **Completed**: Read-only, show results preview

**Layout**:
- Header with back button, session date, status badge
- Session summary card (total pot, player count)
- Player list (main content)
- Bottom action bar

**Player List Item**:
- Name and payment method badge (Cash/Bank)
- Total buy-in amount
- Chip count input (if cashing out) or "Cash Out" button
- Profit/loss preview (if cashed out)
- Expandable: Show all buy-ins with timestamps

**Player Actions (Sheet/Modal)**:
- Add Buy-in (amount + method)
- Edit Name/Method
- Cash Out (enter final amount)
- Remove Player (with confirmation)

**Bottom Action Bar**:
- "Add Player" button (primary)
- "End Session" button (secondary, disabled until all players cashed out)

**Add Player Flow**:
1. Tap "Add Player"
2. Bottom sheet opens
3. Enter name
4. Select payment method (Cash/Bank toggle)
5. Optional: Initial buy-in amount
6. Save

**Add Buy-in Flow**:
1. Tap on player row
2. Action sheet opens
3. Select "Add Buy-in"
4. Enter amount
5. Confirm method (default to player's method)
6. Save

**Cash Out Flow**:
1. Tap "Cash Out" on player row
2. Full-screen modal with number pad
3. Enter final chip count
4. Confirm

**Actions**:
- Back → Return to Home
- End Session (when all cashed out) → Navigate to Session Results

---

### 4.4 Session Results (`/session/:id/results`)
**Purpose**: Final settlements and summary

**Layout**:
- Header with back button and "Results" title
- Summary cards
- Settlement list
- Share/export options

**Summary Section**:
- Total pot amount
- Session duration (calculated from first buy-in to last cash-out)
- Bank player identification
- Balance check indicator (green check if balanced, warning if not)

**Player Results List**:
For each player:
- Name
- Total buy-in
- Cash out amount
- **Profit/Loss with color coding** (green positive, red negative)
- Settlement instruction

**Settlement Section**:
Grouped by action needed:
- "Cash to Collect" (who owes cash to bank)
- "Cash to Distribute" (who gets cash from bank)
- "Bank Transfers" (net settlement amounts)

**Settlement Item**:
- Player name
- Amount
- Direction (to/from bank)
- Method icon (cash/bank)

**Actions**:
- Back → Return to Session Detail
- "Mark as Complete" → Archive session, return to Home
- "Share Results" → Copy text summary to clipboard

**Share Text Format**:
```
Poker Night - Mar 8, 2024

Total Pot: $500

Results:
• Alice: +$150 🏆 (Bank)
• Bob: -$100
• Charlie: -$50

Settlements:
• Bob pays Alice $100 (cash)
• Charlie pays Alice $50 (bank)
```

---

## 5. Tech Stack Recommendation

### 5.1 Recommended: React + TypeScript + Vite

**Rationale**:
- Excellent TypeScript support
- Large ecosystem and community
- Component-based architecture fits the UI well
- Vite provides fast development and optimized builds

**Core Dependencies**:
```json
{
  "react": "^18.x",
  "react-dom": "^18.x",
  "react-router-dom": "^6.x",
  "typescript": "^5.x",
  "vite": "^5.x",
  "uuid": "^9.x",
  "date-fns": "^3.x"
}
```

**Styling Options** (choose one):
1. **Tailwind CSS** (Recommended)
   - Utility-first, rapid development
   - Easy to implement design system
   - Built-in responsive design

2. **CSS Modules + PostCSS**
   - Scoped styles
   - More explicit, less magic

**State Management**:
- **Zustand** - Lightweight, simple API
- Or React Context + useReducer for simpler state needs

**Storage**:
- localStorage for persistence
- Optional: IndexedDB via idb-keyval for larger data

### 5.2 Alternative: Svelte + SvelteKit

**Rationale**:
- Less boilerplate than React
- Built-in animations and transitions
- Smaller bundle size
- Excellent developer experience

**Trade-offs**:
- Smaller ecosystem
- Fewer third-party components

### 5.3 Project Structure

```
poker-tracker/
├── src/
│   ├── components/           # Reusable UI components
│   │   ├── Button.tsx
│   │   ├── Card.tsx
│   │   ├── Input.tsx
│   │   ├── PlayerCard.tsx
│   │   ├── BuyInForm.tsx
│   │   ├── CashOutForm.tsx
│   │   └── SettlementView.tsx
│   ├── pages/                # Route components
│   │   ├── Home.tsx
│   │   ├── NewSession.tsx
│   │   ├── SessionDetail.tsx
│   │   └── SessionResults.tsx
│   ├── hooks/                # Custom React hooks
│   │   ├── useSessions.ts
│   │   ├── useLocalStorage.ts
│   │   └── useSessionCalculations.ts
│   ├── stores/               # State management
│   │   └── sessionStore.ts
│   ├── utils/                # Helper functions
│   │   ├── calculations.ts   # All calculation logic
│   │   ├── formatters.ts     # Date/currency formatting
│   │   └── storage.ts        # localStorage helpers
│   ├── types/                # TypeScript definitions
│   │   └── index.ts
│   ├── constants/            # App constants
│   │   └── theme.ts          # Colors, spacing
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css
├── public/
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
└── tailwind.config.ts
```

### 5.4 Data Persistence

**localStorage Schema**:
```typescript
// Key: 'poker-tracker-sessions'
// Value: Session[] (JSON serialized)

interface StorageSchema {
  'poker-tracker-sessions': Session[];
  'poker-tracker-settings': AppSettings;
}

interface AppSettings {
  currency: 'USD' | 'EUR' | 'GBP' | 'NZD';
  defaultBuyIn: number;
  commonPlayers: string[];  // Names of frequently used players
}
```

**Storage Hooks**:
```typescript
// hooks/useLocalStorage.ts
function useLocalStorage<T>(key: string, initialValue: T): [T, (value: T) => void];

// hooks/useSessions.ts
function useSessions(): {
  sessions: Session[];
  addSession: (session: Omit<Session, 'id' | 'createdAt'>) => void;
  updateSession: (id: string, updates: Partial<Session>) => void;
  deleteSession: (id: string) => void;
  getSession: (id: string) => Session | undefined;
};
```

### 5.5 PWA Configuration

For iPad-native feel:
- Add `manifest.json` for home screen installation
- Service worker for offline functionality
- `apple-mobile-web-app-capable` meta tags
- Touch icons and splash screens

```html
<!-- index.html -->
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="Poker Tracker">
```

---

## 6. Future Enhancements

- [ ] Cloud sync (Firebase/Supabase)
- [ ] Multi-currency support
- [ ] Player statistics and history
- [ ] Export to CSV/Excel
- [ ] Dark mode
- [ ] Custom themes
- [ ] Receipt/photo attachment for buy-ins
- [ ] Push notifications for long-running sessions

---

## 7. Development Checklist

- [ ] Project setup (Vite + React + TS + Tailwind)
- [ ] Type definitions for all data models
- [ ] localStorage persistence layer
- [ ] Home page with session list
- [ ] New Session page
- [ ] Session Detail page (active game)
- [ ] Add/Edit/Remove player functionality
- [ ] Buy-in tracking
- [ ] Cash out flow
- [ ] Session Results page with settlements
- [ ] Share results functionality
- [ ] PWA configuration
- [ ] iPad touch optimization
- [ ] Test with real game scenarios
