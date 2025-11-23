# 🚀 Deploy to Render - Step by Step Guide

## 📋 Pre-Deployment Checklist

### 🔴 CRITICAL: Do These First!

1. **Generate New Google Maps API Key** (MANDATORY - your current key is exposed!)
   - Go to: https://console.cloud.google.com/apis/credentials
   - DELETE old key: `AIzaSyCayecig5sMFkmWnQnV_2qJiU2_gvmGe2k`
   - Create new key with restrictions (see instructions below)

2. **Generate New Admin Password** (MANDATORY!)
   ```bash
   node -e "console.log(require('crypto').randomBytes(16).toString('base64'))"
   ```
   Copy the output - you'll need it!

---

## 🎯 Step 1: Prepare Your Repository (5 minutes)

### Push Your Code to GitHub:

```bash
# Make sure all changes are committed
git add .
git commit -m "Ready for Render deployment with security fixes"
git push origin main
```

**⚠️ IMPORTANT:** Make sure `.env` is NOT pushed (it should be in `.gitignore`)

---

## 🗄️ Step 2: Set Up Database on Render (5 minutes)

### Option A: Use Render's PostgreSQL (Recommended for Free Tier)

1. Go to https://dashboard.render.com/
2. Click "New +" → "PostgreSQL"
3. Configure:
   - **Name:** `bus-transport-db`
   - **Database:** `bus_transport`
   - **User:** `bus_admin` (or any name)
   - **Region:** Oregon (or nearest to you)
   - **Plan:** Free
4. Click "Create Database"
5. **SAVE THE CONNECTION STRING!** 
   - Find "Internal Database URL" - copy this!
   - Format: `postgresql://user:password@hostname/database`

### Option B: Use Your Existing Database
- If you have a database elsewhere, get the connection URL
- Must be accessible from internet
- Update firewall to allow Render IPs

---

## 🌐 Step 3: Deploy Web Service (10 minutes)

### A. Create New Web Service

1. Go to https://dashboard.render.com/
2. Click "New +" → "Web Service"
3. Connect your GitHub account (if not connected)
4. Select your repository: `Bus-Transport-Details-Project`
5. Click "Connect"

### B. Configure the Service

Fill in these settings:

**Basic Settings:**
- **Name:** `bus-transport-api` (or your preferred name)
- **Region:** Oregon (or same as database)
- **Branch:** `main`
- **Root Directory:** Leave blank
- **Environment:** `Node`
- **Build Command:** 
  ```
  npm install && npx prisma generate
  ```
- **Start Command:** 
  ```
  npm start
  ```

**Instance Type:**
- Select: **Free** (or paid if you need more resources)

### C. Add Environment Variables

Click "Advanced" → Add these environment variables:

**CRITICAL Variables (Must Set These!):**

| Key | Value | Notes |
|-----|-------|-------|
| `NODE_ENV` | `production` | Required |
| `PORT` | `10000` | Render uses this port |
| `ADMIN_JWT_SECRET` | `<your JWT secret from .env>` | Copy from your .env |
| `DATABASE_URL` | `<from Step 2>` | Internal Database URL from Render |
| `GOOGLE_MAPS_API_KEY` | `<NEW key with restrictions>` | See Step 4 below! |
| `MAIN_ADMIN_EMAIL` | `maruthikishore0117@gmail.com` | Your email |
| `MAIN_ADMIN_PASSWORD` | `<NEW generated password>` | From pre-deployment step |
| `CORS_ORIGIN` | `https://bus-transport-api.onrender.com` | Update with YOUR Render URL |
| `SECURE_COOKIES` | `true` | Required for production |
| `LOG_LEVEL` | `INFO` | or `WARN` for less logs |

**Optional Variables (Can Use Defaults):**

