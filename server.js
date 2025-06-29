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

// Database pool
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'in-mum-web1671.main-hosting.eu',
  user: process.env.DB_USER || 'u973488458_plumeria',
  password: process.env.DB_PASSWORD || 'Plumeria_retreat1234',
  database: process.env.DB_NAME || 'u973488458_plumeria',
  port: parseInt(process.env.DB_PORT || '3306'),
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  namedPlaceholders: true
});

// Optional debug events
pool.on('acquire', conn => console.log(`[DB] Connection ${conn.threadId} acquired`));
pool.on('release', conn => console.log(`[DB] Connection ${conn.threadId} released`));
pool.on('enqueue', () => console.log('[DB] Waiting for available connection...'));
pool.on('connection', conn => console.log(`[DB] New connection established: ${conn.threadId}`));

// Attach connection per request
app.use(async (req, res, next) => {
  let conn;
  try {
    conn = await pool.getConnection();
    req.db = conn;
    next();
  } catch (err) {
    console.error('[DB] Connection error:', err);
    if (conn) await conn.release().catch(e => console.error('[DB] Release error:', e));
    res.status(503).json({ error: 'Service unavailable', message: 'Database connection failed' });
  }
});

// Release connection after response
app.use((req, res, next) => {
  res.on('finish', async () => {
    if (req.db) {
      try {
        await req.db.release();
      } catch (err) {
        console.error('[DB] Connection release error:', err);
      }
    }
  });
  next();
});

// Helper
async function executeQuery(query, params = [], conn = null) {
  const connection = conn || await pool.getConnection();
  try {
    const [results] = await connection.execute(query, params);
    return results;
  } catch (error) {
    console.error('Database query error:', error);
    throw error;
  } finally {
    if (!conn) await connection.release();
  }
}

// Universal CORS & preflight
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') res.status(200).end();
  else next();
});

// Routes
app.get('/api/nav-items', async (req, res) => {
  try {
    const results = await executeQuery('SELECT label, path FROM nav_items ORDER BY id', [], req.db);
    res.json(results);
  } catch {
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
    `, [], req.db);

    for (let accommodation of accommodations) {
      const packages = await executeQuery(
        `SELECT * FROM packages WHERE accommodation_id = ? AND active = 1`,
        [accommodation.id],
        req.db
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
    `, [id], req.db);

    if (!results.length) return res.status(404).json({ error: 'Accommodation not found' });

    const accommodation = results[0];
    const packages = await executeQuery(
      `SELECT * FROM packages WHERE accommodation_id = ? AND active = 1`,
      [accommodation.id],
      req.db
    );
    accommodation.packages = packages;

    res.json(accommodation);
  } catch (error) {
    console.error('Error fetching accommodation by ID:', error);
    res.status(500).json({ error: 'Failed to fetch accommodation' });
  }
});

app.get('/api/all-images', async (req, res) => {
  try {
    const galleryImages = await executeQuery(`SELECT id, src AS url, alt, category, 'gallery' AS source FROM gallery_images`, [], req.db);
    const accommodations = await executeQuery(`SELECT id, images AS url, name AS alt, type AS category, 'accommodation' AS source FROM accommodations`, [], req.db);
    const packages = await executeQuery(`SELECT id, image_url AS url, name AS alt, 'package' AS category, 'package' AS source FROM packages`, [], req.db);
    const activities = await executeQuery(`SELECT id, image AS url, title AS alt, 'activity' AS category, 'activity' AS source FROM activities`, [], req.db);
    const testimonials = await executeQuery(`SELECT id, image AS url, name AS alt, 'testimonial' AS category, 'testimonial' AS source FROM testimonials`, [], req.db);
    const nearbyLocations = await executeQuery(`SELECT id, image AS url, name AS alt, 'nearby' AS category, 'nearby' AS source FROM nearby_locations`, [], req.db);

    const allImages = [...galleryImages, ...accommodations, ...packages, ...activities, ...testimonials, ...nearbyLocations];
    res.json(allImages);
  } catch (err) {
    console.error('Error fetching images:', err);
    res.status(500).json({ error: 'Failed to fetch images' });
  }
});

app.get('/api/meal-plans', async (req, res) => {
  try {
    const results = await executeQuery(`SELECT id, type, title, description, price, includes FROM meal_plans ORDER BY id`, [], req.db);
    res.json(results);
  } catch {
    res.status(500).json({ error: 'Failed to fetch meal plans' });
  }
});

app.get('/api/activities', async (req, res) => {
  try {
    const results = await executeQuery(`SELECT id, title, description, price, image, duration FROM activities ORDER BY id`, [], req.db);
    res.json(results);
  } catch {
    res.status(500).json({ error: 'Failed to fetch activities' });
  }
});

