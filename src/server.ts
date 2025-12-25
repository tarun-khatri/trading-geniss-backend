import app from './app';
import { env } from './config/env';
import { startPriceFeed } from './services/priceService';
import { startLiquidationMonitor } from './services/riskService';

const PORT = env.PORT;

const server = app.listen(PORT, async () => {
  console.log(`[Server] Backend running on port ${PORT}`);

  // Start Background Workers
  console.log('[Worker] Starting Price Feed Service...');
  startPriceFeed();

  console.log('[Worker] Starting Liquidation Monitor...');
  startLiquidationMonitor();
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
  });
});
