const express = require('express');
const nodemailer = require('nodemailer');
const { getSmtpConfig } = require('../utils/email');
const router = express.Router();

// Office Admin PIN check middleware — verify against office_admins table
async function requireAdmin(req, res, next) {
  const pin = req.headers['x-admin-pin'] || req.query.pin;
  if (!pin) return res.status(401).json({ error: 'Admin PIN required' });
  const db = req.app.locals.db;
  try {
    const result = await db.query('SELECT id, name, lang FROM office_admins WHERE pin = $1 AND active = true', [pin]);
    if (result.rows.length === 0) {
      return res.status(403).json({ error: 'Invalid admin PIN' });
    }
    req.admin = result.rows[0];
    next();
  } catch (err) {
    console.error('Admin auth error:', err.message);
    res.status(500).json({ error: 'Authentication failed' });
  }
}

// POST /api/admin/auth — verify against office_admins table
router.post('/auth', async (req, res) => {
  try {
    const { pin } = req.body;
    if (!pin) return res.status(400).json({ error: 'PIN is required' });
    const db = req.app.locals.db;
    const result = await db.query('SELECT id, name, lang FROM office_admins WHERE pin = $1 AND active = true', [pin]);
    if (result.rows.length > 0) {
      res.json({ success: true, admin: result.rows[0] });
    } else {
      res.json({ success: false });
    }
  } catch (err) {
    console.error('Auth error:', err.message);
    res.status(500).json({ error: 'Auth failed' });
  }
});

// === EMAIL RECIPIENTS ===
router.get('/recipients', requireAdmin, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const result = await db.query('SELECT * FROM email_recipients ORDER BY created_at');
    res.json(result.rows);
  } catch (err) {
    console.error('Get recipients error:', err.message);
    res.status(500).json({ error: 'Failed to load recipients' });
  }
});

router.post('/recipients', requireAdmin, async (req, res) => {
  try {
    const { email, name, reply_to, notify_delivered, notify_damaged, notify_missing } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });
    const db = req.app.locals.db;
    const result = await db.query(
      'INSERT INTO email_recipients (email, name, reply_to, notify_delivered, notify_damaged, notify_missing) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [email, name || '', reply_to || null, notify_delivered !== false, notify_damaged !== false, notify_missing !== false]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Create recipient error:', err.message);
    res.status(500).json({ error: 'Failed to create recipient' });
  }
});

router.put('/recipients/:id', requireAdmin, async (req, res) => {
  try {
    const { email, name, reply_to, notify_delivered, notify_damaged, notify_missing, active } = req.body;
    const db = req.app.locals.db;
    const result = await db.query(
      'UPDATE email_recipients SET email=$1, name=$2, reply_to=$3, notify_delivered=$4, notify_damaged=$5, notify_missing=$6, active=$7 WHERE id=$8 RETURNING *',
      [email, name, reply_to || null, notify_delivered, notify_damaged, notify_missing, active, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update recipient error:', err.message);
    res.status(500).json({ error: 'Failed to update recipient' });
  }
});

router.delete('/recipients/:id', requireAdmin, async (req, res) => {
  try {
    const db = req.app.locals.db;
    await db.query('DELETE FROM email_recipients WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete recipient error:', err.message);
    res.status(500).json({ error: 'Failed to delete recipient' });
  }
});

// === DRIVERS ===
router.get('/drivers', requireAdmin, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const result = await db.query('SELECT * FROM drivers ORDER BY created_at');
    res.json(result.rows);
  } catch (err) {
    console.error('Get drivers error:', err.message);
    res.status(500).json({ error: 'Failed to load drivers' });
  }
});

router.post('/drivers', requireAdmin, async (req, res) => {
  try {
    const { name, pin, lang, email, phone } = req.body;
    if (!name || !pin) return res.status(400).json({ error: 'Name and PIN required' });
    if (pin.length !== 4 || !/^\d{4}$/.test(pin)) return res.status(400).json({ error: 'PIN must be 4 digits' });
    const db = req.app.locals.db;
    const existing = await db.query('SELECT id FROM drivers WHERE pin = $1', [pin]);
    if (existing.rows.length > 0) return res.status(400).json({ error: 'PIN already in use' });
    const result = await db.query(
      'INSERT INTO drivers (name, pin, lang, email, phone) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [name, pin, lang || 'da', email || null, phone || null]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Create driver error:', err.message);
    res.status(500).json({ error: 'Failed to create driver' });
  }
});

