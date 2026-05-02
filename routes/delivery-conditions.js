const express = require('express');
const crypto = require('crypto');
const sharp = require('sharp');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const nodemailer = require('nodemailer');

const PHOTO_DIR = '/data/photos';
if (!fs.existsSync(PHOTO_DIR)) fs.mkdirSync(PHOTO_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, PHOTO_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, 'dc_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6) + ext);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|webp|heic/;
    const ext = allowed.test(require('path').extname(file.originalname).toLowerCase());
    const mime = allowed.test(file.mimetype);
    if (ext || mime) cb(null, true);
    else cb(new Error('Only image files allowed'), false);
  }
});

async function getSmtpConfig(pool) {
  try {
    const defResult = await pool.query('SELECT * FROM smtp_profiles WHERE is_default = true LIMIT 1');
    if (defResult.rows.length) {
      const p = defResult.rows[0];
      return { host: p.host, port: p.port, secure: p.secure, auth: { user: p.username, pass: p.password }, from: p.from_address || p.username };
    }
  } catch(e) {}
  return { host: process.env.SMTP_HOST, port: parseInt(process.env.SMTP_PORT||'587'), secure: false, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }, from: process.env.SMTP_FROM };
}

// POST /api/delivery-conditions
router.post('/', upload.array('photos', 30), async (req, res) => {
  const db = req.app.locals.db;
  try {
    const { driver_id, reason, comment } = req.body;
    const files = req.files || [];

    const driverRes = await db.query('SELECT name, phone, email FROM drivers WHERE id = $1', [driver_id]);
    const driver = driverRes.rows[0] || {};
    const truckName = driver.name || 'Unknown';

    const reportRes = await db.query(
      'INSERT INTO delivery_conditions (driver_id, truck_name, reason, comment, gallery_token) VALUES ($1,$2,$3,$4, $5) RETURNING *',
      [driver_id, truckName, reason || '', comment || '', crypto.randomBytes(32).toString('hex')]
    );
    const report = reportRes.rows[0];

    const photoFilenames = [];
    for (const file of files) {
      let savedFilename = file.filename;
      try {
        const rotatedName = 'rot_' + file.filename.replace(/\.[^.]+$/, '.jpg');
        const rotatedPath = path.join('/data/photos', rotatedName);
        await sharp(file.path).rotate().resize(2048, 2048, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toFile(rotatedPath);
        fs.unlinkSync(file.path);
        savedFilename = rotatedName;
      } catch (sharpErr) {
        console.error('Sharp rotation failed:', sharpErr.message);
      }
      await db.query('INSERT INTO delivery_condition_photos (report_id, filename) VALUES ($1,$2)', [report.id, savedFilename]);
      photoFilenames.push(savedFilename);
    }

    // Send email to all active recipients
    try {
      const recipientsRes = await db.query("SELECT email, reply_to FROM email_recipients WHERE active = TRUE AND notify_dc = TRUE");
      if (recipientsRes.rows.length > 0) {
        const smtp = await getSmtpConfig(db);
        const transporter = nodemailer.createTransport({ host: smtp.host, port: smtp.port, secure: smtp.secure, auth: smtp.auth, tls: { rejectUnauthorized: false } });
        const baseUrl = process.env.BASE_URL || 'https://app.teslak.net';
        const dcGalleryUrl = `${baseUrl}/dc-gallery/${report.id}/${report.gallery_token || ''}`;
        const now = new Date(report.created_at);
        const dateStr = now.toLocaleString('da-DK', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Copenhagen' });

        const photoHtml = photoFilenames.map(fn =>
          `<a href="${baseUrl}/api/photos/file/${fn}" style="display:inline-block;margin:4px;">
            <img src="${baseUrl}/api/photos/file/${fn}" alt="photo" style="width:120px;height:90px;object-fit:cover;border-radius:6px;border:1px solid #ddd;"/>
          </a>`
        ).join('');

        const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,sans-serif;">
<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.1);">
  <div style="background:#ffffff;padding:24px 32px;text-align:center;border-bottom:1px solid #eee;">
    <img src="${baseUrl}/assets/teslak-logo.png" alt="Teslak" style="height:48px;margin-bottom:8px;"/>
    <h1 style="margin:0;color:#1a1a1a;font-size:22px;">📋 Leverings Forhold</h1>
    <p style="margin:4px 0 0;color:#666;font-size:14px;">Delivery Conditions Report</p>
  </div>
  <div style="padding:24px 32px;">
    <table style="width:100%;border-collapse:collapse;">
      <tr style="border-bottom:1px solid #e5e7eb;">
        <td style="padding:10px 8px;color:#6b7280;">Truck</td>
        <td style="padding:10px 8px;font-weight:600;">${truckName}</td>
      </tr>
      <tr style="border-bottom:1px solid #e5e7eb;">
        <td style="padding:10px 8px;color:#6b7280;">Phone</td>
        <td style="padding:10px 8px;">${driver.phone || 'N/A'}</td>
      </tr>
      <tr style="border-bottom:1px solid #e5e7eb;">
        <td style="padding:10px 8px;color:#6b7280;">Årsag / Reason</td>
        <td style="padding:10px 8px;"><strong style="color:#c0392b;">${reason || 'N/A'}</strong></td>
      </tr>
      <tr style="border-bottom:1px solid #e5e7eb;">
        <td style="padding:10px 8px;color:#6b7280;">Kommentar</td>
        <td style="padding:10px 8px;">${comment || '—'}</td>
      </tr>
      <tr>
        <td style="padding:10px 8px;color:#6b7280;">Tidspunkt</td>
        <td style="padding:10px 8px;">${dateStr}</td>
      </tr>
    </table>
  </div>
  ${photoFilenames.length > 0 ? `<div style="padding:0 32px 24px;"><h3 style="margin:0 0 12px;color:#374151;font-size:16px;">📷 Photos (${photoFilenames.length})</h3><div>${photoHtml}</div></div>` : ''}
  <div style="padding:16px 32px;text-align:center;">
      <a href="${dcGalleryUrl}" style="display:inline-block;background:#c0392b;color:#fff;padding:14px 32px;border-radius:8px;font-size:15px;font-weight:600;text-decoration:none;letter-spacing:0.5px;">📸 View Photo Gallery & Download</a>
    </div>
  <div style="background:#f9fafb;padding:16px 32px;text-align:center;border-top:1px solid #e5e7eb;">
    <p style="margin:0;color:#9ca3af;font-size:12px;">Teslak Delivery System &bull; ${new Date().toLocaleDateString('da-DK', { timeZone: 'Europe/Copenhagen' })}</p>
  </div>
</div>
</body></html>`;

        for (const r of recipientsRes.rows) {
          await transporter.sendMail({
            from: smtp.from || '"Teslak Delivery" <noreply@teslak.dk>',
            to: r.email,
            replyTo: driver.email || r.reply_to || undefined,
            subject: `Leverings Forhold: ${reason} - ${truckName} - ${dateStr}`,
            html
          });
        }
      }
    } catch(emailErr) {
      console.error('Delivery conditions email failed:', emailErr.message);
    }

    res.json({ success: true, reportId: report.id });
  } catch (err) {
    console.error('Delivery conditions error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/delivery-conditions - list for driver
router.get('/', async (req, res) => {
  const db = req.app.locals.db;
  try {
    const { driver_id } = req.query;
    const result = await db.query(
      'SELECT dc.*, COUNT(dcp.id) as photo_count FROM delivery_conditions dc LEFT JOIN delivery_condition_photos dcp ON dcp.report_id = dc.id WHERE dc.driver_id = $1 GROUP BY dc.id ORDER BY dc.created_at DESC LIMIT 50',
      [driver_id]
    );
    res.json({ reports: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
