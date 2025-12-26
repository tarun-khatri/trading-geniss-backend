import { Request, Response } from 'express';
import { ably } from '../config/ably';

export const getAblyToken = async (req: Request, res: Response) => {
    try {
        const userId = req.query.userId as string || 'anonymous';

        // Define capabilities
        // 1. Can subscribe to all public ticker channels
        // 2. Can subscribe to their OWN private channel
        // Define capabilities
        // Requirement: "Create a temporary token with "Subscribe-Only" permissions"
        // 1. Public Tickers: 'ticker-*'
        // 2. Private User Alerts: 'private-user-{userId}'
        const capability = {
            'ticker-*': ['subscribe'],
            [`private-user-${userId}`]: ['subscribe']
        };

        // Wrap in promise to handle potential callback-only legacy versions or odd behaviors
        const tokenRequestData = await new Promise((resolve, reject) => {
            ably.auth.createTokenRequest({
                clientId: userId,
                capability: JSON.stringify(capability),
                ttl: 3600 * 1000 // 1 hour
            }, (err, tokenRequest) => {
                if (err) return reject(err);
                resolve(tokenRequest);
            });
        });

        res.json(tokenRequestData);
    } catch (error) {
        console.error('Error creating Ably token request:', error);
        res.status(500).json({ error: 'Failed to generate token' });
    }
};
