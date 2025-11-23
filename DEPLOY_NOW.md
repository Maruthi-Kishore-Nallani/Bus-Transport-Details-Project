# ⚡ 30-MINUTE PRODUCTION DEPLOYMENT GUIDE

**Current Status:** ✅ Security middleware added (helmet, compression, rate limiting)

---

## 🔴 CRITICAL: DO THESE FIRST (15 min)

### 1. Rotate Google Maps API Key (10 min) - MANDATORY!
Your current key `AIzaSyCayecig5sMFkmWnQnV_2qJiU2_gvmGe2k` is exposed and MUST be replaced.

**Steps:**
```
1. Open: https://console.cloud.google.com/apis/credentials
2. Find the exposed key and DELETE it
3. Create new key:
   - Click "CREATE CREDENTIALS" → "API key"
   - Name it: "Bus-Transport-Production"
   - Click "RESTRICT KEY"
   
4. Set restrictions:
   Application restrictions:
   - Select: HTTP referrers (web sites)
   - Add referrer: youractualwebsite.com/*
   - Add referrer: *.youractualwebsite.com/*
   
   API restrictions:
   - Select: Restrict key
   - Check only:
     ✓ Geocoding API
     ✓ Directions API
     ✓ Maps JavaScript API
   
5. Click SAVE
6. Copy the new key
7. Update .env:
   GOOGLE_MAPS_API_KEY=<paste-new-key-here>
```

### 2. Change Admin Password (2 min) - MANDATORY!
Your password `Kishore0817` is exposed.

**Run this to generate new password:**
```bash
node -e "console.log(require('crypto').randomBytes(16).toString('base64'))"
```

**Update .env:**
```env
MAIN_ADMIN_PASSWORD=<paste-generated-password>
```

### 3. Set Your Domain (1 min) - MANDATORY!
**Update .env:**
```env
CORS_ORIGIN=https://yourdomain.com,https://www.yourdomain.com
```
Replace `yourdomain.com` with your ACTUAL domain!

### 4. Enable Secure Cookies (1 min) - If using HTTPS
**Update .env:**
```env
SECURE_COOKIES=true
```
Only set to `true` if you have HTTPS configured!

---

## 🟠 VERIFY SETUP (5 min)

### Test Environment:
```bash
node -e "require('dotenv').config(); console.log('NODE_ENV:', process.env.NODE_ENV); console.log('CORS:', process.env.CORS_ORIGIN); console.log('Secure Cookies:', process.env.SECURE_COOKIES);"
```

### Test Server Locally:
```bash
npm start
```

In another terminal:
```bash
curl http://localhost:3000/api/health
```

Should return: `{"status":"OK",...}`

**✅ If this works, proceed to deployment!**

---

## 🟢 DEPLOY (10 min)

### Option A: Deploy to Render.com (Easiest - 10 min)

1. Push to GitHub:
```bash
git add .
git commit -m "Production ready with security fixes"
git push
```

2. Go to https://render.com
3. Click "New +" → "Web Service"
4. Connect your GitHub repo
5. Configure:
   - **Name:** bus-transport
   - **Environment:** Node
   - **Build Command:** `npm install && npx prisma generate`
   - **Start Command:** `npm start`
6. Add Environment Variables (copy from your .env):
   - `NODE_ENV` = `production`
   - `ADMIN_JWT_SECRET` = `<your-secret>`
   - `DATABASE_URL` = `<your-db-url>`
   - `GOOGLE_MAPS_API_KEY` = `<NEW-key-with-restrictions>`
   - `CORS_ORIGIN` = `https://your-app.onrender.com`
   - `SECURE_COOKIES` = `true`
   - `LOG_LEVEL` = `INFO`
7. Click "Create Web Service"
8. Wait 5-10 minutes for deployment

### Option B: Deploy to Your Own Server

1. SSH to server:
```bash
ssh user@your-server.com
```

