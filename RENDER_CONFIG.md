# Render Configuration Summary

## Required Settings in Render Dashboard

### Build & Deploy

**Build Command:**
```bash
npm run build
```

**Start Command:**
```bash
npm start
```

### Environment Variables (Set in Render Dashboard)

Copy these from your `.env` file:

```
NODE_ENV=production
PORT=10000
ADMIN_JWT_SECRET=your_jwt_secret_here
DATABASE_URL=postgresql://user:password@host:5432/database
GOOGLE_MAPS_API_KEY=your_google_maps_key_here
GEOCODE_COUNTRY=IN
GEOCODE_STATE=Andhra Pradesh
GEOCODE_CITY=Vijayawada
GEOCODE_REGION=in
ADMIN_LOGS_ENRICH_LIMIT=10
SEARCH_RADIUS_KM=1.5
MAIN_ADMIN_EMAIL=your_admin_email@example.com
MAIN_ADMIN_PASSWORD=your_encrypted_password_here
AVAILABILITY_RATE_LIMIT_PER_HOUR=200
AVAILABILITY_LIMIT_PER_CONTACT_PER_HOUR=60
LOGIN_MAX_ATTEMPTS=6
LOGIN_WINDOW_MS=900000
GOOGLE_MAPS_DAILY_LIMIT=1000
CORS_ORIGIN=https://your-app.onrender.com
SECURE_COOKIES=true
LOG_LEVEL=INFO
```

### Auto-Deploy

✅ Enable "Auto-Deploy" from GitHub main branch

---

## What Happens on Deploy

1. **Build Phase** (runs `npm run build`):
   - `npm install` - Installs dependencies
   - `prisma generate` - Generates Prisma client
   - `prisma migrate deploy` - Applies database migrations
   - `npm run db:seed` - Seeds database with bus data

2. **Start Phase** (runs `npm start`):
   - Starts Node.js server
   - Auto-migrates JSON files to database (if needed)
   - Initializes route cache cleanup (2-hour refresh)

---

## First Time Setup

1. Create PostgreSQL database in Render
2. Copy `DATABASE_URL` to environment variables
3. Set all other environment variables
4. Push code to GitHub
5. Render auto-deploys

---

## Verification

After deployment completes, check:

1. Health: `https://your-app.onrender.com/api/health`
2. Settings: `https://your-app.onrender.com/api/settings`
3. Buses: `https://your-app.onrender.com/api/buses`

All should return valid JSON responses.

---

## Notes

- Database migrations run automatically on each deploy
- Seed script is safe to run multiple times (uses upsert)
- Auto-migration only runs if data doesn't exist
- Route cache refreshes every 2 hours automatically
- No terminal access needed!
