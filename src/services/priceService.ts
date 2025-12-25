import WebSocket from 'ws';
import { env } from '../config/env';
import { ably } from '../config/ably';
import { checkRiskCoordinates } from './riskService';

let socket: WebSocket;
const RECONNECT_INTERVAL = 5000;
const SUBSCRIPTIONS = [
    'XT.BTC-USD', 'XT.ETH-USD', 'XT.SOL-USD',
    'XT.BNB-USD', 'XT.XRP-USD', 'XT.ADA-USD',
    'XT.DOGE-USD', 'XT.AVAX-USD', 'XT.MATIC-USD', 'XT.DOT-USD'
];
const priceCache = new Map<string, number>();

export const getCurrentPrice = (symbol: string): number | undefined => {
    return priceCache.get(symbol);
};

export const startPriceFeed = () => {
    connect();
};

const connect = () => {
    console.log('[PriceService] Connecting to Massive WS...');
    socket = new WebSocket(env.MASSIVE_WS_URL);

    socket.on('open', () => {
        console.log('[PriceService] Connected. Authenticating...');

        // Auth
        socket.send(JSON.stringify({
            action: 'auth',
            params: env.MASSIVE_API_KEY
        }));

        // Subscribe
        // Creating comma separated string or sending multiple messages depending on API
        // User snippet showed single string 'XT.BTC-USD'. We can send individual subscription commands
        SUBSCRIPTIONS.forEach(channel => {
            socket.send(JSON.stringify({
                action: 'subscribe',
                params: channel
            }));
        });
    });

    socket.on('message', (data: WebSocket.Data) => {
        try {
            const message = data.toString();
            //console.log('[PriceService] Rx:', message); // DEBUG LOG
            const parsed = JSON.parse(message);

            // Massive sends arrays of events
            if (Array.isArray(parsed)) {
                parsed.forEach(packet => {
                    if (packet.ev === 'XT') { // XT = Trade
                        handleTradeUpdate(packet);
                    }
                });
            } else if (parsed.ev === 'XT') {
                handleTradeUpdate(parsed);
            }
        } catch (err) {
            console.error('[PriceService] Error parsing message:', err);
        }
    });

    socket.on('close', () => {
        console.warn('[PriceService] Connection closed. Reconnecting in 5s...');
        setTimeout(connect, RECONNECT_INTERVAL);
    });

    socket.on('error', (err) => {
        console.error('[PriceService] WebSocket error:', err);
    });
};

const throttleMap = new Map<string, number>();
const THROTTLE_INTERVAL = 300; // Publish max once every 300ms per symbol

const handleTradeUpdate = (packet: any) => {
    // Packet structure based on user snippet: { ev: 'XT', p: 95000, t: 123456789, ... } (inferred)
    // We need to map 'XT.BTC-USD' back to a clean symbol 'BTC-USD' if possible or use the channel name
    // Massive usually sends the ticker in the packet, e.g. 'sym' or 'pair'
    // Assuming packet.sym exists or we map it from the subscription context

    // User snippet used: channel.publish('price_update', { price: packet.p })
    // We need the symbol to publish to the correct channel 'ticker-BTCUSDT' etc.

    // Let's assume packet has 'sym' e.g. 'BTC-USD'
    const symbol = packet.pair || packet.sym || 'BTC-USD'; // Fallback
    const price = packet.p;
    priceCache.set(symbol, price);
    const timestamp = packet.t;

    // Fast-path risk check (always check risk immediately)
    checkRiskCoordinates(symbol, price);

    // Throttle Ably publishing
    const lastPublished = throttleMap.get(symbol) || 0;
    const now = Date.now();

    if (now - lastPublished >= THROTTLE_INTERVAL) {
        // Publish to Ably
        // Channel name: "ticker-BTC-USD"
        const channelName = `ticker-${symbol}`;

        ably.channels.get(channelName).publish('price_update', {
            symbol,
            price,
            timestamp
        });

        throttleMap.set(symbol, now);
    }
};
