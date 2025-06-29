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
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));
app.use(express.json());

// Database configuration
const dbConfig = {
  host: process.env.DB_HOST || 'in-mum-web1671.main-hosting.eu',
  user: process.env.DB_USER || 'u973488458_plumeria',
  password: process.env.DB_PASSWORD || 'Plumeria_retreat1234',
  database: process.env.DB_NAME || 'u973488458_plumeria',
  port: parseInt(process.env.DB_PORT || '3306')
};

// Create database connection pool
const pool = mysql.createPool({
  ...dbConfig,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Helper function with connection acquire + guaranteed release
async function executeQuery(query, params = []) {
  const connection = await pool.getConnection();
  try {
    const [results] = await connection.execute(query, params);
    return results;
  } catch (error) {
    console.error('Database query error:', error);
    throw error;
  } finally {
    await connection.release();
  }
}

// Universal CORS & preflight handler
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.status(200).end();
  } else {
    next();
  }
});

// Routes

app.get('/api/nav-items', async (req, res) => {
  try {
    const results = await executeQuery('SELECT label, path FROM nav_items ORDER BY id');
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch navigation items' });
  }
});

app.get('/api/accommodations', async (req, res) => {
  try {
    const accommodations = await executeQuery(`
      SELECT id, name, type, description, price, capacity, rooms, available,
      features, images, amenity_ids, owner_id, city_id, address, latitude, longitude,
      package_name, package_description, package_images, adult_price, child_price,
      max_guests, created_at, updated_at
      FROM accommodations ORDER BY id
    `);

    for (let accommodation of accommodations) {
      const packages = await executeQuery(
        `SELECT * FROM packages WHERE accommodation_id = ? AND active = 1`,
        [accommodation.id]
      );
      accommodation.packages = packages;
    }

    res.json(accommodations);
  } catch (error) {
    console.error('Error fetching accommodations:', error);
    res.status(500).json({ error: 'Failed to fetch accommodations' });
  }
});

app.get('/api/accommodations/:id', async (req, res) => {
  try {
    const id = req.params.id;
    if (!id) return res.status(400).json({ error: 'Accommodation ID is required' });

    const results = await executeQuery(`
      SELECT id, name, type, description, price, capacity, rooms, available,
      features, images, amenity_ids, owner_id, city_id, address, latitude, longitude,
      package_name, package_description, package_images, adult_price, child_price,
      max_guests, created_at, updated_at
      FROM accommodations WHERE id = ? LIMIT 1
    `, [id]);

    if (!results.length) return res.status(404).json({ error: 'Accommodation not found' });

    const accommodation = results[0];
    const packages = await executeQuery(
      `SELECT * FROM packages WHERE accommodation_id = ? AND active = 1`,
      [accommodation.id]
    );
    accommodation.packages = packages;

    res.json(accommodation);
  } catch (error) {
    console.error('Error fetching accommodation by ID:', error);
    res.status(500).json({ error: 'Failed to fetch accommodation' });
  }
});

// ✅ Updated /api/all-images using executeQuery
app.get('/api/all-images', async (req, res) => {
  try {
    const galleryImages = await executeQuery(`SELECT id, src AS url, alt, category, 'gallery' AS source FROM gallery_images`);
    const accommodations = await executeQuery(`SELECT id, images AS url, name AS alt, type AS category, 'accommodation' AS source FROM accommodations`);
    const packages = await executeQuery(`SELECT id, image_url AS url, name AS alt, 'package' AS category, 'package' AS source FROM packages`);
    const activities = await executeQuery(`SELECT id, image AS url, title AS alt, 'activity' AS category, 'activity' AS source FROM activities`);
    const testimonials = await executeQuery(`SELECT id, image AS url, name AS alt, 'testimonial' AS category, 'testimonial' AS source FROM testimonials`);
    const nearbyLocations = await executeQuery(`SELECT id, image AS url, name AS alt, 'nearby' AS category, 'nearby' AS source FROM nearby_locations`);

    const allImages = [
      ...galleryImages,
      ...accommodations,
      ...packages,
      ...activities,
      ...testimonials,
      ...nearbyLocations
    ];
    res.json(allImages);
  } catch (err) {
    console.error('Error fetching images:', err);
    res.status(500).json({ error: 'Failed to fetch images' });
  }
});

