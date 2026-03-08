/**
 * ✅ Rank 1 Security: Unified Express 5.0 Sanitizer
 * Replaces hpp and express-mongo-sanitize (incompatible with Express 5 read-only req.query)
 */

const sanitize = (obj) => {
  if (obj instanceof Object) {
    for (const key in obj) {
      if (key.startsWith('$')) {
        delete obj[key];
      } else if (obj[key] instanceof Object) {
        sanitize(obj[key]);
      }
    }
  }
};

export const unifiedSanitizer = (req, res, next) => {
  // 1. Sanitize Body & Params (Standard NoSQL Injection Protection)
  if (req.body) sanitize(req.body);
  if (req.params) sanitize(req.params);

  // 2. Sanitize Query (NoSQL + HPP Protection)
  if (req.query) {
    for (const key in req.query) {
      // HPP FIX: If multiple values are passed (?id=1&id=2), retain only the first one
      if (Array.isArray(req.query[key])) {
        // Correctly handle as a getter in Express 5 by modifying the object's keys, not the object itself
        req.query[key] = req.query[key][0];
      }
    }
    // NoSQL FIX: Recursive key checking for '$'
    sanitize(req.query);
  }

  next();
};
