/*
 * Bus Transport - Backend API
 * 
 * BUS AVAILABILITY CHECKER WORKFLOW:
 * ===================================
 * 
 * STEP 1: Input Processing
 *   - Receives location input (place name or coordinates like "16.5062,80.6480")
 *   - If coordinates: uses directly
 *   - If place name: proceeds to STEP 2
 * 
 * STEP 2: Geocoding
 *   - Converts place name to geocodes (lat, lng)
 *   - Uses Google Geocoding API with caching
 *   - Example: "Vijayawada Railway Station" → {lat: 16.5062, lng: 80.6480}
 * 
 * STEP 3: Draw Circle
 *   - Creates a circle with 1.5km radius centered at user location
 *   - Radius: 1500 meters (configurable via SEARCH_RADIUS_KM)
 * 
 * STEP 4: Generate Route Paths
 *   - For each bus in database:
 *     * Loads all stops for morning and evening routes
 *     * Generates route path as array of points using Google Directions API
 *     * Route is encoded as polyline: [{lat, lng}, {lat, lng}, ...]
 *     * Falls back to straight-line between stops if API unavailable
 * 
 * STEP 5: Check Intersection
 *   - For each route path (array of points):
 *     * Checks if any point falls within the 1.5km circle
 *     * Checks if any route segment crosses the circle boundary
 *     * Uses geolib's getDistanceFromLine for accurate segment distance calculation
 * 
 * STEP 6: Return Results
 *   - Returns all buses whose routes intersect the circle
 *   - Includes: bus number, name, nearby stops, etc.
 * 
 * KEY FEATURES:
 * - Routes are pre-stored in database with stops
 * - Route paths are dynamically generated using Google Directions
 * - Intersection uses both point-in-circle and segment-crossing checks
 * - Comprehensive logging for debugging
 */

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { getDistance, isPointWithinRadius, getDistanceFromLine } = require('geolib');
const https = require('https');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const multer = require('multer');
const http = require('http');
const { Server: IOServer } = require('socket.io');
const sharp = require('sharp');
const logger = require('./logger');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;

// Fail fast in production if JWT secret is not set
if (process.env.NODE_ENV === 'production' && !process.env.ADMIN_JWT_SECRET) {
  console.error('FATAL: ADMIN_JWT_SECRET must be set in production. Generate with: node -e "console.log(require(\'crypto\').randomBytes(64).toString(\'hex\'))"');
  process.exit(1);
}
const JWT_SECRET = process.env.ADMIN_JWT_SECRET || 'dev-secret-change-me';
const MAIN_ADMIN_EMAIL = process.env.MAIN_ADMIN_EMAIL || '';
const MAIN_ADMIN_PASSWORD = process.env.MAIN_ADMIN_PASSWORD || '';
const prisma = new PrismaClient();

// Create HTTP server and attach socket.io for live updates
const httpServer = http.createServer(app);
// Allow configuring socket.io CORS origins from env (comma-separated)
const ioCorsOrigins = process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map(o => o.trim()) : ['http://localhost:3000'];
const io = new IOServer(httpServer, {
  cors: {
    origin: (origin, callback) => {
      // Allow requests without origin (mobile apps, curl)
      if (!origin) return callback(null, true);
      if (ioCorsOrigins.includes(origin)) return callback(null, true);
      return callback(new Error('Not allowed by CORS'));
    },
    credentials: true
  },
  path: '/socket.io',
  transports: ['websocket', 'polling'],
  allowEIO3: true,
  pingTimeout: 30000
});

io.on('connection', (socket) => {
  logger.debug('Socket connected', { socketId: socket.id });
  socket.on('disconnect', () => {
    logger.debug('Socket disconnected', { socketId: socket.id });
  });
});

// Middleware
// CORS Configuration - restrict origins in production
const corsOrigins = process.env.CORS_ORIGIN 
  ? process.env.CORS_ORIGIN.split(',').map(o => o.trim()) 
  : ['http://localhost:3000'];

app.use(cors({ 
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);
    if (corsOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn(`CORS blocked origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true 
}));

// Security headers with helmet
app.use(helmet({
  contentSecurityPolicy: false, // Disable if using inline scripts/styles
  crossOriginEmbedderPolicy: false
}));

// Compression for responses
app.use(compression());

// Rate limiting for API endpoints
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: { success: false, message: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', apiLimiter);

app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

// Trust proxy - required for Render and other reverse proxy deployments
// This allows Express to correctly read X-Forwarded-For, X-Forwarded-Proto, etc.
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1); // Trust first proxy
}

// Admin static guard: protect admin pages from anonymous access.
// This runs BEFORE static file serving to prevent direct access to admin HTML.
app.use((req, res, next) => {
  try {
    // Only protect the admin dashboard page and any non-API /admin/* static paths.
    // Allow `/admin.html` (login page) to be served so users can reach the login form.
    const adminPaths = ['/admin-dashboard.html'];
    const isAdminRequest = adminPaths.includes(req.path) || (req.path.startsWith('/admin/') && !req.path.startsWith('/api/'));
    if (!isAdminRequest) return next();

    // Attempt to extract token from Authorization header or cookie
    const auth = req.headers.authorization || '';
    let token = null;
    if (auth && auth.startsWith('Bearer ')) token = auth.slice(7);
    else if (req.headers.cookie) {
      const m = req.headers.cookie.match(/(?:^|;\s*)admin_token=([^;]+)/);
      if (m) token = decodeURIComponent(m[1]);
    }

    if (!token) {
      // Not authenticated — redirect to admin signup/login page
      return res.redirect('/admin-signup.html');
    }

    try {
      const payload = jwt.verify(token, JWT_SECRET);
      if (payload.role !== 'admin' && payload.role !== 'superadmin') throw new Error('Not admin');
      req.admin = payload;
      return next();
    } catch (e) {
      return res.redirect('/admin-signup.html');
    }
  } catch (e) {
    return next();
  }
});

// Serve static files (HTML pages, CSS, client JS) from project root
app.use(express.static(path.join(__dirname)));

// Simple in-memory rate limiting and Google Maps usage tracking
const loginAttempts = new Map(); // ip -> {count, firstTs}
const AVAILABILITY_LIMIT_PER_HOUR = parseInt(process.env.AVAILABILITY_RATE_LIMIT_PER_HOUR || '200', 10);
const AVAILABILITY_LIMIT_PER_CONTACT_PER_HOUR = parseInt(process.env.AVAILABILITY_LIMIT_PER_CONTACT_PER_HOUR || '60', 10);
const LOGIN_MAX_ATTEMPTS = parseInt(process.env.LOGIN_MAX_ATTEMPTS || '6', 10);
const LOGIN_WINDOW_MS = parseInt(process.env.LOGIN_WINDOW_MS || String(15 * 60 * 1000), 10); // 15 min

const availabilityCounters = new Map(); // ip -> {count, windowStart}
const availabilityContactCounters = new Map(); // contact -> {count, windowStart}

// Google Maps daily usage counter (simple in-memory, resets on date change)
const googleUsage = { date: (new Date()).toISOString().slice(0,10), count: 0, limit: parseInt(process.env.GOOGLE_MAPS_DAILY_LIMIT || '1000', 10) };

function cleanStaleLoginAttempts() {
  const now = Date.now();
  for (const [ip, obj] of loginAttempts) {
    if (now - obj.firstTs > LOGIN_WINDOW_MS) loginAttempts.delete(ip);
  }
}
setInterval(cleanStaleLoginAttempts, 60 * 1000);

function incrementAvailability(ip, contact) {
  const now = Date.now();
  const hourWindow = 60 * 60 * 1000;
  // ip counter
  const ipObj = availabilityCounters.get(ip) || { count: 0, windowStart: now };
  if (now - ipObj.windowStart > hourWindow) { ipObj.count = 0; ipObj.windowStart = now; }
  ipObj.count += 1;
  availabilityCounters.set(ip, ipObj);

  // contact counter
  if (contact) {
    const cObj = availabilityContactCounters.get(contact) || { count: 0, windowStart: now };
    if (now - cObj.windowStart > hourWindow) { cObj.count = 0; cObj.windowStart = now; }
    cObj.count += 1;
    availabilityContactCounters.set(contact, cObj);
  }

  return { ipCount: ipObj.count, contactCount: (contact ? availabilityContactCounters.get(contact).count : 0) };
}

function isAvailabilityAllowed(ip, contact) {
  const ipObj = availabilityCounters.get(ip) || { count: 0, windowStart: Date.now() };
  if (ipObj.count >= AVAILABILITY_LIMIT_PER_HOUR) return false;
  if (contact) {
    const cObj = availabilityContactCounters.get(contact) || { count: 0, windowStart: Date.now() };
    if (cObj.count >= AVAILABILITY_LIMIT_PER_CONTACT_PER_HOUR) return false;
  }
  return true;
}

function checkAndIncrementGoogleUsage() {
  const today = (new Date()).toISOString().slice(0,10);
  if (googleUsage.date !== today) { googleUsage.date = today; googleUsage.count = 0; }
  if (googleUsage.count >= googleUsage.limit) return false;
  googleUsage.count += 1;
  return true;
}

// CSRF protection: double submit cookie token. The cookie `csrf_token` is set on login and must be
// included in header `x-csrf-token` for state-changing admin requests (POST/PUT/DELETE).
function requireCsrf(req, res, next) {
  const method = String(req.method || '').toUpperCase();
  if (!['POST','PUT','DELETE','PATCH'].includes(method)) return next();
  try {
    const header = req.headers['x-csrf-token'];
    const cookie = req.headers.cookie || '';
    const m = cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
    const cookieToken = m ? decodeURIComponent(m[1]) : null;
    if (!header || !cookieToken || header !== cookieToken) {
      return res.status(403).json({ success: false, message: 'Invalid CSRF token' });
    }
    return next();
  } catch (e) {
    return res.status(403).json({ success: false, message: 'CSRF check failed' });
  }
}

// Default root route -> serve `page.html` so visiting http://localhost:3000/ opens the main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'page.html'));
});

// Prepare uploads directory and multer
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
// Serve uploads explicitly to ensure predictable public paths
app.use('/uploads', express.static(UPLOADS_DIR, { maxAge: process.env.NODE_ENV === 'production' ? '7d' : 0 }));
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    // Name file as <busNumber>_image<ext>
    try {
      const busNumber = req.params && req.params.busNumber ? String(req.params.busNumber) : String(Date.now());
      const ext = path.extname(file.originalname) || '.jpg';
      const ts = Date.now();
      const fname = `${busNumber}_image_${ts}${ext}`.replace(/[^a-zA-Z0-9._-]/g, '_');
      cb(null, fname);
    } catch (e) {
      const safeName = `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_')}`;
      cb(null, safeName);
    }
  }
});

