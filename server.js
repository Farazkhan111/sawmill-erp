// Sawmill ERP — Cloud Edition
// Data now lives in MongoDB Atlas (not a local file), so it's the same
// data no matter which device/browser you open the app from, and it
// survives Render's restarts/redeploys.

require('dotenv').config();
const express = require('express');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { MongoClient, ObjectId } = require('mongodb');

const PORT = process.env.PORT || 4173;
const MONGODB_URI = process.env.MONGODB_URI;
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret-before-deploying';
const MAX_BACKUPS = 10; // how many dated snapshots to keep per user

if (!MONGODB_URI) {
  console.error('\n  ERROR: MONGODB_URI is not set.');
  console.error('  Create a .env file (see .env.example) or set the');
  console.error('  MONGODB_URI environment variable on Render.\n');
  process.exit(1);
}

const client = new MongoClient(MONGODB_URI);
let db;

async function start() {
  await client.connect();
  db = client.db('sawmill_erp');
  await db.collection('users').createIndex({ username: 1 }, { unique: true });
  await db.collection('backups').createIndex({ userId: 1, createdAt: -1 });

  const app = express();
  app.use(express.json({ limit: '50mb' }));

  // ---------- Auth helpers ----------
  function signToken(user) {
    return jwt.sign({ uid: user._id.toString(), username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '30d' });
  }

  function authRequired(req, res, next) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Not logged in' });
    try {
      req.user = jwt.verify(token, JWT_SECRET);
      next();
    } catch (e) {
      return res.status(401).json({ error: 'Session expired, please log in again' });
    }
  }

  // ---------- Auth routes ----------

  // Tells the frontend whether ANY account exists yet, so it knows whether
  // to show "Create your account" (first run) or a plain login form.
  app.get('/api/auth/status', async (req, res) => {
    const count = await db.collection('users').countDocuments();
    res.json({ setupNeeded: count === 0 });
  });

  // First-run signup. After the first account exists, this route refuses
  // further signups unless the request is authenticated by an existing admin —
  // keeping this a single-business app with controlled logins, not an open registry.
  app.post('/api/auth/register', async (req, res) => {
    try {
      const { username, password, displayName } = req.body || {};
      if (!username || !password || password.length < 6) {
        return res.status(400).json({ error: 'Username and a password (6+ chars) are required' });
      }
      const existingCount = await db.collection('users').countDocuments();
      if (existingCount > 0) {
        // Allow adding more users only if the caller is already a logged-in admin.
        const header = req.headers.authorization || '';
        const token = header.startsWith('Bearer ') ? header.slice(7) : null;
        let caller = null;
        try { caller = token ? jwt.verify(token, JWT_SECRET) : null; } catch (e) { /* ignore */ }
        if (!caller || caller.role !== 'admin') {
          return res.status(403).json({ error: 'Ask an admin to add new users from Settings' });
        }
      }
      const passwordHash = await bcrypt.hash(password, 10);
      const role = existingCount === 0 ? 'admin' : 'staff';
      const doc = { username: username.trim().toLowerCase(), passwordHash, displayName: displayName || username, role, createdAt: new Date() };
      await db.collection('users').insertOne(doc);
      res.json({ ok: true });
    } catch (e) {
      if (e.code === 11000) return res.status(409).json({ error: 'That username is already taken' });
      console.error(e);
      res.status(500).json({ error: 'Could not create account' });
    }
  });

  app.post('/api/auth/login', async (req, res) => {
    try {
      const { username, password } = req.body || {};
      const user = await db.collection('users').findOne({ username: (username || '').trim().toLowerCase() });
      if (!user) return res.status(401).json({ error: 'Invalid username or password' });
      const ok = await bcrypt.compare(password || '', user.passwordHash);
      if (!ok) return res.status(401).json({ error: 'Invalid username or password' });
      res.json({ token: signToken(user), username: user.username, displayName: user.displayName, role: user.role });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Login failed' });
    }
  });

  app.get('/api/auth/me', authRequired, (req, res) => res.json({ username: req.user.username, role: req.user.role }));

  app.post('/api/auth/change-password', authRequired, async (req, res) => {
    try {
      const { currentPassword, newPassword } = req.body || {};
      if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: 'New password must be 6+ chars' });
      const user = await db.collection('users').findOne({ _id: new ObjectId(req.user.uid) });
      const ok = await bcrypt.compare(currentPassword || '', user.passwordHash);
      if (!ok) return res.status(401).json({ error: 'Current password is wrong' });
      const passwordHash = await bcrypt.hash(newPassword, 10);
      await db.collection('users').updateOne({ _id: user._id }, { $set: { passwordHash } });
      res.json({ ok: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Could not change password' });
    }
  });

  // ---------- Data routes (all data for the business, shared by every ----------
  // user who logs into this deployment — a "khata"-style single business
  // account, matching how the original single-PC app worked).

  const DATA_DOC_ID = 'main'; // one shared business document for this deployment

  app.get('/api/db', authRequired, async (req, res) => {
    try {
      const doc = await db.collection('appdata').findOne({ _id: DATA_DOC_ID });
      res.json(doc ? doc.data : null);
    } catch (e) {
      console.error('Failed to read database:', e);
      res.status(500).json({ error: 'Failed to read database' });
    }
  });

  app.post('/api/db', authRequired, async (req, res) => {
    try {
      const existing = await db.collection('appdata').findOne({ _id: DATA_DOC_ID });
      if (existing) {
        // Keep a dated backup of the previous state before overwriting.
        await db.collection('backups').insertOne({
          userId: DATA_DOC_ID,
          data: existing.data,
          createdAt: new Date(),
          savedBy: req.user.username
        });
        const count = await db.collection('backups').countDocuments({ userId: DATA_DOC_ID });
        if (count > MAX_BACKUPS) {
          const toDelete = await db.collection('backups')
            .find({ userId: DATA_DOC_ID }).sort({ createdAt: 1 }).limit(count - MAX_BACKUPS).toArray();
          await db.collection('backups').deleteMany({ _id: { $in: toDelete.map(d => d._id) } });
        }
      }
      await db.collection('appdata').updateOne(
        { _id: DATA_DOC_ID },
        { $set: { data: req.body, updatedAt: new Date(), updatedBy: req.user.username } },
        { upsert: true }
      );
      res.json({ ok: true });
    } catch (e) {
      console.error('Failed to save database:', e);
      res.status(500).json({ error: 'Failed to save database' });
    }
  });

  // List available dated backups (newest first) so Settings can offer restore.
  app.get('/api/backups', authRequired, async (req, res) => {
    try {
      const list = await db.collection('backups')
        .find({ userId: DATA_DOC_ID })
        .project({ data: 0 })
        .sort({ createdAt: -1 })
        .limit(MAX_BACKUPS)
        .toArray();
      res.json(list.map(b => ({ id: b._id.toString(), createdAt: b.createdAt, savedBy: b.savedBy })));
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Failed to list backups' });
    }
  });

  // Restore a specific dated backup as the live data (also snapshots current state first).
  app.post('/api/backups/:id/restore', authRequired, async (req, res) => {
    try {
      const backup = await db.collection('backups').findOne({ _id: new ObjectId(req.params.id) });
      if (!backup) return res.status(404).json({ error: 'Backup not found' });
      const existing = await db.collection('appdata').findOne({ _id: DATA_DOC_ID });
      if (existing) {
        await db.collection('backups').insertOne({
          userId: DATA_DOC_ID, data: existing.data, createdAt: new Date(),
          savedBy: req.user.username, note: 'auto-snapshot before restore'
        });
      }
      await db.collection('appdata').updateOne(
        { _id: DATA_DOC_ID },
        { $set: { data: backup.data, updatedAt: new Date(), updatedBy: req.user.username } },
        { upsert: true }
      );
      res.json({ ok: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Failed to restore backup' });
    }
  });

  // ---------- Static frontend ----------
  app.use(express.static(path.join(__dirname, 'public')));

  app.listen(PORT, () => {
    console.log('');
    console.log('  Sawmill ERP (cloud) is running on port ' + PORT);
    console.log('  Data store: MongoDB Atlas');
    console.log('');
  });
}

start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
