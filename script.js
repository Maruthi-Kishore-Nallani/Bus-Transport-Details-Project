// Bus data will be loaded from database API
let buses = [];
// Map of real busNumber -> display number (1..N)
let busNumberToDisplay = new Map();

// Socket.io live updates
let socket = null;
try {
  if (typeof io === 'function') {
    socket = io('http://localhost:3000');
    socket.on('connect', () => console.log('Socket connected (public):', socket.id));
    socket.on('busImageUpdated', (payload) => {
      console.log('busImageUpdated', payload);
      // Refresh buses so public pages show new images
      loadBusesFromDatabase();
    });
  }
} catch (e) { console.warn('Socket not available', e); }

    async function adminLogin(e) {
      e.preventDefault();
      const email = document.getElementById('adminEmail').value.trim();
      const password = document.getElementById('adminPassword').value;
      const btn = document.getElementById('adminBtn');
      const err = document.getElementById('adminError');
      err.textContent = '';
      err.style.display = 'none';
      btn.disabled = true; btn.textContent = ' Signing in...';
      try {
        const res = await fetch('http://localhost:3000/api/admin/login', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });
        const data = await res.json();
        if (!data.success) { 
          err.textContent = data.message || 'Login failed';
          err.style.display = 'flex';
        } else {
          localStorage.setItem('admin_token', data.token);
          window.location.href = 'admin-dashboard.html';
        }
      } catch (e2) {
        err.textContent = 'Unable to connect to server';
        err.style.display = 'flex';
      } finally {
        btn.disabled = false; btn.textContent = ' Sign In';
      }
    }

// Load bus data from database API
async function loadBusesFromDatabase() {
  try {
    // Show loading state
    container.innerHTML = '<div class="loading">Loading bus data...</div>';
    
    const response = await fetch('http://localhost:3000/api/routes');
    const data = await response.json();
    
    if (data.success) {
      // The API now returns full route details.
      // We can directly use this data after adding some frontend-specific style info.
      const processedBuses = data.routes.map(bus => {
        return {
          ...bus,
          morningRoute: {
            ...bus.morningRoute,
            stops: bus.morningRoute.stops.map(stop => ({
              name: stop.name,
              coords: `${stop.coords.lat},${stop.coords.lng}`
            })),
            style: { color: "#0072ff", weight: 5, opacity: 1, dashed: false }
          },
          eveningRoute: {
            ...bus.eveningRoute,
            stops: bus.eveningRoute.stops.map(stop => ({
              name: stop.name,
              coords: `${stop.coords.lat},${stop.coords.lng}`
            })),
            style: { color: "#28a745", weight: 5, opacity: 1, dashed: false }
          }
        };
      });

      // Ensure buses are unique by number before assigning
      const uniqueBuses = [];
      const seenNumbers = new Set();
      for (const bus of processedBuses) {
        if (!seenNumbers.has(bus.number)) {
          uniqueBuses.push(bus);
          seenNumbers.add(bus.number);
        }
      }
      buses = uniqueBuses;
      
      // Build display numbering (single series starting from 1) based on sorted real numbers
      try {
        const sortedByNumber = [...buses].sort((a, b) => Number(a.number) - Number(b.number));
        busNumberToDisplay = new Map();
        sortedByNumber.forEach((bus, index) => {
          busNumberToDisplay.set(String(bus.number), String(index + 1));
        });
      } catch (e) {
        // Fallback: leave map empty and use real numbers for display
        busNumberToDisplay = new Map();
      }
      
      // Render buses after loading
      if (buses.length === 0) {
        container.innerHTML = '<div class="no-buses">No buses available in the database.</div>';
      } else {
        renderBuses(buses);
      }

      // Populate Apply dropdown now that buses are loaded
      if (typeof populateApplyBusOptions === 'function') {
        populateApplyBusOptions();
      }
    } else {
      console.error('Failed to load buses:', data.message);
      container.innerHTML = '<div class="error">Failed to load bus data from database.</div>';
    }
  } catch (error) {
    console.error('Error loading buses:', error);
    container.innerHTML = '<div class="error">Error loading bus data. Please check if the server is running.</div>';
  }
}

const container = document.getElementById("busContainer");

// Google Maps (interactive) support
// The API key is loaded dynamically from server settings to avoid hardcoding.
let googleMapsLoadPromise = null;

