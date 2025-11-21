# 🚨 URGENT: Pre-Production Deployment Checklist

## ⚠️ CRITICAL SECURITY ISSUE FOUND!

Your `.env` file contains REAL credentials that were visible. **DO THESE NOW:**

---

## 1. 🔴 ROTATE ALL EXPOSED SECRETS (15 minutes)

### A. Google Maps API Key
**EXPOSED KEY:** `AIzaSyCayecig5sMFkmWnQnV_2qJiU2_gvmGe2k`

**Fix RIGHT NOW:**
1. Go to: https://console.cloud.google.com/apis/credentials
2. Find this key and **DELETE IT**
3. Create NEW key with restrictions:
   - Click "Create Credentials" > "API Key"
   - Click "Restrict Key"
   - **Application restrictions:** HTTP referrers
     - Add: `yourdomain.com/*` (your actual domain)
     - Add: `*.yourdomain.com/*`
   - **API restrictions:** Select these only:
     - ✅ Geocoding API
     - ✅ Directions API
     - ✅ Maps JavaScript API (if using in HTML)
4. Copy new key to `.env`
5. **Save and test immediately**

### B. Admin Password
**EXPOSED:** `Kishore0817`

**Fix NOW:**
```bash
# Generate strong password (run this):
node -e "console.log(require('crypto').randomBytes(16).toString('base64'))"

# Or use a password manager to generate 20+ character password
```
Update in `.env`:
```env
MAIN_ADMIN_PASSWORD=<NEW_STRONG_PASSWORD>
```

### C. Database Password
**EXPOSED:** `Kishore0817@localhost`

**If this is production database:**
```sql
-- Connect to PostgreSQL and run:
ALTER USER postgres WITH PASSWORD 'new-very-strong-password-here';
```
Then update `.env`:
```env
DATABASE_URL="postgresql://postgres:NEW_PASSWORD@localhost:5432/bus_transport"
```

---

## 2. 🟠 CONFIGURE PRODUCTION SETTINGS (10 minutes)

### Update `.env`:
```env
# MUST set your actual domain:
CORS_ORIGIN=https://yourdomain.com,https://www.yourdomain.com

# If deploying with HTTPS (which you MUST):
SECURE_COOKIES=true

# Production logging:
LOG_LEVEL=WARN
```

---

## 3. 🟡 ADD ESSENTIAL SECURITY (5 minutes)

Install and add helmet.js for security headers:

```bash
npm install helmet
```

Add to `server.js` (after line 13 where logger is imported):
```javascript
const helmet = require('helmet');
```

Add after CORS middleware (around line 88):
```javascript
// Security headers
app.use(helmet({
  contentSecurityPolicy: false, // Disable if using inline scripts
  crossOriginEmbedderPolicy: false
}));
```

---

## 4. 🟢 VERIFY DATABASE (2 minutes)

```bash
# Run migrations:
npx prisma migrate deploy

# Verify connection:
npx prisma db push
```

---

## 5. ✅ PRE-FLIGHT TEST (5 minutes)

### Test locally with production mode:
```bash
# Set production mode:
$env:NODE_ENV="production"

# Start server:
npm start

# In another terminal, test:
curl http://localhost:3000/api/health

# Should return: {"status":"OK",...}
```

### Test these endpoints:
- ✅ `GET /api/health` - Should work
- ✅ `GET /api/settings` - Should NOT expose API key
- ✅ `POST /api/admin/login` - Should work with new password
- ✅ CORS - Test with curl from different origin (should block)

---

## 6. 🚀 DEPLOYMENT STEPS

### A. Server Setup
- [ ] Install Node.js 18+ on server
- [ ] Install PostgreSQL 14+ on server  
- [ ] Configure HTTPS/SSL (use Let's Encrypt - free!)
- [ ] Install nginx or use cloud provider's load balancer

### B. Deploy Application
```bash
# On server:
git clone <your-repo>
cd Bus-Transport-Project

# Install dependencies:
npm ci --only=production

# Copy .env (DON'T commit it!):
# Upload .env securely via SCP/SFTP or use cloud secrets manager

# Run migrations:
npx prisma generate
npx prisma migrate deploy

# Start with PM2 (process manager):
npm install -g pm2
pm2 start server.js --name bus-transport
pm2 save
pm2 startup
```

### C. Nginx Configuration (if using)
```nginx
server {
    listen 80;
    server_name yourdomain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name yourdomain.com;
    
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;
    
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Forwarded-For $remote_addr;
    }
}
```

---

## 7. ⚡ QUICK WINS (Optional but Recommended)

### A. Add Request Rate Limiting (2 min)
```bash
npm install express-rate-limit
```

Add to `server.js`:
```javascript
const rateLimit = require('express-rate-limit');

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});

app.use('/api/', limiter);
```

### B. Add Compression (1 min)
```bash
npm install compression
```

Add to `server.js`:
```javascript
const compression = require('compression');
app.use(compression());
```

---

## 8. 🔍 POST-DEPLOYMENT VERIFICATION

After deploying:
- [ ] Visit: `https://yourdomain.com`
- [ ] Check HTTPS is working (green padlock)
- [ ] Test bus availability search
- [ ] Test admin login
- [ ] Check browser console for errors
- [ ] Verify API calls work
- [ ] Test on mobile device

---

## 🆘 If Something Breaks

### Quick Rollback:
```bash
# On server:
pm2 stop bus-transport
git reset --hard HEAD~1
npm ci --only=production
npx prisma generate
pm2 restart bus-transport
```

### Check Logs:
```bash
pm2 logs bus-transport
# or
tail -f /var/log/nginx/error.log
```

---

## 📋 Estimated Timeline

| Task | Time | Priority |
|------|------|----------|
| Rotate API keys & passwords | 15 min | 🔴 CRITICAL |
| Configure production settings | 10 min | 🔴 CRITICAL |
| Add helmet.js | 5 min | 🟠 HIGH |
| Verify database | 2 min | 🟠 HIGH |
| Test locally | 5 min | 🟠 HIGH |
| Deploy to server | 30 min | 🟢 REQUIRED |
| Configure HTTPS | 15 min | 🟢 REQUIRED |
| Post-deploy testing | 10 min | 🟢 REQUIRED |

**Total Time: ~90 minutes**

---

## 🎯 Minimum Viable Deployment (If Pressed for Time)

Do ONLY these:
1. ✅ Rotate Google Maps API key (15 min)
2. ✅ Change admin password (2 min)
3. ✅ Set `CORS_ORIGIN` to your domain (1 min)
4. ✅ Deploy with HTTPS (30 min)
5. ✅ Test basic functionality (5 min)

**Minimum Time: ~50 minutes**

---

## ⚠️ WARNING

**DO NOT deploy without:**
- ✅ New Google Maps API key with restrictions
- ✅ HTTPS configured
- ✅ CORS_ORIGIN set to your actual domain
- ✅ New admin password

**Deploying without these = SECURITY BREACH within hours**

---

## Need Help?

If stuck:
1. Check server logs
2. Review `SECURITY_AUDIT.md`
3. Test locally first with `NODE_ENV=production`

**Remember:** Better to delay 1 hour and deploy securely than deploy now and get hacked.
