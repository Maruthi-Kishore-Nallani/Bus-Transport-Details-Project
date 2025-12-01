const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

function hasDelegate(delegate, method = 'findFirst') {
  return delegate && typeof delegate[method] === 'function';
}

// ============================================
// SITE SETTINGS HELPERS
// ============================================

const DEFAULT_SETTINGS = {
  siteTitle: 'BUS TRANSPORT DETAILS',
  organizationName: 'Your Institution',
  contact: { address: 'Address line', phone: '+91 00000 00000', email: 'support@example.com' }
};

/**
 * Get site settings from database
 */
async function getSiteSettings() {
  try {
    if (!hasDelegate(prisma.siteSettings)) throw new Error('Model SiteSettings not available');
    let settings = await prisma.siteSettings.findFirst({
      orderBy: { id: 'asc' }
    });

    if (!settings) {
      // Create default settings if none exist
      settings = await prisma.siteSettings.create({
        data: {
          siteTitle: DEFAULT_SETTINGS.siteTitle,
          organizationName: DEFAULT_SETTINGS.organizationName,
          contactAddress: DEFAULT_SETTINGS.contact.address,
          contactPhone: DEFAULT_SETTINGS.contact.phone,
          contactEmail: DEFAULT_SETTINGS.contact.email
        }
      });
    }

    return {
      siteTitle: settings.siteTitle,
      organizationName: settings.organizationName,
      contact: {
        address: settings.contactAddress,
        phone: settings.contactPhone,
        email: settings.contactEmail
      }
    };
  } catch (error) {
    console.error('[Settings] Error reading settings:', error);
    return { ...DEFAULT_SETTINGS };
  }
}

/**
 * Update site settings in database
 */
async function updateSiteSettings(updates) {
  try {
    if (!hasDelegate(prisma.siteSettings)) throw new Error('Model SiteSettings not available');
    const { siteTitle, organizationName, contact } = updates;

    let settings = await prisma.siteSettings.findFirst({
      orderBy: { id: 'asc' }
    });

    if (!settings) {
      settings = await prisma.siteSettings.create({
        data: {
          siteTitle: siteTitle || DEFAULT_SETTINGS.siteTitle,
          organizationName: organizationName || DEFAULT_SETTINGS.organizationName,
          contactAddress: contact?.address || DEFAULT_SETTINGS.contact.address,
          contactPhone: contact?.phone || DEFAULT_SETTINGS.contact.phone,
          contactEmail: contact?.email || DEFAULT_SETTINGS.contact.email
        }
      });
    } else {
      settings = await prisma.siteSettings.update({
        where: { id: settings.id },
        data: {
          siteTitle: siteTitle !== undefined ? siteTitle : settings.siteTitle,
          organizationName: organizationName !== undefined ? organizationName : settings.organizationName,
          contactAddress: contact?.address !== undefined ? contact.address : settings.contactAddress,
          contactPhone: contact?.phone !== undefined ? contact.phone : settings.contactPhone,
          contactEmail: contact?.email !== undefined ? contact.email : settings.contactEmail
        }
      });
    }

    return {
      siteTitle: settings.siteTitle,
      organizationName: settings.organizationName,
      contact: {
        address: settings.contactAddress,
        phone: settings.contactPhone,
        email: settings.contactEmail
      }
    };
  } catch (error) {
    console.error('[Settings] Error updating settings:', error);
    return null;
  }
}

// ============================================
// PENDING ADMIN HELPERS
// ============================================

/**
 * Get all pending admin requests (unapproved admins)
 */
async function getPendingAdmins() {
  try {
    const pending = await prisma.admin.findMany({
      where: { approved: false },
      select: {
        id: true,
        email: true,
        createdAt: true
      },
      orderBy: { createdAt: 'desc' }
    });
    return pending;
  } catch (error) {
    console.error('[PendingAdmins] Error reading pending admins:', error);
    return [];
  }
}

/**
 * Create a pending admin signup request
 */
async function createPendingAdmin(email, hashedPassword) {
  try {
    const admin = await prisma.admin.create({
      data: {
        email,
        password: hashedPassword,
        approved: false
      }
    });
    return admin;
  } catch (error) {
    console.error('[PendingAdmins] Error creating pending admin:', error);
    return null;
  }
}

/**
 * Check if an admin request exists (pending or approved)
 */
async function adminExists(email) {
  try {
    const count = await prisma.admin.count({
      where: { email: { equals: email, mode: 'insensitive' } }
    });
    return count > 0;
  } catch (error) {
    console.error('[PendingAdmins] Error checking admin existence:', error);
    return false;
  }
}

/**
 * Approve a pending admin
 */
async function approvePendingAdmin(email) {
  try {
    const admin = await prisma.admin.updateMany({
      where: { 
        email: { equals: email, mode: 'insensitive' },
        approved: false
      },
      data: { approved: true }
    });
    return admin.count > 0;
  } catch (error) {
    console.error('[PendingAdmins] Error approving admin:', error);
    return false;
  }
}