| Key | Value |
|-----|-------|
| `GEOCODE_COUNTRY` | `IN` |
| `GEOCODE_REGION` | `ap` |
| `SEARCH_RADIUS_KM` | `1.5` |
| `AVAILABILITY_RATE_LIMIT_PER_HOUR` | `200` |
| `AVAILABILITY_LIMIT_PER_CONTACT_PER_HOUR` | `60` |
| `LOGIN_MAX_ATTEMPTS` | `6` |
| `LOGIN_WINDOW_MS` | `900000` |
| `GOOGLE_MAPS_DAILY_LIMIT` | `1000` |

### D. Deploy!

1. Click "Create Web Service"
2. Render will start building and deploying
3. Wait 5-10 minutes for first deployment
4. Watch the logs for any errors

---

## 🔑 Step 4: Secure Your Google Maps API Key (CRITICAL!)

### Create New Restricted Key:

1. Go to: https://console.cloud.google.com/apis/credentials
2. **DELETE** the old exposed key
3. Click "CREATE CREDENTIALS" → "API key"
4. Name it: `Bus-Transport-Production-Render`
5. Click "RESTRICT KEY"

**Application Restrictions:**
- Select: **HTTP referrers (web sites)**
- Add these referrers:
  ```
  https://bus-transport-details.onrender.com/*
  https://bus-transport-details-*.onrender.com/*
  ```
  (Replace `bus-transport-api` with YOUR service name)

**API Restrictions:**
- Select: **Restrict key**
- Enable ONLY these APIs:
  - ✅ Geocoding API
  - ✅ Directions API
  - ✅ Maps JavaScript API

6. Click **SAVE**
7. Copy the new API key
8. Go back to Render Dashboard → Your Service → Environment
9. Update `GOOGLE_MAPS_API_KEY` with the new key
10. Click "Save Changes" (service will redeploy)

---

## 🔄 Step 5: Update CORS After Deployment

Once deployed, Render gives you a URL like: `https://bus-transport-api.onrender.com`

**Update CORS:**
1. Go to Render Dashboard → Your Service → Environment
2. Find `CORS_ORIGIN` variable
3. Update to: `https://bus-transport-api.onrender.com` (your actual URL)
4. If you have a custom domain, add it: `https://bus-transport-api.onrender.com,https://yourdomain.com`
5. Click "Save Changes"

---

## ✅ Step 6: Test Your Deployment (5 minutes)

### A. Check Health Endpoint

Open in browser or use curl:
```bash
curl https://bus-transport-api.onrender.com/api/health
```

Should return:
```json
{"status":"OK","message":"Bus API is running","timestamp":"..."}
```

### B. Test Settings Endpoint

```bash
curl https://bus-transport-api.onrender.com/api/settings
```

**Verify:**
- ✅ Should have `"mapsEnabled": true`
- ❌ Should NOT have `googleMapsApiKey` field (for security)

### C. Test Admin Login

1. Go to: `https://bus-transport-api.onrender.com/admin.html`
2. Login with:
   - Email: `maruthikishore0117@gmail.com`
   - Password: (your NEW password)
3. Should successfully login and see dashboard

### D. Test Bus Search

1. Go to: `https://bus-transport-api.onrender.com/page.html`
2. Enter your email and a location
3. Search for buses
4. Should work without errors

---

## 🎨 Step 7: Set Up Frontend (If Separate)

If you want to serve the HTML pages separately:

1. In Render Dashboard, create another **Static Site**:
   - Connect same repo
   - **Publish directory:** Leave empty (serves from root)
   - Deploy static files

2. Or use the API service to serve everything (current setup)

---

## 🌍 Step 8: Add Custom Domain (Optional)

If you have your own domain:

1. In Render Dashboard → Your Service → Settings
2. Scroll to "Custom Domains"
3. Click "Add Custom Domain"
4. Enter your domain: `api.yourdomain.com`
5. Render will show DNS records to add
6. Go to your domain registrar (GoDaddy, Namecheap, etc.)
7. Add the CNAME record Render provides
8. Wait for DNS propagation (5-60 minutes)
9. Update `CORS_ORIGIN` to include your custom domain
10. Update Google Maps API key restrictions to include your domain

---

## 🐛 Troubleshooting

### Build Fails

