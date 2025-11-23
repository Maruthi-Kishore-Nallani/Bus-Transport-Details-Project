# Database Migration Guide: JSON Files to PostgreSQL

This guide covers migrating `settings.json`, `pending_admins.json`, and `route_cache.json` to the PostgreSQL database.

## 📋 Overview

### What's Being Migrated

1. **Site Settings** (`settings.json`) → `SiteSettings` table
2. **Pending Admin Requests** (`pending_admins.json`) → `Admin` table (with `approved=false`)
3. **Route Cache** (`route_cache.json`) → `RouteCache` table (auto-refreshes every 2 hours)

### Benefits

- ✅ **Data persistence** across deployments
- ✅ **Better performance** with indexed queries
- ✅ **Automatic cache expiry** (route cache refreshes every 2 hours)
- ✅ **Atomic updates** (no file corruption issues)
- ✅ **Multi-instance support** (no file locking issues)

---

## 🚀 Migration Steps

### Step 1: Update Database Schema

Run the Prisma migration to add new tables:

```cmd
npx prisma migrate dev --name add_settings_and_cache_tables
```

This will:
- Add `SiteSettings` table
- Add `RouteCache` table with 2-hour auto-refresh
- Add `approved` field to `Admin` table
- Add `onDelete: Cascade` for proper cleanup

### Step 2: Migrate Existing Data

Run the migration script to transfer data from JSON files to database:

```cmd
node prisma/migrate-json-to-db.js
```

This will:
- ✅ Migrate `settings.json` → `SiteSettings` table
- ✅ Migrate `route_cache.json` → `RouteCache` table
- ✅ Report on `pending_admins.json` status

**Output Example:**
```
Starting migration from JSON files to database...

1. Migrating site settings...
✓ Site settings migrated successfully

2. Migrating route cache...
✓ Migrated 12 route cache entries

3. Checking pending admins...
✓ No pending admins to migrate

✅ Migration completed successfully!
```

### Step 3: Update server.js

The new database helpers are in `dbHelpers.js`. You need to update `server.js` to use them:

#### Replace old imports (around line 1-50):

```javascript
// OLD CODE - Remove these lines:
const SETTINGS_PATH = path.join(__dirname, 'settings.json');
const PENDING_ADMIN_PATH = path.join(__dirname, 'pending_admins.json');
const ROUTE_CACHE_PATH = ...

function readSettingsFile() { ... }
function writeSettingsFile() { ... }
function readPendingAdmins() { ... }
function writePendingAdmins() { ... }
```

```javascript
// NEW CODE - Add this import:
const {
  getSiteSettings,
  updateSiteSettings,
  getPendingAdmins,
  createPendingAdmin,
  adminExists,
  approvePendingAdmin,
  rejectPendingAdmin,
  getRouteFromCache,
  saveRouteToCache,
  initializeRouteCacheCleanup,
  DEFAULT_SETTINGS
} = require('./dbHelpers');
```

#### Update Settings Endpoints:

**GET /api/settings** (around line 350):
```javascript
// OLD:
app.get('/api/settings', (req, res) => {
  const settingsPublic = { 
    ...siteSettings, 
    mapsEnabled: Boolean(process.env.GOOGLE_MAPS_API_KEY)
  };
  res.json({ success: true, settings: settingsPublic });
});

// NEW:
app.get('/api/settings', async (req, res) => {
  try {
    const settings = await getSiteSettings();
    const settingsPublic = { 
      ...settings, 
      mapsEnabled: Boolean(process.env.GOOGLE_MAPS_API_KEY)
    };
    res.json({ success: true, settings: settingsPublic });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to load settings' });
  }
});
```