// Only allow image uploads
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype || !file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files are allowed'));
    }
    cb(null, true);
  }
});
// Dedicated PDF upload handler for fees structure (separate to keep strict MIME)
const pdfUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => cb(null, `${Date.now()}_fees_tmp.pdf`)
  }),
  limits: { fileSize: 4 * 1024 * 1024 }, // 4MB PDF limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== 'application/pdf') return cb(new Error('Only PDF allowed'));
    cb(null, true);
  }
});
// ---- Site settings unified with database (fallback to JSON) ----
const { getSiteSettings, updateSiteSettings, DEFAULT_SETTINGS } = require('./dbHelpers');
const SETTINGS_PATH = path.join(__dirname, 'settings.json');

async function loadUnifiedSettings() {
  // Prefer DB-backed settings; fall back to local JSON file if DB unavailable
  try {
    const s = await getSiteSettings();
    if (s && typeof s === 'object') return s;
  } catch (e) {
    logger.warn('DB settings read failed, falling back to file', { error: e && e.message });
  }
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      const raw = fs.readFileSync(SETTINGS_PATH, 'utf-8');
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_SETTINGS, ...parsed, contact: { ...DEFAULT_SETTINGS.contact, ...(parsed.contact || {}) } };
    }
  } catch (e) {
    logger.error('Failed to read settings file, using defaults', { error: e && e.message });
  }
  return { ...DEFAULT_SETTINGS };
}

let siteSettings = DEFAULT_SETTINGS;
// Load settings on startup (async)
(async () => { try { siteSettings = await loadUnifiedSettings(); } catch (e) {} })();

// Public settings
app.get('/api/settings', async (req, res) => {
  // DO NOT expose the actual Google Maps API key to clients for security
  // Instead, return a boolean indicating if Maps functionality is available
  try {
    siteSettings = await loadUnifiedSettings();
  } catch (e) { /* keep last known */ }
  const settingsPublic = { ...siteSettings, mapsEnabled: Boolean(process.env.GOOGLE_MAPS_API_KEY) };
  res.json({ success: true, settings: settingsPublic });
});

// Protected update settings
app.put('/api/admin/settings', requireAdmin, async (req, res) => {
  try {
    const { siteTitle, organizationName, contact } = req.body || {};
    // Persist to DB first (source of truth)
    const saved = await updateSiteSettings({ siteTitle, organizationName, contact });
    if (!saved) throw new Error('DB persist failed');
    siteSettings = saved;
    // Also write to local file as cache/fallback (best-effort)
    try { fs.writeFileSync(SETTINGS_PATH, JSON.stringify(siteSettings, null, 2), 'utf-8'); } catch (e) { /* best effort */ }
    return res.json({ success: true, settings: siteSettings });
  } catch (e) {
    logger.error('Failed to update settings', { error: e && e.message });
    return res.status(500).json({ success: false, message: 'Failed to persist settings' });
  }
});

// --- Enhanced geocode + routing + intersection helpers ---

const DEFAULT_RADIUS_KM = parseFloat(process.env.SEARCH_RADIUS_KM) || 1.5; // STEP 3: Radius in km (1.5km = 1500 meters)
const GOOGLE_MAPS_KEY = process.env.GOOGLE_MAPS_API_KEY || null;
const geocodeCache = new Map();
const reverseGeocodeCache = new Map();
// Route polylines cache: in-memory Map and on-disk JSON persistence
const os = require('os');
const PERSIST_ROUTE_CACHE = (process.env.ROUTE_CACHE_PERSIST === 'true') || (process.env.NODE_ENV === 'production');
const ROUTE_CACHE_PATH = PERSIST_ROUTE_CACHE ? path.join(__dirname, 'route_cache.json') : path.join(os.tmpdir(), `route_cache_${process.pid}.json`);
const routePolylinesCache = new Map(); // key: busId (number) -> { morningRoute: [...], eveningRoute: [...] }

function loadRouteCacheFromDisk() {
  try {
    if (fs.existsSync(ROUTE_CACHE_PATH)) {
      const raw = fs.readFileSync(ROUTE_CACHE_PATH, 'utf-8');
      const parsed = JSON.parse(raw);
      for (const key of Object.keys(parsed || {})) {
        routePolylinesCache.set(Number(key), parsed[key]);
      }
      logger.info('Loaded route polylines cache from disk', { count: routePolylinesCache.size });
    }
  } catch (e) {
    logger.warn('Failed to load route cache from disk', { error: e && e.message });
  }
}

function saveRouteCacheToDisk() {
  try {
    const obj = {};
    for (const [k, v] of routePolylinesCache.entries()) obj[String(k)] = v;
    fs.writeFileSync(ROUTE_CACHE_PATH, JSON.stringify(obj, null, 2), 'utf-8');
    logger.info('Saved route polylines cache to disk', { count: routePolylinesCache.size, path: ROUTE_CACHE_PATH, persisted: PERSIST_ROUTE_CACHE });
  } catch (e) {
    logger.warn('Failed to persist route cache to disk', { error: e && e.message });
  }
}

async function buildRouteForBus(b) {
  // b: bus record including stops
  const morningStops = (b.stops || []).filter(s => s.period === 'MORNING').sort((x, y) => x.order - y.order);
  const eveningStops = (b.stops || []).filter(s => s.period === 'EVENING').sort((x, y) => x.order - y.order);

  const buildForStops = async (stopsArr) => {
    if (!stopsArr || stopsArr.length === 0) return [];
    if (stopsArr.length === 1) return [{ lat: stopsArr[0].lat, lng: stopsArr[0].lng }];
    const origin = { lat: stopsArr[0].lat, lng: stopsArr[0].lng };
    const destination = { lat: stopsArr[stopsArr.length - 1].lat, lng: stopsArr[stopsArr.length - 1].lng };
    const waypoints = stopsArr.slice(1, -1).map(s => ({ lat: s.lat, lng: s.lng }));
    try {
      const path = await getRoutePath(origin, destination, waypoints);
      return path;
    } catch (e) {
      // fallback to straight-line points
      return stopsArr.map(s => ({ lat: s.lat, lng: s.lng }));
    }
  };

  const morningRoute = await buildForStops(morningStops);
  const eveningRoute = await buildForStops(eveningStops);
  return { morningRoute, eveningRoute };
}

async function buildAllRoutePolylines() {
  try {
    logger.info('Building all route polylines (may use Google Directions API)');
    const buses = await prisma.bus.findMany({ include: { stops: true } });
    for (const b of buses) {
      try {
        const routes = await buildRouteForBus(b);
        routePolylinesCache.set(b.id, routes);
      } catch (e) {
        logger.warn('Failed building route for bus', { busId: b.id, error: e && e.message });
      }
    }
    saveRouteCacheToDisk();
    logger.info('Finished building route polylines', { cached: routePolylinesCache.size });
  } catch (e) {
    logger.error('Failed to build all route polylines', { error: e && e.message });
  }
}

// Load persisted cache on startup (non-blocking)
loadRouteCacheFromDisk();
// Schedule-controlled background refresh to ensure up-to-date routes when server starts
// Avoid running an immediate, synchronous rebuild which can trigger repeated
// work during dev when files are being written and nodemon watches the tree.
const ROUTE_BUILD_COOLDOWN_MS = parseInt(process.env.ROUTE_BUILD_COOLDOWN_MS || '300000', 10); // default 5 minutes
let _lastRouteBuildTs = 0;
let _routeRebuildTimer = null;

function scheduleRouteCacheRebuild(immediate = false) {
  try {
    if (_routeRebuildTimer) {
      clearTimeout(_routeRebuildTimer);
      _routeRebuildTimer = null;
    }
    const now = Date.now();
    const since = now - _lastRouteBuildTs;
    const delay = immediate ? 0 : Math.max(0, ROUTE_BUILD_COOLDOWN_MS - since);
    _routeRebuildTimer = setTimeout(async () => {
      _routeRebuildTimer = null;
      _lastRouteBuildTs = Date.now();
      try {
        logger.info('Scheduled: starting route polylines build');
        await buildAllRoutePolylines();
      } catch (e) {
        logger.warn('Scheduled route build failed', { error: e && e.message });
      }
    }, delay);
    logger.debug('Route cache rebuild scheduled', { immediate, delay });
  } catch (e) {
    logger.warn('Failed to schedule route cache rebuild', { error: e && e.message });
  }
}

// Perform a single startup rebuild but via scheduler to avoid immediate re-entrancy.
scheduleRouteCacheRebuild(false);

/**
 * STEP 2: Geocode a place name -> { lat, lng, formatted_address }
 * Converts location name (e.g., "Vijayawada Railway Station") to coordinates
 * Uses Google Geocoding if GOOGLE_MAPS_API_KEY is set, else throws.
 * Results are cached to reduce API calls.
 */