**Check logs in Render Dashboard:**
- Missing dependencies? Check `package.json`
- Prisma errors? Make sure `DATABASE_URL` is set

**Common fixes:**
```bash
# If Prisma fails, try this build command:
npm install && npx prisma generate && npx prisma migrate deploy
```

### Database Connection Fails

**Check:**
- Is `DATABASE_URL` set correctly?
- Using Internal Database URL (not External)?
- Database is in same region?

**Test connection:**
Add this to environment variables temporarily:
```
DATABASE_URL_TEST=true
```

### Application Crashes After Deploy

**Check logs:**
1. Render Dashboard → Your Service → Logs
2. Look for error messages

**Common issues:**
- Missing environment variables
- Wrong `PORT` (should be `10000`)
- Database migrations not run

**Run migrations manually:**
In Render Dashboard → Your Service → Shell:
```bash
npx prisma migrate deploy
```

### CORS Errors

**Update `CORS_ORIGIN`:**
- Must include your Render URL
- Must be HTTPS
- Check spelling carefully

### Google Maps Not Working

**Check:**
- New API key created?
- Old key deleted?
- Restrictions set correctly?
- Render URL added to allowed referrers?

---

## 📊 Monitoring Your App

### View Logs:
- Render Dashboard → Your Service → Logs
- Real-time log streaming
- Filter by severity

### Check Metrics:
- Render Dashboard → Your Service → Metrics
- CPU, Memory, Request rate
- Response times

### Set Up Alerts:
- Render Dashboard → Your Service → Notifications
- Email alerts for downtime
- Deploy notifications

---

## 💰 Cost Estimate

**Free Tier:**
- Web Service: Free (with limitations)
- PostgreSQL: Free (expires after 90 days)
- 750 hours/month
- Spins down after 15 min inactivity

**Paid Plans (If Needed):**
- Starter: $7/month (no spin down)
- Standard: $25/month (more resources)
- PostgreSQL: $7/month (persistent)

---

## 🔄 Update/Redeploy

To deploy updates:

1. Make changes to your code
2. Commit and push to GitHub:
   ```bash
   git add .
   git commit -m "Your update message"
   git push origin main
   ```
3. Render automatically redeploys!
4. Watch logs in dashboard

**Manual redeploy:**
- Render Dashboard → Your Service → Manual Deploy → "Deploy latest commit"

---

## ✅ Post-Deployment Checklist

- [ ] Health endpoint returns OK
- [ ] Settings endpoint works (no API key exposed)
- [ ] Admin login successful with NEW password
- [ ] Bus search functionality works
- [ ] HTTPS is enabled (green padlock)
- [ ] CORS configured correctly
- [ ] Google Maps API key rotated and restricted
- [ ] Database migrations ran successfully
- [ ] No errors in logs
- [ ] Monitored for 15 minutes with no issues

---

## 🎉 You're Live!

**Your API is now running at:**
`https://bus-transport-api.onrender.com`

**Access your pages:**
- User page: `https://bus-transport-api.onrender.com/page.html`
- Admin page: `https://bus-transport-api.onrender.com/admin.html`

**Share your URL, test thoroughly, and you're done!**

---

## 🆘 Need Help?

**Render Documentation:**
- https://render.com/docs

**Check logs:**
- Dashboard → Your Service → Logs

**Community:**
- Render Community: https://community.render.com/

**Your project files:**
- `SECURITY_AUDIT.md` - Security details
- `URGENT_DEPLOY_CHECKLIST.md` - Critical tasks
- `DEPLOY_NOW.md` - General deployment guide

---

## 🔐 SECURITY REMINDERS

**Before you celebrate:**
1. ✅ Old Google Maps key deleted?
2. ✅ New key has restrictions?
3. ✅ Admin password changed?
4. ✅ `CORS_ORIGIN` set to your Render URL?
5. ✅ `SECURE_COOKIES=true`?
6. ✅ `.env` file NOT in git?

**If you answered "No" to any, fix it NOW!**

---

**Total Time: ~30 minutes**

**Good luck with your deployment! 🚀**
