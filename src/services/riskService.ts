import { supabaseAdmin } from '../config/supabase';
import { ably } from '../config/ably';
import { Position } from '../types';

// In-memory cache for high-frequency access
// Map<Symbol, Position[]>
const positionCache = new Map<string, Position[]>();
// Map<AccountId, AccountData>
const accountCache = new Map<string, any>();

// Re-sync interval (10 seconds)
const SYNC_INTERVAL = 10000;

export const startLiquidationMonitor = async () => {
    console.log('[RiskService] Starting Liquidation Monitor...');
    await syncPositions();

    setInterval(syncPositions, SYNC_INTERVAL);
};

const syncPositions = async () => {
    try {
        // Fetch positions with Account and Challenge details
        const { data, error } = await supabaseAdmin
            .from('positions')
            .select(`
                *,
                user_accounts (
                    *,
                    challenges (*)
                )
            `)
            .eq('status', 'open');

        if (error) throw error;

        // Clear and rebuild caches
        positionCache.clear();
        accountCache.clear();

        data?.forEach((pos: any) => {
            // Update Position Cache
            const sym = internalSymbol(pos.symbol);
            const current = positionCache.get(sym) || [];
            current.push(pos);
            positionCache.set(sym, current);

            // Update Account Cache (Deduplicated by Account ID)
            if (pos.user_accounts) {
                accountCache.set(pos.user_account_id, pos.user_accounts);
            }
        });

    } catch (err) {
        console.error('[RiskService] Error syncing positions:', err);
    }
};

// ... liquidatePosition (unchanged) ...
// (Omitting liquidatePosition for brevity, assume it stays same or I can include it if I must replace whole file. 
//  Since I'm replacing from line 160ish, I need to be careful. I will use a larger block replacement.)

async function liquidatePosition(position: Position, closePrice: number, reason: string) {
    console.log(`[RiskService] 💀 LIQUIDATING User ${position.user_account_id} | Pos: ${position.id}`);

    try {
        const isLong = position.side === 'long';
        const pnl = (isLong ? closePrice - position.entry_price : position.entry_price - closePrice) * position.quantity;

        const { error: posError } = await supabaseAdmin
            .from('positions')
            .update({
                status: 'liquidated',
                closed_at: new Date().toISOString(),
                unrealized_pnl: 0 // Realized now
            })
            .eq('id', position.id);

        if (posError) throw posError;

        const { data: account } = await supabaseAdmin
            .from('user_accounts')
            .select('*')
            .eq('id', position.user_account_id)
            .single();

        if (account) {
            const newBalance = Number(account.balance) + pnl;
            const newPnl = Number(account.profit_loss || 0) + pnl;

            await supabaseAdmin
                .from('user_accounts')
                .update({
                    balance: newBalance,
                    profit_loss: newPnl,
                    total_trades: (account.total_trades || 0) + 1,
                    losing_trades: (account.losing_trades || 0) + 1
                })
                .eq('id', position.user_account_id);

            // Notify
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
        }
    } catch (err) {
        console.error('[RiskService] Liquidation failed:', err);
    }
}

async function failAccount(accountId: string, reason: string, userId: string) {
    console.log(`[RiskService] ❌ FAILING_ACCOUNT ${accountId} | Reason: ${reason}`);
    try {
        // 1. Close ALL open positions for this account
        const { error: closeAllError } = await supabaseAdmin
            .from('positions')
            .update({ status: 'closed_by_prop', closed_at: new Date().toISOString(), unrealized_pnl: 0 })
            .eq('user_account_id', accountId)
            .eq('status', 'open');

        if (closeAllError) console.error('Error closing all positions:', closeAllError);

        // 2. Set Account Status to FAILED
        await supabaseAdmin
            .from('user_accounts')
            .update({ status: 'failed' })
            .eq('id', accountId);

        // 3. Notify User
        if (userId) {
            const channelName = `private-user-${userId}`;
            ably.channels.get(channelName).publish('challenge_failed', {
                accountId,
                reason
            });
        }
    } catch (err) {
        console.error('Error failing account:', err);
    }
}

