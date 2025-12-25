import dotenv from 'dotenv';
import path from 'path';

// Load .env from backend root
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const requiredEnvVars = [
    'ABLY_API_KEY',
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'MASSIVE_WS_URL',
    'MASSIVE_API_KEY'
];

export const env = {
    PORT: process.env.PORT || 3000,
    ABLY_API_KEY: process.env.ABLY_API_KEY!,
    SUPABASE_URL: process.env.SUPABASE_URL!,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    MASSIVE_WS_URL: process.env.MASSIVE_WS_URL!,
    MASSIVE_API_KEY: process.env.MASSIVE_API_KEY!,
    ALLOWED_ORIGIN: process.env.ALLOWED_ORIGIN || 'http://localhost:5173',
};

// Validation
const missingVars = requiredEnvVars.filter((key) => !process.env[key]);
if (missingVars.length > 0) {
    console.warn(`[WARNING] Missing environment variables: ${missingVars.join(', ')}`);
    // In production, we might want to throw error, but for dev we warn
    // throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
}
