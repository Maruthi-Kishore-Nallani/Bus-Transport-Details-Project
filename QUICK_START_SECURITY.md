# 🚀 Quick Start Security Setup

## Step 1: Copy Environment Template
```bash
cp .env.example .env
```

## Step 2: Generate JWT Secret
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```
Copy the output and add to `.env` as `ADMIN_JWT_SECRET`

## Step 3: Configure Required Variables in `.env`

```env
# REQUIRED - Set these now:
ADMIN_JWT_SECRET=<paste-generated-secret-here>
DATABASE_URL="postgresql://user:password@localhost:5432/bus_transport"
GOOGLE_MAPS_API_KEY=your-actual-api-key

# REQUIRED for production:
NODE_ENV=production
CORS_ORIGIN=https://yourdomain.com
SECURE_COOKIES=true
LOG_LEVEL=INFO
```

## Step 4: Secure Google Maps API Key

1. Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. Create new API key or edit existing
3. Click "Restrict Key"
4. Add HTTP referrer restrictions:
   - `https://yourdomain.com/*`
   - `https://www.yourdomain.com/*`
5. Restrict APIs:
   - ✅ Geocoding API
   - ✅ Directions API
   - ✅ Maps JavaScript API
6. Save and copy key to `.env`

## Step 5: Install Dependencies & Run
```bash
npm install
npx prisma generate
npm run dev
```

## Step 6: Verify Security

### Check Logs
- Should see JSON-formatted structured logs
- Should see server start message with port

### Test CORS
```bash
# This should be blocked:
curl -H "Origin: https://evil.com" http://localhost:3000/api/settings
```

### Test API Key Protection
```bash
# API key should NOT be in response:
curl http://localhost:3000/api/settings | grep -i "key"
# Should only see: "mapsEnabled": true/false
```

### Test JWT Secret
```bash
# Server should exit if not set in production:
NODE_ENV=production npm start
# Should show error about ADMIN_JWT_SECRET
```

## Common Issues & Fixes

### Issue: "ADMIN_JWT_SECRET must be set"
**Fix:** Generate secret (Step 2) and add to `.env`

### Issue: "CORS blocked origin"
**Fix:** Add your domain to `CORS_ORIGIN` in `.env`
```env
CORS_ORIGIN=http://localhost:3000,https://yourdomain.com
```

### Issue: "Google Maps functionality not available"
**Fix:** Set `GOOGLE_MAPS_API_KEY` in `.env`

### Issue: Database connection failed
**Fix:** Update `DATABASE_URL` in `.env` with correct credentials

## Production Deployment Checklist

- [ ] Set `NODE_ENV=production`
- [ ] Set strong `ADMIN_JWT_SECRET` (64+ chars)
- [ ] Set `CORS_ORIGIN` to actual domain
- [ ] Set `SECURE_COOKIES=true`
- [ ] Set `LOG_LEVEL=INFO` or `WARN`
- [ ] Configure HTTPS/TLS
- [ ] Restrict Google Maps API key
- [ ] Run `npm audit`
- [ ] Set up error monitoring
- [ ] Configure database backups

## Security Resources

- 📖 Full details: `SECURITY_AUDIT.md`
- ✅ Complete guide: `SECURITY_SUMMARY.md`
- 📋 Checklist: `README.md` (Security Checklist section)

## Need Help?

1. Check `SECURITY_AUDIT.md` for explanations
2. Review `README.md` for detailed setup
3. Verify all `.env` variables are set
4. Check server logs for error messages

---

**Remember:** Never commit `.env` file to git! It's already in `.gitignore`.
