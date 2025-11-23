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
const io = new IOServer(httpServer, { cors: { origin: '*' } });

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
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    // Name file as <busNumber>_image<ext>
    try {
      const busNumber = req.params && req.params.busNumber ? String(req.params.busNumber) : String(Date.now());
      const ext = path.extname(file.originalname) || '.jpg';
      const fname = `${busNumber}_image${ext}`.replace(/[^a-zA-Z0-9._-]/g, '_');
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
// ---- Simple settings storage (JSON file) ----
const SETTINGS_PATH = path.join(__dirname, 'settings.json');
const DEFAULT_SETTINGS = {
  siteTitle: 'BUS TRANSPORT DETAILS',
  organizationName: 'Your Institution',
  contact: { address: 'Address line', phone: '+91 00000 00000', email: 'support@example.com' }
};

function readSettingsFile() {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      const raw = fs.readFileSync(SETTINGS_PATH, 'utf-8');
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_SETTINGS, ...parsed, contact: { ...DEFAULT_SETTINGS.contact, ...(parsed.contact || {}) } };
    }
  } catch (e) {
    logger.error('Failed to read settings file, using defaults', { error: e.message });
  }
  return { ...DEFAULT_SETTINGS };
}

function writeSettingsFile(settings) {
  try {
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf-8');
    return true;
  } catch (e) {
    logger.error('Failed to write settings file', { error: e.message });
    return false;
  }
}

let siteSettings = readSettingsFile();

// Public settings
app.get('/api/settings', (req, res) => {
  // DO NOT expose the actual Google Maps API key to clients for security
  // Instead, return a boolean indicating if Maps functionality is available
  const settingsPublic = { 
    ...siteSettings, 
    mapsEnabled: Boolean(process.env.GOOGLE_MAPS_API_KEY)
  };
  res.json({ success: true, settings: settingsPublic });
});

// Protected update settings
app.put('/api/admin/settings', requireAdmin, (req, res) => {
  const { siteTitle, organizationName, contact } = req.body || {};
  const next = {
    siteTitle: (siteTitle ?? siteSettings.siteTitle ?? DEFAULT_SETTINGS.siteTitle).toString(),
    organizationName: (organizationName ?? siteSettings.organizationName ?? DEFAULT_SETTINGS.organizationName).toString(),
    contact: {
      address: (contact?.address ?? siteSettings.contact.address ?? DEFAULT_SETTINGS.contact.address).toString(),
      phone: (contact?.phone ?? siteSettings.contact.phone ?? DEFAULT_SETTINGS.contact.phone).toString(),
      email: (contact?.email ?? siteSettings.contact.email ?? DEFAULT_SETTINGS.contact.email).toString()
    }
  };
  siteSettings = next;
  if (!writeSettingsFile(siteSettings)) {
    return res.status(500).json({ success: false, message: 'Failed to persist settings' });
  }
  res.json({ success: true, settings: siteSettings });
});

// --- Enhanced geocode + routing + intersection helpers ---

const DEFAULT_RADIUS_KM = parseFloat(process.env.SEARCH_RADIUS_KM) || 1.5; // STEP 3: Radius in km (1.5km = 1500 meters)
const GOOGLE_MAPS_KEY = process.env.GOOGLE_MAPS_API_KEY || null;
const geocodeCache = new Map();
const reverseGeocodeCache = new Map();

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

  if (!GOOGLE_MAPS_KEY) {
    throw new Error('Google Maps API key not configured');
  }

  // Enforce daily usage limit for Google API calls
  if (!checkAndIncrementGoogleUsage()) {
    throw new Error('Google Maps daily usage limit exceeded');
  }

  const q = encodeURIComponent(locationName);
  const country = process.env.GEOCODE_COUNTRY || '';
  const region = process.env.GEOCODE_REGION || '';
  let url = `https://maps.googleapis.com/maps/api/geocode/json?address=${q}&key=${GOOGLE_MAPS_KEY}`;
  if (country) url += `&components=country:${country}`;
  if (region) url += `&region=${region}`;

  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(body);
          if (j.status === 'OK' && j.results && j.results[0]) {
            const loc = j.results[0].geometry.location;
            const out = { lat: loc.lat, lng: loc.lng, formatted_address: j.results[0].formatted_address };
            geocodeCache.set(key, out);
            resolve(out);
          } else {
            reject(new Error(`Geocode failed: ${j.status || 'NO_RESULTS'}`));
          }
        } catch (err) { reject(err); }
      });
    }).on('error', reject);
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


/**
 * Reverse geocode coordinates -> place name (formatted address)
 * Caches results to minimize API calls.
 */
