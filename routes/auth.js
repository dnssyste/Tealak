const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || require('crypto').randomBytes(64).toString('hex');

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { name, pin } = req.body;
    if (!name || !pin) {
      return res.status(400).json({ error: 'Name and PIN are required' });
    }

    const db = req.app.locals.db;
    const result = await db.query(
      'SELECT id, name, lang FROM drivers WHERE LOWER(name) = LOWER($1) AND pin = $2',
      [name.trim(), pin.trim()]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid name or PIN' });
    }

    const driver = result.rows[0];

    // Signed JWT token (expires in 24h)
    const token = jwt.sign(
      { id: driver.id, name: driver.name },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      success: true,
      driver: {
        id: driver.id,
        name: driver.name,
        lang: driver.lang
      },
      token
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/auth/drivers - list driver names only (no IDs exposed)
router.get('/drivers', async (req, res) => {
  try {
    const db = req.app.locals.db;
    const result = await db.query('SELECT id, name FROM drivers ORDER BY name');
    res.json(result.rows);
  } catch (err) {
    console.error('List drivers error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Export JWT_SECRET for middleware use
router.JWT_SECRET = JWT_SECRET;

module.exports = router;
