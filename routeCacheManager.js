const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const ROUTE_CACHE_REFRESH_HOURS = 2;

/**
 * Get route from cache (database)
 */
async function getRouteFromCache(busId, period) {
  try {
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
  } catch (error) {
    console.error('[RouteCache] Error saving to cache:', error);
  }
}

/**
 * Clear expired cache entries (older than ROUTE_CACHE_REFRESH_HOURS)
 */
async function clearExpiredCache() {
  try {
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
  } catch (error) {
    console.error('[RouteCache] Error clearing expired cache:', error);
  }
}

/**
 * Get all cached routes for a bus
 */
async function getAllRoutesForBus(busId) {
  try {
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
  clearExpiredCache();

  // Schedule periodic cleanup every 2 hours
  setInterval(() => {
    console.log('[RouteCache] Running scheduled cache cleanup...');
    clearExpiredCache();
  }, ROUTE_CACHE_REFRESH_HOURS * 60 * 60 * 1000);

  console.log(`[RouteCache] Initialized with ${ROUTE_CACHE_REFRESH_HOURS}h refresh interval`);
}

module.exports = {
  getRouteFromCache,
  saveRouteToCache,
  clearExpiredCache,
  getAllRoutesForBus,
  initializeRouteCacheCleanup,
  ROUTE_CACHE_REFRESH_HOURS
};
