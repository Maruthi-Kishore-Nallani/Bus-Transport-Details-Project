# Bus Transport App

Minimal setup to run the app (API + static pages: user, admin, settings).

## Quick start
1) Install
```bash
npm install
```
2) Configure `.env` (example values shown)
```env
PORT=3000
ADMIN_JWT_SECRET=change-this
DATABASE_URL=\"postgresql://postgres:password@localhost:5432/bus_transport\"
GOOGLE_MAPS_API_KEY=your-key
GEOCODE_COUNTRY=IN
GEOCODE_REGION=in
# Superadmin (can approve admins)
MAIN_ADMIN_EMAIL=you@example.com
MAIN_ADMIN_PASSWORD=strong-password
```
3) Database
```bash
npx prisma generate
npm run db:migrate
npm run db:seed
```
4) Run
```bash
npm run dev
```
Open `page.html` (user) and `admin.html` (admin login). New admins can request access at `admin-signup.html`; superadmin approves in dashboard → Admin Approvals.

## Key endpoints
- POST `/api/check-availability`
- GET `/api/routes`
- Admin: POST `/api/admin/login`, GET `/api/admin/me`, GET `/api/admin/logs`
- Settings: GET `/api/settings`, PUT `/api/admin/settings`
- Admin approvals: POST `/api/admin/signup-request`, GET `/api/admin/requests`, POST `/api/admin/requests/:email/(approve|reject)`

## Notes
- Requires a valid Google Maps API key for geocoding/reverse-geocoding.
- Data is stored in PostgreSQL (configure via `DATABASE_URL` in `.env`).

## Security Checklist

### Before Deploying to Production

#### 1. Environment Variables
- [ ] Copy `.env.example` to `.env` and fill in all values
- [ ] Generate a strong JWT secret: `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`
- [ ] Set `ADMIN_JWT_SECRET` (never use the default)
- [ ] Set strong `MAIN_ADMIN_PASSWORD`
- [ ] Set `NODE_ENV=production`
- [ ] Set `SECURE_COOKIES=true` (requires HTTPS)

#### 2. Google Maps API Key
- [ ] Restrict API key in Google Cloud Console:
  - Add HTTP referrer restrictions (your domain)
  - Limit to required APIs: Geocoding, Directions, Maps JavaScript
  - Set daily quota limits
- [ ] Never commit API keys to git
- [ ] Rotate key if accidentally exposed

#### 3. Database
- [ ] Use strong PostgreSQL password
- [ ] Enable SSL/TLS for database connections
- [ ] Restrict database access to application server only
- [ ] Regular backups configured
- [ ] Review and apply pending migrations

#### 4. CORS Configuration
- [ ] Set `CORS_ORIGIN` to your actual domain(s) - never use `*` or `true` in production
- [ ] Remove localhost origins from production env

#### 5. Secrets Management
- [ ] Never commit `.env` file (already in `.gitignore`)
- [ ] Never commit `pending_admins.json` or `settings.json` (already in `.gitignore`)
- [ ] Use environment variables or a secrets manager (e.g., AWS Secrets Manager, HashiCorp Vault)
- [ ] Rotate all secrets if they were ever committed to git

#### 6. HTTPS/TLS
- [ ] Deploy behind HTTPS (use Let's Encrypt, Cloudflare, or cloud provider)
- [ ] Redirect all HTTP traffic to HTTPS
- [ ] Set secure cookie flags when `NODE_ENV=production`

#### 7. Rate Limiting & DDoS Protection
- [ ] Configure rate limits appropriately for your use case
- [ ] Consider using Redis for distributed rate limiting
- [ ] Use a reverse proxy (nginx, Cloudflare) for additional protection

#### 8. Logging & Monitoring
- [ ] Replace `console.log` with structured logging (winston/pino)
- [ ] Configure log levels (DEBUG for dev, INFO/WARN/ERROR for prod)
- [ ] Set up error monitoring (Sentry, LogRocket, etc.)
- [ ] Monitor API usage and costs (especially Google Maps API)

#### 9. Authentication & Authorization
- [ ] Review admin approval workflow
- [ ] Implement password strength requirements
- [ ] Consider adding 2FA for admin accounts
- [ ] Set appropriate JWT expiration times
- [ ] Implement refresh tokens for longer sessions

#### 10. Input Validation & SQL Injection
- [ ] Review all Prisma raw queries (`$queryRawUnsafe`, `$executeRawUnsafe`)
- [ ] Use parameterized queries (already done in most places)
- [ ] Validate and sanitize all user inputs
- [ ] Use Prisma client methods instead of raw SQL where possible

#### 11. File Uploads
- [ ] Validate file types and sizes (already implemented)
- [ ] Store uploads outside web root or serve via CDN
- [ ] Scan uploads for malware if accepting from untrusted sources
- [ ] Set proper file permissions on `uploads/` directory

#### 12. Dependencies
- [ ] Run `npm audit` regularly
- [ ] Keep dependencies up to date: `npm update`
- [ ] Review security advisories for critical packages
- [ ] Use `npm ci` in production (not `npm install`)

#### 13. Additional Hardening
- [ ] Add helmet.js for security headers
- [ ] Implement Content Security Policy (CSP)
- [ ] Add request size limits
- [ ] Disable unnecessary HTTP methods
- [ ] Hide server version headers

### Rotating Compromised Secrets

If secrets were committed to git or exposed:

1. **JWT Secret**: Generate new one, existing sessions will be invalidated
2. **Google Maps API Key**: 
   - Create new key in Google Cloud Console
   - Add restrictions immediately
   - Delete old key
   - Update `.env`
3. **Admin Passwords**: Have all admins reset passwords
4. **Database Credentials**: Update in both app and database server

### Quick Security Audit Commands

```bash
# Check for exposed secrets in git history
git log --all --full-history --source -- '*secret*' '*password*' '*.env'

# Audit npm packages
npm audit

# Check for outdated packages
npm outdated

# Search for potential SQL injection
grep -r "\$queryRawUnsafe\|\$executeRawUnsafe" .

# Find console.log statements
grep -r "console\.log" --include="*.js" .
```