2. Clone and setup:
```bash
git clone <your-repo-url>
cd Bus-Transport-Project
npm ci --only=production
```

3. Copy .env securely:
```bash
# On your local machine:
scp .env user@your-server.com:/path/to/project/

# Or create .env on server and paste content
```

4. Setup database and run migrations:
```bash
npx prisma generate
npx prisma migrate deploy
```

5. Install PM2 and start:
```bash
npm install -g pm2
pm2 start server.js --name bus-transport
pm2 save
pm2 startup
```

6. Setup nginx (if needed):
```nginx
server {
    listen 80;
    server_name yourdomain.com;
    
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
    }
}
```

7. Setup SSL with Let's Encrypt:
```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com
```

---

## ✅ POST-DEPLOYMENT CHECK (5 min)

Test these URLs (replace with your domain):

1. **Health Check:**
```bash
curl https://yourdomain.com/api/health
```
Should return: `{"status":"OK"}`

2. **Settings (verify API key NOT exposed):**
```bash
curl https://yourdomain.com/api/settings
```
Should have `"mapsEnabled": true` but NO `googleMapsApiKey`

### Test Admin Login:**
- Go to: `https://yourdomain.com/admin.html`
- Login with: `maruthikishore0117@gmail.com` and your NEW password

4. **Test Bus Search:**
- Go to: `https://yourdomain.com/page.html`
- Try searching for a location

5. **Test Fees Structure Upload (Optional):**
- Login to admin dashboard
- Go to Settings tab
- Upload a fees structure PDF (max 4MB)
- Verify download button appears on public page

5. **Check HTTPS:**
- Look for green padlock in browser
- Certificate should be valid

---

## 🆘 TROUBLESHOOTING

### Server won't start:
```bash
# Check logs:
pm2 logs bus-transport

# Or if running directly:
npm start
```

### Database connection fails:
```bash
# Test connection:
npx prisma db push

# Check DATABASE_URL in .env
```

### CORS errors:
- Make sure CORS_ORIGIN includes your actual domain
- Restart server after .env changes

### Google Maps not working:
- Verify new API key has restrictions set
- Check key is enabled for Geocoding, Directions, Maps JS APIs
- Verify domain is in allowed referrers

---

## 📊 DEPLOYMENT CHECKLIST

Before going live:
- [ ] Rotated Google Maps API key with restrictions
- [ ] Changed admin password to strong password
- [ ] Set CORS_ORIGIN to actual domain
- [ ] Set NODE_ENV=production
- [ ] Set SECURE_COOKIES=true (if HTTPS)
- [ ] Deployed with HTTPS enabled
- [ ] Tested health endpoint
- [ ] Tested admin login
- [ ] Tested bus search functionality
- [ ] Verified API key NOT in /api/settings response
- [ ] Checked browser console for errors

---

## 🎯 MINIMUM TIME ESTIMATE

| Task | Time |
|------|------|
| Rotate API key | 10 min |
| Change password | 2 min |
| Set domain in CORS | 1 min |
| Test locally | 2 min |
| Deploy (Render.com) | 10 min |
| Post-deploy testing | 5 min |
| **TOTAL** | **~30 min** |

---

## ⚠️ SECURITY REMINDER

**DO NOT skip:**
1. ✅ New Google Maps API key with restrictions
2. ✅ New admin password
3. ✅ HTTPS configuration
4. ✅ CORS_ORIGIN set to your domain

**Without these, your site WILL be compromised!**

---

## 📞 QUICK COMMANDS

**Generate strong password:**
```bash
node -e "console.log(require('crypto').randomBytes(16).toString('base64'))"
```

**Check environment:**
```bash
npm run test:env
```

**Start production:**
```bash
npm start
```

**Check if running:**
```bash
curl http://localhost:3000/api/health
```

**View logs (if using PM2):**
```bash
pm2 logs bus-transport
```

---

**YOU'RE READY! Start with the CRITICAL section and you'll be live in 30 minutes! 🚀**
