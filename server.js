const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

const DB_FILE = './keys.json';

function loadDB() {
    if (!fs.existsSync(DB_FILE)) {
        saveDB({ keys: [] });
        return { keys: [] };
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
    res.json({ ip: getClientIP(req) });
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
    const { key, ip } = req.body;
    const db = loadDB();
    const keyData = db.keys.find(k => k.key === key);
    
    if (!keyData) {
        return res.status(400).json({ message: 'Key không tồn tại' });
    }
    
    const now = Math.floor(Date.now() / 1000);
    if (keyData.expires_at && keyData.expires_at < now) {
        return res.status(400).json({ message: 'Key đã hết hạn' });
    }
    
    if (!keyData.whitelisted_ips) keyData.whitelisted_ips = [];
    
    if (keyData.whitelisted_ips.length > 0 && !keyData.whitelisted_ips.includes(ip)) {
        return res.status(400).json({ message: 'Key đã được active trên IP khác' });
    }
    
    if (!keyData.whitelisted_ips.includes(ip)) {
        keyData.whitelisted_ips.push(ip);
        saveDB(db);
    }
    
    res.json({ message: 'Active IP thành công' });
});

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
                link_pem: '#',
                status: isExpired ? 'bao_tri' : 'hoat_dong'
            });
        }
    }
    
    if (items.length === 0) {
        items.push({ ip: 'Chưa có IP active', port: '-', proxy_type: '-', link_pem: '#', status: 'bao_tri' });
    }
    
    res.json({ items: items });
});

// ========== ADMIN API ==========
// Tạo key bằng POST
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

// Tạo key bằng GET (dùng trình duyệt)
app.get('/admin/create-key-quick', (req, res) => {
    const type = req.query.type || 'proxy';
    const expires_days = parseInt(req.query.days) || 30;
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

// Xem danh sách key
app.get('/admin/keys', (req, res) => {
    const db = loadDB();
    res.json(db.keys);
});

// Xóa key
app.delete('/admin/keys/:key', (req, res) => {
    const db = loadDB();
    db.keys = db.keys.filter(k => k.key !== req.params.key);
    saveDB(db);
    res.json({ success: true });
});

// Gia hạn key
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

// ========== Serve HTML ==========
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/aim-ports', (req, res) => {
    res.sendFile(path.join(__dirname, 'aim-ports.html'));
});

app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
