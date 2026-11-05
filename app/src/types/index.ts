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
  /** How much of tonight's buy-ins a player may owe the banker. Starts at $500;
   *  a new player's limit is $0 whatever this says. */
  creditLimit: number;
  /** Who anything over the limit is paid to straight away (Nick or Stephen). */
  creditCollector: string | null;
  /** Winners are paid cash in $50s, with the difference settled by transfer.
   *  Unset on older sessions, which keep their proportional split until a cash
   *  amount is saved for them. */
  cashInFifties?: number;
  /** Only on the response to adding a buy-in: set when part of it went over
   *  the limit and has to be paid up front. */
  creditSplit?: CreditSplit | null;
}

export interface CreditSplit {
  /** Added to what the player owes the banker. */
  credit: number;
  /** Over the limit: transferred to the collector now. */
  bank: number;
  collector: string | null;
  limit: number;
  newPlayer: boolean;
}

/** 'cash' goes to the banker, or the table until there is one. 'bank' is
 *  transferred to the session's collector up front. 'credit' is owed to the
 *  banker after the game, up to the credit limit. */
export type BuyInMethod = 'cash' | 'bank' | 'credit';

export interface Player {
  id: string;
  name: string;
  buyIns: BuyIn[];
  cashOut: CashOut | null;
  paymentMethod: 'cash' | 'bank';
  /** Cash the banker hands this player, in $50s. null until someone records it. */
  cashPaid?: number | null;
}

export interface BuyIn {
  id: string;
  amount: number;
  method: BuyInMethod;
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
  /** Owed to the banker after the game. */
  creditBuyIn: number;
  /** Transferred to the collector up front; the player owes nothing for it. */
  bankBuyIn: number;
  netWithBank: number;
  cashReceived: number;
  bankReceived: number;
  bankOwed: number;
  /** Cash rounded up past what they were owed: they transfer the change back. */
  changeOwed: number;
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
  /** null when nobody bought in by bank. */
  collected: CollectedSummary | null;
  /** Whether the cash amounts were recorded, suggested, or the older split. */
  cashMode: 'saved' | 'suggested' | 'proportional';
  /** Cash collected less cash handed out; negative when more went out. */
  cashLeft: number;
}

export interface CollectedSummary {
  amount: number;
  /** null when the session never named one. */
  collectorName: string | null;
  /** The collector is banking, so no money moves for it. */
  collectorIsBank: boolean;
}

export interface AppSettings {
  currency: 'USD' | 'EUR' | 'GBP' | 'NZD';
  defaultBuyIn: number;
  commonPlayers: string[];
}