async function reverseGeocode(lat, lng) {
  const key = `${Number(lat).toFixed(6)},${Number(lng).toFixed(6)}`;
  if (reverseGeocodeCache.has(key)) return reverseGeocodeCache.get(key);
  if (!GOOGLE_MAPS_KEY) throw new Error('Google Maps API key not configured');

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
  for (const p of path) {
    const d = getDistance({ latitude: p.lat, longitude: p.lng }, center);
    if (d <= radiusMeters) return true;
  }

  // Check each segment between mini points crosses the circle
  for (let i = 0; i < path.length - 1; i++) {
    const a = { latitude: path[i].lat, longitude: path[i].lng };
    const b = { latitude: path[i + 1].lat, longitude: path[i + 1].lng };
    const distToSegment = getDistanceFromLine(center, a, b); // meters
    if (distToSegment <= radiusMeters) return true;
  }

  return false;
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

      // Multiple stops: Generate route path using Google Directions or straight-line
      const origin = { lat: stopsArr[0].lat, lng: stopsArr[0].lng };
      const destination = { lat: stopsArr[stopsArr.length - 1].lat, lng: stopsArr[stopsArr.length - 1].lng };
      const waypoints = stopsArr.slice(1, -1).map(s => ({ lat: s.lat, lng: s.lng }));

             let path;
       try {
         // Generate FULL ROUTE as array of mini points (not just bus stops!)
         // This includes hundreds of points along the actual road path
         path = await getRoutePath(origin, destination, waypoints);
       } catch (e) {
         // Fallback to straight-line connections between stops only
         path = stopsArr.map(s => ({ lat: s.lat, lng: s.lng }));
       }

      // Store the FULL ROUTE path (hundreds of mini points) for reference
      result.routePath = path;

             // Check if the FULL ROUTE (all mini points + segments) intersects the circle
       if (isPathIntersectsCircle(userLocation, path, radiusMeters)) {
         result.intersects = true;
         
         // Count actual bus stops within the circle for reporting
         result.stopCount = stopsArr.reduce((acc, s) => {
           const d = getDistance(
             { latitude: userLocation.lat, longitude: userLocation.lng },
             { latitude: s.lat, longitude: s.lng }
           );
           return acc + (d <= radiusMeters ? 1 : 0);
         }, 0);
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
    rec.count += 1;
    loginAttempts.set(ip, rec);
    if (rec.count > LOGIN_MAX_ATTEMPTS) {
      return res.status(429).json({ success: false, message: 'Too many login attempts. Try again later.' });
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

    // Enrich with place name if coordinates are available
    const enriched = await Promise.all(logs.map(async (log) => {
      let locationName = null;
      let requested = false;
      let rawLocation = log.location;

      // Detect our request flag prefix and strip it for display
      if (typeof rawLocation === 'string' && rawLocation.startsWith('__REQ__YES__||')) {
        requested = true;
        rawLocation = rawLocation.replace('__REQ__YES__||', '');
      }

      if (typeof log.lat === 'number' && typeof log.lng === 'number') {
        try {
          locationName = await reverseGeocode(log.lat, log.lng);
        } catch (e) {
          locationName = null;
        }
      } else if (typeof rawLocation === 'string') {
        // If only a string was provided, try parsing coords "lat,lng"
        const m = rawLocation.match(/^\s*(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)\s*$/);
        if (m) {
          const lat = parseFloat(m[1]); const lng = parseFloat(m[2]);
          if (!isNaN(lat) && !isNaN(lng)) {
            try { locationName = await reverseGeocode(lat, lng); } catch {}
          }
        }
      }
      return { ...log, locationName, requested, location: rawLocation };
    }));

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
      const thumbName = `${busNumber}_thumb${ext}`.replace(/[^a-zA-Z0-9._-]/g, '_');
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
      } else {
        // STEP 2: It's a location name, geocode it
        console.log(`🔍 Geocoding location name: "${location}"...`);
        try {
          const geocodedLocation = await geocodeLocation(location);
          userLocation = { lat: geocodedLocation.lat, lng: geocodedLocation.lng };
          console.log(`✅ Geocoded to: ${userLocation.lat},${userLocation.lng}`);
          console.log(`   Address: ${geocodedLocation.formatted_address}`);
        } catch (error) {
          return res.status(400).json({
            success: false,
            message: `Could not find location "${location}". Please provide coordinates as "lat,lng" or a valid location name.`
          });
        }
      }
    } else if (typeof location === 'object' && location.lat && location.lng) {
      userLocation = location;
    } else {
      return res.status(400).json({
        success: false,
        message: 'Invalid location format. Please provide coordinates as "lat,lng" or a location name.'
      });
    }

              // STEP 3: Find nearby buses (checks if routes intersect 1.5km circle)
      const nearbyBuses = await findNearbyBusesDb(userLocation, 1.5);

    // Log the availability check to database and include optional requester flag.
    // This is made resilient: if Prisma create fails due to schema mismatch,
    // we detect existing columns and fallback to a compatible INSERT so logs
    // are still recorded even before the DB migration is applied.
    try {
      const requestBusFlag = req.body && (req.body.requestBus === true || String(req.body.requestBus).toLowerCase() === 'yes');
      const rawLoc = typeof location === 'string' ? location : `${userLocation.lat},${userLocation.lng}`;
      const locationToSave = requestBusFlag ? `__REQ__YES__||${rawLoc}` : rawLoc;

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
httpServer.listen(PORT, () => {
  logger.info('Bus API Server started', { 
    port: PORT, 
    nodeEnv: process.env.NODE_ENV || 'development',
    endpoints: {
      health: `http://localhost:${PORT}/api/health`,
      availability: `POST http://localhost:${PORT}/api/check-availability`
    }
  });
});

module.exports = app;

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
