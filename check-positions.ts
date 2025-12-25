import { supabaseAdmin } from './src/config/supabase';

async function run() {
    const accountId = '01a74ecb-e154-4a88-bcd0-591db20e5bdd';
    console.log('Checking positions for account:', accountId);

    const { data, error } = await supabaseAdmin
        .from('positions')
        .select('*')
        .eq('user_account_id', accountId)
        .order('opened_at', { ascending: false });

    if (error) {
        console.error('Error:', error);
        return;
    }
    console.log('Positions found:', data?.length);
    console.log(JSON.stringify(data, null, 2));
}

run();
