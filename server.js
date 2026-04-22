const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static('public'));

const DB_FILE = './keys.json';

// Load database
function loadDB() {
    if (!fs.existsSync(DB_FILE)) {
        const sampleKeys = {
            keys: [
                {
                    key: "PROXY-ABC123",
                    type: "proxy",
                    created_at: new Date().toISOString(),
                    expires_at: Math.floor(Date.now() / 1000) + 30 * 86400,
                    whitelisted_ips: [],
                    active: true
                },
                {
                    key: "PREMIUM-XYZ789",
                    type: "premium",
                    created_at: new Date().toISOString(),
                    expires_at: Math.floor(Date.now() / 1000) + 7 * 86400,
                    whitelisted_ips: [],
                    active: true
                }
            ]
        };
        saveDB(sampleKeys);
        return sampleKeys;
    }
    return JSON.parse(fs.readFileSync(DB_FILE));
}

function saveDB(db) {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function getClientIP(req) {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    return ip.replace('::ffff:', '').split(',')[0].trim();
}

// ========== API cho frontend ==========
app.get('/whoami', (req, res) => {
    const ip = getClientIP(req);
    res.json({ ip: ip });
});

app.get('/api/key-status', (req, res) => {
    const key = req.query.key;
    const db = loadDB();
    const keyData = db.keys.find(k => k.key === key);
    
    if (!keyData) {
        return res.json({
            active: false,
            ip_whitelisted: false,
            status: 'Key không tồn tại',
            created_at: null,
            expires_at: null,
            key_type: null
        });
    }
    
    const now = Math.floor(Date.now() / 1000);
    const isExpired = keyData.expires_at && keyData.expires_at < now;
    const clientIp = getClientIP(req);
    const isWhitelisted = keyData.whitelisted_ips?.includes(clientIp) || false;
    
    res.json({
        active: !isExpired,
        ip_whitelisted: isWhitelisted,
        status: isExpired ? 'Hết hạn' : (isWhitelisted ? 'Hoạt động' : 'Chưa kích hoạt'),
        created_at: keyData.created_at,
        expires_at: keyData.expires_at,
        key_type: keyData.type
    });
});

app.post('/submit', (req, res) => {
    const { key, ip, device_id } = req.body;
    const db = loadDB();
    const keyData = db.keys.find(k => k.key === key);
    
    if (!keyData) {
        return res.status(400).json({ message: 'Key không tồn tại' });
    }
    
    const now = Math.floor(Date.now() / 1000);
    if (keyData.expires_at && keyData.expires_at < now) {
        return res.status(400).json({ message: 'Key đã hết hạn' });
    }
    
    if (!keyData.whitelisted_ips) {
        keyData.whitelisted_ips = [];
    }
    
    if (keyData.whitelisted_ips.length > 0 && !keyData.whitelisted_ips.includes(ip)) {
        return res.status(400).json({ message: 'Key đã được active trên IP khác' });
    }
    
    if (!keyData.whitelisted_ips.includes(ip)) {
        keyData.whitelisted_ips.push(ip);
        saveDB(db);
    }
    
    res.json({ message: 'Active IP thành công' });
});

// ========== API AIM Ports ==========
app.get('/api/aim-ports', (req, res) => {
    const db = loadDB();
    const items = [];
    
    for (const key of db.keys) {
        const now = Math.floor(Date.now() / 1000);
        const isExpired = key.expires_at && key.expires_at < now;
        
        for (const ip of (key.whitelisted_ips || [])) {
            items.push({
                ip: ip,
                port: '443',
                proxy_type: key.type || 'proxy',
                link_pem: `https://proxy.example.com/${key.key}.pem`,
                status: isExpired ? 'bao_tri' : 'hoat_dong'
            });
        }
    }
    
    if (items.length === 0) {
        items.push({
            ip: 'Chưa có IP active',
            port: '-',
            proxy_type: '-',
            link_pem: '#',
            status: 'bao_tri'
        });
    }
    
    res.json({ items: items });
});

// ========== ADMIN API (tạo key) ==========
app.post('/admin/create-key', (req, res) => {
    const { type = 'proxy', expires_days = 30 } = req.body;
    const newKey = {
        key: 'KEY-' + Math.random().toString(36).substring(2, 10).toUpperCase(),
        type: type,
        created_at: new Date().toISOString(),
        expires_at: Math.floor(Date.now() / 1000) + expires_days * 86400,
        whitelisted_ips: [],
        active: true
    };
    const db = loadDB();
    db.keys.push(newKey);
    saveDB(db);
    res.json({ success: true, key: newKey });
});

app.get('/admin/keys', (req, res) => {
    const db = loadDB();
    res.json(db.keys);
});

app.delete('/admin/keys/:key', (req, res) => {
    const db = loadDB();
    db.keys = db.keys.filter(k => k.key !== req.params.key);
    saveDB(db);
    res.json({ success: true });
});

app.post('/admin/renew', (req, res) => {
    const { key, add_days } = req.body;
    const db = loadDB();
    const keyData = db.keys.find(k => k.key === key);
    if (!keyData) return res.status(404).json({ error: 'Không tìm thấy key' });
    
    const currentExp = keyData.expires_at || Math.floor(Date.now() / 1000);
    keyData.expires_at = currentExp + add_days * 86400;
    saveDB(db);
    res.json({ success: true, new_expires_at: keyData.expires_at });
});

// Serve frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`📍 Frontend: http://localhost:${PORT}`);
    console.log(`🔑 Tạo key: POST /admin/create-key`);
});