import { Request, Response } from 'express';
import { supabaseAdmin } from '../config/supabase';
import { getCurrentPrice } from '../services/priceService';

export const openPosition = async (req: Request, res: Response) => {
    try {
        const { userAccountId, symbol, side, quantity, leverage } = req.body;

        // 1. Get Real-time Price
        // Map frontend symbol (e.g., BINANCE:BTCUSDT) to backend symbol (e.g., BTC-USD) if needed
        // For now assuming clean symbol or handled by a utility
        const cleanSymbol = symbol.includes(':') ? symbol.split(':')[1].replace('USDT', '-USD') : symbol;
        const currentPrice = getCurrentPrice(cleanSymbol);

        if (!currentPrice) {
            return res.status(400).json({ error: 'Price not available for symbol' });
        }

        // 2. Calculate Margin
        const positionSize = currentPrice * quantity;
        const marginRequired = positionSize / leverage;

        // 3. Check Balance/Drawdown
        const { data: account, error: accError } = await supabaseAdmin
            .from('user_accounts')
            .select('*')
            .eq('id', userAccountId)
            .single();

        if (accError || !account) {
            return res.status(404).json({ error: 'Account not found' });
        }

        if (account.balance < marginRequired) {
            return res.status(400).json({ error: 'Insufficient balance' });
        }

        // TODO: Advanced Drawdown Checks could go here

        // 4. Update Database Transactionally (Simulated with sequential writes for Supabase)
        // Deduct balance/margin/fees if logic dictates, or just track used margin.
        // For simplicity in this prop firm model, we might just track it without deducting from "balance" explicitly unless realized,
        // but typically we lock margin. Let's assume balance is "Available Balance".

        // Here we just insert the position
        const { data: position, error: posError } = await supabaseAdmin
            .from('positions')
            .insert({
                // user_id: account.user_id, // Column does not exist in live DB
                user_account_id: userAccountId,
                symbol: cleanSymbol, // Storing internal symbol
                side,
                entry_price: currentPrice,
                current_price: currentPrice,
                quantity,
                leverage,
                unrealized_pnl: 0,
                status: 'open',
                opened_at: new Date().toISOString()
            })
            .select()
            .single();

        if (posError) {
            console.error('Db Insert Error:', posError);
            throw new Error('Failed to open position');
        }

        res.json(position);

    } catch (error: any) {
        console.error('[TradeController] Open Error:', error.message);
        res.status(500).json({ error: error.message });
    }
};

export const closePosition = async (req: Request, res: Response) => {
    try {
        const { positionId, userAccountId } = req.body;
        console.log(`[Trade] Closing Position: ${positionId} for Account: ${userAccountId}`);

        const { data: position, error: fetchError } = await supabaseAdmin
            .from('positions')
            .select('*')
            .eq('id', positionId)
            .single();

        if (fetchError) {
            console.error('[Trade] Fetch Position Error:', fetchError);
            return res.status(404).json({ error: 'Position not found' });
        }
        if (!position) return res.status(404).json({ error: 'Position not found' });
        if (position.status !== 'open') return res.status(400).json({ error: 'Position already closed' });

        const currentPrice = getCurrentPrice(position.symbol);
        console.log(`[Trade] Close Price for ${position.symbol}: ${currentPrice}`);

        if (!currentPrice) return res.status(400).json({ error: 'Price unavailable' });

        // Calculate PnL
        let pnl = 0;
        if (position.side === 'long') {
            pnl = (currentPrice - position.entry_price) * position.quantity;
        } else {
            pnl = (position.entry_price - currentPrice) * position.quantity;
        }
        console.log(`[Trade] PnL Calc: ${pnl}`);

        // Update Account Balance
        const { data: account, error: accFetchError } = await supabaseAdmin
            .from('user_accounts')
            .select('*')
            .eq('id', userAccountId)
            .single();

        if (accFetchError || !account) {
            console.error('[Trade] Fetch Account Error:', accFetchError);
            return res.status(404).json({ error: 'Account not found' });
        }

        const newBalance = account.balance + pnl;

        // Transaction updates
        const { error: updatePosError } = await supabaseAdmin
            .from('positions')
            .update({
                status: 'closed',
                closed_at: new Date().toISOString(),
                // exit_price: currentPrice, // Column does not exist in DB schema
                unrealized_pnl: 0 // Realized now
                // realized_pnl: pnl // If schema has this
            })
            .eq('id', positionId);

        if (updatePosError) {
            console.error('[Trade] Update Position Error:', updatePosError);
            throw updatePosError;
        }

        const isWin = pnl > 0;

        const { error: updateAccError } = await supabaseAdmin
            .from('user_accounts')
            .update({
                balance: newBalance,
                profit_loss: (account.profit_loss || 0) + pnl,
                total_trades: (account.total_trades || 0) + 1,
                winning_trades: (account.winning_trades || 0) + (isWin ? 1 : 0),
                losing_trades: (account.losing_trades || 0) + (isWin ? 0 : 1)
            })
            .eq('id', userAccountId);

        if (updateAccError) {
            console.error('[Trade] Update Account Error:', updateAccError);
            throw updateAccError;
        }

        res.json({ success: true, pnl, newBalance });

    } catch (error: any) {
        console.error('[TradeController] Close Error:', error);
        res.status(500).json({ error: error.message });
    }
};

export const getAccountState = async (req: Request, res: Response) => {
    try {
        const { userAccountId } = req.body;

        const { data: account, error: accError } = await supabaseAdmin
            .from('user_accounts')
            .select('*')
            .eq('id', userAccountId)
            .single();

        if (accError || !account) return res.status(404).json({ error: 'Account not found' });

        const { data: positions, error: posError } = await supabaseAdmin
            .from('positions')
            .select('*')
            .eq('user_account_id', userAccountId)
            .eq('status', 'open');

        if (posError) throw posError;

        let unrealizedPnl = 0;

        positions?.forEach((pos: any) => {
            const currentPrice = getCurrentPrice(pos.symbol) || pos.entry_price; // Fallback to entry if no price yet
            const isLong = pos.side === 'long';
            const pnl = (isLong ? currentPrice - pos.entry_price : pos.entry_price - currentPrice) * pos.quantity;
            unrealizedPnl += pnl;
        });

        // Simplified calculation for MVP
        const equity = account.balance + unrealizedPnl;
        const startBalance = account.initial_balance;
        const dailyPnl = equity - startBalance; // Logic might vary based on "daily" definition, simplifying to total PnL for now or need a daily reset mechanism
        const dailyPnlPercent = (dailyPnl / startBalance) * 100;

        // Drawdown from initial balance (simplified)
        // Correct prop firm metrics usually track "High Water Mark". 
        // For this MVP we compare current equity vs initial balance.
        const drawdownAmount = startBalance - equity;
        const drawdown = drawdownAmount > 0 ? (drawdownAmount / startBalance) * 100 : 0;

        res.json({
            equity,
            unrealizedPnl,
            dailyPnl, // TODO: Implement strict 24h PnL reset logic if needed
            dailyPnlPercent,
            drawdown,
            liquidated: false, // Monitor logic handled by riskService async
            balance: account.balance
        });

    } catch (error: any) {
        console.error('[TradeController] Monitor Error:', error.message);
        res.status(500).json({ error: error.message });
    }
};