async function checkAccountHealth(accountId: string) {
    const account = accountCache.get(accountId);
    if (!account || !account.challenges) return;

    const challenge = account.challenges;
    // Calculate real-time equity
    // We need to iterate ALL positions for this account to sum PnL
    // Since positionCache is by Symbol, this is inefficient O(Symbols). 
    // Optimization: Build a secondary index Map<AccountId, Position[]> in syncPositions.
    // For now, let's just find them iteratively (MVP).

    let totalUnrealizedPnl = 0;

    // Iterate all cache entries
    positionCache.forEach((positions) => {
        positions.forEach(pos => {
            if (pos.user_account_id === accountId) {
                // Get current price from PriceService cache (imported from module if exported, or we pass it?)
                // Since priceService exports `getCurrentPrice`, we can use it.
                // Circular dependency might be an issue if we import `getCurrentPrice` from priceService here.
                // But priceService imports riskService. Circular!
                // FIX: Pass price map or refactor. 
                // For MVP, riskService can maintain its own latest prices via the update loop args? 
                // `checkRiskCoordinates` receives `currentPrice`. We can update a local `riskPriceCache`.

                // Let's assume we use entry_price if no update yet, or simplistic check.
                // Better: `riskService` stores `lastKnownPrices` map.
                const price = lastKnownPrices.get(internalSymbol(pos.symbol)) || pos.entry_price;

                const isLong = pos.side === 'long';
                const pnl = (isLong ? price - pos.entry_price : pos.entry_price - price) * pos.quantity;
                totalUnrealizedPnl += pnl;
            }
        });
    });

    const equity = account.balance + totalUnrealizedPnl;
    const initialBalance = account.initial_balance;
    const dailyStartBalance = account.initial_balance; // Simplified: usually reset at 00:00 UTC
    // Daily Loss = (DailyStart - Equity) / DailyStart
    // Max Drawdown = (InitialBalance - Equity) / InitialBalance (simplistic HighWaterMark usually)

    // Check Max Drawdown
    const drawdownAmt = initialBalance - equity;
    const drawdownPercent = (drawdownAmt / initialBalance) * 100;

    if (drawdownPercent >= challenge.max_drawdown) {
        await failAccount(accountId, `Max Drawdown Reached: ${drawdownPercent.toFixed(2)}%`, account.user_id);
        return;
    }

    // Check Daily Loss (Simplified: assuming Daily Start = Initial for this MVP or using balance as proxy)
    // challenge.daily_loss_limit
    // If balance (realized) + unrealized < needed
    // Typically Daily Loss is based on Equity at start of day. 
    // For MVP, let's treat it same as Max Drawdown relative to Balance.

    if (drawdownPercent >= challenge.daily_loss_limit) {
        await failAccount(accountId, `Daily Loss Limit Reached: ${drawdownPercent.toFixed(2)}%`, account.user_id);
    }
}

const lastKnownPrices = new Map<string, number>();

// Helper to standardise symbol
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
    return sym;
};

export const checkRiskCoordinates = async (symbol: string, currentPrice: number) => {
    const cleanSym = internalSymbol(symbol);
    lastKnownPrices.set(cleanSym, currentPrice); // Update price cache

    const positions = positionCache.get(cleanSym);
    if (!positions || positions.length === 0) return;

    // Set of accounts to check health for (deduplicated)
    const accountsToCheck = new Set<string>();

    await Promise.all(positions.map(async (position) => {
        try {
            accountsToCheck.add(position.user_account_id);

            const leverage = position.leverage || 1;
            const entryPrice = Number(position.entry_price);

            let liquidationPrice = 0;
            if (position.side === 'long') {
                liquidationPrice = entryPrice * (1 - (1 / leverage));
            } else {
                liquidationPrice = entryPrice * (1 + (1 / leverage));
            }

            let isLiquidated = false;
            if (position.side === 'long' && currentPrice <= liquidationPrice) isLiquidated = true;
            else if (position.side === 'short' && currentPrice >= liquidationPrice) isLiquidated = true;

            if (isLiquidated) {
                await liquidatePosition(position, currentPrice, 'Liquidation Price Reached');
            }

        } catch (err) {
            console.error(`[RiskService] Error checking position ${position.id}:`, err);
        }
    }));

    // After individual trade checks, check overall account health for affected users
    for (const accountId of accountsToCheck) {
        await checkAccountHealth(accountId);
    }
};
