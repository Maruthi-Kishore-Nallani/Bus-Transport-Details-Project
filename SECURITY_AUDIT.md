# Security Audit Report

**Generated:** November 21, 2025  
**Project:** Bus Transport Details System

## Overview

This document summarizes the security audit findings and remediation steps taken for the Bus Transport project.

---

## Critical Findings & Remediation

### ✅ FIXED: Exposed Google Maps API Key
**Risk Level:** HIGH  
**Issue:** The full Google Maps API key was being returned to clients via `GET /api/settings`  
**Impact:** API key could be stolen and used by unauthorized parties, leading to quota exhaustion and charges  
**Remediation:**
- Removed `googleMapsApiKey` from public API response
- Now returns only a boolean `mapsEnabled` flag
- Updated client code to work without direct API key access
- **Action Required:** Rotate the Google Maps API key if it was exposed in git history or production

### ✅ FIXED: Weak JWT Secret Default
**Risk Level:** HIGH  
**Issue:** JWT secret fell back to `'dev-secret-change-me'` if not set in environment  
**Impact:** Attackers could forge admin tokens  
**Remediation:**
- Added production check: server exits with error if `ADMIN_JWT_SECRET` not set
- Created `.env.example` with instructions to generate secure secret
- **Action Required:** Generate new JWT secret using: `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`

### ✅ FIXED: Permissive CORS Configuration
**Risk Level:** MEDIUM  
**Issue:** CORS was set to `origin: true`, allowing any domain  
**Impact:** Cross-origin attacks, CSRF risks  
**Remediation:**
- Implemented whitelist-based CORS using `CORS_ORIGIN` environment variable
- Added origin validation with logging for blocked requests
- **Action Required:** Set `CORS_ORIGIN` in production to your actual domain(s)

### ✅ FIXED: Weak Cookie Security
**Risk Level:** MEDIUM  
**Issue:** Cookies used `sameSite: 'lax'` even in production  
**Impact:** CSRF vulnerabilities  
**Remediation:**
- Updated cookie settings to use `sameSite: 'strict'` in production
- Made `secure` flag configurable via `SECURE_COOKIES` env var
- **Action Required:** Ensure HTTPS in production and set `SECURE_COOKIES=true`

### ✅ FIXED: Sensitive Files in Git
**Risk Level:** MEDIUM  
**Issue:** `pending_admins.json` and `settings.json` could contain sensitive data  
**Impact:** Exposure of hashed passwords, contact info, or API keys  
**Remediation:**
- Added files to `.gitignore`
- Removed from git tracking
- **Action Required:** Review git history and consider using BFG or git-filter-repo if sensitive data was committed

### ✅ IMPROVED: Logging
**Risk Level:** LOW  
**Issue:** Using `console.log` throughout codebase  
**Impact:** Difficult to manage log levels, no structured logging  
**Remediation:**
- Created structured logger module (`logger.js`)
- Replaced critical `console.log` statements
- Added configurable log levels via `LOG_LEVEL` env var
- **Recommendation:** Replace remaining `console.log` statements gradually

---

## Moderate Findings

### ⚠️ Raw SQL Usage (Prisma)
**Risk Level:** MEDIUM  
**Locations:**
- `server.js:829` - Column inspection query (safe - no user input)
- `server.js:842` - SELECT with constructed query (safe - parameterized)
- `server.js:951` - SELECT * FROM Bus (safe - no user input)
- `server.js:1252` - Column inspection (safe - no user input)
- `server.js:1264` - INSERT with parameterized values (safe - using $1, $2, etc.)
- `server.js:1267` - INSERT with parameterized values (safe)
- `server.js:1270` - INSERT with parameterized values (safe)
- `server.js:1324` - SELECT * FROM Bus (safe - no user input)

**Analysis:** All raw SQL usage is currently safe - either using parameterized queries or no user input
**Recommendation:** Prefer Prisma client methods when possible; document why raw SQL is needed

