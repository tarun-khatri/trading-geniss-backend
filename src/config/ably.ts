import Ably from 'ably';
import { env } from './env';

// Server-side Ably instance with full permissions (uses API KEY)
export const ably = new Ably.Realtime(env.ABLY_API_KEY);

ably.connection.on('connected', () => {
    console.log('[Ably] Connected to Ably Realtime');
});

ably.connection.on('failed', (err) => {
    console.error('[Ably] Connection failed:', err);
});
