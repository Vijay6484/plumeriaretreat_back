const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const crypto = require('crypto');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();
const app = express();
const PORT = process.env.PORT || 3001;

// Enhanced security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  maxAge: 86400
}));

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: {
    error: 'Too many requests',
    message: 'Please try again later',
    code: 'RATE_LIMIT_EXCEEDED'
  }
});
app.use('/api/', apiLimiter);

// Body parsing with size limit
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// Enhanced database pool configuration
const poolConfig = {
  host: process.env.DB_HOST || 'in-mum-web1671.main-hosting.eu',
  user: process.env.DB_USER || 'u973488458_plumeria',
  password: process.env.DB_PASSWORD || 'Plumeria_retreat1234',
  database: process.env.DB_NAME || 'u973488458_plumeria',
  port: parseInt(process.env.DB_PORT || '3306'),
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  namedPlaceholders: true,
  timezone: 'Z', // UTC timezone
  charset: 'utf8mb4',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined
};

const pool = mysql.createPool(poolConfig);

// Database connection events for debugging
if (process.env.NODE_ENV === 'development') {
  pool.on('acquire', conn => console.log(`[DB] Connection ${conn.threadId} acquired`));
  pool.on('release', conn => console.log(`[DB] Connection ${conn.threadId} released`));
  pool.on('enqueue', () => console.log('[DB] Waiting for available connection...'));
  pool.on('connection', conn => console.log(`[DB] New connection established: ${conn.threadId}`));
}

// Database middleware with improved error handling
app.use(async (req, res, next) => {
  let conn;
  try {
    conn = await pool.getConnection();
    req.db = conn;
    next();
  } catch (err) {
    console.error('[DB] Connection error:', err);
    res.status(503).json({ 
      error: 'Service unavailable', 
      message: 'Database connection failed',
      code: 'DB_CONNECTION_ERROR'
    });
    if (conn) await conn.release().catch(e => console.error('[DB] Release error:', e));
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

// Enhanced query helper with transaction support
async function executeQuery(query, params = [], conn = null, transaction = false) {
  const connection = conn || await pool.getConnection();
  try {
    if (transaction && !conn) await connection.beginTransaction();
    const [results] = await connection.execute(query, params);
    return results;
  } catch (error) {
    if (transaction && !conn) await connection.rollback();
    console.error('Database query error:', {
      error: error.message,
      query: query.substring(0, 100) + (query.length > 100 ? '...' : ''),
      params: JSON.stringify(params)
    });
    throw error;
  } finally {
    if (!conn && !transaction) await connection.release();
  }
}

// Health check endpoint with more details
app.get('/api/health', async (req, res) => {
  try {
    const [dbResult] = await pool.query('SELECT 1 as db_status');
    res.json({
      status: 'OK',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      db: dbResult[0].db_status === 1 ? 'connected' : 'disconnected',
      memoryUsage: process.memoryUsage(),
      env: process.env.NODE_ENV || 'development'
    });
  } catch (error) {
    res.status(503).json({
      status: 'DOWN',
      error: 'Database connection failed',
      code: 'DB_HEALTH_CHECK_FAILED'
    });
  }
});

// Enhanced accommodations endpoint with pagination and filtering
app.get('/api/accommodations', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    const type = req.query.type;

    let query = `
      SELECT id, name, type, description, price, capacity, rooms, available,
      features, images, address, created_at, updated_at
      FROM accommodations
    `;
    const params = [];

    if (type) {
      query += ' WHERE type = ?';
      params.push(type);
    }

    query += ' ORDER BY id LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const [accommodations, [total]] = await Promise.all([
      executeQuery(query, params, req.db),
      executeQuery('SELECT COUNT(*) as count FROM accommodations' + (type ? ' WHERE type = ?' : ''), type ? [type] : [], req.db)
    ]);

    // Parse JSON fields safely
    const parseField = (field) => {
      try {
        return typeof field === 'string' ? JSON.parse(field) : field;
      } catch (e) {
        return field;
      }
    };

    const processedAccommodations = accommodations.map(acc => ({
      ...acc,
      features: parseField(acc.features),
      images: parseField(acc.images)
    }));

    res.json({
      data: processedAccommodations,
      meta: {
        page,
        limit,
        total: total.count,
        totalPages: Math.ceil(total.count / limit),
        filters: { type }
      }
    });
  } catch (error) {
    console.error('Error fetching accommodations:', error);
    res.status(500).json({ 
      error: 'Failed to fetch accommodations',
      code: 'ACCOMMODATIONS_FETCH_ERROR'
    });
  }
});

