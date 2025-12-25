export interface Position {
    id: string;
    user_id: string;
    user_account_id: string;
    symbol: string;
    side: 'long' | 'short';
    entry_price: number;
    quantity: number;
    leverage: number;
    stop_loss?: number;
    take_profit?: number;
    status: 'open' | 'closed';
}

export interface UserAccount {
    id: string;
    user_id: string;
    challenge_id: string;
    status: 'active' | 'passed' | 'failed';
    balance: number;
    equity: number;
    initial_balance: number;
    daily_loss_limit: number; // Percentage or absolute value
    max_drawdown: number;     // Percentage or absolute value
}
