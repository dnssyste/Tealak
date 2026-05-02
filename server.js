require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { sanitizeMiddleware } = require('./utils/sanitize');
const path = require('path');
const fs = require('fs');
const cron = require('node-cron');
const archiver = require('archiver');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy for Traefik
app.set('trust proxy', 1);

// CORS
// Security headers
app.use(helmet({
  contentSecurityPolicy: false,  // PWA needs inline scripts
  crossOriginEmbedderPolicy: false
}));

// CORS - restricted to our domain
app.use(cors({
  origin: [
    'https://app.teslak.net',
    'http://localhost:3000'  // dev
  ],
  credentials: true
}));

// Rate limiting
const apiLimiter = rateLimit({
  validate: { trustProxy: false },
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' }
});
const authLimiter = rateLimit({
  validate: { trustProxy: false },
  windowMs: 15 * 60 * 1000,
  max: 20, // strict for login
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts, please try again later' }
});
app.use('/api/', apiLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/admin/login', authLimiter);
app.use('/api/server-admin/login', authLimiter);

// Body parsers
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));
app.use(sanitizeMiddleware);

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Database pool
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'teslak',
  user: process.env.DB_USER || 'teslak',
  password: process.env.DB_PASS || 'teslak',
});

// Make pool available to routes
app.locals.db = pool;

// Ensure photo directory exists
const PHOTO_DIR = '/data/photos';
if (!fs.existsSync(PHOTO_DIR)) {
  fs.mkdirSync(PHOTO_DIR, { recursive: true });
}

// Initialize database schema
async function initDB() {
  try {
    const schema = fs.readFileSync(path.join(__dirname, 'db', 'schema.sql'), 'utf8');
    await pool.query(schema);
    console.log('Database schema initialized');
    // Security migration: add gallery tokens
    await pool.query(`
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS gallery_token VARCHAR(64);
      ALTER TABLE delivery_conditions ADD COLUMN IF NOT EXISTS gallery_token VARCHAR(64);
      ALTER TABLE container_reports ADD COLUMN IF NOT EXISTS gallery_token VARCHAR(64);
    `);
    // Backfill missing tokens
    const crypto = require('crypto');
    const tables = ['jobs', 'delivery_conditions', 'container_reports'];
    for (const tbl of tables) {
      const missing = await pool.query(`SELECT id FROM ${tbl} WHERE gallery_token IS NULL`);
      for (const row of missing.rows) {
        const token = crypto.randomBytes(32).toString('hex');
        await pool.query(`UPDATE ${tbl} SET gallery_token = $1 WHERE id = $2`, [token, row.id]);
      }
    }
    console.log('Gallery tokens initialized');
  } catch (err) {
    console.error('Failed to initialize database:', err.message);
  }
}

// Mount routes
const authRoutes = require('./routes/auth');
const jobsRoutes = require('./routes/jobs');
const photosRoutes = require('./routes/photos');
const adminRoutes = require('./routes/admin');
const serverAdminRoutes = require('./routes/server-admin');

