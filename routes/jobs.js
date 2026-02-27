const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { analyzePhotos } = require('../utils/ai');
const { sendJobEmail } = require('../utils/email');

// POST /api/jobs - create new job
router.post('/', async (req, res) => {
  try {
    const { driver_id } = req.body;
    if (!driver_id) {
      return res.status(400).json({ error: 'driver_id is required' });
    }

    const db = req.app.locals.db;
    const id = uuidv4();
    const result = await db.query(
      `INSERT INTO jobs (id, driver_id, status) VALUES ($1, $2, 'pending') RETURNING *`,
      [id, driver_id]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Create job error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/jobs - list jobs with optional filters
router.get('/', async (req, res) => {
  try {
    const db = req.app.locals.db;
    const { status, driver_id, date_from, date_to } = req.query;
    let query = `
      SELECT j.*, d.name as driver_name,
        (SELECT COUNT(*) FROM job_photos WHERE job_id = j.id) as photo_count
      FROM jobs j
      LEFT JOIN drivers d ON j.driver_id = d.id
      WHERE 1=1
    `;
    const params = [];
    let paramIdx = 1;

    if (status) {
      query += ` AND j.status = $${paramIdx++}`;
      params.push(status);
    }
    if (driver_id) {
      query += ` AND j.driver_id = $${paramIdx++}`;
      params.push(driver_id);
    }
    if (date_from) {
      query += ` AND j.created_at >= $${paramIdx++}`;
      params.push(date_from);
    }
    if (date_to) {
      query += ` AND j.created_at <= $${paramIdx++}`;
      params.push(date_to + ' 23:59:59');
    }

    query += ' ORDER BY j.created_at DESC LIMIT 200';

    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('List jobs error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/jobs/:id - get job details with photos
router.get('/:id', async (req, res) => {
  try {
    const db = req.app.locals.db;
    const jobResult = await db.query(
      `SELECT j.*, d.name as driver_name
       FROM jobs j
       LEFT JOIN drivers d ON j.driver_id = d.id
       WHERE j.id = $1`,
      [req.params.id]
    );

    if (jobResult.rows.length === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const photosResult = await db.query(
      'SELECT * FROM job_photos WHERE job_id = $1 ORDER BY created_at',
      [req.params.id]
    );

    const job = jobResult.rows[0];
    job.photos = photosResult.rows;

    res.json(job);
  } catch (err) {
    console.error('Get job error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/jobs/:id - update job fields
router.patch('/:id', async (req, res) => {
  try {
    const db = req.app.locals.db;
    const allowedFields = [
      'tur_nr', 'order_nr', 'customer_name', 'address', 'product',
      'delivery_date', 'antal', 'pos_nr', 'production', 'barcode',
      'status', 'damage_report', 'missing_items'
    ];

    const updates = [];
    const values = [];
    let paramIdx = 1;

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates.push(`${field} = $${paramIdx++}`);
        values.push(req.body[field]);
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    // If status is being set to completed/damaged/missing, set completed_at
    if (req.body.status && ['completed', 'damaged', 'missing'].includes(req.body.status)) {
      updates.push(`completed_at = $${paramIdx++}`);
      values.push(new Date());
    }

    values.push(req.params.id);
    const result = await db.query(
      `UPDATE jobs SET ${updates.join(', ')} WHERE id = $${paramIdx} RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update job error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/jobs/:id/status - update job status
router.patch('/:id/status', async (req, res) => {
  try {
    const { status, damage_report, missing_items } = req.body;
    if (!status || !['completed', 'delivered', 'damaged', 'missing', 'pending'].includes(status)) {
      return res.status(400).json({ error: 'Valid status required: completed, damaged, missing, pending' });
    }

    const db = req.app.locals.db;
    const updates = ['status = $1', 'completed_at = $2'];
    const values = [status, ['completed', 'delivered', 'damaged', 'missing'].includes(status) ? new Date() : null];
    let paramIdx = 3;

    if (damage_report !== undefined) {
      updates.push(`damage_report = $${paramIdx++}`);
      values.push(damage_report);
    }
    if (missing_items !== undefined) {
      updates.push(`missing_items = $${paramIdx++}`);
      values.push(missing_items);
    }

    values.push(req.params.id);
    const result = await db.query(
      `UPDATE jobs SET ${updates.join(', ')} WHERE id = $${paramIdx} RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const job = result.rows[0];

    // Auto-send email if configured - use DB recipients
    try {
      const autoSendSetting = await db.query("SELECT value FROM settings WHERE key = 'email_auto_send'");
      const autoSend = autoSendSetting.rows.length > 0 ? autoSendSetting.rows[0].value === 'true' : (process.env.EMAIL_AUTO_SEND === 'true');
      if (autoSend) {
        // Map job status to notification type
        const statusMap = { delivered: 'notify_delivered', completed: 'notify_delivered', damaged: 'notify_damaged', missing: 'notify_missing' };
        const notifyCol = statusMap[status] || 'notify_delivered';
        const recipients = await db.query('SELECT email, reply_to FROM email_recipients WHERE active = true AND ' + notifyCol + ' = true');
        if (recipients.rows.length > 0) {
          const photos = await db.query('SELECT * FROM job_photos WHERE job_id = $1', [job.id]);
          const sentTo = [];
          for (const r of recipients.rows) {
            await sendJobEmail(job, photos.rows, r.email, r.reply_to);
            sentTo.push(r.email);
          }
          const emailList = sentTo.join(', ');
          await db.query('UPDATE jobs SET email_sent = true, email_sent_to = $1 WHERE id = $2', [emailList, job.id]);
          job.email_sent = true;
          console.log('Email sent to:', emailList);
        } else if (job.email_sent_to) {
          // Fallback to job-level recipient
          const photos = await db.query('SELECT * FROM job_photos WHERE job_id = $1', [job.id]);
          await sendJobEmail(job, photos.rows, job.email_sent_to);
          await db.query('UPDATE jobs SET email_sent = true WHERE id = $1', [job.id]);
          job.email_sent = true;
        }
      }
    } catch (emailErr) {
      console.error('Auto email failed:', emailErr.message);
    }

    res.json(job);
  } catch (err) {
    console.error('Update status error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/jobs/:id/analyze - AI analysis of photos
router.post('/:id/analyze', async (req, res) => {
  try {
    const db = req.app.locals.db;

    // Check job exists
    const jobResult = await db.query('SELECT * FROM jobs WHERE id = $1', [req.params.id]);
    if (jobResult.rows.length === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }

    // Get photos
    const photosResult = await db.query(
      'SELECT * FROM job_photos WHERE job_id = $1',
      [req.params.id]
    );

    if (photosResult.rows.length === 0) {
      return res.status(400).json({ error: 'No photos to analyze' });
    }

    const imagePaths = photosResult.rows.map(p => `/data/photos/${p.filename}`);

    // Run AI analysis
    const aiResult = await analyzePhotos(imagePaths);

    // Parse the result - handle both single object and array
    let parsed = aiResult;
    if (Array.isArray(parsed)) {
      parsed = parsed[0]; // Use first result for the job
    }

    // Update job with AI results
    const updateResult = await db.query(
      `UPDATE jobs SET
        tur_nr = COALESCE($1, tur_nr),
        order_nr = COALESCE($2, order_nr),
        customer_name = COALESCE($3, customer_name),
        address = COALESCE($4, address),
        product = COALESCE($5, product),
        delivery_date = COALESCE($6, delivery_date),
        antal = COALESCE($7, antal),
        pos_nr = COALESCE($8, pos_nr),
        production = COALESCE($9, production),
        barcode = COALESCE($10, barcode),
        ai_raw_response = $11
      WHERE id = $12
      RETURNING *`,
      [
        parsed.tur_nr,
        parsed.order_nr,
        parsed.customer_name,
        parsed.address,
        parsed.product,
        parsed.delivery_date,
        parsed.antal,
        parsed.pos_nr,
        parsed.production,
        parsed.barcode,
        JSON.stringify(aiResult),
        req.params.id
      ]
    );

    res.json({
      success: true,
      job: updateResult.rows[0],
      ai_result: aiResult
    });
  } catch (err) {
    console.error('Analyze error:', err);
    res.status(500).json({ error: 'AI analysis failed: ' + err.message });
  }
});

// POST /api/jobs/:id/email - send job card email
router.post('/:id/email', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email address is required' });
    }

    const db = req.app.locals.db;
    const jobResult = await db.query(
      `SELECT j.*, d.name as driver_name FROM jobs j
       LEFT JOIN drivers d ON j.driver_id = d.id
       WHERE j.id = $1`,
      [req.params.id]
    );

    if (jobResult.rows.length === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const photosResult = await db.query(
      'SELECT * FROM job_photos WHERE job_id = $1',
      [req.params.id]
    );

    const job = jobResult.rows[0];
    await sendJobEmail(job, photosResult.rows, email);

    // Update job
    await db.query(
      'UPDATE jobs SET email_sent = true, email_sent_to = $1 WHERE id = $2',
      [email, req.params.id]
    );

    res.json({ success: true, message: 'Email sent successfully' });
  } catch (err) {
    console.error('Email error:', err);
    res.status(500).json({ error: 'Failed to send email: ' + err.message });
  }
});

module.exports = router;