function loadGoogleMapsApi() {
  if (window.google && window.google.maps) {
    return Promise.resolve();
  }
  if (googleMapsLoadPromise) return googleMapsLoadPromise;
  googleMapsLoadPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-gmaps="true"]');
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', reject);
      return;
    }

    const key = window.SITE_GOOGLE_MAPS_KEY || null;
    if (!key) return reject(new Error('Google Maps API key not available'));

    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}`;
    script.async = true;
    script.defer = true;
    script.setAttribute('data-gmaps', 'true');
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Google Maps JS API'));
    document.head.appendChild(script);
  });
  return googleMapsLoadPromise;
}

// Build polyline style options from route data (with sane defaults)
function buildPolylineOptions(coordsArray, routeData) {
  const style = routeData && routeData.style ? routeData.style : {};
  const color = style.color || '#0072ff';
  const weight = Number(style.weight || 4);
  const opacity = style.opacity === 0 ? 0 : (style.opacity || 1);
  const dashed = Boolean(style.dashed);

  const options = {
    path: coordsArray,
    geodesic: true,
    strokeColor: color,
    strokeOpacity: opacity,
    strokeWeight: weight,
  };

  // Dashed line using symbol icons
  if (dashed) {
    options.strokeOpacity = 0; // hide base stroke
    options.icons = [{
      icon: { path: 'M 0,-1 0,1', strokeOpacity: opacity, strokeColor: color, scale: Math.max(2, weight) },
      offset: '0',
      repeat: `${Math.max(10, weight * 3)}px`
    }];
  }

  return options;
}

// Function to adjust main content padding based on header height
function adjustMainPadding() {
  const header = document.querySelector('header');
  const main = document.querySelector('main');
  
  if (header && main) {
    const headerHeight = header.offsetHeight;
    const extraPadding = 20; // Extra space for visual separation
    const totalPadding = headerHeight + extraPadding;
    
    main.style.paddingTop = `${totalPadding}px`;
  }
}

// Adjust padding on load and resize
window.addEventListener('load', adjustMainPadding);
window.addEventListener('resize', adjustMainPadding);

// Load public site settings and apply to header/footer
async function applySiteSettings() {
  try {
    const res = await fetch('http://localhost:3000/api/settings');
    const data = await res.json();
    if (!data.success || !data.settings) return;
    const s = data.settings;
    const titleEl = document.getElementById('siteTitle');
    if (titleEl) titleEl.textContent = s.siteTitle || 'BUS TRANSPORT DETAILS';
    const addrEl = document.getElementById('contactAddress');
    const phoneEl = document.getElementById('contactPhone');
    const emailEl = document.getElementById('contactEmail');
    if (addrEl) addrEl.textContent = ` Address: ${s.contact?.address || 'Address line'}`;
    if (phoneEl) phoneEl.textContent = ` Contact: ${s.contact?.phone || '+91 00000 00000'}`;
    if (emailEl) emailEl.textContent = ` Email: ${s.contact?.email || 'support@example.com'}`;
    // Expose Google Maps key to loader
    try { window.SITE_GOOGLE_MAPS_KEY = s.googleMapsApiKey || null; } catch (e) { window.SITE_GOOGLE_MAPS_KEY = null; }
  } catch (e) {
    // Silently ignore, defaults remain
  }
}

// Function to render bus cards
function renderBuses(list) {
    container.innerHTML = "";
    list.forEach(bus => {
    const displayNumber = escapeHtml(busNumberToDisplay.get(String(bus.number)) || String(bus.number));
    const routeText = escapeHtml(bus.routeName || bus.location || '');
    const busName = escapeHtml(bus.name || '');
    // Do not show image preview in the list; image is shown only in the modal when 'View Route' is clicked
    container.innerHTML += `
      <div class="bus-card" data-bus-number="${escapeHtml(bus.number)}">
        <div class="bus-info">
          <div class="bus-number">${displayNumber}</div>
          <div class="bus-details">
            <h3>${busName}</h3>
            <p>📍 ${routeText}</p>
          </div>
        </div>
        <button class="view-btn">View Route</button>
      </div>
    `;
  });
}

// Load buses from database when page loads
loadBusesFromDatabase();
// Apply site settings on load
applySiteSettings();

// Search functionality
document.getElementById("busForm").addEventListener("submit", async function(e) {
  e.preventDefault();
  const contact = document.getElementById("email").value.trim();
  const location = document.getElementById("location").value.trim();

  if (!contact) {
    showNotification('Please enter your email address or phone number.', 'error');
    return;
  }

  // Show loading state
  const submitBtn = document.querySelector(".search-btn");
  const originalText = submitBtn.innerHTML;
  submitBtn.innerHTML = "🔍 Searching...";
  submitBtn.disabled = true;

  try {
    // Call backend API to check bus availability
    const response = await fetch('http://localhost:3000/api/check-availability', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
          email: contact,
          location: location,
          requestBus: (document.getElementById('requestBus') && document.getElementById('requestBus').value === 'yes')
        })
    });

    const data = await response.json();

    if (data.success) {
      const numbers = (data.buses || []).map(b => {
        const real = String(b.busNumber);
        return busNumberToDisplay.get(real) || real;
      });
      // Show availability panel without filtering the main bus list
      renderAvailabilityPanel(data.available, numbers); 
    } else {
      showNotification(data.message || 'Error checking bus availability', 'error');
    }
  } catch (error) {
    console.error('Error:', error);
    showNotification('Unable to connect to server. Please try again.', 'error');
    
    // Fallback to local search
    const query = location.toLowerCase();
  const filtered = buses.filter(bus =>
    bus.location.toLowerCase().includes(query) ||
    bus.name.toLowerCase().includes(query) ||
    bus.number.includes(query)
  );
  renderBuses(filtered.length ? filtered : buses);
  } finally {
    // Reset button state
    submitBtn.innerHTML = originalText;
    submitBtn.disabled = false;
  }
});

// Use current location button
document.getElementById('useCurrentLocation')?.addEventListener('click', () => {
  const btn = document.getElementById('useCurrentLocation');
  const input = document.getElementById('location');
  const form = document.getElementById('busForm');

  if (!navigator.geolocation) {
    showNotification('Geolocation is not supported by your browser.', 'error');
    return;
  }

  const originalText = btn.textContent;
  btn.textContent = '📍 Getting location...';
  btn.setAttribute('disabled', 'true');

  navigator.geolocation.getCurrentPosition(async (position) => {
    try {
      const lat = position.coords.latitude; // use full precision
      const lng = position.coords.longitude; // use full precision
      const accuracyMeters = position.coords.accuracy; // estimated radius in meters
      // Try reverse geocoding to get a readable place name (uses Google Maps JS if available)
      let displayVal = `${lat},${lng}`;
      try {
        await loadGoogleMapsApi();
        const geocoder = new google.maps.Geocoder();
        const results = await new Promise((resolve, reject) => {
          geocoder.geocode({ location: { lat, lng } }, (res, status) => {
            if (status === 'OK' && res && res[0]) return resolve(res);
            return resolve(null);
          });
        });
        if (results && results[0] && results[0].formatted_address) {
          displayVal = results[0].formatted_address;
        }
      } catch (e) {
        // fallback to coords if geocoding fails
      }
      input.value = displayVal;

      // Warn if accuracy is poor (>100m)
      if (typeof accuracyMeters === 'number' && accuracyMeters > 100) {
        showNotification(`Location accuracy is about ~${Math.round(accuracyMeters)}m. Turn on GPS for better accuracy.`, 'warning');
      }

      // If accuracy is poor (> 200m), try improving with watchPosition for a short window
      const targetAccuracy = 100; // meters
      const improveThreshold = 200; // meters
      let submitted = false;
      let bestFix = { lat, lng, accuracy: typeof accuracyMeters === 'number' ? accuracyMeters : Infinity };

      function submitNow() {
        if (submitted) return;
        submitted = true;
        input.value = `${bestFix.lat},${bestFix.lng}`;
        if (typeof form.requestSubmit === 'function') {
          form.requestSubmit();
        } else {
          form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
        }
        btn.textContent = originalText;
        btn.removeAttribute('disabled');
      }

      if (bestFix.accuracy > improveThreshold && navigator.geolocation.watchPosition) {
        showNotification('Improving location accuracy...', 'info');
        const watchId = navigator.geolocation.watchPosition((pos) => {
          const a = typeof pos.coords.accuracy === 'number' ? pos.coords.accuracy : Infinity;
          if (a < bestFix.accuracy) {
            bestFix = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: a };
            input.value = `${bestFix.lat},${bestFix.lng}`;
          }
          if (a <= targetAccuracy) {
            navigator.geolocation.clearWatch(watchId);
            submitNow();
          }
        }, () => {
          // ignore watch errors; we'll submit best after timeout
        }, { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });

        // Stop trying after 15s and submit the best we have
        setTimeout(() => {
          try { navigator.geolocation.clearWatch(watchId); } catch (e) {}
          submitNow();
        }, 15000);
      } else {
        // Auto-submit the form to check availability with current fix
          submitNow();
      }
    } catch (err) {
      console.error(err);
      showNotification('Failed to use current location.', 'error');
    } finally {
      // Button state is reset in submitNow() for the success path; ensure fallback reset on early failures
    }
  }, (error) => {
    let message = 'Unable to retrieve your location.';
    if (error && typeof error.code === 'number') {
      if (error.code === error.PERMISSION_DENIED) message = 'Location permission denied. Please allow access and try again.';
      if (error.code === error.POSITION_UNAVAILABLE) message = 'Location information is unavailable. Try again later.';
      if (error.code === error.TIMEOUT) message = 'Getting location timed out. Please try again.';
    }
    showNotification(message, 'warning');
    btn.textContent = originalText;
    btn.removeAttribute('disabled');
  }, {
    enableHighAccuracy: true,
    timeout: 20000,
    maximumAge: 0
  });
});

// Populate Apply form bus dropdown based on availability (capacity > currentOccupancy)
function populateApplyBusOptions() {
  const select = document.getElementById('applyBus');
  if (!select) return;

  // Clear existing
  select.innerHTML = '';

  // Compute available buses
  const available = (buses || []).filter(b => {
    const cap = Number(b.capacity || 0);
    const occ = Number(b.currentOccupancy || 0);
    return cap > 0 && occ < cap;
  });

  if (available.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.disabled = true;
    opt.selected = true;
    opt.textContent = 'No buses with availability right now';
    select.appendChild(opt);
    select.disabled = true;
    return;
  }

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.disabled = true;
  placeholder.selected = true;
  placeholder.textContent = 'Select a bus';
  select.appendChild(placeholder);

  available.forEach(b => {
    const cap = Number(b.capacity || 0);
    const occ = Number(b.currentOccupancy || 0);
    const left = Math.max(0, cap - occ);
    const opt = document.createElement('option');
    opt.value = b.number;
    opt.textContent = `${b.number} - ${b.name} - ${b.location} (${left} seats left)`;
    select.appendChild(opt);
  });

  select.disabled = false;
}

// If buses were already loaded earlier, try populate on DOMContentLoaded as a fallback
document.addEventListener('DOMContentLoaded', () => {
  if ((buses || []).length > 0) {
    populateApplyBusOptions();
  }
});

// Handle Apply form submit: validate, re-check availability, then redirect to payment placeholder
document.getElementById('applyForm')?.addEventListener('submit', async function(e) {
  e.preventDefault();

  const name = document.getElementById('applyName').value.trim();
  const roll = document.getElementById('applyRoll').value.trim();
  const email = document.getElementById('applyEmail').value.trim();
  const phone = document.getElementById('applyPhone').value.trim();
  const address = document.getElementById('applyAddress').value.trim();
  const busNumber = document.getElementById('applyBus').value;

  if (!name || !roll || !email || !phone || !address || !busNumber) {
    showNotification('Please fill all fields.', 'error');
    return;
  }

  // Re-check availability from current list
  const bus = (buses || []).find(b => b.number === busNumber);
  if (!bus) {
    showNotification('Selected bus not found. Please refresh.', 'error');
    return;
  }
  const cap = Number(bus.capacity || 0);
  const occ = Number(bus.currentOccupancy || 0);
  if (!(cap > 0 && occ < cap)) {
    showNotification('Sorry, this bus is currently full. Please choose another.', 'warning');
    populateApplyBusOptions();
    return;
  }

  // Redirect to placeholder payment page with minimal query params
  const params = new URLSearchParams({
    name,
    roll,
    email,
    phone,
    address,
    bus: busNumber
  });
  // Placeholder redirect target (to be replaced when payment page is added)
  window.location.href = `payment.html?${params.toString()}`;
});

// Notification function
function showNotification(message, type = 'info') {
  // Remove existing notifications
  const existingNotification = document.querySelector('.notification');
  if (existingNotification) {
    existingNotification.remove();
  }

  // Create notification element
  const notification = document.createElement('div');
  notification.className = `notification notification-${type}`;
  notification.innerHTML = `
    <div class="notification-content">
      <span class="notification-message">${message}</span>
      <button class="notification-close">&times;</button>
    </div>
  `;

  // Add styles
  notification.style.cssText = `
    position: fixed;
    top: 100px;
    right: 20px;
    background: ${type === 'success' ? '#28a745' : type === 'warning' ? '#ffc107' : type === 'error' ? '#dc3545' : '#0072ff'};
    color: white;
    padding: 15px 20px;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    z-index: 10000;
    max-width: 400px;
    animation: slideIn 0.3s ease-out;
  `;

  // Add animation styles
  const style = document.createElement('style');
  style.textContent = `
    @keyframes slideIn {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
    .notification-content {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .notification-close {
      background: none;
      border: none;
      color: white;
      font-size: 20px;
      cursor: pointer;
      margin-left: 10px;
    }
  `;
  document.head.appendChild(style);

  // Add to page
  document.body.appendChild(notification);

  // Auto remove after 5 seconds
  setTimeout(() => {
    if (notification.parentNode) {
      notification.remove();
    }
  }, 5000);

  // Close button functionality
  notification.querySelector('.notification-close').addEventListener('click', () => {
    notification.remove();
  });
}

// Escape HTML helper to prevent XSS when inserting user content via innerHTML
function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[&<>"]|'/g, function(c) {
    return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];
  });
}

// Availability result panel below the form
function renderAvailabilityPanel(isAvailable, numbers) {
  // Remove existing panel
  const existing = document.querySelector('.result-panel');
  if (existing) existing.remove();

  const form = document.getElementById('busForm');
  const panel = document.createElement('div');
  panel.className = `result-panel ${isAvailable ? 'result-success' : 'result-warning'}`;

  if (isAvailable) {
    const title = document.createElement('div');
    title.className = 'result-title';
    title.textContent = `Found ${numbers.length} bus(es) serving your area within 1.5km radius!`;
    const line = document.createElement('p');
    line.className = 'result-line';
    line.textContent = `Bus numbers: ${numbers.join(', ')}`;
    panel.appendChild(title);
    panel.appendChild(line);
  } else {
    const title = document.createElement('div');
    title.className = 'result-title';
    title.textContent = 'No buses available nearby';
    const line = document.createElement('p');
    line.className = 'result-line'; line.textContent = 'Right now bus is unavailable within 1.5km radius of your location.';
    panel.appendChild(title);
    panel.appendChild(line);
  }

  form.insertAdjacentElement('afterend', panel);
}

// ---- Admin/Shared: safer route rendering to a given map element ----
function toLatLng(coords) {
  if (!coords) return null;
  if (typeof coords === 'string') {
    const parts = coords.split(',').map(Number);
    if (parts.length === 2 && parts.every(n => !isNaN(n))) {
      return new google.maps.LatLng(parts[0], parts[1]);
    }
    return null;
  }
  if (typeof coords === 'object' && typeof coords.lat === 'number' && typeof coords.lng === 'number') {
    return new google.maps.LatLng(coords.lat, coords.lng);
  }
  return null;
}

async function showRouteOnMap(busNumber, mapElementId, type) {
  try {
    const el = document.getElementById(mapElementId);
    if (!el) { console.error('Map element not found'); return; }

    // Ensure Google Maps is loaded (reuse loader if available)
    if (typeof loadGoogleMapsApi === 'function') {
      await loadGoogleMapsApi();
    } else if (!(window.google && google.maps)) {
      console.error('Google Maps JS API not loaded');
      return;
    }

    const res = await fetch(`http://localhost:3000/api/routes/${busNumber}`);
    const data = await res.json();
    if (!data.success || !data.bus) { console.error('Route not found'); return; }

    const route = type === 'morning' ? data.bus.morningRoute : data.bus.eveningRoute;
    const stops = (route && route.stops) ? route.stops : [];
    if (stops.length < 2) { console.error('Need at least 2 stops'); return; }

    const origin = toLatLng(stops[0].coords);
    const destination = toLatLng(stops[stops.length - 1].coords);
    const waypoints = stops.slice(1, -1).map(s => ({ location: toLatLng(s.coords), stopover: true })).filter(w => !!w.location);

    const map = new google.maps.Map(el, { zoom: 12, center: origin });
    const directionsService = new google.maps.DirectionsService();
    const directionsRenderer = new google.maps.DirectionsRenderer({ map, suppressMarkers: false });

    directionsService.route({
      origin,
      destination,
      waypoints,
      travelMode: google.maps.TravelMode.DRIVING,
      optimizeWaypoints: false,
      provideRouteAlternatives: false
    }, (result, status) => {
      if ((google.maps.DirectionsStatus && status === google.maps.DirectionsStatus.OK) || status === 'OK') {
        directionsRenderer.setDirections(result);
        const bounds = new google.maps.LatLngBounds();
        result.routes[0].overview_path.forEach(p => bounds.extend(p));
        map.fitBounds(bounds);
      } else {
        console.error('Directions request failed:', status);
      }
    });
  } catch (err) {
    console.error('Error loading route:', err);
  }
}

