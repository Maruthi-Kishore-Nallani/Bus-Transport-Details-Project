const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

/**
 * Automatically migrate data from JSON files to database on startup
 * Safe to run multiple times - only migrates if needed
 */
async function autoMigrate() {
  console.log('[AutoMigrate] Starting automatic migration check...');

  try {
    // 1. Migrate Site Settings (only if not exists)
    console.log('[AutoMigrate] Checking site settings...');
    const settingsCount = await prisma.siteSettings.count();
    
    if (settingsCount === 0) {
      console.log('[AutoMigrate] No settings found, migrating from JSON...');
      const settingsPath = path.join(__dirname, 'settings.json');
      
      if (fs.existsSync(settingsPath)) {
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        await prisma.siteSettings.create({
          data: {
            siteTitle: settings.siteTitle || 'BUS TRANSPORT DETAILS',
            organizationName: settings.organizationName || '',
            contactAddress: settings.contact?.address || '',
            contactPhone: settings.contact?.phone || '',
            contactEmail: settings.contact?.email || ''
          }
        });
        console.log('[AutoMigrate] ✓ Site settings migrated');
      } else {
        // Create default settings
        await prisma.siteSettings.create({
          data: {
            siteTitle: 'BUS TRANSPORT DETAILS',
            organizationName: '',
            contactAddress: '',
            contactPhone: '',
            contactEmail: ''
          }
        });
        console.log('[AutoMigrate] ✓ Default settings created');
      }
    } else {
      console.log('[AutoMigrate] ✓ Settings already exist, skipping');
    }

    // 2. Migrate Route Cache (only if not exists and JSON file exists)
    console.log('[AutoMigrate] Checking route cache...');
    const cacheCount = await prisma.routeCache.count();
    
    if (cacheCount === 0) {
      const routeCachePath = path.join(__dirname, 'route_cache.json');
      
      if (fs.existsSync(routeCachePath)) {
        console.log('[AutoMigrate] Migrating route cache from JSON...');
        const routeCache = JSON.parse(fs.readFileSync(routeCachePath, 'utf8'));
        let migratedCount = 0;

        for (const [busNumber, routes] of Object.entries(routeCache)) {
          const bus = await prisma.bus.findUnique({ where: { number: busNumber } });

          if (bus) {
            if (routes.morningRoute && Array.isArray(routes.morningRoute) && routes.morningRoute.length > 0) {
              await prisma.routeCache.create({
                data: {
                  busId: bus.id,
                  period: 'MORNING',
                  routeData: routes.morningRoute
                }
              }).catch(() => {}); // Ignore if already exists
              migratedCount++;
            }

            if (routes.eveningRoute && Array.isArray(routes.eveningRoute) && routes.eveningRoute.length > 0) {
              await prisma.routeCache.create({
                data: {
                  busId: bus.id,
                  period: 'EVENING',
                  routeData: routes.eveningRoute
                }
              }).catch(() => {}); // Ignore if already exists
              migratedCount++;
            }
          }
        }
        console.log(`[AutoMigrate] ✓ Migrated ${migratedCount} route cache entries`);
      } else {
        console.log('[AutoMigrate] ✓ No route cache file found, skipping');
      }
    } else {
      console.log('[AutoMigrate] ✓ Route cache already exists, skipping');
    }

    // 3. Migrate Pending Admins (only if pending_admins.json exists)
    console.log('[AutoMigrate] Checking pending admins...');
    const pendingAdminsPath = path.join(__dirname, 'pending_admins.json');
    
    if (fs.existsSync(pendingAdminsPath)) {
      const pendingAdmins = JSON.parse(fs.readFileSync(pendingAdminsPath, 'utf8'));
      
      if (Array.isArray(pendingAdmins) && pendingAdmins.length > 0) {
        console.log(`[AutoMigrate] Found ${pendingAdmins.length} pending admin(s) in JSON`);
        
        for (const pending of pendingAdmins) {
          const exists = await prisma.admin.findUnique({ 
            where: { email: pending.email } 
          });
          
          if (!exists) {
            await prisma.admin.create({
              data: {
                email: pending.email,
                password: pending.password,
                approved: false
              }
            }).catch(() => {}); // Ignore if already exists
          }
        }
        console.log('[AutoMigrate] ✓ Pending admins migrated');
      } else {
        console.log('[AutoMigrate] ✓ No pending admins to migrate');
      }
    } else {
      console.log('[AutoMigrate] ✓ No pending admins file found, skipping');
    }

    console.log('[AutoMigrate] ✅ Migration check completed successfully\n');
    return true;

  } catch (error) {
    console.error('[AutoMigrate] ❌ Migration failed:', error.message);
    // Don't crash the server, just log the error
    return false;
  }
}

module.exports = { autoMigrate };
