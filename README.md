# ChitPro — Chit Fund Management System

A full-stack chit fund (chit business) management system: Node.js + Express +
PostgreSQL backend with a Socket.IO-powered live auction, and a colorful
HTML/CSS/JS frontend for admin and customer portals.

## What's included

```
chitpro/
├── backend/
│   ├── database/schema.sql        PostgreSQL schema (all tables from the spec)
│   ├── src/
│   │   ├── server.js              Express + Socket.IO entry point
│   │   ├── db.js                  PostgreSQL connection pool
│   │   ├── middleware/auth.js     JWT auth + role guard
│   │   ├── routes/                auth, members, chits, auctions, payments, dues, payouts, reports
│   │   ├── scripts/createAdmin.js CLI to safely create the first admin user
│   │   └── utils/audit.js         Audit log writer
│   ├── package.json
│   └── .env.example
└── frontend/
    └── index.html                 Single-file admin + customer UI, wired to the API
```

## What's implemented (M1–M5 of the roadmap)

- Admin login (mobile + password, JWT) and customer login (mobile + OTP, JWT)
- Role-based access control: SUPER_ADMIN, ADMIN, MANAGER, STAFF, ACCOUNTANT, CUSTOMER
- Members: create, list, search, update, delete, per-member chits and payments
- Chit plans and groups: create plans, form groups, add/remove members, vacancy check
- Live auctions over Socket.IO: start/pause/resume/close, place bids in real time,
  confirm winner (auto-creates a pending payout), bid history
- Payments: record a payment, auto-generates a receipt number, posts to cash flow
- Dues: outstanding installments list, reminder trigger (stub — wire to WhatsApp/SMS)
- Payouts: bank/UPI accounts, approve → process → complete/fail flow
- Reports: dashboard summary cards, cash flow totals, dues summary
- Audit log: every create/update/approve action is recorded with old/new values

## What's stubbed (needs a provider you choose)

- OTP delivery and due/auction reminders (`sendOtp()` in `routes/auth.js`,
  `/dues/:id/remind` in `routes/dues.js`) just `console.log` — plug in an
  SMS gateway or the WhatsApp Business API where marked `TODO`.
- Payment gateway for online payments (the schema and `payments` table
  support recording any method; card/UPI collection itself needs a gateway
  like Razorpay/Cashfree if you want in-app collection, not just recording).
- Dividend-split business rules in `confirm-winner` are simplified — the
  discount between chit value and winning bid is returned in the response
  so you can apply your own commission/dividend formula.

## Setup

### 1. Database

```bash
createdb chitpro
psql -d chitpro -f backend/database/schema.sql
```

### 2. Backend

```bash
cd backend
cp .env.example .env
# edit .env: set DATABASE_URL and a real JWT_SECRET
npm install
npm run create-admin -- "Your Name" 9999999999 YourPassword123
npm run dev        # starts on http://localhost:4000
```

### 3. Frontend

`frontend/index.html` is a static file — open it directly in a browser, or
serve it (e.g. `npx serve frontend`). On load it shows a login screen:

- **Admin/staff tab** — sign in with the mobile + password you created above.
- **Customer OTP tab** — needs a member row with that mobile number in the
  `members` table; the OTP is printed to the backend console (no SMS
  provider wired up yet).
- **"Continue with sample data"** — skips login and shows the UI with demo
  numbers, useful for a walkthrough with no backend running.

The small "API" box in the bottom-right corner of the login screen lets you
point the frontend at a different backend URL (defaults to
`http://localhost:4000/api`).

### 4. Live auctions

The frontend's auction screen needs a real `auction_round_id` to subscribe
to. After creating a chit plan → group → auction round via the API, set
`currentAuctionId` near the top of the `<script>` block in `index.html` (or
extend the UI with an auction picker) — then "Place bid" and "Confirm
winner" call the real endpoints and update instantly for every connected
viewer over Socket.IO.

## API reference

All endpoints are under `/api`. Protected routes need
`Authorization: Bearer <token>` from either login endpoint.

| Area | Endpoints |
|---|---|
| Auth | `POST /auth/admin/login`, `POST /auth/customer/send-otp`, `POST /auth/customer/verify-otp`, `POST /auth/refresh`, `POST /auth/logout`, `POST /auth/forgot-password` |
| Members | `GET/POST /members`, `GET/PUT/DELETE /members/:id`, `GET /members/:id/chits`, `GET /members/:id/payments` |
| Chits | `GET/POST /chits`, `GET/PUT/DELETE /chits/:id`, `PATCH /chits/:id/rename`, `POST/GET /chits/:id/groups`, `POST /chits/groups/:id/members`, `DELETE /chits/groups/:id/members/:memberId`, `GET /chits/groups/:id/vacancies` |
| Auctions | `GET /auctions`, `GET /auctions/live`, `POST /auctions`, `PUT/DELETE /auctions/:id`, `POST /auctions/:id/{start,pause,resume,close}`, `POST/GET /auctions/:id/bids`, `GET /auctions/:id/result`, `POST /auctions/:id/confirm-winner` |
| Payments | `GET/POST /payments`, `GET /payments/:id/receipt` |
| Dues | `GET /dues`, `POST /dues/:installmentId/remind` |
| Payouts | `GET /payouts`, `POST /payouts/accounts`, `POST /payouts/:id/{approve,complete,fail}` |
| Reports | `GET /reports/dashboard`, `GET /reports/cash-flow`, `GET /reports/dues-summary` |

## Suggested next steps (M6–M9 from the original roadmap)

1. Wire an SMS/WhatsApp provider into `sendOtp()` and the reminder endpoint.
2. Build out the Staff & Permissions settings screens against the existing
   role checks (the permission matrix in the UI is already backed by
   `requireRole()` on every route).
3. Add automated installment generation when a chit group fills up (a
   scheduled job that inserts one `installments` row per member per round).
4. Add a backup/restore job (`pg_dump` on a cron, stored in `backups/`).
5. Deploy: backend behind HTTPS (e.g. behind Nginx or a platform like
   Render/Railway), Postgres managed (RDS/Supabase/Neon), frontend on any
   static host, and point `apiBaseInput` at the production API URL.
