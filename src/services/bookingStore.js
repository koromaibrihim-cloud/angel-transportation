'use strict';

// In-memory store. Replace with PostgreSQL/MongoDB for production.
const bookings    = new Map();   // txRef → booking object
const holdTimers  = new Map();   // txRef → timeout handle
const userBookings = new Map();  // userId → [txRef]

const HOLD_MS = 10 * 60 * 1000; // 10 minutes

function createBooking({ ref, txRef, userId, from, to, date, busId, seats, passengers, children, totalAmount, extras }) {
  const booking = {
    ref,
    txRef,
    userId: userId || null,
    status: 'pending',   // pending | confirmed | failed | expired
    from, to, date,
    busId, seats,
    passengers,
    children: children || [],
    totalAmount,
    extras,
    createdAt: new Date().toISOString(),
    confirmedAt: null,
    flwTransactionId: null,
    qrCode: null,
  };

  bookings.set(txRef, booking);

  if (userId) {
    const list = userBookings.get(userId) || [];
    list.push(txRef);
    userBookings.set(userId, list);
  }

  // Release seats automatically if payment never completes
  const timer = setTimeout(() => _expireBooking(txRef), HOLD_MS);
  holdTimers.set(txRef, timer);

  return booking;
}

function getUserBookings(userId) {
  const txRefs = userBookings.get(userId) || [];
  return txRefs
    .map(ref => bookings.get(ref))
    .filter(Boolean)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function confirmBooking(txRef, { flwTransactionId, qrCode }) {
  const booking = bookings.get(txRef);
  if (!booking || booking.status !== 'pending') return null;

  _clearTimer(txRef);

  booking.status = 'confirmed';
  booking.confirmedAt = new Date().toISOString();
  booking.flwTransactionId = flwTransactionId;
  booking.qrCode = qrCode;

  return booking;
}

function failBooking(txRef) {
  const booking = bookings.get(txRef);
  if (!booking || booking.status !== 'pending') return null;
  _clearTimer(txRef);
  booking.status = 'failed';
  return booking;
}

function getBooking(txRef) {
  return bookings.get(txRef) || null;
}

// ── private ──────────────────────────────────────────────────────────────────

function _expireBooking(txRef) {
  const booking = bookings.get(txRef);
  if (!booking || booking.status !== 'pending') return;
  booking.status = 'expired';
  holdTimers.delete(txRef);
  console.log(`[seat-release] Booking ${booking.ref} expired — seats ${booking.seats.join(', ')} released`);
}

function _clearTimer(txRef) {
  const t = holdTimers.get(txRef);
  if (t) { clearTimeout(t); holdTimers.delete(txRef); }
}

module.exports = { createBooking, confirmBooking, failBooking, getBooking, getUserBookings };
