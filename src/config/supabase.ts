import { createClient } from '@supabase/supabase-js';
import { env } from './env';

// Admin client with Service Role Key - Has full database access
// BE CAREFUL: Do not expose this client to the frontend
export const supabaseAdmin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
        autoRefreshToken: false,
        persistSession: false,
    },
});