/**
 * Reject/delete a pending admin
 */
async function rejectPendingAdmin(email) {
  try {
    const admin = await prisma.admin.deleteMany({
      where: { 
        email: { equals: email, mode: 'insensitive' },
        approved: false
      }
    });
    return admin.count > 0;
  } catch (error) {
    console.error('[PendingAdmins] Error rejecting admin:', error);
    return false;
  }
}

// ============================================
// ROUTE CACHE HELPERS (2-hour auto-refresh)
// ============================================

const ROUTE_CACHE_REFRESH_HOURS = 2;

/**
 * Get route from cache (database)
 * Returns null if not found or expired
 */
async function getRouteFromCache(busId, period) {
  try {
    if (!hasDelegate(prisma.routeCache, 'findUnique')) return null;
    const cached = await prisma.routeCache.findUnique({
      where: {
        busId_period: {
          busId: parseInt(busId),
          period: period.toUpperCase()
        }
      }
    });

    if (!cached) {
      return null;
    }

    // Check if cache is older than ROUTE_CACHE_REFRESH_HOURS
    const cacheAge = Date.now() - cached.updatedAt.getTime();
    const maxAge = ROUTE_CACHE_REFRESH_HOURS * 60 * 60 * 1000;

    if (cacheAge > maxAge) {
      console.log(`[RouteCache] Cache expired for bus ${busId} ${period}, needs refresh`);
      return null; // Force refresh
    }

    return cached.routeData;
  } catch (error) {
    console.error('[RouteCache] Error reading from cache:', error);
    return null;
  }
}

/**
 * Save route to cache (database)
 */
async function saveRouteToCache(busId, period, routeData) {
  try {
    if (!hasDelegate(prisma.routeCache, 'upsert')) return false;
    await prisma.routeCache.upsert({
      where: {
        busId_period: {
          busId: parseInt(busId),
          period: period.toUpperCase()
        }
      },
      update: {
        routeData: routeData,
        updatedAt: new Date()
      },
      create: {
        busId: parseInt(busId),
        period: period.toUpperCase(),
        routeData: routeData
      }
    });
    console.log(`[RouteCache] Saved route for bus ${busId} ${period}`);
    return true;
  } catch (error) {
    console.error('[RouteCache] Error saving to cache:', error);
    return false;
  }
}

/**
 * Clear expired cache entries (older than ROUTE_CACHE_REFRESH_HOURS)
 */
async function clearExpiredRouteCache() {
  try {
    if (!hasDelegate(prisma.routeCache, 'deleteMany')) return 0;
    const expiryTime = new Date(Date.now() - ROUTE_CACHE_REFRESH_HOURS * 60 * 60 * 1000);
    
    const result = await prisma.routeCache.deleteMany({
      where: {
        updatedAt: {
          lt: expiryTime
        }
      }
    });

    if (result.count > 0) {
      console.log(`[RouteCache] Cleared ${result.count} expired cache entries`);
    }
    return result.count;
  } catch (error) {
    console.error('[RouteCache] Error clearing expired cache:', error);
    return 0;
  }
}

/**
 * Get all cached routes for a bus
 */
async function getAllRoutesForBus(busId) {
  try {
    if (!hasDelegate(prisma.routeCache, 'findMany')) return { morningRoute: null, eveningRoute: null };
    const routes = await prisma.routeCache.findMany({
      where: {
        busId: parseInt(busId)
      }
    });

    return {
      morningRoute: routes.find(r => r.period === 'MORNING')?.routeData || null,
      eveningRoute: routes.find(r => r.period === 'EVENING')?.routeData || null
    };
  } catch (error) {
    console.error('[RouteCache] Error getting routes for bus:', error);
    return { morningRoute: null, eveningRoute: null };
  }
}

/**
 * Initialize periodic cache cleanup (runs every 2 hours)
 */
function initializeRouteCacheCleanup() {
  // Clear expired cache immediately on startup
  clearExpiredRouteCache();

  // Schedule periodic cleanup every 2 hours
  setInterval(() => {
    console.log('[RouteCache] Running scheduled cache cleanup...');
    clearExpiredRouteCache();
  }, ROUTE_CACHE_REFRESH_HOURS * 60 * 60 * 1000);

  console.log(`[RouteCache] Initialized with ${ROUTE_CACHE_REFRESH_HOURS}h auto-refresh`);
}

module.exports = {
  // Settings
  getSiteSettings,
  updateSiteSettings,
  DEFAULT_SETTINGS,
  
  // Pending Admins
  getPendingAdmins,
  createPendingAdmin,
  adminExists,
  approvePendingAdmin,
  rejectPendingAdmin,
  
  // Route Cache
  getRouteFromCache,
  saveRouteToCache,
  clearExpiredRouteCache,
  getAllRoutesForBus,
  initializeRouteCacheCleanup,
  ROUTE_CACHE_REFRESH_HOURS
};
