# Google Maps Integration Guide

## Understanding the 403 Error

If you see this error in production:
```
Failed to load resource: the server responded with a status of 403
Map render failed: Error: Google Maps script not found
```

**This is expected behavior for security reasons.**

---

## How It Works

### Development Mode
- The app can fetch your API key from `/api/maps-key`
- Interactive maps work automatically
- This is convenient but NOT secure for production

### Production Mode
- `/api/maps-key` returns 403 (blocked)
- API key is NOT exposed to clients
- Interactive maps won't load unless you add them manually
- **This protects your API key from theft/abuse**

---

## Current Behavior (Production)

When users click "View Route" in the bus modal:
- ✅ **Details tab works:** Shows driver info, schedule, occupancy, bus image
- ✅ **Morning/Evening route tabs work:** Show list of stops with names
- ⚠️ **Interactive map:** Shows placeholder "Route stops listed above. Interactive map unavailable."

**This is acceptable for most use cases** - users can still see all route information.

---

## Option 1: Keep Current Setup (Recommended)

**Pros:**
- Secure - API key not exposed
- No additional configuration needed
- Users still see all route stops
- Geocoding/availability still works server-side

**Cons:**
- No interactive map in route modal
- Users can't zoom/pan the route

**Action Required:** None! This is the secure default.

---

## Option 2: Enable Client-Side Maps (Advanced)

If you MUST have interactive maps in production:

### Step 1: Create a Separate Restricted Key

1. Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. Create a NEW API key (don't reuse your server key!)
3. Name it: `Bus-Transport-Client-Side-Maps`
4. **CRITICAL:** Set restrictions:

   **Application Restrictions:**
   - Type: HTTP referrers (web sites)
   - Add referrers:
     ```
     https://yourdomain.com/*
     https://www.yourdomain.com/*
     https://your-app.onrender.com/*
     ```
   
   **API Restrictions:**
   - Restrict key to: **Maps JavaScript API ONLY**
   - Do NOT enable: Geocoding API, Directions API, etc.

5. Save the key

### Step 2: Add Script to HTML

Edit `page.html` (and `admin-dashboard.html` if needed):

```html
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Bus Transport</title>
  
  <!-- Add this line with YOUR restricted client key: -->
  <script src="https://maps.googleapis.com/maps/api/js?key=YOUR_CLIENT_KEY_HERE&libraries=places" async defer></script>
  
  <link rel="stylesheet" href="styles.css">
</head>
```

### Step 3: Deploy and Test

- Push changes to your repo
- Redeploy on Render
- Test route modal - maps should now load

### Security Checklist for Client-Side Maps:

- [ ] Using a SEPARATE key (not your server key)
- [ ] HTTP referrer restrictions set to YOUR domains only
- [ ] API restrictions set to Maps JavaScript API ONLY
- [ ] Server key still kept private (not in HTML)
- [ ] Daily quota limits set in Google Cloud Console
- [ ] Key is NOT committed to git (if using env variables)

---

## Option 3: Server-Side Static Maps (Alternative)

Instead of interactive maps, generate static map images server-side:

1. Use Google Static Maps API
2. Generate images on the server
3. Cache them for performance
4. Display in modal

**Requires code changes - not currently implemented.**

---

## Troubleshooting

### "Maps work in development but not production"
**Expected!** Development mode uses `/api/maps-key` which is disabled in production.

### "I added the script but maps still don't load"
- Check browser console for API key errors
- Verify domain is in allowed referrers
- Make sure you enabled "Maps JavaScript API" for that key
- Check daily quota hasn't been exceeded

### "Maps load but don't show routes"
- Make sure you added `&libraries=places` to the script URL
- Verify the key has Maps JavaScript API enabled (not just Geocoding)

### "I see 'This page can't load Google Maps correctly'"
- Your key has restrictions that block your domain
- Add your actual domain to HTTP referrers
- Or temporarily remove restrictions to test (NOT for production!)

---

## Cost Considerations

**Current Setup (No Client Maps):**
- Geocoding: ~$5 per 1000 requests
- Directions: ~$5 per 1000 requests
- Server-side only = controlled usage

**With Client-Side Maps Enabled:**
- Map loads: $7 per 1000 loads
- Additional cost if users zoom/pan extensively
- Set daily quotas to prevent surprise bills!

---

## Recommendation

**For most use cases:** Keep the current setup. The route information is fully visible without interactive maps, and your API key stays secure.

**Only enable client maps if:**
- You need visual route display
- You have budget for additional Maps API costs
- You can properly restrict the client key
- You understand the security implications

---

## Questions?

- Check [Google Maps Platform Documentation](https://developers.google.com/maps/documentation)
- Review your API usage at [Google Cloud Console](https://console.cloud.google.com/)
- See `README.md` and `SECURITY_AUDIT.md` for more security tips