**PUT /api/admin/settings** (around line 363):
```javascript
// OLD:
app.put('/api/admin/settings', requireAdmin, (req, res) => {
  const { siteTitle, organizationName, contact } = req.body || {};
  const next = { ... };
  siteSettings = next;
  if (!writeSettingsFile(siteSettings)) {
    return res.status(500).json({ success: false, message: 'Failed to persist settings' });
  }
  res.json({ success: true, settings: siteSettings });
});

// NEW:
app.put('/api/admin/settings', requireAdmin, async (req, res) => {
  try {
    const { siteTitle, organizationName, contact } = req.body || {};
    const updated = await updateSiteSettings({ siteTitle, organizationName, contact });
    if (!updated) {
      return res.status(500).json({ success: false, message: 'Failed to persist settings' });
    }
    res.json({ success: true, settings: updated });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to update settings' });
  }
});
```

#### Update Pending Admin Endpoints:

**POST /api/admin/signup-request** (around line 1263):
```javascript
// OLD:
app.post('/api/admin/signup-request', async (req, res) => {
  // ... validation ...
  const pending = readPendingAdmins();
  if (pending.find(p => p.email.toLowerCase() === email.toLowerCase())) {
    return res.json({ success: true, message: 'Signup request already submitted' });
  }
  const hashed = bcrypt.hashSync(password, 10);
  pending.push({ name, email, password: hashed, createdAt: new Date().toISOString() });
  writePendingAdmins(pending);
  res.json({ success: true, message: 'Signup request submitted. Await approval by main admin.' });
});

// NEW:
app.post('/api/admin/signup-request', async (req, res) => {
  try {
    const { name, email, password } = req.body || {};
    // ... validation ...
    
    if (await adminExists(email) || isSuperAdmin(email)) {
      return res.status(400).json({ success: false, message: 'This email is already an admin' });
    }
    
    const hashed = bcrypt.hashSync(password, 10);
    const created = await createPendingAdmin(email, hashed);
    
    if (!created) {
      return res.status(500).json({ success: false, message: 'Failed to submit request' });
    }
    
    res.json({ success: true, message: 'Signup request submitted. Await approval by main admin.' });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});
```

**GET /api/admin/requests** (around line 1298):
```javascript
// OLD:
app.get('/api/admin/requests', requireAdmin, (req, res) => {
  if (req.admin.role !== 'superadmin') {
    return res.status(403).json({ success: false, message: 'Only superadmin may view requests' });
  }
  const pending = readPendingAdmins();
  res.json({ success: true, requests: pending.map(p => ({ name: p.name, email: p.email, createdAt: p.createdAt })) });
});

// NEW:
app.get('/api/admin/requests', requireAdmin, async (req, res) => {
  try {
    if (req.admin.role !== 'superadmin') {
      return res.status(403).json({ success: false, message: 'Only superadmin may view requests' });
    }
    const pending = await getPendingAdmins();
    res.json({ success: true, requests: pending });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to load requests' });
  }
});
```

**POST /api/admin/requests/:email/approve** (around line 1308):
```javascript
// OLD:
app.post('/api/admin/requests/:email/approve', requireAdmin, requireCsrf, async (req, res) => {
  // ... role check ...
  const email = decodeURIComponent(req.params.email);
  let pending = readPendingAdmins();
  const idx = pending.findIndex(p => p.email.toLowerCase() === email.toLowerCase());
  if (idx === -1) return res.status(404).json({ success: false, message: 'Request not found' });
  const reqObj = pending[idx];
  try {
    await prisma.admin.create({ data: { email: reqObj.email, password: reqObj.password } });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Failed to create admin' });
  }
  pending.splice(idx, 1);
  writePendingAdmins(pending);
  res.json({ success: true });
});

// NEW:
app.post('/api/admin/requests/:email/approve', requireAdmin, requireCsrf, async (req, res) => {
  try {
    if (req.admin.role !== 'superadmin') {
      return res.status(403).json({ success: false, message: 'Only superadmin may approve' });
    }
    
    const email = decodeURIComponent(req.params.email);
    const approved = await approvePendingAdmin(email);
    
    if (!approved) {
      return res.status(404).json({ success: false, message: 'Request not found' });
    }
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to approve admin' });
  }
});
```

