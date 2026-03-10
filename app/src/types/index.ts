export interface Session {
  id: string;
  createdAt: number;
  updatedAt: number;
  date: string;
  status: 'active' | 'completed';
  players: Player[];
  bankPlayerId: string | null;
  notes: string;
}

export interface Player {
  id: string;
  name: string;
  buyIns: BuyIn[];
  cashOut: CashOut | null;
  paymentMethod: 'cash' | 'bank';
}

export interface BuyIn {
  id: string;
  amount: number;
  method: 'cash' | 'bank';
  timestamp: number;
  notes: string;
}

export interface CashOut {
  amount: number;
  timestamp: number;
}

export interface SessionTotals {
  totalPot: number;
  totalCashOut: number;
  isBalanced: boolean;
}

export interface Settlement {
  playerId: string;
  playerName: string;
  profitLoss: number;
  cashBuyIn: number;
  bankBuyIn: number;
  netWithBank: number;
  cashReceived: number;
  bankReceived: number;
  bankOwed: number;
}

export interface SettlementSummary {
  bankPlayerId: string;
  bankPlayerName: string;
  settlements: Settlement[];
  cashToCollect: number;
  cashToDistribute: number;
  bankTransfersOut: number;
  bankTransfersIn: number;
}

export interface AppSettings {
  currency: 'USD' | 'EUR' | 'GBP' | 'NZD';
  defaultBuyIn: number;
  commonPlayers: string[];
}