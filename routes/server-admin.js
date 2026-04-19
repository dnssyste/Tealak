const express = require('express');
const nodemailer = require('nodemailer');
const router = express.Router();

// Server Admin PIN check middleware
async function requireServerAdmin(req, res, next) {
  const pin = req.headers['x-server-admin-pin'];
  if (!pin) return res.status(401).json({ error: 'Server admin PIN required' });
  const db = req.app.locals.db;
  try {
    const result = await db.query("SELECT value FROM settings WHERE key = 'server_admin_pin'");
    if (result.rows.length === 0 || result.rows[0].value !== pin) {
      return res.status(401).json({ error: 'Invalid server admin PIN' });
    }
    next();
  } catch (err) {
    console.error('Server admin auth error:', err.message);
    res.status(500).json({ error: 'Authentication failed' });
  }
}

// === AUTH ===
router.post('/auth', async (req, res) => {
  try {
    const { pin } = req.body;
    if (!pin) return res.status(400).json({ error: 'PIN is required' });
    const db = req.app.locals.db;
    const result = await db.query("SELECT value FROM settings WHERE key = 'server_admin_pin'");
    if (result.rows.length > 0 && result.rows[0].value === pin) {
      res.json({ success: true });
    } else {
      res.json({ success: false });
    }
  } catch (err) {
    console.error('Auth error:', err.message);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

// === SMTP CONFIG ===

// Helper: get SMTP config from smtp_config table with env fallback
async function getSmtpConfig(db) {
  const defaults = {
    host: process.env.SMTP_HOST || '',
    port: process.env.SMTP_PORT || '587',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || '',
  };

  try {
    const result = await db.query('SELECT key, value FROM smtp_config');
    if (result.rows.length > 0) {
      const config = {};
      result.rows.forEach(r => { config[r.key] = r.value; });
      if (config.smtp_host) {
        return {
          host: config.smtp_host || defaults.host,
          port: config.smtp_port || defaults.port,
          user: config.smtp_user || defaults.user,
          pass: config.smtp_pass || defaults.pass,
          from: config.smtp_from || defaults.from,
        };
      }
    }
  } catch (err) {
    console.error('Failed to load SMTP config from DB:', err.message);
  }

  return defaults;
}

// GET /api/server-admin/smtp — Read SMTP config
router.get('/smtp', requireServerAdmin, async (req, res) => {
  try {
    const config = await getSmtpConfig(req.app.locals.db);
    res.json({
      smtp_host: config.host,
      smtp_port: config.port,
      smtp_user: config.user,
      smtp_pass: config.pass,
      smtp_from: config.from,
    });
  } catch (err) {
    console.error('Get SMTP config error:', err.message);
    res.status(500).json({ error: 'Failed to load SMTP settings' });
  }
});

// PUT /api/server-admin/smtp — Save SMTP config (upsert each key)
router.put('/smtp', requireServerAdmin, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const allowedKeys = ['smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass', 'smtp_from'];

    for (const [key, value] of Object.entries(req.body)) {
      if (allowedKeys.includes(key) && value !== undefined) {
        await db.query(
          'INSERT INTO smtp_config (key, value, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()',
          [key, String(value)]
        );
      }
    }

    res.json({ success: true, message: 'SMTP settings saved' });
  } catch (err) {
    console.error('Save SMTP config error:', err.message);
    res.status(500).json({ error: 'Failed to save SMTP settings' });
  }
});

// POST /api/server-admin/smtp/test — Send test email
router.post('/smtp/test', requireServerAdmin, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Recipient email is required' });

    const config = await getSmtpConfig(req.app.locals.db);

    if (!config.host || !config.user || !config.pass) {
      return res.status(400).json({ error: 'SMTP settings are incomplete. Please configure host, user, and password first.' });
    }

    const transporter = nodemailer.createTransport({
      host: config.host,
      port: parseInt(config.port || '587'),
      secure: String(config.port) === '465',
      auth: {
        user: config.user,
        pass: config.pass,
      },
    });

    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:480px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.1);">
    <div style="background:#1a1a2e;padding:24px 32px;text-align:center;">
      <h1 style="margin:0;color:#fff;font-size:22px;letter-spacing:1px;">🚛 TESLAK</h1>
      <p style="margin:4px 0 0;color:#94a3b8;font-size:13px;">SMTP Test Email</p>
    </div>
    <div style="padding:32px;text-align:center;">
      <div style="font-size:48px;margin-bottom:16px;">✅</div>
      <h2 style="margin:0 0 8px;color:#1a1a2e;font-size:20px;">SMTP Test Successful</h2>
      <p style="margin:0;color:#6b7280;font-size:14px;line-height:1.6;">
        This test email confirms your SMTP configuration is correct.
      </p>
      <div style="margin-top:20px;padding:16px;background:#f0fdf4;border-radius:8px;border:1px solid #bbf7d0;">
        <p style="margin:0;font-size:13px;color:#166534;">
          <strong>Host:</strong> ${config.host}<br/>
          <strong>Port:</strong> ${config.port}<br/>
          <strong>From:</strong> ${config.from}
        </p>
      </div>
    </div>
    <div style="background:#f9fafb;padding:16px 32px;text-align:center;border-top:1px solid #e5e7eb;">
      <p style="margin:0;color:#9ca3af;font-size:12px;">
        Teslak Delivery System &bull; ${new Date().toLocaleDateString('da-DK')} ${new Date().toLocaleTimeString('da-DK')}
      </p>
    </div>
  </div>
</body>
</html>`;

    await transporter.sendMail({
      from: config.from || `"Teslak Test" <${config.user}>`,
      to: email,
      subject: '✅ Teslak SMTP Test - Mail Server Working',
      html,
    });

    console.log(`Test email sent to ${email}`);
    res.json({ success: true, message: `Test email sent to ${email}` });
  } catch (err) {
    console.error('SMTP test error:', err.message);
    res.status(500).json({ error: `SMTP test failed: ${err.message}` });
  }
});

// === OFFICE ADMINS ===

// GET /api/server-admin/office-admins — List all
router.get('/office-admins', requireServerAdmin, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const result = await db.query('SELECT * FROM office_admins ORDER BY created_at');
    res.json(result.rows);
  } catch (err) {
    console.error('Get office admins error:', err.message);
    res.status(500).json({ error: 'Failed to load office admins' });
  }
});

// POST /api/server-admin/office-admins — Create
router.post('/office-admins', requireServerAdmin, async (req, res) => {
  try {
    const { name, pin, email, lang } = req.body;
    if (!name || !pin) return res.status(400).json({ error: 'Name and PIN are required' });
    const db = req.app.locals.db;
    const existing = await db.query('SELECT id FROM office_admins WHERE pin = $1', [pin]);
    if (existing.rows.length > 0) return res.status(400).json({ error: 'PIN already in use' });
    const result = await db.query(
      'INSERT INTO office_admins (name, pin, email, lang) VALUES ($1, $2, $3, $4) RETURNING *',
      [name, pin, email || null, lang || 'da']
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Create office admin error:', err.message);
    res.status(500).json({ error: 'Failed to create office admin' });
  }
});

// PUT /api/server-admin/office-admins/:id — Update
router.put('/office-admins/:id', requireServerAdmin, async (req, res) => {
  try {
    const { name, pin, email, lang, active } = req.body;
    const db = req.app.locals.db;
    if (pin) {
      const existing = await db.query('SELECT id FROM office_admins WHERE pin = $1 AND id != $2', [pin, req.params.id]);
      if (existing.rows.length > 0) return res.status(400).json({ error: 'PIN already in use' });
    }
    const result = await db.query(
      'UPDATE office_admins SET name=COALESCE($1,name), pin=COALESCE($2,pin), email=$3, lang=COALESCE($4,lang), active=COALESCE($5,active) WHERE id=$6 RETURNING *',
      [name, pin, email || null, lang, active, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update office admin error:', err.message);
    res.status(500).json({ error: 'Failed to update office admin' });
  }
});

// DELETE /api/server-admin/office-admins/:id — Delete
router.delete('/office-admins/:id', requireServerAdmin, async (req, res) => {
  try {
    const db = req.app.locals.db;
    await db.query('DELETE FROM office_admins WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete office admin error:', err.message);
    res.status(500).json({ error: 'Failed to delete office admin' });
  }
});

// === DRIVERS ===

// GET /api/server-admin/drivers — List all
// PUT /settings/:key - update a setting
router.put('/settings/:key', requireServerAdmin, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const { key } = req.params;
    const { value } = req.body;
    await db.query(
      'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2',
      [key, value]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/drivers', requireServerAdmin, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const result = await db.query('SELECT * FROM drivers ORDER BY created_at');
    res.json(result.rows);
  } catch (err) {
    console.error('Get drivers error:', err.message);
    res.status(500).json({ error: 'Failed to load drivers' });
  }
});

// POST /api/server-admin/drivers — Create
router.post('/drivers', requireServerAdmin, async (req, res) => {
  try {
    const { name, pin, lang, email, phone } = req.body;
    if (!name || !pin) return res.status(400).json({ error: 'Name and PIN are required' });
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

// PUT /api/server-admin/drivers/:id — Update
router.put('/drivers/:id', requireServerAdmin, async (req, res) => {
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

// DELETE /api/server-admin/drivers/:id — Delete (handle FK error)
router.delete('/drivers/:id', requireServerAdmin, async (req, res) => {
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


// ===== SMTP PROFILES =====
router.get('/smtp-profiles', requireServerAdmin, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const result = await db.query('SELECT id, name, host, port, secure, username, from_address, is_default, created_at FROM smtp_profiles ORDER BY is_default DESC, id ASC');
    res.json({ profiles: result.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.post('/smtp-profiles', requireServerAdmin, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const { name, host, port, secure, username, password, from_address, is_default } = req.body;
    if (!name || !host || !username || !password) return res.status(400).json({ error: 'name, host, username, password required' });
    if (is_default) await db.query('UPDATE smtp_profiles SET is_default = false');
    const r = await db.query('INSERT INTO smtp_profiles (name, host, port, secure, username, password, from_address, is_default) VALUES (,,,,,,,) RETURNING id', [name, host, port || 587, !!secure, username, password, from_address || username, !!is_default]);
    res.json({ success: true, id: r.rows[0].id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.put('/smtp-profiles/:id', requireServerAdmin, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const { name, host, port, secure, username, password, from_address, is_default } = req.body;
    if (is_default) await db.query('UPDATE smtp_profiles SET is_default = false');
    if (password) {
      await db.query('UPDATE smtp_profiles SET name=$1, host=$2, port=$3, secure=$4, username=$5, password=$6, from_address=$7, is_default=$8 WHERE id=$9', [name, host, port || 587, !!secure, username, password, from_address || username, !!is_default, req.params.id]);
    } else {
      await db.query('UPDATE smtp_profiles SET name=$1, host=$2, port=$3, secure=$4, username=$5, from_address=$6, is_default=$7 WHERE id=$8', [name, host, port || 587, !!secure, username, from_address || username, !!is_default, req.params.id]);
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.delete('/smtp-profiles/:id', requireServerAdmin, async (req, res) => {
  try {
    const db = req.app.locals.db;
    await db.query('DELETE FROM smtp_profiles WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.post('/smtp-profiles/:id/set-default', requireServerAdmin, async (req, res) => {
  try {
    const db = req.app.locals.db;
    await db.query('UPDATE smtp_profiles SET is_default = false');
    await db.query('UPDATE smtp_profiles SET is_default = true WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.post('/smtp-profiles/:id/test', requireServerAdmin, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const { to } = req.body;
    const result = await db.query('SELECT * FROM smtp_profiles WHERE id=$1', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Profile not found' });
    const p = result.rows[0];
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({ host: p.host, port: p.port, secure: p.secure, auth: { user: p.username, pass: p.password } });
    await transporter.sendMail({ from: p.from_address, to: to || p.username, subject: 'SMTP Test - ' + p.name, text: 'SMTP profile test successful for: ' + p.name });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.get('/smtp-assignments', requireServerAdmin, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const keys = ['smtp_delivery_profile', 'smtp_container_profile', 'smtp_damage_profile'];
    const result = await db.query('SELECT key, value FROM settings WHERE key = ANY($1)', [keys]);
    const out = {};
    result.rows.forEach(r => { out[r.key] = r.value; });
    res.json(out);
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.post('/smtp-assignments', requireServerAdmin, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const { smtp_delivery_profile, smtp_container_profile, smtp_damage_profile } = req.body;
    for (const [k, v] of [['smtp_delivery_profile', smtp_delivery_profile], ['smtp_container_profile', smtp_container_profile], ['smtp_damage_profile', smtp_damage_profile]]) {
      await db.query('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', [k, v || '']);
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = { router, getSmtpConfig };