router.put('/drivers/:id', requireAdmin, async (req, res) => {
  try {
    const { name, pin, lang, email, phone } = req.body;
    const db = req.app.locals.db;
    if (pin) {
      if (pin.length !== 4 || !/^\d{4}$/.test(pin)) return res.status(400).json({ error: 'PIN must be 4 digits' });
      const existing = await db.query('SELECT id FROM drivers WHERE pin = $1 AND id != $2', [pin, req.params.id]);
      if (existing.rows.length > 0) return res.status(400).json({ error: 'PIN already in use' });
    }
    const result = await db.query(
      'UPDATE drivers SET name=COALESCE($1,name), pin=COALESCE($2,pin), lang=COALESCE($3,lang), email=$4, phone=$5 WHERE id=$6 RETURNING *',
      [name, pin, lang, email || null, phone || null, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update driver error:', err.message);
    res.status(500).json({ error: 'Failed to update driver' });
  }
});

router.delete('/drivers/:id', requireAdmin, async (req, res) => {
  try {
    const db = req.app.locals.db;
    await db.query('DELETE FROM drivers WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    if (err.code === '23503') {
      return res.status(409).json({ error: 'Cannot delete driver with existing jobs. Deactivate instead.' });
    }
    console.error('Delete driver error:', err.message);
    res.status(500).json({ error: 'Failed to delete driver' });
  }
});

// === SETTINGS (only email_auto_send allowed) ===
router.get('/settings', requireAdmin, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const result = await db.query("SELECT key, value FROM settings WHERE key = 'email_auto_send'");
    const settings = {};
    result.rows.forEach(r => settings[r.key] = r.value);
    res.json(settings);
  } catch (err) {
    console.error('Get settings error:', err.message);
    res.status(500).json({ error: 'Failed to load settings' });
  }
});

