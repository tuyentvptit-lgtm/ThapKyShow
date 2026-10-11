require('dotenv').config();
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const UPLOADS = path.join(ROOT, 'uploads');
fs.mkdirSync(UPLOADS, { recursive: true });
const db = new Database(path.join(__dirname, 'data.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const isoNow = () => new Date().toISOString();
const safeString = (value, max = 250) => String(value ?? '').trim().slice(0, max);
const validEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

// SQLite tables are created on first launch so the project runs without a separate database server.
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    phone TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'customer' CHECK(role IN ('customer','admin')),
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS event_config (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    title TEXT NOT NULL,
    tagline TEXT NOT NULL,
    date TEXT NOT NULL,
    time TEXT NOT NULL,
    venue TEXT NOT NULL,
    address TEXT NOT NULL,
    bank_name TEXT NOT NULL,
    bank_account TEXT NOT NULL,
    bank_owner TEXT NOT NULL,
    bank_note TEXT NOT NULL,
    hold_minutes INTEGER NOT NULL DEFAULT 10
  );
  CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    subtitle TEXT NOT NULL,
    price INTEGER NOT NULL CHECK(price >= 0),
    stock INTEGER NOT NULL CHECK(stock >= 0),
    accent TEXT NOT NULL DEFAULT 'gold',
    active INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    ticket_id INTEGER NOT NULL REFERENCES tickets(id),
    quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 6),
    unit_price INTEGER NOT NULL,
    total INTEGER NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('reserved','pending','approved','rejected','expired')),
    expires_at TEXT,
    transfer_reference TEXT NOT NULL,
    proof_filename TEXT,
    admin_note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

const existingEvent = db.prepare('SELECT id FROM event_config WHERE id = 1').get();
if (!existingEvent) {
  db.prepare(`INSERT INTO event_config
    (id,title,tagline,date,time,venue,address,bank_name,bank_account,bank_owner,bank_note,hold_minutes)
    VALUES (1,?,?,?,?,?,?,?,?,?,?,?)`).run(
      'Thập Kỷ', 'Một bản nhạc · 2016 — 2026', '2026-11-07', '18:00',
      'Cung Văn hóa tỉnh Phú Thọ (Nhà Tròn)', 'Số 1, đường An Dương Vương, phường Hòa Bình',
      'NGÂN HÀNG DEMO — CẦN CẬP NHẬT', '0000000000', 'CLB FIRE - THAP KY',
      'Đây là thông tin chuyển khoản mẫu để thử nghiệm. Admin phải thay bằng tài khoản chính thức trước khi bán vé thật.', 10
    );
}
const ticketCount = db.prepare('SELECT COUNT(*) AS count FROM tickets').get().count;
if (ticketCount === 0) {
  const insertTicket = db.prepare('INSERT INTO tickets (name,subtitle,price,stock,accent,active) VALUES (?,?,?,?,?,1)');
  const seedTickets = db.transaction(() => {
    insertTicket.run('Vé Đồng Hành', 'Cùng Fire viết tiếp hành trình', 100000, 120, 'silver');
    insertTicket.run('Vé Tiêu Chuẩn', 'Một đêm nhạc — một thập kỷ', 180000, 180, 'gold');
    insertTicket.run('Vé Ưu Tiên', 'Khu vực gần sân khấu', 280000, 40, 'platinum');
  });
  seedTickets();
}
const adminEmail = safeString(process.env.ADMIN_EMAIL || 'admin@thapky.local', 190).toLowerCase();
const adminPassword = process.env.ADMIN_PASSWORD || 'FireAdmin@2026';
const existingAdmin = db.prepare('SELECT id FROM users WHERE email = ?').get(adminEmail);
if (!existingAdmin) {
  db.prepare('INSERT INTO users (name,email,phone,password_hash,role,created_at) VALUES (?,?,?,?,?,?)').run(
    safeString(process.env.ADMIN_NAME || 'Quản trị viên Thập Kỷ', 100), adminEmail, '', bcrypt.hashSync(adminPassword, 10), 'admin', isoNow()
  );
}

app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      fontSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"]
    }
  }
}));
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));
app.use(session({
  name: 'thapky.sid',
  secret: process.env.SESSION_SECRET || 'dev-only-secret-change-before-deploying-please-2026',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 1000 * 60 * 60 * 8 }
}));
app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false }));
app.use(express.static(PUBLIC, { index: 'index.html', maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0 }));

