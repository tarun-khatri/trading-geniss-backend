const fetch = require('node-fetch');

// Use native fetch if node 18+ or install node-fetch. 
// Assuming Node 18+ or environments often strictly don't have it, let's try standard http or assumption of fetch available.
// Actually, standard http is safer.

const http = require('http');

function post(path, body) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify(body);
        const options = {
            hostname: 'localhost',
            port: 3000,
            path: path,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': data.length
            }
        };

        const req = http.request(options, (res) => {
            let responseBody = '';
            res.on('data', (chunk) => {
                responseBody += chunk;
            });
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, data: JSON.parse(responseBody) });
                } catch (e) {
                    resolve({ status: res.statusCode, data: responseBody });
                }
            });
        });

        req.on('error', (error) => {
            reject(error);
        });

        req.write(data);
        req.end();
    });
}

async function run() {
    const accountId = '01a74ecb-e154-4a88-bcd0-591db20e5bdd';
    console.log('Testing Monitor...');
    const monitor = await post('/api/trade/monitor', { userAccountId: accountId });
    console.log('Monitor:', monitor);

    console.log('Testing Open Position (Short)...');
    const open = await post('/api/trade/open', {
        userAccountId: accountId,
        symbol: 'BINANCE:BTCUSDT',
        side: 'short',
        quantity: 0.001,
        leverage: 10
    });
    console.log('Open:', open);

    if (open.data && open.data.id) {
        console.log('Waiting 2s...');
        await new Promise(r => setTimeout(r, 2000));

        console.log('Testing Monitor (Check PnL)...');
        const monitor2 = await post('/api/trade/monitor', { userAccountId: accountId });
        console.log('Monitor 2:', monitor2);

        console.log('Testing Close Position...');
        const close = await post('/api/trade/close', {
            userAccountId: accountId,
            positionId: open.data.id
        });
        console.log('Close:', close);
    }
}

run();