// Enhanced booking endpoint with validation
app.post('/api/bookings', async (req, res) => {
  const requiredFields = [
    'accommodation_id', 'guest_name', 'guest_email',
    'rooms', 'adults', 'check_in', 'check_out'
  ];
  
  const missingFields = requiredFields.filter(field => !req.body[field]);
  if (missingFields.length) {
    return res.status(400).json({
      error: 'Missing required fields',
      missingFields,
      code: 'VALIDATION_ERROR'
    });
  }

  // Email validation
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(req.body.guest_email)) {
    return res.status(400).json({
      error: 'Invalid email format',
      code: 'VALIDATION_ERROR'
    });
  }

  // Date validation
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const checkIn = new Date(req.body.check_in);
  if (checkIn < today) {
    return res.status(400).json({
      error: 'Check-in date must be today or in the future',
      code: 'VALIDATION_ERROR'
    });
  }

  try {
    const {
      package_id, accommodation_id, guest_name, guest_email, guest_phone,
      rooms, adults, children = 0, food_veg = 0, food_nonveg = 0, food_jain = 0,
      check_in, check_out, total_amount, advance_amount, coupon_code = null
    } = req.body;

    // Start transaction
    const conn = await pool.getConnection();
    await conn.beginTransaction();

    try {
      // Check accommodation availability
      const [accommodation] = await executeQuery(
        'SELECT available, rooms FROM accommodations WHERE id = ? FOR UPDATE',
        [accommodation_id],
        conn,
        true
      );

      if (!accommodation || !accommodation.available) {
        throw new Error('Accommodation not available');
      }

      if (rooms > accommodation.rooms) {
        throw new Error('Not enough rooms available');
      }

      // Create booking
      const result = await executeQuery(`
        INSERT INTO bookings 
        (package_id, accommodation_id, guest_name, guest_email, guest_phone, 
         rooms, adults, children, food_veg, food_nonveg, food_jain, 
         check_in, check_out, total_amount, advance_amount, coupon_code)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        package_id, accommodation_id, guest_name, guest_email, guest_phone,
        rooms, adults, children, food_veg, food_nonveg, food_jain,
        check_in, check_out, total_amount, advance_amount, coupon_code
      ], conn, true);

      await conn.commit();
      
      res.status(201).json({ 
        success: true, 
        booking_id: result.insertId,
        links: {
          payment: `/api/payments?booking_id=${result.insertId}`,
          booking: `/api/bookings/${result.insertId}`
        }
      });
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      await conn.release();
    }
  } catch (error) {
    console.error('Error creating booking:', error);
    res.status(500).json({ 
      error: 'Failed to create booking',
      message: error.message,
      code: 'BOOKING_CREATION_ERROR'
    });
  }
});

// Enhanced PayU payment endpoint
app.post('/api/payments/payu', async (req, res) => {
  try {
    const requiredFields = ['amount', 'firstname', 'email', 'productinfo', 'booking_id'];
    const missingFields = requiredFields.filter(field => !req.body[field]);
    
    if (missingFields.length) {
      return res.status(400).json({
        error: 'Missing required payment fields',
        missingFields,
        code: 'PAYMENT_VALIDATION_ERROR'
      });
    }

    const { amount, firstname, email, phone = '', productinfo, booking_id } = req.body;

    // Validate amount
    if (isNaN(amount) || amount <= 0) {
      return res.status(400).json({
        error: 'Invalid amount',
        code: 'PAYMENT_VALIDATION_ERROR'
      });
    }

    const PAYU_MERCHANT_KEY = process.env.PAYU_MERCHANT_KEY;
    const PAYU_MERCHANT_SALT = process.env.PAYU_MERCHANT_SALT;

    if (!PAYU_MERCHANT_KEY || !PAYU_MERCHANT_SALT) {
      throw new Error('Payment gateway configuration missing');
    }

    const txnid = 'TXN' + Date.now() + Math.floor(Math.random() * 1000);
    const surl = process.env.PAYMENT_SUCCESS_URL || `${req.protocol}://${req.get('host')}/payment/success`;
    const furl = process.env.PAYMENT_FAILURE_URL || `${req.protocol}://${req.get('host')}/payment/failure`;

    const hashString = [
      PAYU_MERCHANT_KEY, txnid, amount, productinfo, firstname, email,
      booking_id, '', '', '', '', '', '', '', PAYU_MERCHANT_SALT
    ].join('|');
    const hash = crypto.createHash('sha512').update(hashString).digest('hex');

    res.json({
      success: true,
      payment: {
        gateway: 'payu',
        url: process.env.PAYU_URL || 'https://secure.payu.in/_payment',
        data: {
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
        }
      }
    });
  } catch (error) {
    console.error('Payment processing error:', error);
    res.status(500).json({ 
      error: 'Payment processing failed',
      message: error.message,
      code: 'PAYMENT_PROCESSING_ERROR'
    });
  }
});

// 404 handler
app.use('/api/*', (req, res) => {
  res.status(404).json({
    error: 'Not found',
    message: `The requested resource ${req.originalUrl} was not found`,
    code: 'NOT_FOUND'
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.stack);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong',
    code: 'INTERNAL_SERVER_ERROR'
  });
});

// Graceful shutdown
const shutdown = async (signal) => {
  console.log(`\n[Shutdown] Received ${signal}, closing server...`);
  
  try {
    // Close server first to stop accepting new connections
    await new Promise((resolve) => {
      server.close(resolve);
    });
    console.log('[Shutdown] HTTP server closed');
    
    // Then close database pool
    await pool.end();
    console.log('[Shutdown] Database pool closed');
    
    process.exit(0);
  } catch (err) {
    console.error('[Shutdown] Error:', err);
    process.exit(1);
  }
};

// Handle shutdown signals
['SIGINT', 'SIGTERM'].forEach(signal => {
  process.on(signal, () => shutdown(signal));
});

// Start server
const server = app.listen(PORT, () => {
  console.log(`Server running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
});

