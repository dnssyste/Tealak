const express = require('express');
const router = express.Router();

// Admin PIN check middleware
async function requireAdmin(req, res, next) {
  const pin = req.headers['x-admin-pin'] || req.query.pin;
  if (!pin) return res.status(401).json({ error: 'Admin PIN required' });
  const db = req.app.locals.db;
  const result = await db.query("SELECT value FROM settings WHERE key = 'admin_pin'");
  if (result.rows.length === 0 || result.rows[0].value !== pin) {
    return res.status(403).json({ error: 'Invalid admin PIN' });
  }
  next();
}

// === EMAIL RECIPIENTS ===
router.get('/recipients', requireAdmin, async (req, res) => {
  const db = req.app.locals.db;
  const result = await db.query('SELECT * FROM email_recipients ORDER BY created_at');
  res.json(result.rows);
});

router.post('/recipients', requireAdmin, async (req, res) => {
  const { email, name, reply_to, notify_delivered, notify_damaged, notify_missing } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });
  const db = req.app.locals.db;
  const result = await db.query(
    'INSERT INTO email_recipients (email, name, reply_to, notify_delivered, notify_damaged, notify_missing) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
    [email, name || '', reply_to || null, notify_delivered !== false, notify_damaged !== false, notify_missing !== false]
  );
  res.json(result.rows[0]);
});

router.put('/recipients/:id', requireAdmin, async (req, res) => {
  const { email, name, reply_to, notify_delivered, notify_damaged, notify_missing, active } = req.body;
  const db = req.app.locals.db;
  const result = await db.query(
    'UPDATE email_recipients SET email=$1, name=$2, reply_to=$3, notify_delivered=$4, notify_damaged=$5, notify_missing=$6, active=$7 WHERE id=$8 RETURNING *',
    [email, name, reply_to || null, notify_delivered, notify_damaged, notify_missing, active, req.params.id]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
  res.json(result.rows[0]);
});

router.delete('/recipients/:id', requireAdmin, async (req, res) => {
  const db = req.app.locals.db;
  await db.query('DELETE FROM email_recipients WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

// === DRIVERS ===
router.get('/drivers', requireAdmin, async (req, res) => {
  const db = req.app.locals.db;
  const result = await db.query('SELECT * FROM drivers ORDER BY created_at');
  res.json(result.rows);
});

router.post('/drivers', requireAdmin, async (req, res) => {
  const { name, pin, lang, email } = req.body;
  if (!name || !pin) return res.status(400).json({ error: 'Name and PIN required' });
  if (pin.length !== 4 || !/^\d{4}$/.test(pin)) return res.status(400).json({ error: 'PIN must be 4 digits' });
  const db = req.app.locals.db;
  const existing = await db.query('SELECT id FROM drivers WHERE pin = $1', [pin]);
  if (existing.rows.length > 0) return res.status(400).json({ error: 'PIN already in use' });
  const result = await db.query(
    'INSERT INTO drivers (name, pin, lang, email) VALUES ($1, $2, $3, $4) RETURNING *',
    [name, pin, lang || 'da', email || null]
  );
  res.json(result.rows[0]);
});

router.put('/drivers/:id', requireAdmin, async (req, res) => {
  const { name, pin, lang, email } = req.body;
  const db = req.app.locals.db;
  if (pin) {
    if (pin.length !== 4 || !/^\d{4}$/.test(pin)) return res.status(400).json({ error: 'PIN must be 4 digits' });
    const existing = await db.query('SELECT id FROM drivers WHERE pin = $1 AND id != $2', [pin, req.params.id]);
    if (existing.rows.length > 0) return res.status(400).json({ error: 'PIN already in use' });
  }
  const result = await db.query(
    'UPDATE drivers SET name=COALESCE($1,name), pin=COALESCE($2,pin), lang=COALESCE($3,lang), email=$4 WHERE id=$5 RETURNING *',
    [name, pin, lang, email || null, req.params.id]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
  res.json(result.rows[0]);
});

router.delete('/drivers/:id', requireAdmin, async (req, res) => {
  const db = req.app.locals.db;
  await db.query('DELETE FROM drivers WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

// === SETTINGS ===
router.get('/settings', requireAdmin, async (req, res) => {
  const db = req.app.locals.db;
  const result = await db.query('SELECT key, value FROM settings ORDER BY key');
  const settings = {};
  result.rows.forEach(r => settings[r.key] = r.value);
  res.json(settings);
});

router.put('/settings', requireAdmin, async (req, res) => {
  const db = req.app.locals.db;
  for (const [key, value] of Object.entries(req.body)) {
    if (key === 'admin_pin' || key === 'email_auto_send') {
      await db.query('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2', [key, value]);
    }
  }
  res.json({ success: true });
});

module.exports = router;