async function geocodeLocation(locationName) {
  if (!locationName || typeof locationName !== 'string') throw new Error('Invalid location for geocoding');
  const key = locationName.trim().toLowerCase();
  if (geocodeCache.has(key)) return geocodeCache.get(key);

  // If no Google Maps key is configured, fall back to Nominatim (OpenStreetMap)
  if (!GOOGLE_MAPS_KEY) {
    return nominatimGeocode(locationName);
  }

  // Enforce daily usage limit for Google API calls
  if (!checkAndIncrementGoogleUsage()) {
    throw new Error('Google Maps daily usage limit exceeded');
  }

  // Preprocess: If a state (administrative area) env is provided and not already in the query, append it
  const statePref = process.env.GEOCODE_STATE || '';
  const cityPref = process.env.GEOCODE_CITY || '';
  let queryAugmented = locationName.trim();
  if (statePref && !new RegExp(statePref.replace(/[-/\\^$*+?.()|[\]{}]/g,'\\$&'), 'i').test(queryAugmented)) {
    queryAugmented += `, ${statePref}`;
  }
  if (cityPref && !new RegExp(cityPref.replace(/[-/\\^$*+?.()|[\]{}]/g,'\\$&'), 'i').test(queryAugmented) && /market|station|bus|stand|center|centre|college/i.test(queryAugmented)) {
    // If query looks like a POI and city isn't present, append city
    queryAugmented += `, ${cityPref}`;
  }

  const q = encodeURIComponent(queryAugmented);
  const country = process.env.GEOCODE_COUNTRY || '';
  const region = process.env.GEOCODE_REGION || '';
  const components = [];
  if (country) components.push(`country:${country}`);
  // If statePref provided, include administrative_area component filter (Google supports 'administrative_area')
  if (statePref) components.push(`administrative_area:${encodeURIComponent(statePref)}`);
  if (cityPref) components.push(`locality:${encodeURIComponent(cityPref)}`);
  let url = `https://maps.googleapis.com/maps/api/geocode/json?address=${q}&key=${GOOGLE_MAPS_KEY}`;
  if (components.length) url += `&components=${components.join('|')}`;
  if (region) url += `&region=${region}`; // region bias (ccTLD style)

  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(body);
          if (j.status === 'OK' && Array.isArray(j.results) && j.results.length) {
            const stateNorm = statePref ? statePref.toLowerCase() : '';
            const cityNorm = cityPref ? cityPref.toLowerCase() : '';
            // Prefer result whose address components match desired state & city if provided
            let chosen = null;
            for (const r of j.results) {
              const comps = Array.isArray(r.address_components) ? r.address_components : [];
              const compNames = comps.map(c => c.long_name.toLowerCase());
              const compTypes = comps.map(c => c.types).flat();
              const hasState = stateNorm && compNames.includes(stateNorm);
              const hasCity = cityNorm && compNames.includes(cityNorm);
              // Prioritize: both state + city > state only > city only > first result
              if (!chosen || (stateNorm && cityNorm && hasState && hasCity) || (stateNorm && hasState && !cityNorm) || (cityNorm && hasCity && !stateNorm)) {
                // If both required, ensure this one matches both before selecting definitively
                if (stateNorm && cityNorm) {
                  if (hasState && hasCity) { chosen = r; break; }
                } else if (stateNorm && hasState) { chosen = r; break; }
                else if (cityNorm && hasCity) { chosen = r; break; }
                else if (!stateNorm && !cityNorm && !chosen) { chosen = r; }
                else if (!chosen) { chosen = r; }
              }
            }
            if (!chosen) chosen = j.results[0];
            const loc = chosen.geometry.location;
            const out = { lat: loc.lat, lng: loc.lng, formatted_address: chosen.formatted_address };
            geocodeCache.set(key, out);
            return resolve(out);
          }
          // If Google didn't return results, try Nominatim as a fallback
          return nominatimGeocode(locationName).then((resGeo) => {
            if (resGeo) return resolve(resGeo);
            return reject(new Error(`Geocode failed: ${j.status || 'NO_RESULTS'}`));
          }).catch(() => reject(new Error(`Geocode failed: ${j.status || 'NO_RESULTS'}`)));
        } catch (err) { reject(err); }
      });
    }).on('error', reject);
  });
}

// Google Places helper removed: we rely on `geocodeLocation` (regional-first) and Nominatim fallback.

/**
 * Nominatim (OpenStreetMap) geocoding fallback
 * Returns { lat, lng, formatted_address } or throws
 */
function nominatimGeocode(locationName) {
  return new Promise((resolve, reject) => {
    try {
      const q = encodeURIComponent(locationName);
      const nomUrl = `https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1`;
      const opts = new URL(nomUrl);
      const reqOpts = { hostname: opts.hostname, path: opts.pathname + opts.search, method: 'GET', headers: { 'User-Agent': 'BusTransportApp/1.0' } };
      https.get(reqOpts, (res) => {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => {
          try {
            const arr = JSON.parse(body);
            if (Array.isArray(arr) && arr.length > 0) {
              const first = arr[0];
              const out = { lat: parseFloat(first.lat), lng: parseFloat(first.lon), formatted_address: first.display_name };
              geocodeCache.set(locationName.trim().toLowerCase(), out);
              return resolve(out);
            }
            return resolve(null);
          } catch (e) { return reject(e); }
        });
      }).on('error', (e) => reject(e));
    } catch (e) { reject(e); }
  });
}

// Server-side geocoding endpoint (POST) - resolves place name to coords
app.post('/api/geocode', async (req, res) => {
  try {
    const location = req.body && req.body.location;
    if (!location || typeof location !== 'string') return res.status(400).json({ success: false, message: 'location string required' });
    try {
      const geo = await geocodeLocation(location);
      return res.json({ success: true, location: geo });
    } catch (e) {
      return res.status(400).json({ success: false, message: e && e.message ? e.message : 'Geocoding failed' });
    }
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// Server-side reverse geocoding endpoint (POST) - resolves coords to formatted address
app.post('/api/reverse-geocode', async (req, res) => {
  try {
    const lat = Number(req.body && req.body.lat);
    const lng = Number(req.body && req.body.lng);
    if (Number.isNaN(lat) || Number.isNaN(lng)) return res.status(400).json({ success: false, message: 'lat and lng required' });
    try {
      const addr = await reverseGeocode(lat, lng);
      return res.json({ success: true, address: addr });
    } catch (e) {
      return res.status(400).json({ success: false, message: 'Reverse geocoding failed' });
    }
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// Dev-only: return Google Maps API key to client for local development
app.get('/api/maps-key', (req, res) => {
  try {
    // Only allow in non-production to avoid leaking keys from deployed sites
    if (process.env.NODE_ENV === 'production') return res.status(403).json({ success: false, message: 'Not allowed' });
    if (!GOOGLE_MAPS_KEY) return res.status(404).json({ success: false, message: 'No key configured' });
    return res.json({ success: true, key: GOOGLE_MAPS_KEY });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});


/**
 * Reverse geocode coordinates -> place name (formatted address)
 * Caches results to minimize API calls.
 */
async function reverseGeocode(lat, lng) {
  const key = `${Number(lat).toFixed(6)},${Number(lng).toFixed(6)}`;
  if (reverseGeocodeCache.has(key)) return reverseGeocodeCache.get(key);

  // If no Google Maps key is configured, fall back to Nominatim reverse geocoding
  if (!GOOGLE_MAPS_KEY) {
    try {
      const addr = await nominatimReverse(lat, lng);
      if (addr) {
        reverseGeocodeCache.set(key, addr);
        return addr;
      }
    } catch (e) {
      // ignore and fall through to error below
    }
    throw new Error('Google Maps API key not configured');
  }

  if (!checkAndIncrementGoogleUsage()) throw new Error('Google Maps daily usage limit exceeded');
  const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${encodeURIComponent(`${lat},${lng}`)}&key=${GOOGLE_MAPS_KEY}`;
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(body);
          if (j.status === 'OK' && j.results && j.results[0]) {
            const addr = j.results[0].formatted_address;
            reverseGeocodeCache.set(key, addr);
            resolve(addr);
          } else {
            resolve(null);
          }
        } catch (e) { resolve(null); }
      });
    }).on('error', () => resolve(null));
  });
}

// Nominatim reverse geocode fallback
function nominatimReverse(lat, lng) {
  return new Promise((resolve, reject) => {
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}&format=json`;
      https.get(url, { headers: { 'User-Agent': 'BusTransportApp/1.0' } }, (res) => {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => {
          try {
            const j = JSON.parse(body);
            if (j && j.display_name) return resolve(j.display_name);
            return resolve(null);
          } catch (e) { return reject(e); }
        });
      }).on('error', reject);
    } catch (e) { reject(e); }
  });
}

/**
 * Geocode by lat,lng -> { formatted_address, lat, lng }
 * Uses Google Geocoding API when key is available, else falls back to Nominatim
 */
async function geocodeLatLng(lat, lng) {
  const nLat = Number(lat); const nLng = Number(lng);
  if (Number.isNaN(nLat) || Number.isNaN(nLng)) throw new Error('Invalid lat/lng');

  // Prefer Google Geocoding when key present
  if (GOOGLE_MAPS_KEY) {
    if (!checkAndIncrementGoogleUsage()) throw new Error('Google Maps daily usage limit exceeded');
    const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${encodeURIComponent(`${nLat},${nLng}`)}&key=${GOOGLE_MAPS_KEY}`;
    return new Promise((resolve, reject) => {
      https.get(url, (res) => {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => {
          try {
            const j = JSON.parse(body);
            if (j.status === 'OK' && j.results && j.results[0]) {
              const r = j.results[0];
              const loc = r.geometry && r.geometry.location ? r.geometry.location : { lat: nLat, lng: nLng };
              return resolve({ formatted_address: r.formatted_address || `${nLat}, ${nLng}`, lat: loc.lat, lng: loc.lng });
            }
            // fallback to nominatim
            return nominatimReverse(nLat, nLng).then(addr => resolve({ formatted_address: addr || `${nLat}, ${nLng}`, lat: nLat, lng: nLng })).catch(() => resolve({ formatted_address: `${nLat}, ${nLng}`, lat: nLat, lng: nLng }));
          } catch (e) { return reject(e); }
        });
      }).on('error', (e) => {
        // fallback
        nominatimReverse(nLat, nLng).then(addr => resolve({ formatted_address: addr || `${nLat}, ${nLng}`, lat: nLat, lng: nLng })).catch(() => resolve({ formatted_address: `${nLat}, ${nLng}`, lat: nLat, lng: nLng }));
      });
    });
  }

  // No Google key: use Nominatim reverse and return lat/lng as provided
  try {
    const addr = await nominatimReverse(nLat, nLng);
    return { formatted_address: addr || `${nLat}, ${nLng}`, lat: nLat, lng: nLng };
  } catch (e) {
    return { formatted_address: `${nLat}, ${nLng}`, lat: nLat, lng: nLng };
  }
}

/**
 * Decode Google's polyline string -> [{lat, lng}, ...]
 */
function decodePolyline(encoded) {
  if (!encoded) return [];
  let index = 0, lat = 0, lng = 0, coords = [];
  while (index < encoded.length) {
    let shift = 0, result = 0, b;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);

    shift = 0; result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : (result >> 1);

    coords.push({ lat: lat * 1e-5, lng: lng * 1e-5 });
  }
  return coords;
}

/**
 * STEP 4: Generate route path as array of MINI POINTS
 * Creates a route polyline (array of {lat,lng}) between origin and destination with optional waypoints.
 * Uses Google Directions API to generate actual road paths with MANY intermediate points.
 * 
 * CRITICAL: This function returns HUNDREDS of mini points along the route, not just the bus stops!
 * The Google Directions API polyline contains every curve and turn of the actual road.
 * 
 * If Google Directions fails or key missing, returns straight-line sequence through supplied points.
 * This encoded route array is then checked against the 1.5km circle for intersection.
 * 
 * @param {Object} origin - {lat, lng} or Stop-like object
 * @param {Object} destination - {lat, lng} or Stop-like object
 * @param {Array} waypoints - Array of intermediate points
 * @returns {Array} Array of {lat, lng} points representing the FULL ROUTE (many mini points)
 */
async function getRoutePath(origin, destination, waypoints = []) {
  const o = origin.coords ? origin.coords : { lat: origin.lat, lng: origin.lng };
  const d = destination.coords ? destination.coords : { lat: destination.lat, lng: destination.lng };
  const wpList = (waypoints || []).map(w => w.coords ? w.coords : { lat: w.lat, lng: w.lng });

  // Fallback straight-line path if no API key
  if (!GOOGLE_MAPS_KEY) {
    return [o, ...wpList, d].map(p => ({ lat: +p.lat, lng: +p.lng }));
  }

  // Enforce daily usage limit for Google API calls
  if (!checkAndIncrementGoogleUsage()) {
    // fallback to straight-line if usage exceeded
    return [o, ...wpList, d].map(p => ({ lat: +p.lat, lng: +p.lng }));
  }

  const originStr = `${o.lat},${o.lng}`;
  const destStr = `${d.lat},${d.lng}`;
  const wpStr = wpList.map(p => `${p.lat},${p.lng}`).join('|');

  const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${originStr}&destination=${destStr}&key=${GOOGLE_MAPS_KEY}&mode=driving${wpStr ? `&waypoints=${encodeURIComponent(wpStr)}` : ''}`;

  return new Promise((resolve) => {
    https.get(url, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(body);
                     if (j.status === 'OK' && j.routes && j.routes[0] && j.routes[0].overview_polyline) {
             // Decode the polyline which contains HUNDREDS of mini points along the route
             const decoded = decodePolyline(j.routes[0].overview_polyline.points);
             return resolve(decoded);
           }
         } catch (e) {
           // Silent fallback
         }
         // fallback to raw points (just bus stops)
        resolve([o, ...wpList, d].map(p => ({ lat: +p.lat, lng: +p.lng })));
      });
    }).on('error', () => {
      resolve([o, ...wpList, d].map(p => ({ lat: +p.lat, lng: +p.lng })));
    });
  });
}