// Modal functionality
const modal = document.getElementById("routeModal");
const modalTitle = document.getElementById("modalTitle");
const closeBtn = document.querySelector(".close");

// Safety check for modal elements
if (!modal || !modalTitle || !closeBtn) {
  console.error("Modal elements not found. Please check HTML structure.");
}

// Handle "View Route" button click
document.addEventListener("click", (e) => {
  if (e.target.classList.contains("view-btn")) {
    const busCard = e.target.closest(".bus-card");
    const busName = busCard.querySelector("h3").textContent;
    // Use real bus number from data attribute for API calls
    const busNumber = busCard.getAttribute("data-bus-number");
    
    // Find the bus data
    const busData = buses.find(bus => bus.number === busNumber);
    if (busData) {
      showModal(busData);
    }
  }
});

// Show modal with bus data
function showModal(busData) {
  // Store current bus data
  currentBusData = busData;
  
  modalTitle.textContent = `${busData.name} - ${busData.location}`;
  
  // Update morning route
  document.getElementById("morningRouteTitle").textContent = 
    `Morning Route: ${busData.morningRoute.from} → ${busData.morningRoute.to}`;
  document.getElementById("morningRouteDescription").textContent = 
    busData.morningRoute.description;
  
  // Create stops list for morning route
  const morningStopsList = busData.morningRoute.stops.map((stop, index) => 
    `${index + 1}. ${stop.name}`
  ).join('<br>');
  document.getElementById("morningRouteStops").innerHTML = 
    `<strong>Route Stops:</strong><br>${morningStopsList}`;
  
  // Update evening route
  document.getElementById("eveningRouteTitle").textContent = 
    `Evening Route: ${busData.eveningRoute.from} → ${busData.eveningRoute.to}`;
  document.getElementById("eveningRouteDescription").textContent = 
    busData.eveningRoute.description;
  
  // Create stops list for evening route
  const eveningStopsList = busData.eveningRoute.stops.map((stop, index) => 
    `${index + 1}. ${stop.name}`
  ).join('<br>');
  document.getElementById("eveningRouteStops").innerHTML = 
    `<strong>Route Stops:</strong><br>${eveningStopsList}`;
  
  // Populate description tab
  const busRouteTextEl = document.getElementById("busRouteText");
  if (busData.morningRoute && busData.morningRoute.stops.length > 0) {
    const routeFlow = busData.morningRoute.stops
      .map(stop => `<div>${stop.name}</div>`)
      .join('<div class="route-arrow">↓</div>');
    busRouteTextEl.innerHTML = `<div class="route-flow">${routeFlow}</div>`;
  } else {
    busRouteTextEl.innerHTML = "<p>Route details not available.</p>";
  }

  // Populate Occupancy
  document.getElementById('busCapacity').textContent = `Bus Capacity: ${busData.capacity || 'N/A'}`;
  document.getElementById('currentOccupancy').textContent = `Current Occupancy: ${busData.currentOccupancy || 0} Students`;

  // Populate Driver Details
  document.getElementById('driverName').textContent = `Name: ${busData.driverName || 'Not available'}`;
  document.getElementById('driverPhone').textContent = `Phone: ${busData.driverPhone || 'Not available'}`;

  // Populate Live Location
  const liveLocationEl = document.getElementById('liveLocationLink');
  if (busData.liveLocationUrl) {
    liveLocationEl.innerHTML = `<a href="${busData.liveLocationUrl}" target="_blank" rel="noopener noreferrer">Click here to view live location</a>`;
  } else {
    liveLocationEl.textContent = 'Live location not available.';
  }

  // Bus image (if present)
  const busImgEl = document.getElementById('busImage');
  if (busImgEl) {
    if (busData.imageUrl) {
      busImgEl.src = busData.imageUrl;
      busImgEl.style.display = 'block';
    } else {
      busImgEl.src = '';
      busImgEl.style.display = 'none';
    }
  }

  // Show schedule times (if present)
  const morningTimesEl = document.getElementById('morningTimes');
  const eveningTimesEl = document.getElementById('eveningTimes');
  if (morningTimesEl) {
    const ms = busData.morningStartTime || null;
    const me = busData.morningEndTime || null;
    morningTimesEl.textContent = (ms || me) ? `Morning: ${ms || '--'} → ${me || '--'}` : 'Morning: Not available';
  }
  if (eveningTimesEl) {
    const es = busData.eveningStartTime || null;
    const ee = busData.eveningEndTime || null;
    eveningTimesEl.textContent = (es || ee) ? `Evening: ${es || '--'} → ${ee || '--'}` : 'Evening: Not available';
  }


  // Generate dynamic maps
  // Make modal visible BEFORE rendering maps so Google Maps can measure container
  modal.style.display = "block";

  // Reset to description tab
  switchRouteTab('details');

  // Prevent body scrolling
  document.body.style.overflow = 'hidden';

  // Render maps after next tick to ensure layout is settled
  setTimeout(() => {
    generateRouteMap('morning', busData.morningRoute);
    generateRouteMap('evening', busData.eveningRoute);
  }, 0);
}