const expireHolds = () => db.prepare("UPDATE orders SET status='expired', updated_at=? WHERE status='reserved' AND expires_at IS NOT NULL AND expires_at <= ?").run(isoNow(), isoNow());
const getEvent = () => db.prepare('SELECT * FROM event_config WHERE id=1').get();
function remainingFor(ticket, now = isoNow()) {
  expireHolds();
  const held = db.prepare(`SELECT COALESCE(SUM(quantity),0) AS count FROM orders
    WHERE ticket_id=? AND (status='pending' OR status='approved' OR (status='reserved' AND expires_at > ?))`).get(ticket.id, now).count;
  return Math.max(0, ticket.stock - held);
}
function publicTicket(ticket) {
  return { id: ticket.id, name: ticket.name, subtitle: ticket.subtitle, price: ticket.price, stock: ticket.stock, remaining: remainingFor(ticket), accent: ticket.accent, active: Boolean(ticket.active) };
}
function currentUser(req) {
  if (!req.session.userId) return null;
  return db.prepare('SELECT id,name,email,phone,role,created_at FROM users WHERE id=?').get(req.session.userId) || null;
}
function requireAuth(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'Bạn cần đăng nhập để thực hiện thao tác này.' });
  req.user = user;
  next();
}
function requireAdmin(req, res, next) {
  const user = currentUser(req);
  if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Khu vực này chỉ dành cho Admin.' });
  req.user = user;
  next();
}
function orderForUser(orderId, user) {
  const order = db.prepare(`SELECT o.*, t.name AS ticket_name, u.name AS customer_name, u.email AS customer_email, u.phone AS customer_phone
    FROM orders o JOIN tickets t ON t.id=o.ticket_id JOIN users u ON u.id=o.user_id WHERE o.id=?`).get(orderId);
  if (!order || (user.role !== 'admin' && order.user_id !== user.id)) return null;
  return order;
}
function orderJson(o) {
  return {
    id: o.id, user_id: o.user_id, ticket_id: o.ticket_id, ticket_name: o.ticket_name,
    customer_name: o.customer_name, customer_email: o.customer_email, customer_phone: o.customer_phone,
    quantity: o.quantity, unit_price: o.unit_price, total: o.total, status: o.status,
    expires_at: o.expires_at, transfer_reference: o.transfer_reference,
    has_proof: Boolean(o.proof_filename), proof_url: o.proof_filename ? `/api/orders/${encodeURIComponent(o.id)}/proof` : null,
    admin_note: o.admin_note, created_at: o.created_at, updated_at: o.updated_at
  };
}
const uploadStorage = multer.diskStorage({
  destination: (_req, _file, callback) => callback(null, UPLOADS),
  filename: (_req, file, callback) => {
    const ext = ({ 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'application/pdf': '.pdf' })[file.mimetype];
    callback(null, `${crypto.randomUUID()}${ext || '.bin'}`);
  }
});
const uploadProof = multer({
  storage: uploadStorage,
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    callback(allowed.includes(file.mimetype) ? null : new Error('Chỉ nhận ảnh JPG, PNG, WEBP hoặc file PDF.'), allowed.includes(file.mimetype));
  }
});

