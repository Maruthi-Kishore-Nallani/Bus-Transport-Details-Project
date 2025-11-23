# 🚀 Render Deployment Guide (No Terminal Access)

This guide shows you how to deploy to Render when you can't access the terminal.

## ✅ What Happens Automatically

When you deploy to Render, these things happen **automatically**:

1. ✅ **Prisma generates** client code
2. ✅ **Database migrations** are applied
3. ✅ **Database is seeded** with bus data
4. ✅ **JSON files migrate** to database on first startup
5. ✅ **Route cache** auto-refreshes every 2 hours

**You don't need terminal access!** Everything is automated.

---

## 📋 Pre-Deployment Checklist

### 1. Commit All Changes

```cmd
git add .
git commit -m "Add database migration and auto-setup"
git push origin main
```

### 2. Verify Render Settings

In your Render dashboard, make sure these are set:

**Build Command:**
```bash
npm run build
```

**Start Command:**
```bash
npm start
```

**Environment Variables** (must be set in Render):
- ✅ `DATABASE_URL` - Your PostgreSQL connection string
- ✅ `ADMIN_JWT_SECRET` - Your JWT secret
- ✅ `GOOGLE_MAPS_API_KEY` - Your Google Maps API key
- ✅ `NODE_ENV` - Set to `production`
- ✅ All other env vars from `.env.example`

---

## 🔄 Deployment Process

### Step 1: Push to GitHub

```cmd
git add .
git commit -m "Deploy with database migration"
git push origin main
```

### Step 2: Deploy on Render

Go to your Render dashboard and click **"Manual Deploy"** or wait for auto-deploy.

### Step 3: Watch Build Logs

Render will show you logs like:

```
==> Building...
npm install
✓ Installed dependencies

npx prisma generate
✓ Generated Prisma Client

npx prisma migrate deploy
✓ Applied 2 migrations

npm run db:seed
✓ Seeded database with 5 buses

Build completed successfully!
```

### Step 4: Watch Startup Logs

After build, you'll see:

```
==> Starting service...
Bus API Server started on port 10000
[AutoMigrate] Starting automatic migration check...
[AutoMigrate] ✓ Settings already exist, skipping
[AutoMigrate] ✓ Route cache already exists, skipping
[AutoMigrate] ✓ No pending admins to migrate
[AutoMigrate] ✅ Migration check completed successfully
[RouteCache] Initialized with 2h auto-refresh
```

---

## 🎯 What Each File Does

### `render-build.sh` (Build Script)
Runs during deployment:
1. Installs npm packages
2. Generates Prisma client
3. Applies database migrations
4. Seeds database with bus data

### `autoMigrate.js` (Startup Migration)
Runs when server starts:
1. Checks if settings exist → migrates from `settings.json` if needed
2. Checks if route cache exists → migrates from `route_cache.json` if needed
3. Checks if pending admins exist → migrates from `pending_admins.json` if needed
4. **Safe to run multiple times** - only migrates if data doesn't exist

### `dbHelpers.js` (Database Operations)
Provides functions for:
- Site settings (read/write to database)
- Pending admin requests (database-backed)
- Route cache with 2-hour auto-refresh

---

## 🔍 Verifying Deployment

### Check if Database is Set Up

Visit: `https://your-app.onrender.com/api/health`

Should return:
```json
{
  "status": "ok",
  "timestamp": "2025-11-23T..."
}
```

### Check if Settings Work

Visit: `https://your-app.onrender.com/api/settings`

Should return:
```json
{
  "success": true,
  "settings": {
    "siteTitle": "BUS TRANSPORT DETAILS",
    "organizationName": "...",
    "contact": {...},
    "mapsEnabled": true
  }
}
```

### Check if Buses Are Seeded

Visit: `https://your-app.onrender.com/api/buses`

Should return list of 5 buses (2, 3, 4, 6, 7).

---

## 🐛 Troubleshooting

### Issue: Build Fails

**Check:** Build logs in Render dashboard

**Common fixes:**
- Make sure `DATABASE_URL` is set in environment variables
- Check if migrations have syntax errors
- Verify `package.json` scripts are correct

### Issue: Database Not Seeded

**Check:** Startup logs in Render dashboard

**Fix:** The seed script uses `upsert`, so you can manually trigger it:

In Render dashboard → **Shell** (if available) or redeploy.

### Issue: Settings Not Loading

**Check:** Startup logs for auto-migration messages

**What to look for:**
```
[AutoMigrate] ✓ Site settings migrated
```

If you see errors, the migration failed. Check database permissions.

### Issue: Route Cache Not Working

**Check:** Logs for route cache initialization:
```
[RouteCache] Initialized with 2h auto-refresh
```

The cache will build automatically as routes are requested.

---

## 📊 Database Schema Applied

After deployment, your database will have these tables:

### Core Tables (Existing)
- `Admin` - Admin users (now with `approved` field)
- `Bus` - Bus information
- `Stop` - Bus stops
- `AvailabilityLog` - Availability check logs

### New Tables (Added)
- `SiteSettings` - Site configuration (replaces `settings.json`)
- `RouteCache` - Cached routes with 2-hour expiry (replaces `route_cache.json`)

---

## 🎉 Success Indicators

Your deployment is successful when you see:

1. ✅ Build completes without errors
2. ✅ "Bus API Server started" in logs
3. ✅ "[AutoMigrate] ✅ Migration check completed successfully"
4. ✅ "[RouteCache] Initialized with 2h auto-refresh"
5. ✅ Health endpoint returns `{"status":"ok"}`
6. ✅ Settings endpoint returns site settings
7. ✅ Buses endpoint returns 5 buses

---

## 📝 After Deployment

### Clean Up Local Environment (Optional)

Once everything works on Render, you can remove local JSON files:

```cmd
# Backup first
mkdir backup
move settings.json backup\
move pending_admins.json backup\
move route_cache.json backup\
```

These files are no longer needed - everything is in the database!

---

## 🔄 Future Deployments

For future deployments, just:

```cmd
git add .
git commit -m "Your changes"
git push origin main
```

Render will automatically:
- Build the app
- Apply new migrations
- Restart the server
- Run auto-migration check (safe, won't duplicate data)

---

## 🆘 Need Help?

### Check Logs

Render Dashboard → Your Service → Logs

Look for:
- ❌ Red error messages
- ⚠️ Yellow warnings
- ✅ Green success indicators

### Common Log Messages

**Good:**
```
✓ Applied 3 migrations
✓ Seeded database
[AutoMigrate] ✅ Migration check completed successfully
[RouteCache] Initialized with 2h auto-refresh
```

**Needs Attention:**
```
❌ Migration failed
❌ Failed to connect to database
⚠️ Auto-migration skipped
```

---

## 🎯 Quick Deploy Commands

```cmd
# 1. Stage all changes
git add .

# 2. Commit with message
git commit -m "Deploy with auto-migration"

# 3. Push to GitHub (triggers Render deploy)
git push origin main

# 4. Watch Render dashboard for build/deploy logs
```

**That's it!** No terminal access needed. Everything is automated.

---

## ✅ Final Checklist

Before deploying, verify:

- [ ] All changes committed to git
- [ ] `DATABASE_URL` set in Render environment variables
- [ ] `render-build.sh` has execute permissions (should be automatic)
- [ ] `package.json` has `"build": "..."` script
- [ ] Pushed to GitHub (`git push origin main`)
- [ ] Render build command is `npm run build`
- [ ] Render start command is `npm start`

**Ready to deploy!** 🚀