app.use('/api/auth', authRoutes);
app.use('/api/jobs', jobsRoutes);
app.use('/api/photos', photosRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/server-admin', serverAdminRoutes.router || serverAdminRoutes);
const containerRoutes = require('./routes/container');
app.use('/api/container', containerRoutes);
const deliveryConditionsRoutes = require('./routes/delivery-conditions');
app.use('/api/delivery-conditions', deliveryConditionsRoutes);

// Public dropdown options (no auth needed - used by truck app)
app.get('/api/dropdown-options/:category', async (req, res) => {
  try {
    const { category } = req.params;
    const allowed = ['dc_reason', 'item_type'];
    if (!allowed.includes(category)) return res.status(400).json({ error: 'Invalid category' });
    const db = req.app.locals.db;
    const result = await db.query(
      'SELECT id, label_da, label_en, sort_order FROM dropdown_options WHERE category=$1 AND active=true ORDER BY sort_order ASC',
      [category]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Health check
// Get a specific setting by key
app.get('/api/settings/:key', async (req, res) => {
  try {
    const db = req.app.locals.db;
    const result = await db.query('SELECT value FROM settings WHERE key = $1', [req.params.key]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Setting not found' });
    res.json({ key: req.params.key, value: result.rows[0].value });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});


// Gallery page for email links
app.get('/gallery/:jobId/:token', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'gallery.html'));
});

// DC gallery page
app.get('/dc-gallery/:reportId/:token', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dc-gallery.html'));
});

// DC report gallery API
app.get('/api/dc-reports/:reportId/gallery', async (req, res) => {
  try {
    const { reportId } = req.params;
    const token = req.query.token;
    if (!token) return res.status(403).json({ error: 'Access denied' });
    const pool = req.app.locals.db;
    const report = await pool.query('SELECT * FROM delivery_conditions WHERE id = $1 AND gallery_token = $2', [reportId, token]);
    if (report.rows.length === 0) return res.status(404).json({ error: 'Report not found' });
    const photos = await pool.query('SELECT * FROM delivery_condition_photos WHERE report_id = $1', [reportId]);
    res.json({ report: report.rows[0], photos: photos.rows });
  } catch (err) {
    console.error('DC gallery error:', err);
    res.status(500).json({ error: 'Failed to load report' });
  }
});

// DC ZIP download
app.get('/api/dc-reports/:reportId/download-all', async (req, res) => {
  try {
    const { reportId } = req.params;
    const token = req.query.token;
    if (!token) return res.status(403).json({ error: 'Access denied' });
    const pool = req.app.locals.db;
    const report = await pool.query('SELECT * FROM delivery_conditions WHERE id = $1 AND gallery_token = $2', [reportId, token]);
    if (report.rows.length === 0) return res.status(404).json({ error: 'Report not found' });
    const photos = await pool.query('SELECT * FROM delivery_condition_photos WHERE report_id = $1', [reportId]);
    if (photos.rows.length === 0) return res.status(404).json({ error: 'No photos found' });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="teslak-dc-' + reportId + '-photos.zip"');
    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.pipe(res);
    photos.rows.forEach(p => {
      const filePath = require('path').join('/data/photos', p.filename);
      if (fs.existsSync(filePath)) {
        archive.file(filePath, { name: p.filename });
      }
    });
    await archive.finalize();
  } catch (err) {
    console.error('DC ZIP error:', err);
    res.status(500).json({ error: 'Failed to create ZIP' });
  }
});


// ZIP download of all photos for a job
app.get('/api/jobs/:jobId/download-all', async (req, res) => {
  try {
    const { jobId } = req.params;
    const token = req.query.token;
    if (!token) return res.status(403).json({ error: 'Access denied' });
    const pool = req.app.locals.db;
    const job = await pool.query('SELECT * FROM jobs WHERE id = $1 AND gallery_token = $2', [jobId, token]);
    if (job.rows.length === 0) return res.status(404).json({ error: 'Job not found' });
    const photos = await pool.query('SELECT * FROM job_photos WHERE job_id = $1', [jobId]);
    if (photos.rows.length === 0) return res.status(404).json({ error: 'No photos found' });

    const orderNr = job.rows[0].order_nr || jobId;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="teslak-' + orderNr + '-photos.zip"');

    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.pipe(res);
    photos.rows.forEach(p => {
      const filePath = path.join('/data/photos', p.filename);
      if (fs.existsSync(filePath)) {
        archive.file(filePath, { name: p.original_name || p.filename });
      }
    });
    await archive.finalize();
  } catch (err) {
    console.error('ZIP download error:', err);
    res.status(500).json({ error: 'Failed to create ZIP' });
  }
});

// Admin page
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Server admin page
app.get('/server-admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'server-admin.html'));
});

// SPA fallback - serve index.html for non-API routes
app.get('*', (req, res) => {
  const indexPath = path.join(__dirname, 'public', 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).json({ error: 'Not found' });
  }
});

// Daily cleanup cron: 2am, delete jobs + photos older than 30 days
cron.schedule('0 2 * * *', async () => {
  console.log('Running daily cleanup...');
  try {
    // Get photos for old jobs before deleting
    const oldPhotos = await pool.query(
      `SELECT jp.filename FROM job_photos jp
       JOIN jobs j ON jp.job_id = j.id
       WHERE j.created_at < NOW() - INTERVAL '30 days'`
    );

    // Delete photo files
    for (const row of oldPhotos.rows) {
      const filePath = path.join(PHOTO_DIR, row.filename);
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          console.log(`Deleted photo: ${row.filename}`);
        }
      } catch (e) {
        console.error(`Failed to delete photo ${row.filename}:`, e.message);
      }
    }

    // Delete old jobs (cascades to job_photos)
    const result = await pool.query(
      `DELETE FROM jobs WHERE created_at < NOW() - INTERVAL '30 days'`
    );
    console.log(`Cleanup complete: removed ${result.rowCount} old jobs`);
  } catch (err) {
    console.error('Cleanup failed:', err.message);
  }
});

// Start server
initDB().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Teslak Delivery server running on port ${PORT}`);
  });
});