app.get('/api/faqs', async (req, res) => {
  try {
    const results = await executeQuery(`SELECT id, question, answer FROM faqs ORDER BY id`, [], req.db);
    res.json(results);
  } catch {
    res.status(500).json({ error: 'Failed to fetch FAQs' });
  }
});

app.get('/api/gallery-images', async (req, res) => {
  try {
    const results = await executeQuery(`SELECT id, src, alt, category, width, height FROM gallery_images ORDER BY id`, [], req.db);
    res.json(results);
  } catch {
    res.status(500).json({ error: 'Failed to fetch gallery images' });
  }
});

app.get('/api/testimonials', async (req, res) => {
  try {
    const results = await executeQuery(`SELECT id, name, location, image, rating, text FROM testimonials ORDER BY id`, [], req.db);
    res.json(results);
  } catch {
    res.status(500).json({ error: 'Failed to fetch testimonials' });
  }
});

app.get('/api/nearby-locations', async (req, res) => {
  try {
    const results = await executeQuery(`SELECT id, name, distance, image, description FROM nearby_locations ORDER BY distance`, [], req.db);
    res.json(results);
  } catch {
    res.status(500).json({ error: 'Failed to fetch nearby locations' });
  }
});

app.get('/api/packages', async (req, res) => {
  const accommodationId = parseInt(req.query.accommodation);
  const pkgId = parseInt(req.query.package);

  if (accommodationId && pkgId) {
    try {
      const [pkg] = await executeQuery(
        `SELECT * FROM packages WHERE id = ? AND accommodation_id = ? AND active = 1 LIMIT 1`,
        [pkgId, accommodationId],
        req.db
      );
      if (!pkg) return res.status(404).json({ error: 'Package not found' });

      if (typeof pkg.includes === 'string') try { pkg.includes = JSON.parse(pkg.includes); } catch { }
      if (typeof pkg.detailed_info === 'string') try { pkg.detailed_info = JSON.parse(pkg.detailed_info); } catch { }

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
    `, [], req.db);

    for (const pkg of results) {
      if (typeof pkg.includes === 'string') try { pkg.includes = JSON.parse(pkg.includes); } catch { }
      if (typeof pkg.detailedInfo === 'string') try { pkg.detailedInfo = JSON.parse(pkg.detailedInfo); } catch { }
    }
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch packages' });
  }
});

/**
 * Helper to replace undefined with null in booking data,
 * because MySQL doesn't accept undefined bind parameters.
 */
function sanitizeBookingData(data) {
  const sanitized = {};
  for (const [key, value] of Object.entries(data)) {
    sanitized[key] = value === undefined ? null : value;
  }
  return sanitized;
}

app.post('/api/bookings', async (req, res) => {
  const {
    package_id, accommodation_id, guest_name, guest_email, guest_phone,
    rooms, adults, children, food_veg, food_nonveg, food_jain,
    check_in, check_out, total_amount, advance_amount
  } = req.body;

  // Sanitize booking data to convert undefined -> null
  const bookingData = sanitizeBookingData({
    package_id, accommodation_id, guest_name, guest_email, guest_phone,
    rooms, adults, children, food_veg, food_nonveg, food_jain,
    check_in, check_out, total_amount, advance_amount
  });

  try {
    const result = await executeQuery(`
      INSERT INTO bookings 
      (package_id, accommodation_id, guest_name, guest_email, guest_phone, rooms, adults, children, food_veg, food_nonveg, food_jain, check_in, check_out, total_amount, advance_amount)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      bookingData.package_id,
      bookingData.accommodation_id,
      bookingData.guest_name,
      bookingData.guest_email,
      bookingData.guest_phone,
      bookingData.rooms,
      bookingData.adults,
      bookingData.children,
      bookingData.food_veg,
      bookingData.food_nonveg,
      bookingData.food_jain,
      bookingData.check_in,
      bookingData.check_out,
      bookingData.total_amount,
      bookingData.advance_amount
    ], req.db);

    res.json({ success: true, booking_id: result.insertId });
  } catch (error) {
    console.error('Error creating booking:', error);
    res.status(500).json({ error: 'Failed to create booking' });
  }
});


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

app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Graceful shutdown
const shutdown = async () => {
  console.log('\n[Shutdown] Closing database pool...');
  try {
    await pool.end();
    console.log('[Shutdown] Database pool closed successfully');
    process.exit(0);
  } catch (err) {
    console.error('[Shutdown] Error closing pool:', err);
    process.exit(1);
  }
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
});

export default app;
