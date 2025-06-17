import express from 'express';
import mysql from 'mysql2/promise';
import cors from 'cors';
import dotenv from 'dotenv';
import crypto from 'crypto';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: [
    'https://plumeriaretreat.vercel.app',
    'http://localhost:5173',
    'http://localhost:5174'
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));
// app.options('/*', cors());

app.use(express.json());

// Database configuration
const dbConfig = {
  host: process.env.DB_HOST || 'in-mum-web1671.main-hosting.eu',
  user: process.env.DB_USER || 'u973488458_plumeria',
  password: process.env.DB_PASSWORD || 'Plumeria_retreat1234',
  database: process.env.DB_NAME || 'u973488458_plumeria',
  port: parseInt(process.env.DB_PORT || '3306')
};
// const dbConfig={
//   host: 'localhost',
//   user: 'root',
//   password: '2005',
//   database: 'camping_retreat',
//   port: 3306
// }

// Create database connection pool
const pool = mysql.createPool({
  ...dbConfig,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Helper function to execute queries
async function executeQuery(query, params = []) {
  try {
    const [results] = await pool.execute(query, params);
    return results;
  } catch (error) {
    console.error('Database query error:', error);
    throw error;
  }
}

// API Routes

// Get all navigation items
app.get('/api/nav-items', async (req, res) => {
  try {
    res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
    const results = await executeQuery('SELECT label, path FROM nav_items ORDER BY id');
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch navigation items' });
  }
});

// Get all accommodations with packages
app.get('/api/accommodations', async (req, res) => {
  try {
    res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
    const accommodations = await executeQuery(`
      SELECT *
      FROM accommodations 
      ORDER BY id
    `);

    // Fetch packages for each accommodation
    for (let accommodation of accommodations) {
      const packages = await executeQuery(`
        SELECT *
        FROM packages
        WHERE accommodation_id = ? AND active = 1
      `, [accommodation.id]);
      
      accommodation.packages = packages;
    }

    res.json(accommodations);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch accommodations' });
  }
});

// Get all meal plans
app.get('/api/meal-plans', async (req, res) => {
  try {
    res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
    const results = await executeQuery(`
      SELECT id, type, title, description, price, includes 
      FROM meal_plans 
      ORDER BY id
    `);
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch meal plans' });
  }
});

// Get all activities
app.get('/api/activities', async (req, res) => {
  try {
    res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
    const results = await executeQuery(`
      SELECT id, title, description, price, image, duration 
      FROM activities 
      ORDER BY id
    `);
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch activities' });
  }
});

// Get all FAQs
app.get('/api/faqs', async (req, res) => {
  try {
    res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
    const results = await executeQuery(`
      SELECT id, question, answer 
      FROM faqs 
      ORDER BY id
    `);
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch FAQs' });
  }
});

// Get all gallery images
app.get('/api/gallery-images', async (req, res) => {
  try {
    res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
    const results = await executeQuery(`
      SELECT id, src, alt, category, width, height 
      FROM gallery_images 
      ORDER BY id
    `);
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch gallery images' });
  }
});

// Get all testimonials
app.get('/api/testimonials', async (req, res) => {
  try {
    res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
    const results = await executeQuery(`
      SELECT id, name, location, image, rating, text 
      FROM testimonials 
      ORDER BY id
    `);
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch testimonials' });
  }
});

// Get all nearby locations
app.get('/api/nearby-locations', async (req, res) => {
  try {
    res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
    const results = await executeQuery(`
      SELECT id, name, distance, image, description 
      FROM nearby_locations 
      ORDER BY distance
    `);
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch nearby locations' });
  }
});

// Get all packages
app.get('/api/packages', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  const accommodationId = parseInt(req.query.accommodation);
  const pkgId = parseInt(req.query.package);
  // If both query params are present, fetch the specific package
  if (accommodationId && pkgId) {
    try {
      const [pkg] = await executeQuery(
        `SELECT * FROM packages WHERE id = ? AND accommodation_id = ? AND active = 1 LIMIT 1`,
        [pkgId, accommodationId]
      );
      if (!pkg) return res.status(404).json({ error: 'Package not found' });

      // Parse JSON fields
      if (typeof pkg.includes === 'string') {
        try { pkg.includes = JSON.parse(pkg.includes); } catch {}
      }
      if (typeof pkg.detailed_info === 'string') {
        try { pkg.detailed_info = JSON.parse(pkg.detailed_info); } catch {}
      }

      res.json(pkg);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch package' });
    }
    return;
  }

  // Otherwise, return all packages (existing logic)
  try {
    const results = await executeQuery(`
      SELECT 
        id, accommodation_id as accommodationId, name, description, 
        price, duration, max_guests as maxGuests, image_url as imageUrl,
        includes, active, detailed_info as detailedInfo
      FROM packages 
      WHERE active = 1
      ORDER BY id
    `);

    // Parse JSON fields for all packages
    for (const pkg of results) {
      if (typeof pkg.includes === 'string') {
        try { pkg.includes = JSON.parse(pkg.includes); } catch {}
      }
      if (typeof pkg.detailedInfo === 'string') {
        try { pkg.detailedInfo = JSON.parse(pkg.detailedInfo); } catch {}
      }
    }

    res.json(results);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch packages' });
  }
});

// Get all data in one endpoint (for the single page frontend)
app.get('/api/all-data', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  try {
    const [
      navItems,
      accommodations,
      mealPlans,
      activities,
      faqs,
      galleryImages,
      testimonials,
      nearbyLocations,
      packages
    ] = await Promise.all([
      executeQuery('SELECT label, path FROM nav_items ORDER BY id'),
      executeQuery(`
        SELECT 
          id, type, title, description, price, capacity, 
          features, image, has_ac as hasAC, has_attached_bath as hasAttachedBath,
          available_rooms as availableRooms, detailed_info as detailedInfo
        FROM accommodations 
        ORDER BY id
      `),
      executeQuery('SELECT id, type, title, description, price, includes FROM meal_plans ORDER BY id'),
      executeQuery('SELECT id, title, description, price, image, duration FROM activities ORDER BY id'),
      executeQuery('SELECT id, question, answer FROM faqs ORDER BY id'),
      executeQuery('SELECT id, src, alt, category, width, height FROM gallery_images ORDER BY id'),
      executeQuery('SELECT id, name, location, image, rating, text FROM testimonials ORDER BY id'),
      executeQuery('SELECT id, name, distance, image, description FROM nearby_locations ORDER BY distance'),
      executeQuery(`
        SELECT 
          id, accommodation_id as accommodationId, name, description, 
          price, duration, max_guests as maxGuests, image_url as imageUrl,
          includes, active, detailed_info as detailedInfo
        FROM packages 
        WHERE active = 1
        ORDER BY id
      `)
    ]);

    // Add packages to accommodations
    for (let accommodation of accommodations) {
      accommodation.packages = packages.filter(
        pkg => pkg.accommodationId === accommodation.id
      );
    }

    const allData = {
      navItems,
      accommodations,
      mealPlans,
      activities,
      faqs,
      galleryImages,
      testimonials,
      nearbyLocations,
      packages
    };

    res.json(allData);
  } catch (error) {
    console.error('Error fetching all data:', error);
    res.status(500).json({ error: 'Failed to fetch data' });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
});

// Get a single accommodation by ID
app.get('/api/accommodations/:id', async (req, res) => {
  try {
    res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
    const id = req.params.id;
    const results = await executeQuery(
      `SELECT 
        id, type, title, description, price, capacity, 
        features, image, has_ac as hasAC, has_attached_bath as hasAttachedBath,
        available_rooms as availableRooms, detailed_info as detailedInfo
      FROM accommodations 
      WHERE id = ?
      LIMIT 1
      `, [id]
    );
    if (!results.length) {
      return res.status(404).json({ error: 'Accommodation not found' });
    }

    // Fetch packages for this accommodation
    const packages = await executeQuery(
      `SELECT 
        id, accommodation_id as accommodationId, name, description, 
        price, duration, max_guests as maxGuests, image_url as imageUrl,
        includes, active, detailed_info as detailedInfo
      FROM packages 
      WHERE accommodation_id = ? AND active = 1
      ORDER BY id
      `, [id]
    );
    const accommodation = results[0];
    accommodation.packages = packages;

    res.json(accommodation);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch accommodation' });
  }
});

// Get a single package by combined id (e.g. 102)
app.get('/api/packages/:combinedId', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  const { combinedId } = req.params;
  const splitIdx = combinedId.indexOf('0');
  if (splitIdx < 1) return res.status(400).json({ error: 'Invalid package id format' });
  const accommodationId = parseInt(combinedId.slice(0, splitIdx));
  const pkgId = parseInt(combinedId.slice(splitIdx + 1));
  try {
    const [pkg] = await executeQuery(
      `SELECT * FROM packages WHERE id = ? AND accommodation_id = ? AND active = 1 LIMIT 1`,
      [pkgId, accommodationId]
    );
    if (!pkg) return res.status(404).json({ error: 'Package not found' });
    res.json(pkg);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch package' });
  }
});