**POST /api/admin/requests/:email/reject** (around line 1330):
```javascript
// OLD:
app.post('/api/admin/requests/:email/reject', requireAdmin, requireCsrf, (req, res) => {
  // ... role check ...
  const email = decodeURIComponent(req.params.email);
  let pending = readPendingAdmins();
  const next = pending.filter(p => p.email.toLowerCase() !== email.toLowerCase());
  writePendingAdmins(next);
  res.json({ success: true });
});

// NEW:
app.post('/api/admin/requests/:email/reject', requireAdmin, requireCsrf, async (req, res) => {
  try {
    if (req.admin.role !== 'superadmin') {
      return res.status(403).json({ success: false, message: 'Only superadmin may reject' });
    }
    
    const email = decodeURIComponent(req.params.email);
    await rejectPendingAdmin(email);
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to reject admin' });
  }
});
```

#### Update Route Cache Code:

Find the route cache loading/saving code (around line 388-430) and replace:

```javascript
// OLD:
const routePolylinesCache = new Map();
function loadRouteCacheFromDisk() { ... }
function saveRouteCacheToDisk() { ... }
loadRouteCacheFromDisk();

// NEW - Just initialize the cleanup job:
initializeRouteCacheCleanup(); // Call this once on server startup
```

Then find all places where route cache is accessed and update:

**Reading from cache:**
```javascript
// OLD:
const cached = routePolylinesCache.get(Number(bus.number));
if (cached && cached.morningRoute) { ... }

// NEW:
const cachedRoute = await getRouteFromCache(bus.id, 'MORNING');
if (cachedRoute) { ... }
```

**Writing to cache:**
```javascript
// OLD:
routePolylinesCache.set(Number(bus.number), { morningRoute: [...], eveningRoute: [...] });
saveRouteCacheToDisk();

// NEW:
await saveRouteToCache(bus.id, 'MORNING', morningRouteData);
await saveRouteToCache(bus.id, 'EVENING', eveningRouteData);
```

#### Update Admin Login:

Find the admin login code (around line 1160) and update to check `approved` status:

```javascript
// After finding admin:
const admin = await prisma.admin.findUnique({ where: { email } });
if (!admin || !bcrypt.compareSync(password, admin.password)) {
  return res.status(401).json({ success: false, message: 'Invalid credentials' });
}

// ADD THIS CHECK:
if (!admin.approved) {
  return res.status(403).json({ success: false, message: 'Account pending approval' });
}

// Then continue with JWT token generation...
```

### Step 4: Initialize Route Cache Cleanup

Add this line in server.js after all imports and before starting the server (around line 2000):

```javascript
// Initialize route cache cleanup (2-hour auto-refresh)
initializeRouteCacheCleanup();

// Start server
const PORT = process.env.PORT || 3000;
```

### Step 5: Test Everything

```cmd
# 1. Test settings
curl http://localhost:3000/api/settings

# 2. Test admin login (should work for approved admins only)
curl -X POST http://localhost:3000/api/admin/login -H "Content-Type: application/json" -d '{"email":"admin@example.com","password":"password"}'

# 3. Check route cache (will auto-refresh every 2 hours)
# Just use the bus routes normally - cache is handled automatically
```

### Step 6: Backup and Clean Up

Once everything is working:

```cmd
# Backup JSON files
mkdir backup
move settings.json backup\
move pending_admins.json backup\
move route_cache.json backup\

# Or delete them if you're confident
del settings.json
del pending_admins.json
del route_cache.json
```

---

## 🔄 Route Cache Auto-Refresh

The route cache now **automatically expires after 2 hours**:

- ✅ When a route is requested, if cache is older than 2 hours, it's automatically refreshed
- ✅ Background job runs every 2 hours to clean up expired entries
- ✅ No manual intervention needed
- ✅ Reduces Google Maps API calls while keeping data fresh

### How it Works

1. **First Request**: Route calculated via Google Maps API, saved to database
2. **Within 2 Hours**: Route served from database (fast!)
3. **After 2 Hours**: Cache expired, new route calculated and saved
4. **Background Cleanup**: Every 2 hours, old entries are deleted automatically

