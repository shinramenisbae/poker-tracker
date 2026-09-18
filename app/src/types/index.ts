export interface Session {
  id: string;
  createdAt: number;
  updatedAt: number;
  date: string;
  status: 'active' | 'completed';
  players: Player[];
  bankPlayerId: string | null;
  notes: string;
  gameType: 'in-person' | 'online';
  discordThreadId: string | null;
  /** Set once the bank player has been paid by everyone AND paid the winners
   *  out. Distinct from `status`, which only means the game itself finished. */
  settledAt: string | null;
  settledBy: string | null;
  /** Taken off the table before anyone is paid; $0 when none was taken. */
  rakeAmount: number;
  /** Who is holding it, by name. null means whoever banks this session. */
  rakeHolder: string | null;
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
  // ISO string from the API (server-side entry time); ms number in legacy data.
  timestamp: number | string;
  notes: string;
  isRebuy?: number | boolean;
  // 'top-up' = added chips while still stacked; 'stacked' = lost the full stack.
  rebuyType?: 'top-up' | 'stacked' | null;
  // Optional hand they got stacked with, e.g. "AA" or "KK vs 76s".
  stackedHand?: string | null;
}

export interface CashOut {
  amount: number;
  timestamp: number;
}

export interface SessionTotals {
  totalPot: number;
  totalCashOut: number;
  rake: number;
  isBalanced: boolean;
}

export interface RakeSummary {
  amount: number;
  holderName: string;
  /** The banker is holding it, so no money moves for the rake. */
  holderIsBank: boolean;
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
  /** null when no rake was taken. */
  rake: RakeSummary | null;
}

export interface AppSettings {
  currency: 'USD' | 'EUR' | 'GBP' | 'NZD';
  defaultBuyIn: number;
  commonPlayers: string[];
}