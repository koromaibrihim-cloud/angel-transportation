'use strict';

require('dotenv').config();

const express  = require('express');
const cors     = require('cors');
const path     = require('path');
const crypto   = require('crypto');
const { v4: uuidv4 } = require('uuid');
const Flutterwave    = require('flutterwave-node-v3');

const { BUSES, calculateFare }   = require('./src/data/buses');
const { createBooking, confirmBooking, failBooking, getBooking, getUserBookings } = require('./src/services/bookingStore');
const { generateTicketQR }       = require('./src/services/qrService');
const { sendBookingConfirmationSMS } = require('./src/services/smsService');

const app  = express();
const PORT = process.env.PORT || 3000;

const flw = new Flutterwave(
  process.env.FLW_PUBLIC_KEY  || 'FLWPUBK_TEST-missing',
  process.env.FLW_SECRET_KEY  || 'FLWSECK_TEST-missing'
);

// ── CORS ─────────────────────────────────────────────────────────────────────
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : ['http://localhost:3000', process.env.APP_URL].filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    // allow requests with no origin (mobile apps, curl, Postman, same-origin)
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));

// ── Middleware ────────────────────────────────────────────────────────────────

// Webhook needs the raw body for signature comparison — register BEFORE express.json()
app.use('/api/webhook/flutterwave', express.raw({ type: 'application/json' }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── In-memory user store ─────────────────────────────────────────────────────
const users = new Map(); // email → { id, firstName, lastName, email, phone, passwordHash }

function hashPassword(pass) {
  return crypto.createHash('sha256').update(pass + 'angel-salt').digest('hex');
}

// ── POST /api/auth/register ───────────────────────────────────────────────────
app.post('/api/auth/register', (req, res) => {
  const { firstName, lastName, email, phone, password } = req.body;

  if (!firstName || !lastName || !email || !password)
    return res.status(400).json({ error: 'First name, last name, email and password are required.' });

  if (password.length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });

  const key = email.toLowerCase().trim();
  if (users.has(key))
    return res.status(409).json({ error: 'An account with this email already exists. Please log in.' });

  const user = {
    id: uuidv4(),
    firstName: firstName.trim(),
    lastName:  lastName.trim(),
    email:     key,
    phone:     (phone || '').trim(),
    passwordHash: hashPassword(password),
    createdAt: new Date().toISOString(),
  };
  users.set(key, user);

  console.log(`[auth] New user registered: ${user.email}`);

  const { passwordHash: _, ...safeUser } = user;
  res.status(201).json({ user: safeUser });
});

// ── POST /api/auth/login ──────────────────────────────────────────────────────
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'Email and password are required.' });

  const user = users.get(email.toLowerCase().trim());
  if (!user || user.passwordHash !== hashPassword(password))
    return res.status(401).json({ error: 'Incorrect email or password.' });

  console.log(`[auth] Login: ${user.email}`);

  const { passwordHash: _, ...safeUser } = user;
  res.json({ user: safeUser });
});

// ── POST /api/booking/create ──────────────────────────────────────────────────
// Called by the frontend before launching the Flutterwave checkout modal.
// Creates a pending booking and starts the 10-minute seat-hold timer.
app.post('/api/booking/create', (req, res) => {
  const { from, to, date, busId, seats, passengers, children, extras, userId } = req.body;

  if (!from || !to || !date || !busId || !Array.isArray(seats) || !seats.length || !Array.isArray(passengers) || !passengers.length) {
    return res.status(400).json({ error: 'Missing required booking fields.' });
  }

  const bus = BUSES.find(b => b.id === busId);
  if (!bus) return res.status(404).json({ error: 'Bus not found.' });

  // Fare always calculated server-side — frontend cannot manipulate amounts
  const farePerSeat  = calculateFare(bus, from, to);
  const adultFare    = farePerSeat * seats.length;

  // Children: 0-2 yrs free, 3-11 yrs 50% off per child
  const childrenFare = (Array.isArray(children) ? children : []).reduce((sum, c) => {
    const age = parseInt(c.age);
    return sum + (age >= 3 && age <= 11 ? Math.round(farePerSeat * 0.5) : 0);
  }, 0);

  const insurance  = extras?.insurance ? 10000 * passengers.length : 0;
  const luggage    = extras?.luggage   ? 20000 : 0;
  const serviceFee = 5000;
  const totalAmount = adultFare + childrenFare + insurance + luggage + serviceFee;

  const bookingRef = `ANG-${randomCode(6)}`;
  const txRef      = `ANG-TX-${uuidv4()}`;

  createBooking({ ref: bookingRef, txRef, userId: userId || null, from, to, date, busId, seats, passengers, children: children || [], totalAmount, extras });

  console.log(`[booking] Created ${bookingRef} | ${from}→${to} | ${seats.join(',')} | Le ${totalAmount.toLocaleString()}`);

  res.json({
    bookingRef,
    txRef,
    totalAmount,
    publicKey: process.env.FLW_PUBLIC_KEY,
    primaryPassenger: passengers[0],
  });
});

