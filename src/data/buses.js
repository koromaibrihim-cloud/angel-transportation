'use strict';

const BUSES = [
  { id: 1, operator: 'Angel VIP Express',   code: 'VIP', color: '#1a56db', type: 'VIP AC',        dep: '06:00', arr: '10:00', duration: '4h 00m', amenities: ['AC', 'WiFi', 'USB Port', 'Recliner'], baseFare: 250000, totalSeats: 36 },
  { id: 2, operator: 'Angel Executive',      code: 'EXE', color: '#059669', type: 'Executive AC',   dep: '07:30', arr: '12:00', duration: '4h 30m', amenities: ['AC', 'USB Port'],                    baseFare: 200000, totalSeats: 40 },
  { id: 3, operator: 'Angel Business Coach', code: 'BUS', color: '#7c3aed', type: 'Business Class', dep: '09:00', arr: '14:00', duration: '5h 00m', amenities: ['AC', 'Recliner'],                    baseFare: 180000, totalSeats: 44 },
  { id: 4, operator: 'Angel Express',        code: 'EXP', color: '#dc2626', type: 'Standard AC',    dep: '10:00', arr: '15:30', duration: '5h 30m', amenities: ['AC'],                                baseFare: 150000, totalSeats: 50 },
  { id: 5, operator: 'Angel Night Rider',    code: 'NGT', color: '#0f172a', type: 'Overnight AC',   dep: '20:00', arr: '01:00', duration: '5h 00m', amenities: ['AC', 'Blanket', 'Snack'],            baseFare: 190000, totalSeats: 40 },
  { id: 6, operator: 'Angel Economy Plus',   code: 'ECO', color: '#d97706', type: 'Economy',        dep: '12:00', arr: '18:00', duration: '6h 00m', amenities: ['Fan'],                               baseFare: 100000, totalSeats: 54 },
];

// Multipliers relative to Freetown→Bo baseline (= 1.0)
const ROUTE_MULTIPLIERS = {
  'Freetown-Bo': 1.0,             'Freetown-Kenema': 1.35,          'Freetown-Makeni': 0.80,
  'Freetown-Koidu (Kono)': 1.70,  'Freetown-Kailahun': 1.90,        'Freetown-Port Loko': 0.55,
  'Freetown-Kambia': 0.80,        'Freetown-Kabala': 1.30,           'Freetown-Magburaka': 0.90,
  'Freetown-Lunsar': 0.50,        'Freetown-Waterloo': 0.15,         'Freetown-Pujehun': 1.20,
  'Freetown-Moyamba': 0.65,       'Freetown-Bonthe': 1.40,           'Freetown-Mattru Jong': 1.10,
  'Freetown-Lungi': 0.20,         'Freetown-Bumbuna': 1.10,          'Freetown-Falaba': 1.60,
  'Freetown-Pendembu': 1.75,      'Freetown-Daru': 1.80,             'Freetown-Segbwema': 1.45,
  'Freetown-Blama': 1.20,         'Freetown-Zimmi': 1.50,
  'Bo-Kenema': 0.50,              'Bo-Pujehun': 0.55,                'Bo-Moyamba': 0.40,
  'Bo-Mattru Jong': 0.60,         'Bo-Blama': 0.45,                  'Bo-Zimmi': 0.70,
  'Bo-Tikonko': 0.15,             'Bo-Bumpe': 0.25,                  'Bo-Mano': 0.30,
  'Kenema-Kailahun': 0.70,        'Kenema-Koidu (Kono)': 0.80,       'Kenema-Segbwema': 0.35,
  'Kenema-Pendembu': 0.65,        'Kenema-Daru': 0.75,               'Kenema-Panguma': 0.30,
  'Makeni-Kabala': 0.70,          'Makeni-Port Loko': 0.40,          'Makeni-Magburaka': 0.30,
  'Makeni-Binkolo': 0.15,         'Makeni-Kambia': 0.55,             'Makeni-Lunsar': 0.30,
  'Makeni-Bumbuna': 0.50,         'Makeni-Falaba': 0.90,
  'Port Loko-Kambia': 0.40,       'Port Loko-Lunsar': 0.20,          'Port Loko-Rokupr': 0.25,
  'Kabala-Falaba': 0.45,          'Kabala-Gberia Fotombu': 0.35,
  'Koidu (Kono)-Yengema': 0.15,   'Koidu (Kono)-Sefadu': 0.10,       'Koidu (Kono)-Gandorhun': 0.25,
  'Kailahun-Daru': 0.30,          'Kailahun-Buedu': 0.35,            'Kailahun-Pendembu': 0.40,
};

function calculateFare(bus, from, to) {
  const key1 = `${from}-${to}`;
  const key2 = `${to}-${from}`;
  const mult = ROUTE_MULTIPLIERS[key1] || ROUTE_MULTIPLIERS[key2] || 0.75;
  return Math.round((bus.baseFare * mult) / 1000) * 1000;
}

module.exports = { BUSES, ROUTE_MULTIPLIERS, calculateFare };