// Authentication
app.post('/api/auth/register', (req, res) => {
  const name = safeString(req.body.name, 100);
  const email = safeString(req.body.email, 190).toLowerCase();
  const phone = safeString(req.body.phone, 30);
  const password = String(req.body.password || '');
  if (name.length < 2) return res.status(400).json({ error: 'Vui lòng nhập họ tên hợp lệ.' });
  if (!validEmail(email)) return res.status(400).json({ error: 'Email chưa đúng định dạng.' });
  if (password.length < 8) return res.status(400).json({ error: 'Mật khẩu cần ít nhất 8 ký tự.' });
  if (phone && !/^[+0-9 ()-]{8,20}$/.test(phone)) return res.status(400).json({ error: 'Số điện thoại chưa hợp lệ.' });
  try {
    const result = db.prepare('INSERT INTO users (name,email,phone,password_hash,role,created_at) VALUES (?,?,?,?,?,?)')
      .run(name, email, phone, bcrypt.hashSync(password, 10), 'customer', isoNow());
    req.session.userId = Number(result.lastInsertRowid);
    res.status(201).json({ user: currentUser(req) });
  } catch (error) {
    if (String(error.code).includes('SQLITE_CONSTRAINT_UNIQUE')) return res.status(409).json({ error: 'Email này đã được đăng ký.' });
    throw error;
  }
});
app.post('/api/auth/login', (req, res) => {
  const email = safeString(req.body.email, 190).toLowerCase();
  const password = String(req.body.password || '');
  const user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) return res.status(401).json({ error: 'Email hoặc mật khẩu không chính xác.' });
  req.session.regenerate((error) => {
    if (error) return res.status(500).json({ error: 'Không thể tạo phiên đăng nhập. Hãy thử lại.' });
    req.session.userId = user.id;
    res.json({ user: currentUser(req) });
  });
});
app.post('/api/auth/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get('/api/me', (req, res) => res.json({ user: currentUser(req) }));

// Public show and ticket inventory
app.get('/api/event', (_req, res) => {
  const event = getEvent();
  const tickets = db.prepare('SELECT * FROM tickets WHERE active=1 ORDER BY price ASC').all().map(publicTicket);
  res.json({ event, tickets });
});

// Customer booking flow
app.post('/api/orders', requireAuth, (req, res) => {
  expireHolds();
  const ticketId = Number(req.body.ticketId);
  const quantity = Number(req.body.quantity);
  if (!Number.isInteger(ticketId) || !Number.isInteger(quantity) || quantity < 1 || quantity > 6) {
    return res.status(400).json({ error: 'Vui lòng chọn loại vé và số lượng từ 1 đến 6.' });
  }
  const ticket = db.prepare('SELECT * FROM tickets WHERE id=? AND active=1').get(ticketId);
  if (!ticket) return res.status(404).json({ error: 'Loại vé này hiện không mở bán.' });
  const createOrder = db.transaction(() => {
    const now = isoNow();
    const held = db.prepare(`SELECT COALESCE(SUM(quantity),0) AS count FROM orders WHERE ticket_id=?
      AND (status='pending' OR status='approved' OR (status='reserved' AND expires_at > ?))`).get(ticketId, now).count;
    const remaining = ticket.stock - held;
    if (remaining < quantity) return { error: `Chỉ còn ${Math.max(0, remaining)} vé cho hạng vé này.` };
    const id = `TK-${new Date().getFullYear()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const expiresAt = new Date(Date.now() + getEvent().hold_minutes * 60 * 1000).toISOString();
    const reference = `THAPKY ${id}`;
    db.prepare(`INSERT INTO orders (id,user_id,ticket_id,quantity,unit_price,total,status,expires_at,transfer_reference,created_at,updated_at)
      VALUES (?,?,?,?,?,?, 'reserved', ?,?,?,?)`).run(id, req.user.id, ticketId, quantity, ticket.price, ticket.price * quantity, expiresAt, reference, now, now);
    return orderForUser(id, req.user);
  });
  const result = createOrder();
  if (result.error) return res.status(409).json({ error: result.error });
  res.status(201).json({ order: orderJson(result), event: getEvent() });
});
app.get('/api/orders', requireAuth, (req, res) => {
  expireHolds();
  const rows = db.prepare(`SELECT o.*, t.name AS ticket_name, u.name AS customer_name, u.email AS customer_email, u.phone AS customer_phone
    FROM orders o JOIN tickets t ON t.id=o.ticket_id JOIN users u ON u.id=o.user_id WHERE o.user_id=? ORDER BY o.created_at DESC`).all(req.user.id);
  res.json({ orders: rows.map(orderJson) });
});
app.get('/api/orders/:id', requireAuth, (req, res) => {
  expireHolds();
  const order = orderForUser(req.params.id, req.user);
  if (!order) return res.status(404).json({ error: 'Không tìm thấy đơn vé.' });
  res.json({ order: orderJson(order), event: getEvent() });
});
app.delete('/api/orders/:id', requireAuth, (req, res) => {
  const order = orderForUser(req.params.id, req.user);
  if (!order) return res.status(404).json({ error: 'Không tìm thấy đơn vé.' });
  if (order.status !== 'reserved') return res.status(400).json({ error: 'Chỉ có thể hủy đơn đang giữ chỗ, chưa gửi minh chứng.' });
  db.prepare("UPDATE orders SET status='expired', updated_at=? WHERE id=?").run(isoNow(), order.id);
  res.json({ ok: true });
});
app.post('/api/orders/:id/proof', requireAuth, (req, res) => {
  uploadProof.single('proof')(req, res, (uploadError) => {
    if (uploadError) return res.status(400).json({ error: uploadError.message || 'Không thể tải minh chứng.' });
    if (!req.file) return res.status(400).json({ error: 'Vui lòng chọn ảnh hoặc PDF minh chứng.' });
    const order = orderForUser(req.params.id, req.user);
    if (!order) { fs.unlinkSync(req.file.path); return res.status(404).json({ error: 'Không tìm thấy đơn vé.' }); }
    expireHolds();
    const fresh = db.prepare('SELECT * FROM orders WHERE id=?').get(order.id);
    if (!['reserved', 'pending'].includes(fresh.status)) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Đơn đã hết hạn hoặc đã được xử lý, không thể gửi minh chứng.' });
    }
    if (fresh.status === 'reserved' && fresh.expires_at <= isoNow()) {
      fs.unlinkSync(req.file.path);
      return res.status(410).json({ error: 'Thời gian giữ vé đã hết. Hãy tạo đơn giữ vé mới.' });
    }
    if (fresh.proof_filename) {
      const previous = path.join(UPLOADS, path.basename(fresh.proof_filename));
      if (fs.existsSync(previous)) fs.unlinkSync(previous);
    }
    db.prepare("UPDATE orders SET proof_filename=?, status='pending', expires_at=NULL, updated_at=? WHERE id=?")
      .run(req.file.filename, isoNow(), order.id);
    res.json({ order: orderJson(orderForUser(order.id, req.user)), message: 'Đã gửi minh chứng. Vé được giữ trong lúc Admin kiểm tra.' });
  });
});
app.get('/api/orders/:id/proof', requireAuth, (req, res) => {
  const order = orderForUser(req.params.id, req.user);
  if (!order || !order.proof_filename) return res.status(404).json({ error: 'Không tìm thấy minh chứng.' });
  const filePath = path.join(UPLOADS, path.basename(order.proof_filename));
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Tệp minh chứng không còn tồn tại trên máy chủ.' });
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.sendFile(filePath);
});

// Admin endpoints
app.get('/api/admin/summary', requireAdmin, (_req, res) => {
  expireHolds();
  const count = (status) => db.prepare('SELECT COUNT(*) AS n FROM orders WHERE status=?').get(status).n;
  const revenue = db.prepare("SELECT COALESCE(SUM(total),0) AS n FROM orders WHERE status='approved'").get().n;
  const tickets = db.prepare('SELECT * FROM tickets ORDER BY price ASC').all().map(publicTicket);
  res.json({ counts: { all: db.prepare('SELECT COUNT(*) AS n FROM orders').get().n, reserved: count('reserved'), pending: count('pending'), approved: count('approved'), rejected: count('rejected'), expired: count('expired') }, approvedRevenue: revenue, tickets, event: getEvent() });
});
app.get('/api/admin/orders', requireAdmin, (req, res) => {
  expireHolds();
  const status = safeString(req.query.status, 20);
  let rows;
  if (status && ['reserved','pending','approved','rejected','expired'].includes(status)) {
    rows = db.prepare(`SELECT o.*, t.name AS ticket_name, u.name AS customer_name, u.email AS customer_email, u.phone AS customer_phone
      FROM orders o JOIN tickets t ON t.id=o.ticket_id JOIN users u ON u.id=o.user_id WHERE o.status=? ORDER BY o.created_at DESC`).all(status);
  } else {
    rows = db.prepare(`SELECT o.*, t.name AS ticket_name, u.name AS customer_name, u.email AS customer_email, u.phone AS customer_phone
      FROM orders o JOIN tickets t ON t.id=o.ticket_id JOIN users u ON u.id=o.user_id ORDER BY o.created_at DESC LIMIT 300`).all();
  }
  res.json({ orders: rows.map(orderJson) });
});
app.post('/api/admin/orders/:id/release', requireAdmin, (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Không tìm thấy đơn vé.' });
  if (order.status !== 'reserved') return res.status(400).json({ error: 'Chỉ có thể trả kho cho đơn đang giữ chỗ chưa gửi minh chứng.' });
  db.prepare("UPDATE orders SET status='expired', admin_note='Admin đã giải phóng chỗ giữ vé', updated_at=? WHERE id=?").run(isoNow(), order.id);
  res.json({ ok: true, message: 'Đã trả lại kho vé.' });
});

app.patch('/api/admin/orders/:id', requireAdmin, (req, res) => {
  const status = safeString(req.body.status, 20);
  const note = safeString(req.body.adminNote, 500);
  if (!['approved','rejected'].includes(status)) return res.status(400).json({ error: 'Trạng thái cần là approved hoặc rejected.' });
  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Không tìm thấy đơn vé.' });
  if (order.status !== 'pending') return res.status(400).json({ error: 'Chỉ đơn đã gửi minh chứng mới được duyệt hoặc từ chối.' });
  if (status === 'approved' && !order.proof_filename) return res.status(400).json({ error: 'Đơn chưa có minh chứng chuyển khoản.' });
  db.prepare('UPDATE orders SET status=?, admin_note=?, updated_at=? WHERE id=?').run(status, note, isoNow(), order.id);
  res.json({ order: orderJson(orderForUser(order.id, req.user)), message: status === 'approved' ? 'Đã xác nhận thanh toán.' : 'Đã từ chối đơn vé.' });
});
app.patch('/api/admin/event', requireAdmin, (req, res) => {
  const fields = {
    title: safeString(req.body.title, 100), tagline: safeString(req.body.tagline, 200),
    date: safeString(req.body.date, 10), time: safeString(req.body.time, 5),
    venue: safeString(req.body.venue, 200), address: safeString(req.body.address, 250),
    bank_name: safeString(req.body.bank_name, 150), bank_account: safeString(req.body.bank_account, 80),
    bank_owner: safeString(req.body.bank_owner, 150), bank_note: safeString(req.body.bank_note, 500),
    hold_minutes: Number(req.body.hold_minutes)
  };
  if (!fields.title || !/^\d{4}-\d{2}-\d{2}$/.test(fields.date) || !/^\d{2}:\d{2}$/.test(fields.time)) return res.status(400).json({ error: 'Tên show, ngày và giờ cần hợp lệ.' });
  if (!Number.isInteger(fields.hold_minutes) || fields.hold_minutes < 3 || fields.hold_minutes > 60) return res.status(400).json({ error: 'Thời gian giữ vé phải từ 3 đến 60 phút.' });
  db.prepare(`UPDATE event_config SET title=?,tagline=?,date=?,time=?,venue=?,address=?,bank_name=?,bank_account=?,bank_owner=?,bank_note=?,hold_minutes=? WHERE id=1`)
    .run(fields.title, fields.tagline, fields.date, fields.time, fields.venue, fields.address, fields.bank_name, fields.bank_account, fields.bank_owner, fields.bank_note, fields.hold_minutes);
  res.json({ event: getEvent(), message: 'Đã lưu thông tin show và chuyển khoản.' });
});
app.patch('/api/admin/tickets/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const name = safeString(req.body.name, 100);
  const subtitle = safeString(req.body.subtitle, 200);
  const price = Number(req.body.price);
  const stock = Number(req.body.stock);
  const active = req.body.active === false || req.body.active === 0 || req.body.active === '0' ? 0 : 1;
  if (!Number.isInteger(id) || !name || !Number.isSafeInteger(price) || price < 0 || !Number.isInteger(stock) || stock < 0 || stock > 100000) return res.status(400).json({ error: 'Tên, giá hoặc số lượng vé không hợp lệ.' });
  const ticket = db.prepare('SELECT * FROM tickets WHERE id=?').get(id);
  if (!ticket) return res.status(404).json({ error: 'Không tìm thấy hạng vé.' });
  const alreadyAllocated = db.prepare("SELECT COALESCE(SUM(quantity),0) AS n FROM orders WHERE ticket_id=? AND (status='pending' OR status='approved' OR status='reserved')").get(id).n;
  if (stock < alreadyAllocated) return res.status(409).json({ error: `Số lượng kho không thể thấp hơn ${alreadyAllocated} vé đã giữ/đã bán.` });
  db.prepare('UPDATE tickets SET name=?,subtitle=?,price=?,stock=?,active=? WHERE id=?').run(name, subtitle, price, stock, active, id);
  res.json({ ticket: publicTicket(db.prepare('SELECT * FROM tickets WHERE id=?').get(id)), message: 'Đã lưu hạng vé.' });
});

app.get('/admin', (_req, res) => res.sendFile(path.join(PUBLIC, 'admin.html')));
app.get('/health', (_req, res) => res.json({ ok: true, service: 'Thập Kỷ Ticketing' }));
app.use('/api', (error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: 'Máy chủ gặp lỗi không mong muốn. Hãy kiểm tra terminal để xem chi tiết.' });
});
app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).send('Máy chủ gặp lỗi không mong muốn.');
});

app.listen(PORT, () => {
  console.log(`\n✦ Thập Kỷ Ticketing đang chạy tại http://localhost:${PORT}`);
  console.log(`✦ Trang Admin: http://localhost:${PORT}/admin`);
  console.log(`✦ Admin demo: ${adminEmail} / ${adminPassword}`);
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.startsWith('replace-')) console.warn('⚠ Hãy đổi SESSION_SECRET trong .env trước khi triển khai thực tế.');
  console.log('⚠ Tài khoản ngân hàng và giá vé hiện là dữ liệu mẫu; hãy cập nhật trong Admin trước khi nhận tiền thật.\n');
});
