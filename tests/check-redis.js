const net = require('net');
const s = net.createConnection(6379, 'localhost');
s.on('connect', () => { console.log('Redis OK on port 6379'); s.end(); });
s.on('error', (e) => { console.log('Redis error:', e.message); s.destroy(); });
setTimeout(() => { console.log('Timeout'); process.exit(1); }, 3000);
