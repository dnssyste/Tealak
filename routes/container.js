const express = require('express');
const crypto = require('crypto');
const sharp = require('sharp');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { sendContainerReportEmail } = require('../utils/email');

const PHOTO_DIR = '/data/photos';
if (!fs.existsSync(PHOTO_DIR)) fs.mkdirSync(PHOTO_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, PHOTO_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, 'container_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6) + ext);
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

// POST /api/container - create container report
router.post('/', upload.array('photos', 30), async (req, res) => {
  const db = req.app.locals.db;
  try {
    const { driver_id, comment, tur_nr, container_nr, rating, item_type } = req.body;
    const files = req.files || [];

    // Get truck name
    const driverRes = await db.query('SELECT name FROM drivers WHERE id = $1', [driver_id]);
    const truckName = driverRes.rows[0] ? driverRes.rows[0].name : 'Unknown';

    // Create report
    const reportRes = await db.query(
      'INSERT INTO container_reports (driver_id, truck_name, comment, tur_nr, container_nr, rating, item_type, gallery_token) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *',
      [driver_id, truckName, comment || '', tur_nr || null, container_nr || null, rating ? parseInt(rating) : null, item_type || null, crypto.randomBytes(32).toString('hex')]
    );
    const report = reportRes.rows[0];

    // Save photos (with EXIF auto-rotation)
    const photoFilenames = [];
    for (const file of files) {
      try {
        const rotatedName = 'rot_' + file.filename.replace(/\.[^.]+$/, '.jpg');
        const rotatedPath = path.join('/data/photos', rotatedName);
        await sharp(file.path).rotate().resize(2048, 2048, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toFile(rotatedPath);
        fs.unlinkSync(file.path);
        await db.query('INSERT INTO container_report_photos (report_id, filename) VALUES ($1, $2)', [report.id, rotatedName]);
        photoFilenames.push(rotatedName);
      } catch (sharpErr) {
        console.error('Sharp rotation failed:', sharpErr.message);
        await db.query('INSERT INTO container_report_photos (report_id, filename) VALUES ($1, $2)', [report.id, file.filename]);
        photoFilenames.push(file.filename);
      }
    }

    // Send email
    try {
      await sendContainerReportEmail(db, report, photoFilenames);
      await db.query('UPDATE container_reports SET email_sent = TRUE WHERE id = $1', [report.id]);
    } catch (emailErr) {
      console.error('Container report email failed:', emailErr.message);
    }

    res.json({ success: true, reportId: report.id });
  } catch (err) {
    console.error('Container report error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/container - list reports for driver
router.get('/', async (req, res) => {
  const db = req.app.locals.db;
  try {
    const { driver_id } = req.query;
    const result = await db.query(
      'SELECT cr.*, COUNT(crp.id) as photo_count FROM container_reports cr LEFT JOIN container_report_photos crp ON crp.report_id = cr.id WHERE cr.driver_id = $1 GROUP BY cr.id ORDER BY cr.created_at DESC LIMIT 50',
      [driver_id]
    );
    res.json({ reports: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
