# Bus Transport App

Minimal setup to run the app (API + static pages: user, admin, settings).

## Quick start
1) Install
```bash
npm install
```
2) Configure `.env` (example values shown)
```env
PORT=3000
ADMIN_JWT_SECRET=change-this
DATABASE_URL=\"postgresql://postgres:password@localhost:5432/bus_transport\"
GOOGLE_MAPS_API_KEY=your-key
GEOCODE_COUNTRY=IN
GEOCODE_REGION=in
# Superadmin (can approve admins)
MAIN_ADMIN_EMAIL=you@example.com
MAIN_ADMIN_PASSWORD=strong-password
```
3) Database
```bash
npx prisma generate
npm run db:migrate
npm run db:seed
```
4) Run
```bash
npm run dev
```
Open `page.html` (user) and `admin.html` (admin login). New admins can request access at `admin-signup.html`; superadmin approves in dashboard → Admin Approvals.

## Key endpoints
- POST `/api/check-availability`
- GET `/api/routes`
- Admin: POST `/api/admin/login`, GET `/api/admin/me`, GET `/api/admin/logs`
- Settings: GET `/api/settings`, PUT `/api/admin/settings`
- Admin approvals: POST `/api/admin/signup-request`, GET `/api/admin/requests`, POST `/api/admin/requests/:email/(approve|reject)`

## Notes
- Requires a valid Google Maps API key for geocoding/reverse-geocoding.
- Data is stored in PostgreSQL (configure via `DATABASE_URL` in `.env`).
