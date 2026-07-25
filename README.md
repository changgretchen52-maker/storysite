# Storysite

A simple public website where anyone can sign up and post a story with a selfie.

## Features

- Sign up / log in (passwords hashed with bcrypt, sessions via cookies)
- Public feed of all stories, newest first
- Post a story with a title, text, and an optional selfie photo (jpg/png/gif/webp, 8MB max)
- Public profile pages per user (`/user/<username>`)
- Delete your own posts

## Tech stack

- **Node.js + Express** — server and routing
- **EJS** — server-rendered HTML templates
- **better-sqlite3** — file-based SQL database (no separate DB server needed)
- **multer** — handles the image upload
- **bcryptjs** — password hashing
- **express-session** — login sessions

Everything runs from a single process with no external services required,
so it's easy to self-host.

## Running it locally

```bash
npm install
npm start
```

Then open http://localhost:3000

By default it uses port 3000; override with `PORT=8080 npm start`.

## Before you deploy publicly

1. **Set a real session secret.** Set the `SESSION_SECRET` environment
   variable to a long random string — don't use the default in
   `server.js`.
   ```bash
   export SESSION_SECRET="$(openssl rand -hex 32)"
   ```
2. **Serve over HTTPS.** Once you have HTTPS (e.g. via a reverse proxy
   like Caddy or nginx + Let's Encrypt), uncomment `secure: true` in the
   cookie config in `server.js` so session cookies are only sent over
   HTTPS.
3. **Back up `storysite.db` and the `uploads/` folder** — that's your
   entire database and all uploaded images.
4. **Consider adding**: rate limiting on signup/login (to stop bots and
   brute-force attempts), email verification, and a content moderation
   plan since this is public and lets strangers upload photos and text.
   None of that is included here — this is a working starting point,
   not a production-hardened social platform.

## Deploying to a VPS (typical flow)

1. Copy this folder to your server (`scp`, `git clone`, etc.)
2. `npm install --production`
3. Run it with a process manager so it restarts on crash/reboot, e.g.:
   ```bash
   npm install -g pm2
   pm2 start server.js --name storysite
   pm2 save
   pm2 startup
   ```
4. Put nginx or Caddy in front of it as a reverse proxy for HTTPS and a
   real domain name.

## Project structure

```
storysite/
├── server.js           # routes and app setup
├── db.js                # SQLite connection + schema
├── middleware/auth.js    # login-required guard, attaches current user
├── views/                # EJS templates
├── public/css/style.css  # styling
└── uploads/              # uploaded selfies (created automatically)
```