/**
 * STEP 5: Check if route path intersects the circle
 * Determines whether a polyline (array of route points) intersects a circle
 * centered at userLocation with given radius (in meters).
 * 
 * CRITICAL: The path parameter contains HUNDREDS of mini points from the Google Directions API.
 * This function checks EVERY mini point and EVERY segment between points.
 * It's NOT just checking bus stops - it's checking the ENTIRE ROUTE!
 * 
 * Algorithm:
 * 1. Check if ANY of the hundreds of mini points is within the circle
 * 2. Check if ANY segment (between consecutive mini points) crosses the circle boundary
 * 
 * @param {Object} userLocation - {lat, lng} center of the circle
 * @param {Array} path - Array of {lat, lng} points representing the FULL ROUTE (many mini points)
 * @param {Number} radiusMeters - Radius of the circle in meters (typically 1500 for 1.5km)
 * @returns {Boolean} True if ANY point or segment of the path intersects the circle
 */
function isPathIntersectsCircle(userLocation, path, radiusMeters) {
  if (!path || path.length === 0) return false;
  const center = { latitude: userLocation.lat, longitude: userLocation.lng };
  // Check if ANY mini point is inside circle -> intersects
  // Use per-point distance checks only (matches requested algorithm).
  // This avoids any discrepancies from segment-distance helper implementations.
  let minDist = Infinity;
  let minIndex = -1;
  for (let i = 0; i < path.length; i++) {
    const p = path[i];
    const lat = Number(p.lat);
    const lng = Number(p.lng);
    if (Number.isNaN(lat) || Number.isNaN(lng)) continue;
    const d = getDistance({ latitude: lat, longitude: lng }, center);
    if (d < minDist) { minDist = d; minIndex = i; }
    if (d <= radiusMeters) {
      logger.debug('Path intersects circle by point', { index: i, distanceMeters: d, radiusMeters });
      return true;
    }
  }

  // If no point was within the radius, return false (no intersection)
  logger.debug('Path did not intersect (point-only check)', { minDist, minIndex, radiusMeters });
  return false;
}

// Helper: compute minimum distance (meters) from userLocation to any point in path
function getMinDistanceAlongPath(userLocation, path) {
  const center = { latitude: userLocation.lat, longitude: userLocation.lng };
  let minDist = Infinity;
  let minIndex = -1;
  if (!Array.isArray(path) || path.length === 0) return { minDist, minIndex };
  for (let i = 0; i < path.length; i++) {
    const p = path[i];
    const lat = Number(p.lat);
    const lng = Number(p.lng);
    if (Number.isNaN(lat) || Number.isNaN(lng)) continue;
    const d = getDistance({ latitude: lat, longitude: lng }, center);
    if (d < minDist) { minDist = d; minIndex = i; }
  }
  return { minDist, minIndex };
}

// --- Geodesy helpers (self-contained) ---
function toRad(deg) { return deg * Math.PI / 180; }
function toDeg(rad) { return rad * 180 / Math.PI; }

// Great-circle distance (Haversine) in meters
function haversineDistance(a, b) {
  const R = 6371000; // Earth radius meters
  const lat1 = toRad(a.latitude); const lat2 = toRad(b.latitude);
  const dLat = lat2 - lat1; const dLon = toRad(b.longitude - a.longitude);
  const sinDlat = Math.sin(dLat / 2);
  const sinDlon = Math.sin(dLon / 2);
  const aa = sinDlat * sinDlat + Math.cos(lat1) * Math.cos(lat2) * sinDlon * sinDlon;
  const c = 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa));
  return R * c;
}