// Get all images from all relevant tables
app.get('/api/all-images', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  try {
    // Gallery images
    const galleryImages = await executeQuery(
      `SELECT id, src AS url, alt, category, 'gallery' AS source FROM gallery_images`
    );
    // Accommodation images
    const accommodations = await executeQuery(
      `SELECT id, image AS url, title AS alt, type AS category, 'accommodation' AS source FROM accommodations`
    );
    // Package images
    const packages = await executeQuery(
      `SELECT id, image_url AS url, name AS alt, 'package' AS category, 'package' AS source FROM packages`
    );
    // Activity images
    const activities = await executeQuery(
      `SELECT id, image AS url, title AS alt, 'activity' AS category, 'activity' AS source FROM activities`
    );
    // Testimonial images
    const testimonials = await executeQuery(
      `SELECT id, image AS url, name AS alt, 'testimonial' AS category, 'testimonial' AS source FROM testimonials`
    );
    // Nearby location images
    const nearbyLocations = await executeQuery(
      `SELECT id, image AS url, name AS alt, 'nearby' AS category, 'nearby' AS source FROM nearby_locations`
    );

    // Combine all images
    const allImages = [
      ...galleryImages,
      ...accommodations,
      ...packages,
      ...activities,
      ...testimonials,
      ...nearbyLocations,
    ];

    res.json(allImages);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch all images' });
  }
});

