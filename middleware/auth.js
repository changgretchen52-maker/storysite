function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.redirect('/login');
  }
  next();
}

// Makes current user available in all views without repeating code in every route
function attachUser(db) {
  return (req, res, next) => {
    if (req.session.userId) {
      const user = db
        .prepare('SELECT id, username, bio, avatar_filename FROM users WHERE id = ?')
        .get(req.session.userId);
      res.locals.currentUser = user || null;
    } else {
      res.locals.currentUser = null;
    }
    next();
  };
}

module.exports = { requireAuth, attachUser };
