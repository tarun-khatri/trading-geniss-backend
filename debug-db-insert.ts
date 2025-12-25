import { supabaseAdmin } from './src/config/supabase';

async function run() {
    console.log('Fetching account...');
    const accountId = '01a74ecb-e154-4a88-bcd0-591db20e5bdd';

    const { data: account, error: accError } = await supabaseAdmin
        .from('user_accounts')
        .select('*')
        .eq('id', accountId)
        .single();

    if (accError) {
        console.error('Account Access Error:', accError);
        return;
    }
    console.log('Account User ID:', account.user_id);

    console.log('Attempting Insert...');
    const { data, error } = await supabaseAdmin
        .from('positions')
        .insert({
            user_id: account.user_id,
            user_account_id: accountId,
            symbol: 'BTC-USD',
            side: 'long',
            entry_price: 50000,
            current_price: 50000,
            quantity: 0.001,
            leverage: 10,
            unrealized_pnl: 0,
            status: 'open',
            opened_at: new Date().toISOString()
        })
        .select()
        .single();

    if (error) {
        console.error('INSERT ERROR:', JSON.stringify(error, null, 2));
    } else {
        console.log('SUCCESS:', data);
    }
}

run();