// Create a booking
app.post('/api/bookings', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  const {
    package_id, accommodation_id, guest_name, guest_email, guest_phone,
    rooms, adults, children, food_veg, food_nonveg, food_jain,
    check_in, check_out, total_amount, advance_amount
  } = req.body;

  try {
    const [result] = await pool.execute(
      `INSERT INTO bookings 
      (package_id, accommodation_id, guest_name, guest_email, guest_phone, rooms, adults, children, food_veg, food_nonveg, food_jain, check_in, check_out, total_amount, advance_amount)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [package_id, accommodation_id, guest_name, guest_email, guest_phone, rooms, adults, children, food_veg, food_nonveg, food_jain, check_in, check_out, total_amount, advance_amount]
    );
    res.json({ success: true, booking_id: result.insertId });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create booking' });
  }
});

// PayU payment initiation
app.post('/api/payments/payu', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  const {
    amount, firstname, email, phone, productinfo, booking_id, surl, furl
  } = req.body;

  const PAYU_MERCHANT_KEY = process.env.PAYU_MERCHANT_KEY || 'rFrruE9E';
  const PAYU_MERCHANT_SALT = process.env.PAYU_MERCHANT_SALT || 'DvYeVsKfYU';
  const PAYU_BASE_URL = process.env.PAYU_BASE_URL || 'https://secure.payu.in/_payment';

  const txnid = 'TXN' + Date.now() + Math.floor(Math.random() * 1000);

  const udf1 = booking_id || '';
  const udf2 = '';
  const udf3 = '';
  const udf4 = '';
  const udf5 = '';
  const udf6 = '';
  const udf7 = '';
  const udf8 = '';
  const udf9 = '';
  const udf10 = '';

  const hashString = [
    PAYU_MERCHANT_KEY,
    txnid,
    amount,
    productinfo,
    firstname,
    email,
    udf1,
    udf2,
    udf3,
    udf4,
    udf5,
    udf6,
    udf7,
    udf8,
    udf9,
    udf10,
    PAYU_MERCHANT_SALT
  ].join('|');
  const hash = crypto.createHash('sha512').update(hashString).digest('hex');

  const payuData = {
    key: PAYU_MERCHANT_KEY,
    txnid,
    amount,
    productinfo,
    firstname,
    email,
    phone,
    surl,
    furl,
    hash,
    service_provider: 'payu_paisa',
    udf1: booking_id
  };

  res.json({
    payu_url: 'https://secure.payu.in/_payment',
    payuData
  });
});

export default app;