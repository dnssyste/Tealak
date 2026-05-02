const xss = require('xss');

// Recursively sanitize all string values in an object
function sanitizeObj(obj) {
  if (typeof obj === 'string') return xss(obj);
  if (Array.isArray(obj)) return obj.map(sanitizeObj);
  if (obj && typeof obj === 'object') {
    const clean = {};
    for (const [k, v] of Object.entries(obj)) {
      clean[k] = sanitizeObj(v);
    }
    return clean;
  }
  return obj;
}

function sanitizeMiddleware(req, res, next) {
  if (req.body && typeof req.body === 'object') {
    req.body = sanitizeObj(req.body);
  }
  next();
}

module.exports = { sanitizeMiddleware, sanitizeObj };