router.put('/settings', requireAdmin, async (req, res) => {
  try {
    const db = req.app.locals.db;
    for (const [key, value] of Object.entries(req.body)) {
      if (key === 'email_auto_send') {
        await db.query('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2', [key, value]);
      }
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Update settings error:', err.message);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

// === PHOTO LIBRARY ===
router.get('/photos/library', requireAdmin, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const result = await db.query(`
      SELECT j.*, d.name as driver_name,
        (SELECT json_agg(json_build_object('id', jp.id, 'filename', jp.filename, 'photo_type', jp.photo_type, 'original_name', jp.original_name, 'created_at', jp.created_at))
         FROM job_photos jp WHERE jp.job_id = j.id) as photos
      FROM jobs j
      LEFT JOIN drivers d ON j.driver_id = d.id
      ORDER BY j.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Photo library error:', err.message);
    res.status(500).json({ error: 'Failed to load photo library' });
  }
});

router.post('/photos/email', requireAdmin, async (req, res) => {
  try {
    const { job_id, email, message } = req.body;
    if (!job_id || !email) return res.status(400).json({ error: 'job_id and email are required' });

    const db = req.app.locals.db;

    // Get job details
    const jobResult = await db.query(
      `SELECT j.*, d.name as driver_name FROM jobs j
       LEFT JOIN drivers d ON j.driver_id = d.id
       WHERE j.id = $1`, [job_id]
    );
    if (jobResult.rows.length === 0) return res.status(404).json({ error: 'Job not found' });
    const job = jobResult.rows[0];

    // Get photos
    const photosResult = await db.query('SELECT * FROM job_photos WHERE job_id = $1', [job_id]);
    const photos = photosResult.rows;

    // Get SMTP config
    const smtpConfig = await getSmtpConfig(db);
    if (!smtpConfig.host) {
      return res.status(400).json({ error: 'SMTP not configured. Please set up SMTP in Server Administration.' });
    }

    const baseUrl = process.env.BASE_URL || 'https://teslak.brbeck.net';
    const galleryUrl = `${baseUrl}/gallery/${job_id}`;

    const photoLinks = photos.map(p =>
      `<a href="${baseUrl}/api/photos/file/${p.filename}" style="display:inline-block;margin:4px;">
        <img src="${baseUrl}/api/photos/file/${p.filename}" alt="${p.original_name || p.filename}" style="width:120px;height:90px;object-fit:cover;border-radius:6px;border:1px solid #ddd;" />
      </a>`
    ).join('');

    const customMessage = message ? `
      <div style="padding:16px 32px;">
        <div style="padding:12px 16px;background:#f8fafc;border-left:3px solid #c0392b;border-radius:4px;">
          <p style="margin:0;color:#374151;font-size:14px;line-height:1.6;">${message.replace(/\n/g, '<br>')}</p>
        </div>
      </div>` : '';

    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:640px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;margin-top:20px;margin-bottom:20px;box-shadow:0 2px 8px rgba(0,0,0,0.1);">
    <div style="background:#1a1a2e;padding:24px 32px;text-align:center;">
      <h1 style="margin:0;color:#fff;font-size:24px;letter-spacing:1px;">🚛 TESLAK</h1>
      <p style="margin:4px 0 0;color:#94a3b8;font-size:13px;">Delivery Photos</p>
    </div>
    <div style="padding:20px 32px;">
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <tr style="border-bottom:1px solid #e5e7eb;">
          <td style="padding:8px;color:#6b7280;width:100px;">Order Nr</td>
          <td style="padding:8px;font-weight:500;">${job.order_nr || 'N/A'}</td>
        </tr>
        <tr style="border-bottom:1px solid #e5e7eb;">
          <td style="padding:8px;color:#6b7280;">Tur Nr</td>
          <td style="padding:8px;">${job.tur_nr || 'N/A'}</td>
        </tr>
        <tr style="border-bottom:1px solid #e5e7eb;">
          <td style="padding:8px;color:#6b7280;">Address</td>
          <td style="padding:8px;">${job.address || 'N/A'}</td>
        </tr>
        <tr style="border-bottom:1px solid #e5e7eb;">
          <td style="padding:8px;color:#6b7280;">Photos</td>
          <td style="padding:8px;">${photos.length} photo(s)</td>
        </tr>
      </table>
    </div>
    ${customMessage}
    <div style="text-align:center;padding:16px 32px;">
      <a href="${galleryUrl}" style="display:inline-block;background:#c0392b;color:#fff;padding:14px 32px;border-radius:8px;font-size:15px;font-weight:600;text-decoration:none;">📸 View Photo Gallery & Download</a>
    </div>
    ${photos.length > 0 ? `
    <div style="padding:0 32px 24px;">
      <h3 style="margin:0 0 12px;color:#374151;font-size:16px;">📷 Photos (${photos.length})</h3>
      <div>${photoLinks}</div>
    </div>` : ''}
    <div style="background:#f9fafb;padding:16px 32px;text-align:center;border-top:1px solid #e5e7eb;">
      <p style="margin:0;color:#9ca3af;font-size:12px;">
        Teslak Delivery System &bull; ${new Date().toLocaleDateString('da-DK')}
      </p>
    </div>
  </div>
</body>
</html>`;

    const transporter = nodemailer.createTransport({
      host: smtpConfig.host,
      port: smtpConfig.port,
      secure: smtpConfig.secure,
      auth: smtpConfig.auth,
    });

    await transporter.sendMail({
      from: smtpConfig.from || '"Teslak Delivery" <noreply@teslak.dk>',
      to: email,
      subject: `Teslak Delivery Photos - Order ${job.order_nr || job.id}`,
      html,
    });

    console.log(`Photo email sent to ${email} for job ${job_id}`);
    res.json({ success: true, message: `Photos emailed to ${email}` });
  } catch (err) {
    console.error('Photo email error:', err.message);
    res.status(500).json({ error: 'Failed to send photo email: ' + err.message });
  }
});

module.exports = router;