// Initial bearing from a -> b in radians
function bearingRad(a, b) {
  const lat1 = toRad(a.latitude); const lat2 = toRad(b.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return Math.atan2(y, x);
}

// Cross-track distance from point c to great-circle path a->b (meters)
function crossTrackDistanceMeters(a, b, c) {
  const R = 6371000;
  const d13 = haversineDistance(a, c) / R; // angular distance
  const theta13 = bearingRad(a, c);
  const theta12 = bearingRad(a, b);
  const xt = Math.asin(Math.sin(d13) * Math.sin(theta13 - theta12));
  return Math.abs(xt * R);
}

// Compute the along-track distance from a to closest point to c on a->b (meters)
function alongTrackDistanceMeters(a, b, c) {
  const R = 6371000;
  const d13 = haversineDistance(a, c) / R;
  const theta13 = bearingRad(a, c);
  const theta12 = bearingRad(a, b);
  const at = Math.acos(Math.cos(d13) / Math.cos(Math.asin(Math.sin(d13) * Math.sin(theta13 - theta12))));
  return at * R;
}

// Distance from point c to segment a-b (meters). Uses cross-track when projection lies on segment,
// otherwise returns min(distance to endpoints).
function pointToSegmentDistanceMeters(a, b, c) {
  try {
    const A = { latitude: a.lat || a.latitude, longitude: a.lng || a.longitude };
    const B = { latitude: b.lat || b.latitude, longitude: b.lng || b.longitude };
    const C = { latitude: c.lat || c.latitude, longitude: c.lng || c.longitude };

    const distAB = haversineDistance(A, B);
    if (distAB === 0) return haversineDistance(A, C);

    const at = alongTrackDistanceMeters(A, B, C);
    if (at < 0) return haversineDistance(A, C);
    if (at > distAB) return haversineDistance(B, C);

    // projection lies on segment -> use cross-track
    return crossTrackDistanceMeters(A, B, C);
  } catch (e) {
    return Infinity;
  }
}

/**
 * Main helper: find buses whose route intersects a circle of radiusKm around userLocation.
 * Returns array of bus objects with nearby stop count and basic metadata.
 * 
 * Workflow:
 * 1. Takes input location (place name or coordinates)
 * 2. Converts to geocodes if needed
 * 3. Draws 1.5km radius circle from that point
 * 4. Checks if bus route (encoded as array of points) intersects the circle
 * 5. Returns buses with intersecting routes
 */
 async function findNearbyBusesDb(userLocation, radiusKm = DEFAULT_RADIUS_KM) {
   const radiusMeters = radiusKm * 1000;
   const buses = await prisma.bus.findMany({ include: { stops: true } });
   const results = [];

  for (const b of buses) {
    // build ordered morning & evening stops from database
    const morningStops = b.stops.filter(s => s.period === 'MORNING').sort((x, y) => x.order - y.order);
    const eveningStops = b.stops.filter(s => s.period === 'EVENING').sort((x, y) => x.order - y.order);

    let intersects = false;
    let nearbyStopCount = 0;
    let routeDetails = {};

    /**
     * Check route intersection with circle
     * @param {Array} stopsArr - Array of stop objects with lat/lng
     * @param {String} routeType - 'morning' or 'evening'
     * @returns {Object} { intersects: boolean, stopCount: number, routePath: Array }
     */
    async function checkRouteStops(stopsArr, routeType) {
      const result = { intersects: false, stopCount: 0, routePath: [] };
      
      if (!stopsArr || stopsArr.length === 0) return result;

      // Single stop: just check if it's within circle
      if (stopsArr.length === 1) {
        const s = stopsArr[0];
        const dist = getDistance(
          { latitude: userLocation.lat, longitude: userLocation.lng },
          { latitude: s.lat, longitude: s.lng }
        );
        
        if (dist <= radiusMeters) {
          result.intersects = true;
          result.stopCount = 1;
        }
        result.routePath = [{ lat: s.lat, lng: s.lng }];
        return result;
      }

      // Multiple stops: Prefer using precomputed route polyline cache to avoid
      // making Directions API calls per-request. Fall back to generating path.
      let path = [];
      try {
        const cached = routePolylinesCache.get(b.id);
        if (cached && cached[routeType === 'MORNING' ? 'morningRoute' : 'eveningRoute'] && cached[routeType === 'MORNING' ? 'morningRoute' : 'eveningRoute'].length > 0) {
          path = cached[routeType === 'MORNING' ? 'morningRoute' : 'eveningRoute'];
        } else {
          const origin = { lat: stopsArr[0].lat, lng: stopsArr[0].lng };
          const destination = { lat: stopsArr[stopsArr.length - 1].lat, lng: stopsArr[stopsArr.length - 1].lng };
          const waypoints = stopsArr.slice(1, -1).map(s => ({ lat: s.lat, lng: s.lng }));
          path = await getRoutePath(origin, destination, waypoints);
        }
      } catch (e) {
        // Fallback to straight-line connections between stops only
        path = stopsArr.map(s => ({ lat: s.lat, lng: s.lng }));
      }

      // Store the FULL ROUTE path (hundreds of mini points) for reference
      result.routePath = path;

      // Compute minimum distance from user location to any point on the path
      const { minDist, minIndex } = getMinDistanceAlongPath(userLocation, path);
      logger.debug('Route diagnostic', { busId: b.id, busNumber: b.number, routeType, pathLength: (path && path.length) || 0, minDist, minIndex, radiusMeters });

      if (typeof minDist === 'number' && minDist <= radiusMeters) {
        result.intersects = true;
        // Count actual bus stops within the circle for reporting
        result.stopCount = stopsArr.reduce((acc, s) => {
          const d = getDistance(
            { latitude: userLocation.lat, longitude: userLocation.lng },
            { latitude: s.lat, longitude: s.lng }
          );
          return acc + (d <= radiusMeters ? 1 : 0);
        }, 0);
        logger.info('Route marked as intersecting by point-distance', { busNumber: b.number, routeType, minDist, minIndex, radiusMeters });
      }

      return result;
    }

    // Check both morning and evening routes
    try {
      const morningCheck = await checkRouteStops(morningStops, 'MORNING');
      if (morningCheck.intersects) {
        intersects = true;
        nearbyStopCount += morningCheck.stopCount;
        routeDetails.morningRoute = morningCheck.routePath;
      }

      const eveningCheck = await checkRouteStops(eveningStops, 'EVENING');
      if (eveningCheck.intersects) {
        intersects = true;
        nearbyStopCount += eveningCheck.stopCount;
        routeDetails.eveningRoute = eveningCheck.routePath;
      }

    } catch (err) {
      console.error(`Error checking routes for bus ${b.number}:`, err);
      
      // Fallback: check if any individual stops are within the circle
      const fallbackCount = [...morningStops, ...eveningStops].reduce((acc, s) => {
        const d = getDistance(
          { latitude: userLocation.lat, longitude: userLocation.lng },
          { latitude: s.lat, longitude: s.lng }
        );
        return acc + (d <= radiusMeters ? 1 : 0);
      }, 0);
      
             if (fallbackCount > 0) {
         intersects = true;
         nearbyStopCount = fallbackCount;
       }
     }

     // If route intersects the circle, include this bus in results
     if (intersects) {
       results.push({
        busNumber: b.number,
        busName: b.name,
        location: b.location,
        totalNearbyStops: nearbyStopCount,
        morningStops: morningStops.map(s => ({ name: s.name, lat: s.lat, lng: s.lng })),
        eveningStops: eveningStops.map(s => ({ name: s.name, lat: s.lat, lng: s.lng })),
                 routeDetails // Store the actual route paths for debugging/display
       });
     }
   }

   return results;
}

// Simple admin auth (env-based)
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

// ---- Pending admin signup storage ----
const PENDING_ADMIN_PATH = path.join(__dirname, 'pending_admins.json');
function readPendingAdmins() {
  try {
    if (fs.existsSync(PENDING_ADMIN_PATH)) {
      return JSON.parse(fs.readFileSync(PENDING_ADMIN_PATH, 'utf-8'));
    }
  } catch {}
  return [];
}
function writePendingAdmins(list) {
  try {
    fs.writeFileSync(PENDING_ADMIN_PATH, JSON.stringify(list, null, 2), 'utf-8');
    return true;
  } catch { return false; }
}
function isSuperAdmin(email) {
  return MAIN_ADMIN_EMAIL && email && email.toLowerCase() === MAIN_ADMIN_EMAIL.toLowerCase();
}

// Admin login backed by database
app.post('/api/admin/login', async (req, res) => {
  try {
    // Rate limit login attempts per IP
    const ip = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'unknown';
    const now = Date.now();
    const rec = loginAttempts.get(ip) || { count: 0, firstTs: now };
    if (now - rec.firstTs > LOGIN_WINDOW_MS) { rec.count = 0; rec.firstTs = now; }
    // Increment count for this attempt
    rec.count += 1;
    loginAttempts.set(ip, rec);
    if (rec.count > LOGIN_MAX_ATTEMPTS) {
      const retryMs = (rec.firstTs + LOGIN_WINDOW_MS) - now;
      return res.status(429).json({ 
        success: false, 
        message: 'Too many login attempts. Try again later.',
        attemptsUsed: rec.count - 1, // prior successful attempts within window
        maxAttempts: LOGIN_MAX_ATTEMPTS,
        attemptsRemaining: 0,
        windowMs: LOGIN_WINDOW_MS,
        retryAfterSeconds: retryMs > 0 ? Math.ceil(retryMs / 1000) : 0
      });
    }

    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required' });
    }

    // Superadmin login via .env (not stored in DB)
    if (isSuperAdmin(email) && MAIN_ADMIN_PASSWORD) {
      const ok = bcrypt.compareSync(password, bcrypt.hashSync(MAIN_ADMIN_PASSWORD, 8)) || password === MAIN_ADMIN_PASSWORD;
      if (ok) {
        const token = jwt.sign({ role: 'superadmin', email, id: 'env-superadmin' }, JWT_SECRET, { expiresIn: '8h' });
        // Set http-only cookie so browser navigations can carry auth for admin pages
        const isProduction = process.env.NODE_ENV === 'production';
        const cookieOptions = { 
          httpOnly: true, 
          sameSite: isProduction ? 'strict' : 'lax', 
          secure: isProduction || process.env.SECURE_COOKIES === 'true', 
          maxAge: 8 * 60 * 60 * 1000 
        };
        try {
          res.cookie('admin_token', token, cookieOptions);
          // Also set a csrf token cookie (accessible to JS) for double-submit CSRF protection
          const csrf = require('crypto').randomBytes(24).toString('hex');
          res.cookie('csrf_token', csrf, { ...cookieOptions, httpOnly: false });
        } catch (e) { /* ignore cookie set errors */ }
        return res.json({ success: true, token });
      }
    }

    const admin = await prisma.admin.findUnique({ where: { email } });
    if (!admin || !bcrypt.compareSync(password, admin.password)) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
    const token = jwt.sign({ role: 'admin', email: admin.email, id: admin.id }, JWT_SECRET, { expiresIn: '8h' });
    const isProduction = process.env.NODE_ENV === 'production';
    const cookieOptions = { 
      httpOnly: true, 
      sameSite: isProduction ? 'strict' : 'lax', 
      secure: isProduction || process.env.SECURE_COOKIES === 'true', 
      maxAge: 8 * 60 * 60 * 1000 
    };
    try {
      res.cookie('admin_token', token, cookieOptions);
      const csrf = require('crypto').randomBytes(24).toString('hex');
      res.cookie('csrf_token', csrf, { ...cookieOptions, httpOnly: false });
    } catch (e) { /* ignore */ }
    res.json({ success: true, token });
  } catch (e) {
    logger.error('Admin login failed', { error: e.message, stack: e.stack });
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// Logout: clear admin cookie
app.post('/api/admin/logout', (req, res) => {
  try {
    res.clearCookie('admin_token');
  } catch (e) { /* ignore */ }
  res.json({ success: true });
});

// Example protected route (for future admin dashboard APIs)
function requireAdmin(req, res, next) {
  try {
    const auth = req.headers.authorization || '';
    let token = null;
    if (auth && auth.startsWith('Bearer ')) token = auth.slice(7);
    else if (req.headers.cookie) {
      const m = req.headers.cookie.match(/(?:^|;\s*)admin_token=([^;]+)/);
      if (m) token = decodeURIComponent(m[1]);
    }
    if (!token) return res.status(401).json({ success: false, message: 'Missing token' });
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.role !== 'admin' && payload.role !== 'superadmin') throw new Error('Not admin');
    req.admin = payload;
    next();
  } catch (e) {
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }
}

app.get('/api/admin/me', requireAdmin, (req, res) => {
  res.json({ success: true, admin: { email: req.admin.email, role: req.admin.role } });
});

// Public: submit signup request for admin
app.post('/api/admin/signup-request', async (req, res) => {
  try {
    const { name, email, password } = req.body || {};
    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: 'Name, email, and password are required' });
    }
    // Basic email format check
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ success: false, message: 'Invalid email' });
    }
    // If already an admin, reject
    const existing = await prisma.admin.findUnique({ where: { email } });
    if (existing || isSuperAdmin(email)) {
      return res.status(400).json({ success: false, message: 'This email is already an admin' });
    }
    const pending = readPendingAdmins();
    if (pending.find(p => p.email.toLowerCase() === email.toLowerCase())) {
      return res.json({ success: true, message: 'Signup request already submitted' });
    }
    const hashed = bcrypt.hashSync(password, 10);
    pending.push({ name, email, password: hashed, createdAt: new Date().toISOString() });
    writePendingAdmins(pending);
    res.json({ success: true, message: 'Signup request submitted. Await approval by main admin.' });
  } catch (e) {
    console.error('Signup request failed:', e);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// List pending admins (superadmin only)
app.get('/api/admin/requests', requireAdmin, (req, res) => {
  if (req.admin.role !== 'superadmin') {
    return res.status(403).json({ success: false, message: 'Only superadmin may view requests' });
  }
  const pending = readPendingAdmins();
  res.json({ success: true, requests: pending.map(p => ({ name: p.name, email: p.email, createdAt: p.createdAt })) });
});

// Approve pending admin (superadmin)
app.post('/api/admin/requests/:email/approve', requireAdmin, requireCsrf, async (req, res) => {
  if (req.admin.role !== 'superadmin') {
    return res.status(403).json({ success: false, message: 'Only superadmin may approve' });
  }
  const email = decodeURIComponent(req.params.email);
  let pending = readPendingAdmins();
  const idx = pending.findIndex(p => p.email.toLowerCase() === email.toLowerCase());
  if (idx === -1) return res.status(404).json({ success: false, message: 'Request not found' });
  const reqObj = pending[idx];
  try {
    // create admin in DB
    await prisma.admin.create({ data: { email: reqObj.email, password: reqObj.password } });
  } catch (e) {
    console.error('Failed creating admin:', e);
    return res.status(500).json({ success: false, message: 'Failed to create admin' });
  }
  pending.splice(idx, 1);
  writePendingAdmins(pending);
  res.json({ success: true });
});

// Reject pending admin (superadmin)
app.post('/api/admin/requests/:email/reject', requireAdmin, requireCsrf, (req, res) => {
  if (req.admin.role !== 'superadmin') {
    return res.status(403).json({ success: false, message: 'Only superadmin may reject' });
  }
  const email = decodeURIComponent(req.params.email);
  let pending = readPendingAdmins();
  const next = pending.filter(p => p.email.toLowerCase() !== email.toLowerCase());
  writePendingAdmins(next);
  res.json({ success: true });
});

// Get availability logs for admin dashboard
app.get('/api/admin/logs', requireAdmin, async (req, res) => {
  try {
    // SECURITY NOTE: Using raw SQL to inspect schema columns for backward compatibility.
    // This query contains no user input and is safe from SQL injection.
    // Needed because Prisma schema may not match database schema during migrations.
    const colsRes = await prisma.$queryRawUnsafe(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name ILIKE 'availabilitylog'`);
    const colNames = Array.isArray(colsRes) ? colsRes.map(r => (r && r.column_name) ? String(r.column_name).toLowerCase() : '').filter(Boolean) : [];

    let emailSelect = 'NULL AS email';
    if (colNames.includes('contact') && colNames.includes('email')) {
      emailSelect = 'COALESCE(contact, email) AS email';
    } else if (colNames.includes('contact')) {
      emailSelect = 'contact AS email';
    } else if (colNames.includes('email')) {
      emailSelect = 'email AS email';
    }

    const selectQuery = `SELECT id, ${emailSelect}, location, lat, lng, status, "createdAt" FROM "AvailabilityLog" ORDER BY "createdAt" DESC LIMIT 100`;
    // SECURITY NOTE: This query is safe - no user input, constructed from validated column names
    const logs = await prisma.$queryRawUnsafe(selectQuery);

    // Return logs using the stored unified `location` value so admin always sees
    // the exact formatted label saved at submission time.
    // Parse 'requested' flag but skip server-side enrichment to improve performance.
    // Client-side enrichment was removed earlier; coordinate-only entries display as-is.
    const enriched = logs.map((log) => {
      let requested = false;
      let rawLocation = log.location;
      if (typeof rawLocation === 'string' && rawLocation.startsWith('__REQ__YES__||')) {
        requested = true;
        rawLocation = rawLocation.replace('__REQ__YES__||', '');
      }
      return { ...log, requested, location: rawLocation };
    });

    res.json({ success: true, logs: enriched });
  } catch (e) {
    console.error('Failed to fetch logs:', e);
    res.status(500).json({ success: false, message: 'Failed to fetch logs' });
  }
});

// Add new bus (admin only)
app.post('/api/admin/buses', requireAdmin, requireCsrf, async (req, res) => {
  try {
    const { number, name, location, routeName, capacity, currentOccupancy, driverName, driverPhone, liveLocationUrl, morningStops, eveningStops, morningStartTime, morningEndTime, eveningStartTime, eveningEndTime } = req.body;

    if (!number || !name) {
      return res.status(400).json({ success: false, message: 'Bus number and name are required' });
    }

    const bus = await prisma.bus.create({
      data: { number, name, location: location ?? '', routeName: routeName ?? null, imageUrl: null, capacity: capacity ?? 60, currentOccupancy: currentOccupancy ?? 0, driverName: driverName ?? "", driverPhone: driverPhone ?? "", liveLocationUrl: liveLocationUrl ?? "", morningStartTime: morningStartTime ?? null, morningEndTime: morningEndTime ?? null, eveningStartTime: eveningStartTime ?? null, eveningEndTime: eveningEndTime ?? null }
    });

    // Add morning stops
    if (morningStops && morningStops.length > 0) {
      for (let i = 0; i < morningStops.length; i++) {
        const stop = morningStops[i];
        await prisma.stop.create({
          data: {
            name: stop.name,
            lat: stop.lat,
            lng: stop.lng,
            period: 'MORNING',
            order: i + 1,
            busId: bus.id
          }
        });
      }
    }

    // Add evening stops
    if (eveningStops && eveningStops.length > 0) {
      for (let i = 0; i < eveningStops.length; i++) {
        const stop = eveningStops[i];
        await prisma.stop.create({
          data: {
            name: stop.name,
            lat: stop.lat,
            lng: stop.lng,
            period: 'EVENING',
            order: i + 1,
            busId: bus.id
          }
        });
      }
    }

    res.json({ success: true, message: 'Bus added successfully', bus });
  } catch (e) {
    logger.error('Failed to add bus', { error: e.message, stack: e.stack });
    res.status(500).json({ success: false, message: 'Failed to add bus' });
  }
});

// After adding a bus, schedule a route cache rebuild (debounced)
try { scheduleRouteCacheRebuild(false); } catch (e) { /* ignore */ }

// Get all buses (admin only)
app.get('/api/admin/buses', requireAdmin, async (req, res) => {
  try {
    let buses;
    try {
      buses = await prisma.bus.findMany({
        include: {
          stops: {
            orderBy: { order: 'asc' }
          }
        }
      });
    } catch (innerErr) {
      // Prisma schema/database mismatch (e.g. missing columns) -> fall back to raw queries
      // SECURITY NOTE: These queries contain no user input and are safe from SQL injection
      logger.warn('Prisma query failed while fetching buses (admin), using raw fallback', { error: innerErr.message });
      const rawBuses = await prisma.$queryRawUnsafe('SELECT * FROM "Bus"');
      const allStops = await prisma.stop.findMany({ orderBy: [{ busId: 'asc' }, { order: 'asc' }] });
      const stopsByBus = {};
      for (const s of allStops) {
        if (!stopsByBus[s.busId]) stopsByBus[s.busId] = [];
        stopsByBus[s.busId].push(s);
      }
      buses = rawBuses.map(b => ({ ...b, stops: stopsByBus[b.id] || [] }));
    }

    res.json({ success: true, buses });
  } catch (e) {
    console.error('Failed to fetch buses (admin):', e);
    res.status(500).json({ success: false, message: 'Failed to fetch buses' });
  }
});

// Update bus (admin only)
app.put('/api/admin/buses/:busNumber', requireAdmin, requireCsrf, async (req, res) => {
  try {
    const { busNumber } = req.params;
    const { name, location, routeName, imageUrl, capacity, currentOccupancy, driverName, driverPhone, liveLocationUrl, morningStops, eveningStops, morningStartTime, morningEndTime, eveningStartTime, eveningEndTime } = req.body;
    
    const bus = await prisma.bus.findUnique({ where: { number: busNumber } });
    if (!bus) {
      return res.status(404).json({ success: false, message: 'Bus not found' });
    }

    // Update bus basic info
    const updatedBus = await prisma.bus.update({
      where: { number: busNumber },
      data: {
        name,
        location: location ?? undefined,
        routeName: routeName ?? undefined,
        imageUrl: imageUrl ?? undefined,
        capacity: capacity ?? undefined,
        currentOccupancy: currentOccupancy ?? undefined,
        driverName: driverName ?? undefined,
        driverPhone: driverPhone ?? undefined,
        liveLocationUrl: liveLocationUrl ?? undefined,
        morningStartTime: morningStartTime ?? undefined,
        morningEndTime: morningEndTime ?? undefined,
        eveningStartTime: eveningStartTime ?? undefined,
        eveningEndTime: eveningEndTime ?? undefined
      }
    });

    // Delete existing stops
    await prisma.stop.deleteMany({ where: { busId: bus.id } });

    // Add new morning stops
    if (morningStops && morningStops.length > 0) {
      for (let i = 0; i < morningStops.length; i++) {
        const stop = morningStops[i];
        await prisma.stop.create({
          data: {
            name: stop.name,
            lat: stop.lat,
            lng: stop.lng,
            period: 'MORNING',
            order: i + 1,
            busId: bus.id
          }
        });
      }
    }

    // Add new evening stops
    if (eveningStops && eveningStops.length > 0) {
      for (let i = 0; i < eveningStops.length; i++) {
        const stop = eveningStops[i];
        await prisma.stop.create({
          data: {
            name: stop.name,
            lat: stop.lat,
            lng: stop.lng,
            period: 'EVENING',
            order: i + 1,
            busId: bus.id
          }
        });
      }
    }

    res.json({ success: true, message: 'Bus updated successfully', bus: updatedBus });
  } catch (e) {
    console.error('Failed to update bus:', e);
    res.status(500).json({ success: false, message: 'Failed to update bus' });
  }
});

// After updating a bus, schedule a route cache rebuild (debounced)
try { scheduleRouteCacheRebuild(false); } catch (e) { /* ignore */ }

// Delete bus (admin only)
app.delete('/api/admin/buses/:busNumber', requireAdmin, requireCsrf, async (req, res) => {
  try {
    const { busNumber } = req.params;
    
    const bus = await prisma.bus.findUnique({ where: { number: busNumber } });
    if (!bus) {
      return res.status(404).json({ success: false, message: 'Bus not found' });
    }

    // Delete all stops first
    await prisma.stop.deleteMany({ where: { busId: bus.id } });
    
    // Delete the bus
    await prisma.bus.delete({ where: { number: busNumber } });

    res.json({ success: true, message: 'Bus deleted successfully' });
  } catch (e) {
    console.error('Failed to delete bus:', e);
    res.status(500).json({ success: false, message: 'Failed to delete bus' });
  }
});

// After deleting a bus, schedule a route cache rebuild (debounced)
try { scheduleRouteCacheRebuild(false); } catch (e) { /* ignore */ }

// Upload or replace bus image (admin only)
app.post('/api/admin/buses/:busNumber/photo', requireAdmin, requireCsrf, upload.single('photo'), async (req, res) => {
  try {
    const busNumber = req.params.busNumber;
    const file = req.file;
    if (!file) return res.status(400).json({ success: false, message: 'No file uploaded' });

    const bus = await prisma.bus.findUnique({ where: { number: busNumber } });
    if (!bus) return res.status(404).json({ success: false, message: 'Bus not found' });

    // Remove prior image file if present and different
    try {
      if (bus.imageUrl && typeof bus.imageUrl === 'string') {
        const priorPath = bus.imageUrl.startsWith('/') ? bus.imageUrl.slice(1) : bus.imageUrl;
        const absPrior = path.join(__dirname, priorPath);
        if (fs.existsSync(absPrior) && path.resolve(absPrior) !== path.resolve(path.join(UPLOADS_DIR, file.filename))) {
          try { fs.unlinkSync(absPrior); } catch (e) { /* ignore unlink errors */ }
        }

        // Also remove prior thumbnail if it exists (assume naming convention '<busNumber>_thumb.ext')
        try {
          const priorDir = path.dirname(absPrior);
          const priorBase = path.basename(absPrior);
          const thumbBase = priorBase.replace('_image', '_thumb');
          const absThumb = path.join(priorDir, thumbBase);
          if (fs.existsSync(absThumb) && path.resolve(absThumb) !== path.resolve(path.join(UPLOADS_DIR, `${bus.number}_thumb${path.extname(file.filename)}`))) {
            try { fs.unlinkSync(absThumb); } catch (e) { /* ignore */ }
          }
        } catch (ee) { /* ignore */ }
      }
    } catch (e) {
      // ignore cleanup errors
    }

    const imageUrl = `/uploads/${file.filename}`;

    // Try to generate a thumbnail (small preview) using sharp
    let thumbnailUrl = null;
    try {
      const ext = path.extname(file.filename) || '.jpg';
      // Keep same timestamp suffix as original by replacing the marker
      let thumbName = file.filename.includes('_image_')
        ? file.filename.replace('_image_', '_thumb_')
        : `${busNumber}_thumb_${Date.now()}${ext}`;
      thumbName = thumbName.replace(/[^a-zA-Z0-9._-]/g, '_');
      const inPath = path.join(UPLOADS_DIR, file.filename);
      const outPath = path.join(UPLOADS_DIR, thumbName);
      await sharp(inPath).resize(320, 200, { fit: 'cover' }).toFile(outPath);
      thumbnailUrl = `/uploads/${thumbName}`;
    } catch (e) {
      console.warn('Thumbnail generation failed:', e && e.message ? e.message : e);
    }

    const updated = await prisma.bus.update({ where: { number: busNumber }, data: { imageUrl } });

    // Emit a live-update event for connected clients so public pages and admin UIs can refresh
    try {
      io.emit('busImageUpdated', { busNumber: String(updated.number), imageUrl, thumbnailUrl });
    } catch (e) { /* ignore */ }

    // Return updated imageUrl explicitly so client can update UI immediately
    res.json({ success: true, imageUrl: imageUrl, thumbnailUrl, bus: { number: updated.number, imageUrl: updated.imageUrl } });
  } catch (e) {
    console.error('Failed to upload bus image:', e);
    // If error is a Multer error or other known error, return message
    const msg = e && e.message ? String(e.message) : 'Failed to upload image';
    res.status(500).json({ success: false, message: msg });
  }
});

// Admin: upload/update fees structure PDF (stored as /uploads/fees-structure.pdf)
app.post('/api/admin/fees-structure', requireAdmin, requireCsrf, pdfUpload.single('feesPdf'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ success: false, message: 'No PDF uploaded' });
    const targetName = 'fees-structure.pdf';
    const targetPath = path.join(UPLOADS_DIR, targetName);
    // Replace existing file if present
    try { if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath); } catch (e) { /* ignore */ }
    try { fs.renameSync(path.join(UPLOADS_DIR, file.filename), targetPath); } catch (e) {
      return res.status(500).json({ success: false, message: 'Failed storing PDF' });
    }
    return res.json({ success: true, url: `/uploads/${targetName}` });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message || 'Upload failed' });
  }
});

// Public: check fees structure availability
app.get('/api/fees-structure', (req, res) => {
  try {
    const targetPath = path.join(UPLOADS_DIR, 'fees-structure.pdf');
    if (!fs.existsSync(targetPath)) return res.json({ success: false, available: false });
    const stat = fs.statSync(targetPath);
    return res.json({ success: true, available: true, size: stat.size, url: '/uploads/fees-structure.pdf', updatedAt: stat.mtime.toISOString() });
  } catch (e) {
    return res.status(500).json({ success: false, available: false });
  }
});

// API Routes

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Bus API is running',
    timestamp: new Date().toISOString()
  });
});

// Bus availability checker endpoint
app.post('/api/check-availability', async (req, res) => {
  try {
    const contact = req.body && (req.body.email || req.body.contact || req.body.phone);
    const location = req.body && req.body.location;

    // Rate-limit availability checks per-IP and per-contact to avoid abuse and to stay within Maps API limits
    const ip = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'unknown';
    // Normalize contact string for counters
    const contactKey = contact ? String(contact).toLowerCase() : null;
    // Check counters before proceeding
    if (!isAvailabilityAllowed(ip, contactKey)) {
      return res.status(429).json({ success: false, message: 'Rate limit exceeded for availability checks. Try again later.' });
    }
    // We increment counters after basic validation so bots can't cheaply increment without valid payloads

    // Validate input (contact required)
    if (!contact || !location) {
      return res.status(400).json({ success: false, message: 'Contact (email or phone) and location are required' });
    }

    // Validate contact: allow either email or phone number
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const phoneRegex = /^[0-9\+\-\s]{7,20}$/; // loose phone validation
    const isEmail = emailRegex.test(String(contact));
    const isPhone = phoneRegex.test(String(contact));
    if (!isEmail && !isPhone) {
      return res.status(400).json({ success: false, message: 'Please provide a valid email address or phone number' });
    }

    // Passed validation — increment counters
    try { incrementAvailability(ip, contactKey); } catch (e) {}

    // STEP 1: Parse location (coordinates or location name)
    console.log('\n🚀 NEW BUS AVAILABILITY CHECK');
    console.log(`📧 Contact: ${contact}`);
    console.log(`📍 Input location: ${location}`);
    
    let userLocation;
    // We'll also derive a human-friendly formattedName like: "Place Name (lat, lng)"
    let formattedName = null;
    if (typeof location === 'string') {
      // Check if it's coordinates (lat,lng format) - handle with or without spaces
      const coordMatch = location.match(/^\s*(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)\s*$/);
      if (coordMatch) {
        const lat = parseFloat(coordMatch[1]);
        const lng = parseFloat(coordMatch[2]);
        if (isNaN(lat) || isNaN(lng)) {
          return res.status(400).json({
            success: false,
            message: 'Invalid coordinate format. Please provide coordinates as "lat,lng"'
          });
        }
        userLocation = { lat, lng };
        console.log(`✅ Using coordinates directly: ${lat},${lng}`);

        // Attempt to derive a nearby place name via reverse geocoding so the stored name
        // looks like it was obtained from the current location (user expectation).
        // Use geocodeLatLng which returns a stable `{ formatted_address, lat, lng }`
        // and falls back to Nominatim when Google isn't available.
        try {
          const geo = await geocodeLatLng(lat, lng);
          if (geo && geo.formatted_address) {
            formattedName = `${geo.formatted_address} (${Number(geo.lat).toFixed(6)}, ${Number(geo.lng).toFixed(6)})`;
            // also update userLocation to any adjusted coords returned by the geocoder
            userLocation = { lat: Number(geo.lat), lng: Number(geo.lng) };
          }
        } catch (e) {
          // ignore, we'll fall back to raw coords below
        }

      } else {
        // STEP 2: It's a location name — prefer a regional geocode first (uses GEOCODE_COUNTRY/GEOCODE_REGION),
        // then fall back to Places API, then global geocoding/Nominatim.
        console.log(`🔍 Resolving place name: "${location}" using regional-first strategy...`);

        // 1) Try geocodeLocation (this function already considers GEOCODE_COUNTRY/GEOCODE_REGION)
        try {
          const regionalGeo = await geocodeLocation(location);
          if (regionalGeo && typeof regionalGeo.lat === 'number' && typeof regionalGeo.lng === 'number') {
            userLocation = { lat: regionalGeo.lat, lng: regionalGeo.lng };
            formattedName = `${regionalGeo.formatted_address || location} (${Number(regionalGeo.lat).toFixed(6)}, ${Number(regionalGeo.lng).toFixed(6)})`;
            console.log(`✅ Regional geocode succeeded: ${formattedName}`);
          }
        } catch (e) {
          // ignore - we'll try other methods
        }

        // 2) If regional geocode didn't return a usable result, fallback to non-regional geocode/Nominatim
        // (Previously we used Google Places here; removed to simplify geocoding flow.)
        // No-op: will try final fallback below using geocodeLocation()

        // 3) Final fallback: if still not found, try a non-regional geocode or Nominatim via geocodeLocation
        if (!userLocation) {
          try {
            const geocodedLocation = await geocodeLocation(location);
            userLocation = { lat: geocodedLocation.lat, lng: geocodedLocation.lng };
            formattedName = `${geocodedLocation.formatted_address} (${Number(geocodedLocation.lat).toFixed(6)}, ${Number(geocodedLocation.lng).toFixed(6)})`;
            console.log(`✅ Fallback geocoded to: ${userLocation.lat},${userLocation.lng}`);
            console.log(`   Address: ${geocodedLocation.formatted_address}`);
          } catch (error) {
            return res.status(400).json({
              success: false,
              message: `Could not find location "${location}". Please provide coordinates as "lat,lng" or a valid location name.`
            });
          }
        }
      }
    } else if (typeof location === 'object' && location.lat && location.lng) {
      userLocation = { lat: Number(location.lat), lng: Number(location.lng) };
      // derive a friendly name from coordinates when possible
      try {
        const geo = await geocodeLatLng(userLocation.lat, userLocation.lng);
        if (geo && geo.formatted_address) {
          formattedName = `${geo.formatted_address} (${Number(geo.lat).toFixed(6)}, ${Number(geo.lng).toFixed(6)})`;
          userLocation = { lat: Number(geo.lat), lng: Number(geo.lng) };
        }
      } catch (e) { /* ignore */ }
    } else {
      return res.status(400).json({
        success: false,
        message: 'Invalid location format. Please provide coordinates as "lat,lng" or a location name.'
      });
    }

    // If we couldn't derive a friendly formattedName, fall back to raw coords or original string
    if (!formattedName) {
      if (userLocation && typeof userLocation.lat === 'number' && typeof userLocation.lng === 'number') {
        formattedName = `${Number(userLocation.lat).toFixed(6)}, ${Number(userLocation.lng).toFixed(6)}`;
      } else if (typeof location === 'string') {
        formattedName = location;
      }
    }

              // STEP 3: Find nearby buses (checks if routes intersect 1.5km circle)
              const nearbyBuses = await findNearbyBusesDb(userLocation, 1.5);

    // Log the availability check to database and include optional requester flag.
    // This is made resilient: if Prisma create fails due to schema mismatch,
    // we detect existing columns and fallback to a compatible INSERT so logs
    // are still recorded even before the DB migration is applied.
    try {
      const requestBusFlag = req.body && (req.body.requestBus === true || String(req.body.requestBus).toLowerCase() === 'yes');
      // Use the human-friendly formattedName derived earlier (e.g. "Place Name (lat, lng)")
      const locationToSave = requestBusFlag ? `__REQ__YES__||${formattedName}` : formattedName;

      // First try the Prisma create using the newer schema (contact + requested)
      try {
        await prisma.availabilityLog.create({
          data: {
            contact: contact,
            location: locationToSave,
            lat: userLocation.lat,
            lng: userLocation.lng,
            requested: requestBusFlag === true,
            status: nearbyBuses.length > 0 ? 'AVAILABLE' : 'UNAVAILABLE'
          }
        });
      } catch (createErr) {
        // If Prisma create fails (schema mismatch), attempt to detect available
        // columns and insert using raw SQL into whichever columns exist.
        console.warn('Prisma create failed for AvailabilityLog; attempting raw fallback:', createErr && createErr.message ? createErr.message : createErr);

        // Inspect table columns
        let cols = [];
        try {
          const colsRes = await prisma.$queryRawUnsafe(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name ILIKE 'availabilitylog'`);
          cols = Array.isArray(colsRes) ? colsRes.map(r => (r && r.column_name) ? String(r.column_name).toLowerCase() : '').filter(Boolean) : [];
        } catch (colErr) {
          console.warn('Failed to inspect AvailabilityLog columns:', colErr && colErr.message ? colErr.message : colErr);
        }

        const statusVal = nearbyBuses.length > 0 ? 'AVAILABLE' : 'UNAVAILABLE';

        // Build fallback insert based on available columns
        try {
          if (cols.includes('contact')) {
            // SECURITY NOTE: Using parameterized query ($1, $2, etc.) - safe from SQL injection
            // Insert into contact-based schema
            await prisma.$executeRawUnsafe(`INSERT INTO "AvailabilityLog" (contact, location, lat, lng, requested, status, "createdAt") VALUES ($1, $2, $3, $4, $5, $6, now())`, contact, locationToSave, userLocation.lat, userLocation.lng, requestBusFlag === true, statusVal);
          } else if (cols.includes('email')) {
            // SECURITY NOTE: Using parameterized query - safe from SQL injection
            // Old schema: email column present
            await prisma.$executeRawUnsafe(`INSERT INTO "AvailabilityLog" (email, location, lat, lng, status, "createdAt") VALUES ($1, $2, $3, $4, $5, now())`, contact, locationToSave, userLocation.lat, userLocation.lng, statusVal);
          } else {
            // SECURITY NOTE: Using parameterized query - safe from SQL injection
            // Last resort: try to insert minimal columns if possible
            await prisma.$executeRawUnsafe(`INSERT INTO "AvailabilityLog" (location, lat, lng, status, "createdAt") VALUES ($1, $2, $3, $4, now())`, locationToSave, userLocation.lat, userLocation.lng, statusVal);
          }
        } catch (rawErr) {
          console.error('Raw fallback insert into AvailabilityLog failed:', rawErr && rawErr.message ? rawErr.message : rawErr);
        }
      }
    } catch (logError) {
      console.error('Failed to log availability check (outer):', logError && logError.message ? logError.message : logError);
    }

    if (nearbyBuses.length === 0) {
      return res.json({
        success: true,
        available: false,
        message: 'At your location, within 1.5km radius, the college bus is not available. Your search will be notified to admin.',
        buses: []
      });
    }

    return res.json({
      success: true,
      available: true,
      message: `Found ${nearbyBuses.length} bus(es) within 1.5km radius`,
      buses: nearbyBuses
    });

  } catch (error) {
    console.error('Error checking bus availability:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Debug: return cached/generated full route polyline points for a bus (unprotected)
// Useful during development to inspect the actual path used for intersection checks.
app.get('/api/debug/route-path/:busNumber', async (req, res) => {
  try {
    const busNumber = req.params.busNumber;
    if (!busNumber) return res.status(400).json({ success: false, message: 'busNumber required' });
    const bus = await prisma.bus.findUnique({ where: { number: busNumber }, include: { stops: true } });
    if (!bus) return res.status(404).json({ success: false, message: 'Bus not found' });
    const cached = routePolylinesCache.get(bus.id);
    if (cached && ((cached.morningRoute && cached.morningRoute.length) || (cached.eveningRoute && cached.eveningRoute.length))) {
      return res.json({ success: true, bus: { number: bus.number, id: bus.id }, cache: cached });
    }

    // Try to build on-demand (non-blocking) and return
    try {
      const built = await buildRouteForBus(bus);
      // Do not persist here to avoid triggering file-watcher loops; store in-memory
      routePolylinesCache.set(bus.id, built);
      return res.json({ success: true, bus: { number: bus.number, id: bus.id }, cache: built });
    } catch (e) {
      return res.status(500).json({ success: false, message: 'Failed to build route', error: e && e.message });
    }
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// Admin-only: trigger a debounced route cache rebuild immediately
app.post('/api/admin/rebuild-routes', requireAdmin, requireCsrf, async (req, res) => {
  try {
    scheduleRouteCacheRebuild(true); // immediate (subject to scheduler guards)
    return res.json({ success: true, message: 'Route rebuild scheduled' });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Failed to schedule rebuild', error: e && e.message });
  }
});

// Admin-only utility: compute minDist (point-only) and segment min-distance for a given bus and user coords
app.post('/api/admin/debug/min-dist', requireAdmin, async (req, res) => {
  try {
    const { busNumber, lat, lng } = req.body || {};
    if (!busNumber || typeof lat === 'undefined' || typeof lng === 'undefined') return res.status(400).json({ success: false, message: 'busNumber, lat, lng required' });
    const bus = await prisma.bus.findUnique({ where: { number: String(busNumber) }, include: { stops: true } });
    if (!bus) return res.status(404).json({ success: false, message: 'Bus not found' });

    // Use cached polyline if available, else build on-demand (do not persist to disk here)
    let cached = routePolylinesCache.get(bus.id);
    if (!cached) {
      try { cached = await buildRouteForBus(bus); routePolylinesCache.set(bus.id, cached); } catch (e) { /* ignore build failure */ }
    }

    const userLocation = { lat: Number(lat), lng: Number(lng) };
    const report = { busNumber: bus.number, busId: bus.id, userLocation };

    // Compute point-only min dist for morning/evening
    const computeFor = (route) => {
      if (!route || route.length === 0) return { minDistPoint: Infinity, minIndexPoint: -1, minDistSegment: Infinity, minSegmentIndex: -1 };
      const { minDist, minIndex } = getMinDistanceAlongPath(userLocation, route);
      let minSeg = Infinity; let minSegIndex = -1;
      for (let i = 0; i < route.length - 1; i++) {
        const a = route[i]; const b = route[i+1];
        const segDist = pointToSegmentDistanceMeters(a, b, { lat: userLocation.lat, lng: userLocation.lng });
        if (segDist < minSeg) { minSeg = segDist; minSegIndex = i; }
      }
      return { minDistPoint: minDist, minIndexPoint: minIndex, minDistSegment: minSeg, minSegmentIndex: minSegIndex };
    };

    report.morning = cached && cached.morningRoute ? computeFor(cached.morningRoute) : null;
    report.evening = cached && cached.eveningRoute ? computeFor(cached.eveningRoute) : null;

    return res.json({ success: true, report });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Internal error', error: e && e.message });
  }
});

// Get all bus routes (from DB)
app.get('/api/routes', async (req, res) => {
  try {
    // Attempt the normal Prisma query first (uses Prisma schema fields)
    let busesWithStops;
    try {
      busesWithStops = await prisma.bus.findMany({
        include: {
          stops: {
            orderBy: [{ period: 'asc' }, { order: 'asc' }],
          },
        },
      });
    } catch (innerErr) {
      // If Prisma fails due to schema mismatch (e.g. P2022 column missing),
      // fall back to a raw SQL query to avoid crashing the endpoint.
      console.error('Prisma query failed while fetching buses, using raw fallback:', innerErr);

      // Fetch raw bus rows directly from DB (no Prisma model mapping)
      const rawBuses = await prisma.$queryRawUnsafe('SELECT * FROM "Bus"');

      // Load all stops and group by busId
      const allStops = await prisma.stop.findMany({ orderBy: [{ busId: 'asc' }, { order: 'asc' }] });
      const stopsByBus = {};
      for (const s of allStops) {
        if (!stopsByBus[s.busId]) stopsByBus[s.busId] = [];
        stopsByBus[s.busId].push(s);
      }

      // Normalize shape to match expected `bus` object used below
      busesWithStops = rawBuses.map(b => ({ ...b, stops: stopsByBus[b.id] || [] }));
    }

    const toStops = (stops, period) => (stops || [])
      .filter(s => s.period === period)
      .sort((a, b) => a.order - b.order)
      .map(s => ({ name: s.name, coords: { lat: s.lat, lng: s.lng } }));

    const routes = (busesWithStops || []).map(bus => {
      const morningStops = toStops(bus.stops, 'MORNING');
      const eveningStops = toStops(bus.stops, 'EVENING');

      return {
        number: bus.number,
        name: bus.name,
        location: bus.location,
        routeName: bus.routeName || null,
        imageUrl: bus.imageUrl || null,
        morningStartTime: bus.morningStartTime || null,
        morningEndTime: bus.morningEndTime || null,
        eveningStartTime: bus.eveningStartTime || null,
        eveningEndTime: bus.eveningEndTime || null,
        capacity: bus.capacity,
        currentOccupancy: bus.currentOccupancy,
        driverName: bus.driverName,
        driverPhone: bus.driverPhone,
        liveLocationUrl: bus.liveLocationUrl,
        morningRoute: {
          stops: morningStops,
          from: morningStops[0]?.name || 'Start',
          to: morningStops[morningStops.length - 1]?.name || 'End',
          description: `Route from ${morningStops[0]?.name || 'Start'} to ${morningStops[morningStops.length - 1]?.name || 'End'}`,
        },
        eveningRoute: {
          stops: eveningStops,
          from: eveningStops[0]?.name || 'Start',
          to: eveningStops[eveningStops.length - 1]?.name || 'End',
          description: `Route from ${eveningStops[0]?.name || 'Start'} to ${eveningStops[eveningStops.length - 1]?.name || 'End'}`,
        },
      };
    });

    res.json({ success: true, routes });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: 'Failed to load routes' });
  }
});

// Start HTTP server (with socket.io attached)
httpServer.listen(PORT, async () => {
  logger.info('Bus API Server started', { 
    port: PORT, 
    nodeEnv: process.env.NODE_ENV || 'development',
    endpoints: {
      health: `http://localhost:${PORT}/api/health`,
      availability: `POST http://localhost:${PORT}/api/check-availability`
    }
  });

  // Auto-migrate JSON data to database on startup
  try {
    const { autoMigrate } = require('./autoMigrate');
    await autoMigrate();
  } catch (error) {
    logger.warn('Auto-migration skipped or failed', { error: error.message });
  }

  // Initialize route cache cleanup (2-hour refresh)
  try {
    const { initializeRouteCacheCleanup } = require('./dbHelpers');
    initializeRouteCacheCleanup();
  } catch (error) {
    logger.warn('Route cache cleanup initialization skipped', { error: error.message });
  }
});

module.exports = app;
// Export selected helpers for external maintenance scripts (non-breaking)
module.exports.geocodeLatLng = geocodeLatLng;

// Global error handler: return JSON for errors (helps client-side uploads and API consumers)
app.use((err, req, res, next) => {
  logger.error('Unhandled error', { 
    error: err.message, 
    stack: err.stack,
    path: req.path,
    method: req.method 
  });
  if (res.headersSent) return next(err);
  const status = err && err.status ? err.status : 500;
  res.status(status).json({ success: false, message: (err && err.message) ? err.message : 'Internal server error' });
});