---

## 📊 Database Schema Changes

### New Tables

#### `SiteSettings`
```sql
CREATE TABLE "SiteSettings" (
  id INT PRIMARY KEY,
  siteTitle TEXT,
  organizationName TEXT,
  contactAddress TEXT,
  contactPhone TEXT,
  contactEmail TEXT,
  createdAt TIMESTAMP,
  updatedAt TIMESTAMP
);
```

#### `RouteCache`
```sql
CREATE TABLE "RouteCache" (
  id INT PRIMARY KEY,
  busId INT REFERENCES "Bus"(id) ON DELETE CASCADE,
  period TEXT CHECK (period IN ('MORNING', 'EVENING')),
  routeData JSONB,
  createdAt TIMESTAMP,
  updatedAt TIMESTAMP,
  UNIQUE(busId, period)
);
CREATE INDEX idx_routecache_updated ON "RouteCache"(updatedAt);
```

### Modified Tables

#### `Admin` (added `approved` field)
```sql
ALTER TABLE "Admin" ADD COLUMN approved BOOLEAN DEFAULT FALSE;
UPDATE "Admin" SET approved = TRUE WHERE approved IS NULL;
```

---

## 🐛 Troubleshooting

### Issue: Migration script fails

**Solution:** Make sure your `.env` `DATABASE_URL` points to the correct database:
```cmd
# Check connection
npx prisma db pull
```

### Issue: Settings not loading

**Solution:** Check if SiteSettings table has data:
```sql
SELECT * FROM "SiteSettings";
```

If empty, run:
```cmd
node prisma/migrate-json-to-db.js
```

### Issue: Route cache not expiring

**Solution:** The cleanup job runs every 2 hours. Check logs for:
```
[RouteCache] Running scheduled cache cleanup...
[RouteCache] Cleared X expired cache entries
```

### Issue: Pending admins not showing

**Solution:** Check if admins have `approved=false`:
```sql
SELECT id, email, approved, "createdAt" FROM "Admin" WHERE approved = FALSE;
```

---

## 🎯 Quick Command Reference

```cmd
# 1. Create migration
npx prisma migrate dev --name add_settings_and_cache_tables

# 2. Migrate data from JSON files
node prisma/migrate-json-to-db.js

# 3. Generate Prisma client
npx prisma generate

# 4. View database
npx prisma studio

# 5. Check route cache
SELECT "busId", period, "updatedAt", 
       EXTRACT(EPOCH FROM (NOW() - "updatedAt"))/3600 as age_hours
FROM "RouteCache"
ORDER BY "updatedAt" DESC;

# 6. Check pending admins
SELECT id, email, approved, "createdAt" FROM "Admin" WHERE approved = FALSE;

# 7. Clear old cache manually (if needed)
DELETE FROM "RouteCache" WHERE "updatedAt" < NOW() - INTERVAL '2 hours';
```

---

## ✅ Verification Checklist

- [ ] Database schema updated (run `npx prisma migrate dev`)
- [ ] Data migrated from JSON files (run migration script)
- [ ] server.js updated to use `dbHelpers.js`
- [ ] Settings endpoints working
- [ ] Admin approval system working
- [ ] Route cache auto-refreshing every 2 hours
- [ ] `initializeRouteCacheCleanup()` called on server startup
- [ ] JSON files backed up or removed
- [ ] Tested on production database

---

## 📝 Notes

- **Route Cache**: Automatically refreshes every 2 hours, no action needed
- **Pending Admins**: Now stored as `Admin` records with `approved=false`
- **Settings**: Single row in `SiteSettings` table (ID=1)
- **Cascading Deletes**: Deleting a bus also deletes its route cache and stops
- **Performance**: Database queries are faster than JSON file I/O
- **Scalability**: Works perfectly with multiple server instances

---

**Migration Complete! 🎉**

Your application now uses PostgreSQL for all persistent data with automatic route cache refresh every 2 hours.
