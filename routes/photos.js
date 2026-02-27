const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const sharp = require('sharp');

const PHOTO_DIR = '/data/photos';

// Multer config
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (!fs.existsSync(PHOTO_DIR)) {
      fs.mkdirSync(PHOTO_DIR, { recursive: true });
    }
    cb(null, PHOTO_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `${uuidv4()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|webp|heic/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    const mime = allowed.test(file.mimetype) || file.mimetype === 'image/heic';
    if (ext || mime) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

// POST /api/photos/:jobId - upload photos (max 10)
router.post('/:jobId', upload.array('photos', 10), async (req, res) => {
  try {
    const db = req.app.locals.db;
    const { jobId } = req.params;
    const photoType = req.body.photo_type || 'sticker';

    // Check job exists
    const jobResult = await db.query('SELECT id FROM jobs WHERE id = $1', [jobId]);
    if (jobResult.rows.length === 0) {
      // Clean up uploaded files
      if (req.files) {
        req.files.forEach(f => fs.unlinkSync(f.path));
      }
      return res.status(404).json({ error: 'Job not found' });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    const savedPhotos = [];
    for (const file of req.files) {
      // Optimize with sharp - resize if too large, convert to jpeg
      try {
        const optimizedName = `opt_${file.filename.replace(/\.[^.]+$/, '.jpg')}`;
        const optimizedPath = path.join(PHOTO_DIR, optimizedName);
        await sharp(file.path)
          .resize(2048, 2048, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 85 })
          .toFile(optimizedPath);

        // Remove original, use optimized
        fs.unlinkSync(file.path);

        const result = await db.query(
          `INSERT INTO job_photos (job_id, filename, photo_type, original_name)
           VALUES ($1, $2, $3, $4) RETURNING *`,
          [jobId, optimizedName, photoType, file.originalname]
        );
        savedPhotos.push(result.rows[0]);
      } catch (sharpErr) {
        // If sharp fails, keep original
        console.error('Sharp optimization failed:', sharpErr.message);
        const result = await db.query(
          `INSERT INTO job_photos (job_id, filename, photo_type, original_name)
           VALUES ($1, $2, $3, $4) RETURNING *`,
          [jobId, file.filename, photoType, file.originalname]
        );
        savedPhotos.push(result.rows[0]);
      }
    }

    res.status(201).json(savedPhotos);
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Upload failed: ' + err.message });
  }
});

// GET /api/photos/:jobId - list photos for a job
router.get('/:jobId', async (req, res) => {
  try {
    // Avoid matching 'file' as a jobId
    if (req.params.jobId === 'file') return;

    const db = req.app.locals.db;
    const result = await db.query(
      'SELECT * FROM job_photos WHERE job_id = $1 ORDER BY created_at',
      [req.params.jobId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('List photos error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/photos/file/:filename - serve individual photo
router.get('/file/:filename', (req, res) => {
  try {
    const filename = path.basename(req.params.filename); // Prevent path traversal
    const filePath = path.join(PHOTO_DIR, filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Photo not found' });
    }

    res.sendFile(filePath);
  } catch (err) {
    console.error('Serve photo error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/photos/:id - delete a photo
router.delete('/:id', async (req, res) => {
  try {
    const db = req.app.locals.db;
    const result = await db.query(
      'DELETE FROM job_photos WHERE id = $1 RETURNING *',
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Photo not found' });
    }

    // Delete file
    const filePath = path.join(PHOTO_DIR, result.rows[0].filename);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    res.json({ success: true, deleted: result.rows[0] });
  } catch (err) {
    console.error('Delete photo error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
