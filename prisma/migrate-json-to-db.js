const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

async function migrateData() {
  console.log('Starting migration from JSON files to database...\n');

  try {
    // 1. Migrate Site Settings
    console.log('1. Migrating site settings...');
    const settingsPath = path.join(__dirname, '..', 'settings.json');
    if (fs.existsSync(settingsPath)) {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      
      await prisma.siteSettings.upsert({
        where: { id: 1 },
        update: {
          siteTitle: settings.siteTitle || 'BUS TRANSPORT DETAILS',
          organizationName: settings.organizationName || '',
          contactAddress: settings.contact?.address || '',
          contactPhone: settings.contact?.phone || '',
          contactEmail: settings.contact?.email || ''
        },
        create: {
          siteTitle: settings.siteTitle || 'BUS TRANSPORT DETAILS',
          organizationName: settings.organizationName || '',
          contactAddress: settings.contact?.address || '',
          contactPhone: settings.contact?.phone || '',
          contactEmail: settings.contact?.email || ''
        }
      });
      console.log('✓ Site settings migrated successfully');
    } else {
      console.log('⚠ settings.json not found, skipping...');
    }

    // 2. Migrate Route Cache
    console.log('\n2. Migrating route cache...');
    const routeCachePath = path.join(__dirname, '..', 'route_cache.json');
    if (fs.existsSync(routeCachePath)) {
      const routeCache = JSON.parse(fs.readFileSync(routeCachePath, 'utf8'));
      let migratedCount = 0;

      for (const [busNumber, routes] of Object.entries(routeCache)) {
        // Find the bus by number
        const bus = await prisma.bus.findUnique({
          where: { number: busNumber }
        });

        if (bus) {
          // Migrate morning route
          if (routes.morningRoute && Array.isArray(routes.morningRoute) && routes.morningRoute.length > 0) {
            await prisma.routeCache.upsert({
              where: {
                busId_period: {
                  busId: bus.id,
                  period: 'MORNING'
                }
              },
              update: {
                routeData: routes.morningRoute
              },
              create: {
                busId: bus.id,
                period: 'MORNING',
                routeData: routes.morningRoute
              }
            });
            migratedCount++;
          }

          // Migrate evening route
          if (routes.eveningRoute && Array.isArray(routes.eveningRoute) && routes.eveningRoute.length > 0) {
            await prisma.routeCache.upsert({
              where: {
                busId_period: {
                  busId: bus.id,
                  period: 'EVENING'
                }
              },
              update: {
                routeData: routes.eveningRoute
              },
              create: {
                busId: bus.id,
                period: 'EVENING',
                routeData: routes.eveningRoute
              }
            });
            migratedCount++;
          }
        } else {
          console.log(`  ⚠ Bus ${busNumber} not found in database, skipping...`);
        }
      }
      console.log(`✓ Migrated ${migratedCount} route cache entries`);
    } else {
      console.log('⚠ route_cache.json not found, skipping...');
    }

    // 3. Migrate Pending Admins (if any)
    console.log('\n3. Checking pending admins...');
    const pendingAdminsPath = path.join(__dirname, '..', 'pending_admins.json');
    if (fs.existsSync(pendingAdminsPath)) {
      const pendingAdmins = JSON.parse(fs.readFileSync(pendingAdminsPath, 'utf8'));
      
      if (Array.isArray(pendingAdmins) && pendingAdmins.length > 0) {
        console.log(`  Found ${pendingAdmins.length} pending admin(s)`);
        console.log('  Note: Pending admins are now stored as Admin records with approved=false');
        console.log('  These should be handled through the admin approval system');
      } else {
        console.log('✓ No pending admins to migrate');
      }
    } else {
      console.log('⚠ pending_admins.json not found, skipping...');
    }

    console.log('\n✅ Migration completed successfully!');
    console.log('\nNext steps:');
    console.log('1. Verify the migrated data in the database');
    console.log('2. Update server.js to use database instead of JSON files');
    console.log('3. Keep JSON files as backup until verification is complete');

  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

migrateData();