// Generate dynamic route map
async function generateRouteMap(routeType, routeData) {
  const mapContainer = document.querySelector(`#${routeType}Route .route-map`);
  // Hide placeholder
  const placeholder = mapContainer.querySelector('.map-placeholder');
  if (placeholder) placeholder.style.display = 'none';

  // Prepare/clear canvas
  let canvas = mapContainer.querySelector('.map-canvas');
  if (!canvas) {
    canvas = document.createElement('div');
    canvas.className = 'map-canvas';
    canvas.style.width = '100%';
    canvas.style.height = '400px';
    canvas.style.borderRadius = '12px';
    canvas.style.overflow = 'hidden';
    mapContainer.appendChild(canvas);
  } else {
    canvas.innerHTML = '';
  }

  try {
    await loadGoogleMapsApi();

    // Get stops from routeData.stops array
    const stops = routeData.stops || [];
    if (stops.length < 2) {
      throw new Error('Not enough stops for route');
    }

    // Parse coordinates from stops
    const coords = stops.map(stop => {
      const [lat, lng] = stop.coords.split(',').map(Number);
      return { lat, lng };
    });

    // Default center
    const defaultCenter = coords[0] || { lat: 16.5286, lng: 80.6393 };

    const map = new google.maps.Map(canvas, {
      center: defaultCenter,
      zoom: 12,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: true,
      zoomControl: true,
    });

    if (coords.length > 0) {
      // Use Directions API to snap to roads and honor waypoints
      const svc = new google.maps.DirectionsService();
      const rnd = new google.maps.DirectionsRenderer({
        suppressMarkers: true,
        preserveViewport: false,
        polylineOptions: buildPolylineOptions(coords, routeData)
      });
      rnd.setMap(map);

      // Origin and destination
      const origin = coords[0];
      const destination = coords[coords.length - 1];
      
      // Waypoints (all stops except first and last)
      const waypoints = coords.slice(1, -1).map(coord => ({ 
        location: coord, 
        stopover: true 
      }));

      svc.route({
        origin,
        destination,
        waypoints,
        travelMode: google.maps.TravelMode.DRIVING,
        optimizeWaypoints: false,
        provideRouteAlternatives: false
      }, (res, status) => {
        if (status === google.maps.DirectionsStatus.OK && res) {
          rnd.setDirections(res);
        } else {
          // Fallback to straight polyline if directions fail
          const polyline = new google.maps.Polyline(buildPolylineOptions(coords, routeData));
          polyline.setMap(map);
          const bounds = new google.maps.LatLngBounds();
          coords.forEach(c => bounds.extend(c));
          map.fitBounds(bounds);
        }
      });


      

      // Create markers for each stop with custom icons and info windows
      stops.forEach((stop, index) => {
        const [lat, lng] = stop.coords.split(',').map(Number);
        const position = { lat, lng };
        
        // Different marker for start, waypoints, and end
        let markerIcon = '';
        let label = '';
        let markerColor = '#0072ff';
        
        if (index === 0) {
          // Start marker
          markerIcon = '🚌';
          label = 'S';
          markerColor = '#28a745';
        } else if (index === stops.length - 1) {
          // End marker
          markerIcon = '🏫';
          label = 'D';
          markerColor = '#dc3545';
        } else {
          // Waypoint marker
          markerIcon = '📍';
          label = (index).toString();
          markerColor = '#ffc107';
        }

        const marker = new google.maps.Marker({
          position,
          map,
          label: {
            text: label,
            color: 'white',
            fontWeight: 'bold',
            fontSize: '12px'
          },
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 8,
            fillColor: markerColor,
            fillOpacity: 1,
            strokeColor: 'white',
            strokeWeight: 2
          },
          title: stop.name
        });

        // Info window for each stop
        const infoWindow = new google.maps.InfoWindow({
          content: `
            <div style="padding: 8px; font-family: Arial, sans-serif;">
              <strong>${stop.name}</strong><br>
              <small>Stop ${index + 1} of ${stops.length}</small><br>
              <small>Coordinates: ${stop.coords}</small>
            </div>
          `
        });

        marker.addListener('click', () => {
          infoWindow.open(map, marker);
        });
      });
    }
  } catch (err) {
    // On failure, show placeholder
    if (placeholder) placeholder.style.display = 'flex';
    console.error('Map render failed:', err);
  }
}

