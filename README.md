FRONTEND COMPATIBLE WITH YOUR CURRENT BACKEND

Backend routes used:
- GET /api/bottles
- GET /api/bottles/:barcode
- GET /api/stock
- POST /api/stock/assign
- POST /api/stock/transfer
- GET /api/stock/movements/history
- GET /api/readings
- POST /api/readings

No /auth/login, /outlets, /bars, /products routes are used, so 404 errors from those old routes are removed.

Run:
npm install
npm run dev

Vercel:
VITE_API_URL=https://backend-all-tgww.onrender.com/api