// ── POST /api/webhook/flutterwave ─────────────────────────────────────────────
// Flutterwave calls this after every payment event.
// We respond 200 immediately, then verify and process asynchronously.
app.post('/api/webhook/flutterwave', (req, res) => {
  // Verify the secret hash Flutterwave sends in the verif-hash header
  const incomingHash = req.headers['verif-hash'];
  if (!incomingHash || incomingHash !== process.env.FLW_WEBHOOK_SECRET) {
    console.warn('[webhook] Rejected — bad verif-hash');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Respond immediately so Flutterwave does not retry
  res.status(200).json({ received: true });

  // Process asynchronously — never block the response
  _processWebhook(req.body).catch(err =>
    console.error('[webhook] Processing error:', err)
  );
});

// ── GET /api/booking/status/:txRef ────────────────────────────────────────────
// Polled by the frontend after the Flutterwave modal closes.
app.get('/api/booking/status/:txRef', (req, res) => {
  const booking = getBooking(req.params.txRef);
  if (!booking) return res.status(404).json({ error: 'Booking not found.' });

  res.json({
    ref:         booking.ref,
    status:      booking.status,       // pending | confirmed | failed | expired
    qrCode:      booking.status === 'confirmed' ? booking.qrCode : null,
    confirmedAt: booking.confirmedAt,
    from:        booking.from,
    to:          booking.to,
    date:        booking.date,
    seats:       booking.seats,
  });
});

// ── GET /ping — lightweight health check (used by uptime monitors) ───────────
app.get('/ping', (_req, res) => res.json({ ok: true, ts: Date.now() }));

// ── GET /api/user/trips/:userId ───────────────────────────────────────────────
app.get('/api/user/trips/:userId', (req, res) => {
  const trips = getUserBookings(req.params.userId).map(b => ({
    ref:         b.ref,
    status:      b.status,
    from:        b.from,
    to:          b.to,
    date:        b.date,
    seats:       b.seats,
    passengers:  b.passengers,
    children:    b.children,
    totalAmount: b.totalAmount,
    qrCode:      b.status === 'confirmed' ? b.qrCode : null,
    confirmedAt: b.confirmedAt,
    createdAt:   b.createdAt,
  }));
  res.json({ trips });
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚌 Angel Transportation server running`);
  console.log(`   Local:   http://localhost:${PORT}`);
  console.log(`   Network: http://<your-ip>:${PORT}  (accessible from phones/tablets on same WiFi)\n`);
  if (!process.env.FLW_PUBLIC_KEY || process.env.FLW_PUBLIC_KEY.includes('missing')) {
    console.warn('⚠  FLW_PUBLIC_KEY not set. Add your Flutterwave keys to .env');
  }
});

// ── Webhook processor (async, runs after 200 is sent) ────────────────────────
async function _processWebhook(rawBody) {
  const payload = JSON.parse(rawBody.toString());

  if (payload.event !== 'charge.completed') return;

  const { status, tx_ref: txRef, id: flwId, amount, currency } = payload.data;

  const booking = getBooking(txRef);
  if (!booking) {
    console.warn(`[webhook] No booking found for txRef ${txRef}`);
    return;
  }
  if (booking.status !== 'pending') {
    console.log(`[webhook] Booking ${booking.ref} already ${booking.status} — skipping`);
    return;
  }

  if (status !== 'successful') {
    failBooking(txRef);
    console.log(`[webhook] Payment failed for ${booking.ref}`);
    return;
  }

  // Always verify with Flutterwave's API — never trust the webhook payload alone
  const verify = await flw.Transaction.verify({ id: flwId });
  const vd = verify.data;

  if (
    vd.status   !== 'successful'   ||
    vd.tx_ref   !== txRef          ||
    vd.currency !== 'SLL'          ||
    vd.amount   < booking.totalAmount
  ) {
    failBooking(txRef);
    console.error(`[webhook] Verification mismatch for ${booking.ref}`, {
      status: vd.status, currency: vd.currency,
      expected: booking.totalAmount, received: vd.amount,
    });
    return;
  }

  // Generate QR code
  const qrCode = await generateTicketQR(booking);

  // Confirm booking and store QR
  confirmBooking(txRef, { flwTransactionId: flwId, qrCode });
  console.log(`✅ [webhook] Booking ${booking.ref} confirmed (flw id: ${flwId})`);

  // Send SMS to every passenger in parallel — failures don't block anything
  await Promise.allSettled(
    booking.passengers
      .filter(p => p.phone)
      .map(p => sendBookingConfirmationSMS(p.phone, booking))
  );
}

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error('[error]', err.message);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

process.on('unhandledRejection', (reason) => console.error('[unhandledRejection]', reason));
process.on('uncaughtException',  (err)    => console.error('[uncaughtException]',  err));

// ── Helpers ───────────────────────────────────────────────────────────────────
function randomCode(len) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}