// Close modal
function closeModal() {
  modal.style.display = "none";
  // Restore body scrolling
  document.body.style.overflow = 'auto';
  // Reset current bus data
  currentBusData = null;
  // Reset modal to description route
  switchRouteTab('details');
  // Restore placeholder content
  restorePlaceholders();
}

// Restore placeholder content
function restorePlaceholders() {
  const morningMap = document.querySelector('#morningRoute .route-map');
  const eveningMap = document.querySelector('#eveningRoute .route-map');
  
  // Remove any existing map images
  const morningImg = morningMap.querySelector('img');
  const eveningImg = eveningMap.querySelector('img');
  
  if (morningImg) morningImg.remove();
  if (eveningImg) eveningImg.remove();
  
  // Show placeholders
  const morningPlaceholder = morningMap.querySelector('.map-placeholder');
  const eveningPlaceholder = eveningMap.querySelector('.map-placeholder');
  
  if (morningPlaceholder) morningPlaceholder.style.display = 'flex';
  if (eveningPlaceholder) eveningPlaceholder.style.display = 'flex';
}

// Event listeners for closing modal
closeBtn.addEventListener("click", closeModal);

// Intentionally disable closing by clicking outside or Escape key
// Modal will close only via the header close (X) button

// Tab switching functionality
function switchRouteTab(routeType) {
  // Remove active class from all tabs and sections
  document.querySelectorAll(".tab-btn").forEach(btn => btn.classList.remove("active"));
  document.querySelectorAll(".route-section").forEach(section => section.classList.remove("active"));
  
  // Add active class to selected tab and section
  const tabButton = document.querySelector(`[data-route="${routeType}"]`);  
  if (tabButton) tabButton.classList.add("active");  
  const routeSection = document.getElementById(`${routeType}Route`);  
  if (routeSection) routeSection.classList.add("active");
}

// Store current bus data for map regeneration
let currentBusData = null;

// Handle tab clicks
document.addEventListener("click", (e) => {
  if (e.target.classList.contains("tab-btn")) {
    const routeType = e.target.getAttribute("data-route");
    switchRouteTab(routeType);
  }
});
