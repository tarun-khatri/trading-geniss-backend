import { supabaseAdmin } from '../config/supabase';
import { ably } from '../config/ably';
import { Position } from '../types';

// In-memory cache for high-frequency access
// Map<Symbol, Position[]>
const positionCache = new Map<string, Position[]>();

// Re-sync interval (10 seconds) - In a real prop firm this would be handled by event-sourcing or strict consistency
const SYNC_INTERVAL = 10000;

export const startLiquidationMonitor = async () => {
    console.log('[RiskService] Starting Liquidation Monitor...');
    await syncPositions();

    setInterval(syncPositions, SYNC_INTERVAL);
};

const syncPositions = async () => {
    try {
        const { data, error } = await supabaseAdmin
            .from('positions')
            .select('*')
            .eq('status', 'open');

        if (error) throw error;

        // Clear and rebuild cache
        positionCache.clear();

        data?.forEach((pos: Position) => {
            const sym = pos.symbol.includes('BTC') ? 'BTC-USD' :
                pos.symbol.includes('ETH') ? 'ETH-USD' :
                    pos.symbol.includes('SOL') ? 'SOL-USD' :
                        pos.symbol.includes('BNB') ? 'BNB-USD' :
                            pos.symbol.includes('XRP') ? 'XRP-USD' :
                                pos.symbol.includes('ADA') ? 'ADA-USD' :
                                    pos.symbol.includes('DOGE') ? 'DOGE-USD' :
                                        pos.symbol.includes('AVAX') ? 'AVAX-USD' :
                                            pos.symbol.includes('MATIC') ? 'MATIC-USD' :
                                                pos.symbol.includes('DOT') ? 'DOT-USD' : pos.symbol;

            const current = positionCache.get(sym) || [];
            current.push(pos);
            positionCache.set(sym, current);
        });

        // console.log(`[RiskService] Synced ${data?.length} open positions`);
    } catch (err) {
        console.error('[RiskService] Error syncing positions:', err);
    }
};

// Helper function - Hoisted or defined before use
async function liquidatePosition(position: Position, closePrice: number, reason: string) {
    console.log(`[RiskService] 💀 LIQUIDATING User ${position.user_account_id} | Pos: ${position.id}`);

    try {
        // 1. Calculate PnL (Realized Loss)
        const isLong = position.side === 'long';
        const pnl = (isLong ? closePrice - position.entry_price : position.entry_price - closePrice) * position.quantity;

        // 2. Close in DB
        // NOTE: 'exit_price' column does not exist, so we don't set it. 
        // We set 'status' to 'liquidated'.
        // We update 'unrealized_pnl' to 0 (or final pnl if you want to track it there before moving to account history)
        // Ideally we should have a 'realized_pnl' column or 'history' table, but adhering to existing schema:

        const { error: posError } = await supabaseAdmin
            .from('positions')
            .update({
                status: 'liquidated', // Schema allows 'liquidated'
                closed_at: new Date().toISOString(),
                // exit_price: closePrice, // REMOVED: Column missing
                unrealized_pnl: 0
            })
            .eq('id', position.id);

        if (posError) throw posError;

        // 3. Update User Account Balance & Equity
        // We need to fetch the current account state first to subtract the loss/margin
        const { data: account, error: accFetchError } = await supabaseAdmin
            .from('user_accounts')
            .select('*')
            .eq('id', position.user_account_id)
            .single();

        if (accFetchError || !account) throw accFetchError || new Error('Account not found');

        // New Balance = Old Balance + PnL (PnL is negative here)
        // Equity should also update.
        // Assuming 'balance' is cash balance.
        // New Balance = Old Balance + PnL (PnL is negative here)
        // Equity is likely calculated on the fly or separate table 'account_snapshots'.
        // We update 'balance' and 'profit_loss'.

        const newBalance = Number(account.balance) + pnl;
        const newPnl = Number(account.profit_loss || 0) + pnl;

        const { error: accUpdateError } = await supabaseAdmin
            .from('user_accounts')
            .update({
                balance: newBalance,
                profit_loss: newPnl,
                total_trades: (account.total_trades || 0) + 1,
                losing_trades: (account.losing_trades || 0) + 1 // Liquidation is always a loss
            })
            .eq('id', position.user_account_id);

        if (accUpdateError) throw accUpdateError;

        // 4. Remove from Cache
        const cached = positionCache.get(internalSymbol(position.symbol)) || [];
        positionCache.set(internalSymbol(position.symbol), cached.filter(p => p.id !== position.id));

        // 5. Notify User via Private Channel
        // We need the user_id (auth id), not the account_id, for the channel name if possible.
        // Looking at schema, partitions are by user_id? 
        // `user_accounts` has `user_id`. `positions` has `user_account_id`.
        // We fetched `account` which has `user_id`.
        if (account.user_id) {
            const channelName = `private-user-${account.user_id}`;
            ably.channels.get(channelName).publish('liquidation_alert', {
                positionId: position.id,
                symbol: position.symbol,
                closePrice,
                pnl,
                reason
            });
        }

    } catch (err) {
        console.error('[RiskService] Liquidation failed:', err);
    }
}

// Helper to standardise symbol for cache keys
const internalSymbol = (sym: string) => {
    if (sym.includes('BTC')) return 'BTC-USD';
    if (sym.includes('ETH')) return 'ETH-USD';
    if (sym.includes('SOL')) return 'SOL-USD';
    if (sym.includes('BNB')) return 'BNB-USD';
    if (sym.includes('XRP')) return 'XRP-USD';
    if (sym.includes('ADA')) return 'ADA-USD';
    if (sym.includes('DOGE')) return 'DOGE-USD';
    if (sym.includes('AVAX')) return 'AVAX-USD';
    if (sym.includes('MATIC')) return 'MATIC-USD';
    if (sym.includes('DOT')) return 'DOT-USD';
    return sym; // Fallback
};

export const checkRiskCoordinates = async (symbol: string, currentPrice: number) => {
    // Ensure we use the clean symbol format for cache lookup
    const cleanSym = internalSymbol(symbol);
    const positions = positionCache.get(cleanSym);

    if (!positions || positions.length === 0) return;

    // Utilize a promise array to handle multiple checks concurrently
    await Promise.all(positions.map(async (position) => {
        try {
            // Default leverage to 1 if missing
            const leverage = position.leverage || 1;
            const entryPrice = Number(position.entry_price);

            // Calculate Liquidation Price
            // Long: Entry * (1 - 1/Lev) e.g. 100 * (1 - 0.1) = 90
            // Short: Entry * (1 + 1/Lev) e.g. 100 * (1 + 0.1) = 110
            let liquidationPrice = 0;

            if (position.side === 'long') {
                liquidationPrice = entryPrice * (1 - (1 / leverage));
            } else {
                liquidationPrice = entryPrice * (1 + (1 / leverage));
            }

            // Check if Liquidated
            let isLiquidated = false;
            if (position.side === 'long' && currentPrice <= liquidationPrice) {
                isLiquidated = true;
            } else if (position.side === 'short' && currentPrice >= liquidationPrice) {
                isLiquidated = true;
            }

            if (isLiquidated) {
                await liquidatePosition(position, currentPrice, 'Liquidation Price Reached');
            }

        } catch (err) {
            console.error(`[RiskService] Error checking position ${position.id}:`, err);
        }
    }));
};