### ⚠️ In-Memory Rate Limiting
**Risk Level:** MEDIUM (Production)  
**Issue:** Rate limiting uses in-memory Maps, won't work across multiple instances  
**Impact:** Rate limits can be bypassed in load-balanced deployments  
**Recommendation:** Use Redis or similar for distributed rate limiting in production

### ⚠️ innerHTML Usage
**Risk Level:** LOW  
**Locations:** Multiple in `script.js`  
**Analysis:** All uses escape user input via `escapeHtml()` function - currently safe  
**Recommendation:** Continue using `escapeHtml()` for all dynamic content

---

## Low Priority Findings

### ℹ️ No Helmet.js
**Recommendation:** Add helmet.js for security headers:
```bash
npm install helmet
```
```javascript
const helmet = require('helmet');
app.use(helmet());
```

### ℹ️ No Request Size Limits
**Recommendation:** Add body parser limits:
```javascript
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));
```

### ℹ️ File Upload Security
**Current:** Validates file types and sizes (good)  
**Recommendation:** 
- Store uploads in cloud storage (S3, GCS) instead of local filesystem
- Consider virus scanning for user uploads
- Add file name sanitization (already done via regex)

---

## Required Actions Before Production

### Immediate (P0)
- [ ] Set `ADMIN_JWT_SECRET` with secure value
- [ ] Set `CORS_ORIGIN` to actual domain(s)
- [ ] Set `NODE_ENV=production`
- [ ] Set `SECURE_COOKIES=true`
- [ ] Ensure HTTPS is configured
- [ ] Rotate Google Maps API key if exposed
- [ ] Review and restrict Google Maps API key in Cloud Console

### High Priority (P1)
- [ ] Run `npm audit` and fix vulnerabilities
- [ ] Set up error monitoring (Sentry, etc.)
- [ ] Configure production logging (winston/pino with external service)
- [ ] Set up database backups
- [ ] Review admin approval workflow

### Medium Priority (P2)
- [ ] Implement Redis for rate limiting
- [ ] Add helmet.js
- [ ] Set up CI/CD with security scanning
- [ ] Document API endpoints (OpenAPI/Swagger)
- [ ] Add integration tests

### Nice to Have (P3)
- [ ] Implement refresh tokens for JWT
- [ ] Add 2FA for admin accounts
- [ ] Move uploads to cloud storage
- [ ] Add request/response compression
- [ ] Implement API versioning

---

## Security Testing Checklist

- [ ] Test CORS with unauthorized origin
- [ ] Test JWT with invalid/expired tokens
- [ ] Test rate limiting thresholds
- [ ] Test file upload size limits and type validation
- [ ] Test SQL injection on all endpoints (currently safe)
- [ ] Test XSS on all user inputs (currently safe with escapeHtml)
- [ ] Test CSRF protection
- [ ] Verify HTTPS redirect in production
- [ ] Verify secure cookie flags in production

---

## Compliance Notes

- **GDPR:** System collects contact info (email/phone) and location data
  - Ensure privacy policy is in place
  - Implement data deletion endpoint
  - Add consent mechanism
- **Data Retention:** Define retention policy for `AvailabilityLog` table
- **Audit Trail:** Consider logging admin actions for compliance

---

## Monitoring Recommendations

### Application Metrics
- Response times per endpoint
- Error rates
- Authentication failures
- Rate limit hits

### Security Metrics
- Failed login attempts per IP
- CORS violations
- JWT verification failures
- File upload rejections

### Business Metrics
- Google Maps API usage and costs
- Database connection pool status
- Active users/sessions

---

## Contact for Security Issues

If you discover a security vulnerability, please email: [security@yourdomain.com]

**Do NOT** open a public GitHub issue for security vulnerabilities.

---

## References

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Node.js Security Best Practices](https://nodejs.org/en/docs/guides/security/)
- [Express Security Best Practices](https://expressjs.com/en/advanced/best-practice-security.html)
- [Prisma Security Guidelines](https://www.prisma.io/docs/concepts/components/prisma-client/raw-database-access)

---

**Last Updated:** November 21, 2025  
**Next Review:** [Set quarterly review date]
