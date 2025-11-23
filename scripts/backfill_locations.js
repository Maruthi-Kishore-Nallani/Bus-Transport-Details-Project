#!/usr/bin/env node
/*
 * One-time backfill script: enrich coordinate-only AvailabilityLog.location entries
 * with a formatted address using geocodeLatLng (Google Geocoding if key present,
 * else Nominatim reverse).
 *
 * Safety Features:
 * - Dry run mode via --dry-run or DRY_RUN=true (no writes).
 * - Limit number of rows processed via --limit N or BACKFILL_LIMIT env.
 * - Skips rows that already contain an address before coordinates.
 * - Preserves the __REQ__YES__|| prefix if present.
 * - Rate throttling (1 request per THROTTLE_MS, default 900ms) to respect API quotas.
 * - Retries transient network failures up to 2 additional times.
 *
 * Usage:
 *   node scripts/backfill_locations.js --limit 50 --dry-run
 *   node scripts/backfill_locations.js --limit 200
 *
 * Environment variables:
 *   BACKFILL_LIMIT      (override --limit)
 *   DRY_RUN=true        (forces dry run)
 *   THROTTLE_MS=750     (adjust pacing)
 *   GEOCODE_COUNTRY / GEOCODE_STATE / GEOCODE_CITY / GOOGLE_MAPS_API_KEY inherited automatically
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Reuse geocodeLatLng from server.js if available; else provide a minimal fallback
let geocodeLatLng;
try {
  const srv = require('../server');
  if (srv && srv.geocodeLatLng) geocodeLatLng = srv.geocodeLatLng;
} catch (e) {
  // ignore, we'll define fallback
}

if (!geocodeLatLng) {
  const https = require('https');
  const GOOGLE_MAPS_KEY = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_KEY || '';
  async function nominatimReverse(lat, lng) {
    return new Promise((resolve) => {
      try {
        const url = `https://nominatim.openstreetmap.org/reverse?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}&format=json`;
        https.get(url, { headers: { 'User-Agent': 'BackfillScript/1.0' } }, (res) => {
          let body = '';
            res.on('data', c => body += c);
            res.on('end', () => {
              try { const j = JSON.parse(body); return resolve(j && j.display_name ? j.display_name : null); } catch { resolve(null); }
            });
        }).on('error', () => resolve(null));
      } catch { resolve(null); }
    });
  }
  geocodeLatLng = async function(lat, lng) {
    const nLat = Number(lat); const nLng = Number(lng);
    if (Number.isNaN(nLat) || Number.isNaN(nLng)) throw new Error('Invalid lat/lng');
    if (!GOOGLE_MAPS_KEY) {
      const addr = await nominatimReverse(nLat, nLng);
      return { formatted_address: addr || `${nLat}, ${nLng}`, lat: nLat, lng: nLng };
    }
    const https = require('https');
    const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${encodeURIComponent(`${nLat},${nLng}`)}&key=${GOOGLE_MAPS_KEY}`;
    return new Promise((resolve) => {
      https.get(url, (res) => {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', async () => {
          try {
            const j = JSON.parse(body);
            if (j.status === 'OK' && j.results && j.results[0]) {
              const r = j.results[0];
              const loc = r.geometry && r.geometry.location ? r.geometry.location : { lat: nLat, lng: nLng };
              return resolve({ formatted_address: r.formatted_address || `${nLat}, ${nLng}`, lat: loc.lat, lng: loc.lng });
            }
          } catch { /* ignore */ }
          // fallback to nominatim
          const addr = await nominatimReverse(nLat, nLng);
          resolve({ formatted_address: addr || `${nLat}, ${nLng}`, lat: nLat, lng: nLng });
        });
      }).on('error', async () => {
        const addr = await nominatimReverse(nLat, nLng);
        resolve({ formatted_address: addr || `${nLat}, ${nLng}`, lat: nLat, lng: nLng });
      });
    });
  };
}

// Args parsing
const args = process.argv.slice(2);
function hasFlag(f) { return args.includes(f); }
function getArgValue(name) { const idx = args.indexOf(name); return idx !== -1 && args[idx+1] ? args[idx+1] : null; }

const limitArg = parseInt(getArgValue('--limit') || process.env.BACKFILL_LIMIT || '0', 10);
const LIMIT = limitArg > 0 ? limitArg : Infinity;
const DRY_RUN = hasFlag('--dry-run') || /^true$/i.test(process.env.DRY_RUN || '');
const THROTTLE_MS = parseInt(process.env.THROTTLE_MS || '900', 10);

const coordOnlyRegex = /^\(?\s*-?\d+\.\d+\s*,\s*-?\d+\.\d+\s*\)?$/;
const unifiedPattern = /[^()]+\(\s*-?\d+\.\d+\s*,\s*-?\d+\.\d+\s*\)/; // address plus coords

function stripRequestedPrefix(s) {
  if (typeof s === 'string' && s.startsWith('__REQ__YES__||')) return { requested: true, value: s.replace('__REQ__YES__||', '') };
  return { requested: false, value: s };
}

(async function main(){
  console.log('Backfill starting', { limit: LIMIT === Infinity ? 'ALL' : LIMIT, dryRun: DRY_RUN, throttleMs: THROTTLE_MS });
  let processed = 0, updated = 0, skipped = 0, failed = 0;

  try {
    // Fetch candidate rows (we over-fetch then filter in memory)
    // Select minimal fields needed to decide & update
    const rows = await prisma.availabilityLog.findMany({
      select: { id: true, location: true, lat: true, lng: true },
      orderBy: { id: 'asc' }
    });

    for (const row of rows) {
      if (processed >= LIMIT) break;
      const { requested, value: locRaw } = stripRequestedPrefix(row.location || '');
      const isUnifiedAlready = unifiedPattern.test(locRaw);
      const isCoordOnly = coordOnlyRegex.test(locRaw.trim());

      if (!isCoordOnly || isUnifiedAlready) { skipped++; continue; }

      processed++;
      const coordMatch = locRaw.match(/(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/);
      if (!coordMatch) { skipped++; continue; }
      const lat = parseFloat(coordMatch[1]);
      const lng = parseFloat(coordMatch[2]);
      if (Number.isNaN(lat) || Number.isNaN(lng)) { skipped++; continue; }

      // Throttle to respect API limits
      if (processed > 1) await new Promise(r => setTimeout(r, THROTTLE_MS));

      let geo; let attempts = 0; let success = false;
      while (attempts < 3 && !success) {
        attempts++;
        try { geo = await geocodeLatLng(lat, lng); success = true; } catch (e) { if (attempts >= 3) console.warn('Geocode failed permanently', { id: row.id, error: e.message }); }
      }
      if (!success || !geo || !geo.formatted_address) { failed++; continue; }

      const unified = `${geo.formatted_address} (${geo.lat.toFixed(6)}, ${geo.lng.toFixed(6)})`;
      const finalLocation = requested ? `__REQ__YES__||${unified}` : unified;

      if (DRY_RUN) {
        console.log(`[DRY] Would update id=${row.id} -> ${finalLocation}`);
      } else {
        try {
          await prisma.availabilityLog.update({ where: { id: row.id }, data: { location: finalLocation } });
          updated++;
          console.log(`Updated id=${row.id}`);
        } catch (e) {
          failed++;
          console.error(`Update failed id=${row.id}:`, e.message);
        }
      }
    }
  } catch (e) {
    console.error('Backfill fatal error:', e);
  } finally {
    console.log('Backfill complete', { processed, updated, skipped, failed, dryRun: DRY_RUN });
    await prisma.$disconnect();
  }
})();