// Meal Plans
app.get('/api/meal-plans', async (req, res) => {
  try {
    const results = await executeQuery(`SELECT id, type, title, description, price, includes FROM meal_plans ORDER BY id`);
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch meal plans' });
  }
});

// Activities
app.get('/api/activities', async (req, res) => {
  try {
    const results = await executeQuery(`SELECT id, title, description, price, image, duration FROM activities ORDER BY id`);
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch activities' });
  }
});

// FAQs
app.get('/api/faqs', async (req, res) => {
  try {
    const results = await executeQuery(`SELECT id, question, answer FROM faqs ORDER BY id`);
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch FAQs' });
  }
});

// Gallery Images
app.get('/api/gallery-images', async (req, res) => {
  try {
    const results = await executeQuery(`SELECT id, src, alt, category, width, height FROM gallery_images ORDER BY id`);
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch gallery images' });
  }
});

// Testimonials
app.get('/api/testimonials', async (req, res) => {
  try {
    const results = await executeQuery(`SELECT id, name, location, image, rating, text FROM testimonials ORDER BY id`);
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch testimonials' });
  }
});

// Nearby Locations
app.get('/api/nearby-locations', async (req, res) => {
  try {
    const results = await executeQuery(`SELECT id, name, distance, image, description FROM nearby_locations ORDER BY distance`);
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch nearby locations' });
  }
});

// Packages
app.get('/api/packages', async (req, res) => {
  const accommodationId = parseInt(req.query.accommodation);
  const pkgId = parseInt(req.query.package);

  if (accommodationId && pkgId) {
    try {
      const [pkg] = await executeQuery(
        `SELECT * FROM packages WHERE id = ? AND accommodation_id = ? AND active = 1 LIMIT 1`,
        [pkgId, accommodationId]
      );
      if (!pkg) return res.status(404).json({ error: 'Package not found' });

      if (typeof pkg.includes === 'string') try { pkg.includes = JSON.parse(pkg.includes); } catch {}
      if (typeof pkg.detailed_info === 'string') try { pkg.detailed_info = JSON.parse(pkg.detailed_info); } catch {}

      res.json(pkg);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch package' });
    }
    return;
  }

  try {
    const results = await executeQuery(`
      SELECT id, accommodation_id as accommodationId, name, description, price, duration, max_guests as maxGuests, image_url as imageUrl, includes, active, detailed_info as detailedInfo
      FROM packages WHERE active = 1 ORDER BY id
    `);
    for (const pkg of results) {
      if (typeof pkg.includes === 'string') try { pkg.includes = JSON.parse(pkg.includes); } catch {}
      if (typeof pkg.detailedInfo === 'string') try { pkg.detailedInfo = JSON.parse(pkg.detailedInfo); } catch {}
    }
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch packages' });
  }
});

// Create booking
app.post('/api/bookings', async (req, res) => {
  const {
    package_id, accommodation_id, guest_name, guest_email, guest_phone,
    rooms, adults, children, food_veg, food_nonveg, food_jain,
    check_in, check_out, total_amount, advance_amount
  } = req.body;

  try {
    const result = await executeQuery(`
      INSERT INTO bookings 
      (package_id, accommodation_id, guest_name, guest_email, guest_phone, rooms, adults, children, food_veg, food_nonveg, food_jain, check_in, check_out, total_amount, advance_amount)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [package_id, accommodation_id, guest_name, guest_email, guest_phone, rooms, adults, children, food_veg, food_nonveg, food_jain, check_in, check_out, total_amount, advance_amount]
    );
    res.json({ success: true, booking_id: result.insertId });
  } catch (error) {
    console.error('Error creating booking:', error);
    res.status(500).json({ error: 'Failed to create booking' });
  }
});

// PayU payment
app.post('/api/payments/payu', async (req, res) => {
  const { amount, firstname, email, phone, productinfo, booking_id, surl, furl } = req.body;

  const PAYU_MERCHANT_KEY = process.env.PAYU_MERCHANT_KEY || 'rFrruE9E';
  const PAYU_MERCHANT_SALT = process.env.PAYU_MERCHANT_SALT || 'DvYeVsKfYU';

  const txnid = 'TXN' + Date.now() + Math.floor(Math.random() * 1000);

  const hashString = [
    PAYU_MERCHANT_KEY, txnid, amount, productinfo, firstname, email,
    booking_id || '', '', '', '', '', '', '', '', '', PAYU_MERCHANT_SALT
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

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
});

export default app;
