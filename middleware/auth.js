function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.redirect('/login');
  }
  next();
}

function attachUser(db) {
  return async (req, res, next) => {
    if (req.session.userId) {
      try {
        const result = await db.query(
          'SELECT id, username, bio, avatar_filename FROM users WHERE id = $1',
          [req.session.userId]
        );
        res.locals.currentUser = result.rows[0] || null;
      } catch (err) {
        console.error('attachUser error:', err);
        res.locals.currentUser = null;
      }
    } else {
      res.locals.currentUser = null;
    }
    next();
  };
}

module.exports = { requireAuth, attachUser };
