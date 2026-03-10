# Poker Buy-In/Cash-Out Tracker - Project Plan

## Project Overview
A miniapp for tracking poker home game sessions: buy-ins, rebuys, cash-outs, and bank/cash payment methods.

## Tech Stack
- Next.js 14+ (App Router)
- TypeScript
- Tailwind CSS (earth tones, clean minimal UI)
- LocalStorage for data persistence (no backend needed)
- PWA-ready for iPad browser use

## Core Features
1. **Session Management**
   - Create new session
   - View past sessions list
   - Click to view session details

2. **Player Management**
   - Add players to session
   - Track buy-in amounts
   - Quick rebuy buttons ($50, $100, custom)
   - Payment method: Cash (pay now) or Bank (pay later)

3. **Cash Out & Calculations**
   - Enter final stack amount per player
   - Auto-calculate profit/loss
   - Cash players: get full stack paid out
   - Bank players: only profit via bank, or owe losses

4. **Bank Player Logic**
   - Biggest winner = session bank
   - Handles all bank transfers

5. **UI/UX**
   - Clean, minimalistic
   - Earth tone colors (Claude-style)
   - iPad-optimized touch interface
   - Intuitive flow

## Project Structure
```
poker-tracker/
├── app/
│   ├── page.tsx              # Home / session list
│   ├── session/
│   │   ├── [id]/
│   │   │   └── page.tsx      # Session detail view
│   │   └── new/
│   │       └── page.tsx      # Create new session
│   ├── layout.tsx
│   └── globals.css
├── components/
│   ├── SessionCard.tsx
│   ├── PlayerRow.tsx
│   ├── BuyInModal.tsx
│   ├── CashOutModal.tsx
│   └── RebuyButtons.tsx
├── lib/
│   ├── types.ts
│   ├── storage.ts
│   └── calculations.ts
├── public/
└── package.json
```

## Color Palette (Earth Tones)
- Background: #FAFAF8 (warm off-white)
- Card/Container: #FFFFFF
- Primary: #8B7355 (warm brown)
- Secondary: #A0926D (tan)
- Accent: #6B8E6B (sage green for positive)
- Danger: #B87070 (muted red for negative)
- Text: #3D3D3D (soft black)
- Text Secondary: #6B6B6B
- Border: #E8E4E0

## Data Models

### Session
```typescript
interface Session {
  id: string;
  name: string;
  date: string;
  createdAt: number;
  players: Player[];
  status: 'active' | 'completed';
  bankPlayerId?: string; // Biggest winner
}
```

### Player
```typescript
interface Player {
  id: string;
  name: string;
  buyIns: BuyIn[];
  cashOut?: number;
  paymentMethod: 'cash' | 'bank';
}
```

### BuyIn
```typescript
interface BuyIn {
  id: string;
  amount: number;
  timestamp: number;
}
```

## Calculation Logic
- Total Buy-In = sum of all buy-ins
- Profit/Loss = Cash Out - Total Buy-In
- Cash player payout: Full cash out amount
- Bank player settlement: Only profit (receive) or loss (owe)

## Testing Checklist
- [ ] Create session
- [ ] Add multiple players
- [ ] Add buy-ins with quick buttons
- [ ] Add custom buy-in amount
- [ ] Switch payment methods
- [ ] Cash out players
- [ ] Verify profit/loss calculations
- [ ] Verify bank player identification
- [ ] View past sessions
- [ ] Session detail view works
- [ ] Data persists after refresh
- [ ] iPad touch-friendly

## Subagent Tasks
1. **Setup Agent**: Initialize Next.js project, install deps, configure Tailwind
2. **Types Agent**: Create TypeScript interfaces and types
3. **Storage Agent**: Implement LocalStorage persistence layer
4. **Components Agent**: Build UI components (SessionCard, PlayerRow, modals)
5. **Pages Agent**: Build main pages (home, new session, session detail)
6. **Logic Agent**: Implement calculations and business logic
7. **Styling Agent**: Apply earth tone theme, iPad optimization
8. **Testing Agent**: End-to-end testing and bug fixes
