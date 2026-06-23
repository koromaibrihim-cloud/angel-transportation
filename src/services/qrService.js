'use strict';

const QRCode = require('qrcode');

async function generateTicketQR(booking) {
  const payload = JSON.stringify({
    ref: booking.ref,
    operator: 'Angel Transportation',
    from: booking.from,
    to: booking.to,
    date: booking.date,
    seats: booking.seats,
    issuedAt: new Date().toISOString(),
  });

  return QRCode.toDataURL(payload, {
    width: 200,
    margin: 2,
    color: { dark: '#1a56db', light: '#ffffff' },
    errorCorrectionLevel: 'M',
  });
}

module.exports = { generateTicketQR };
