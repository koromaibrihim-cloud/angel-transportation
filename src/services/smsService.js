'use strict';

// SMS via Termii (termii.com) — well-supported across West Africa including Sierra Leone.
// Set TERMII_API_KEY in .env. If the key is absent, messages are logged to console only.

const TERMII_URL = 'https://api.ng.termii.com/api/sms/send';
const SENDER_ID  = 'AngelBus'; // Register this in your Termii dashboard

async function sendBookingConfirmationSMS(phone, booking) {
  const message =
    `Angel Transportation: Booking ${booking.ref} CONFIRMED! ` +
    `${booking.from} to ${booking.to} on ${booking.date}. ` +
    `Seat(s): ${booking.seats.join(', ')}. ` +
    `Show your e-ticket QR code at boarding. Safe travels!`;

  if (!process.env.TERMII_API_KEY) {
    console.log(`[SMS skipped — no TERMII_API_KEY] To: ${phone} | ${message}`);
    return { status: 'skipped' };
  }

  const res = await fetch(TERMII_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to: phone,
      from: SENDER_ID,
      sms: message,
      type: 'plain',
      api_key: process.env.TERMII_API_KEY,
      channel: 'generic',
    }),
  });

  const data = await res.json();
  if (!res.ok) console.error('[SMS] Termii error:', data);
  return data;
}

module.exports = { sendBookingConfirmationSMS };
