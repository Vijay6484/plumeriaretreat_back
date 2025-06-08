const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
require('dotenv').config();


const app = express();
const PORT = process.env.PORT || 8080;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});


// Database connection
// const dbConfig = {
//   host: process.env.DB_HOST || 'mysql.railway.internal',
//   user: process.env.DB_USER || 'root',
//   password: process.env.DB_PASSWORD || 'XuzzPuWFCRujAWxdWZTSwVBFVKdnNnJT',
//   database: process.env.DB_NAME || 'railway',
//   waitForConnections: true,
//   connectionLimit: 10,
//   queueLimit: 0
// };

const dbConfig = {
  host: 'localhost',
  user: 'root',
  password: '2005',
  database: 'plumeria_retreat',
};

const pool = mysql.createPool(dbConfig);
async function testConnection() {
  try {
    const connection = await pool.getConnection();
    console.log('Database connected successfully');
    connection.release();
  } catch (error) {
    console.error('Database connection failed:', error);
  }
}

// Routes

// Get all accommodations
app.get('/api/accommodations', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT * FROM accommodations WHERE available = 1 ORDER BY price ASC'
    );
    res.json(rows);
  } catch (error) {
    console.error('Error fetching accommodations:', error);
    res.status(500).json({ error: 'Failed to fetch accommodations' });
  }
});

// Get all meal plans
app.get('/api/meal-plans', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT * FROM meal_plans WHERE available = 1 ORDER BY price ASC'
    );
    res.json(rows);
  } catch (error) {
    console.error('Error fetching meal plans:', error);
    res.status(500).json({ error: 'Failed to fetch meal plans' });
  }
});

// Get all activities
app.get('/api/activities', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT * FROM activities WHERE available = 1 ORDER BY price ASC'
    );
    res.json(rows);
  } catch (error) {
    console.error('Error fetching activities:', error);
    res.status(500).json({ error: 'Failed to fetch activities' });
  }
});

// Check availability
app.post('/api/check-availability', async (req, res) => {
  try {
    const { accommodation_id, check_in_date, check_out_date, rooms } = req.body;

    // Check if dates are blocked
    const [blockedDates] = await pool.execute(
      'SELECT COUNT(*) as blocked_count FROM blocked_dates WHERE blocked_date BETWEEN ? AND ?',
      [check_in_date, check_out_date]
    );

    if (blockedDates[0].blocked_count > 0) {
      return res.json({ available: false, reason: 'Selected dates are blocked' });
    }

    // Check room availability
    const [bookedRooms] = await pool.execute(`
      SELECT COALESCE(SUM(b.rooms), 0) as booked_rooms 
      FROM bookings b 
      WHERE b.accommodation_id = ? 
      AND b.status NOT IN ('cancelled') 
      AND (
        (b.check_in_date <= ? AND b.check_out_date > ?) OR
        (b.check_in_date < ? AND b.check_out_date >= ?) OR
        (b.check_in_date >= ? AND b.check_out_date <= ?)
      )
    `, [accommodation_id, check_in_date, check_in_date, check_out_date, check_out_date, check_in_date, check_out_date]);

    const [accommodation] = await pool.execute(
      'SELECT available_rooms FROM accommodations WHERE id = ?',
      [accommodation_id]
    );

    const availableRooms = accommodation[0].available_rooms - bookedRooms[0].booked_rooms;
    const isAvailable = availableRooms >= rooms;

    res.json({ 
      available: isAvailable, 
      available_rooms: availableRooms,
      requested_rooms: rooms 
    });
  } catch (error) {
    console.error('Error checking availability:', error);
    res.status(500).json({ error: 'Failed to check availability' });
  }
});

// Validate coupon
app.post('/api/coupons/validate', async (req, res) => {
  try {
    const { code } = req.body;

    const [coupons] = await pool.execute(`
      SELECT * FROM coupons 
      WHERE code = ? 
      AND active = 1 
      AND (expiry_date IS NULL OR expiry_date >= CURDATE())
      AND (usage_limit IS NULL OR used_count < usage_limit)
    `, [code]);

    if (coupons.length === 0) {
      return res.json({ valid: false, message: 'Invalid or expired coupon' });
    }

    const coupon = coupons[0];
    res.json({ 
      valid: true, 
      discount: coupon.discount_percentage,
      min_amount: coupon.min_amount 
    });
  } catch (error) {
    console.error('Error validating coupon:', error);
    res.status(500).json({ error: 'Failed to validate coupon' });
  }
});

// Create booking
app.post('/api/bookings', async (req, res) => {
  const connection = await pool.getConnection();
  
  try {
    await connection.beginTransaction();

    const {
      guest_name, guest_email, guest_phone, check_in_date, check_out_date,
      adults, children, accommodation_id, rooms, meal_plan_id, activities,
      coupon_code, total_amount
    } = req.body;

    // Create booking
    const [bookingResult] = await connection.execute(`
      INSERT INTO bookings (
        guest_name, guest_email, guest_phone, check_in_date, check_out_date,
        adults, children, accommodation_id, rooms, meal_plan_id, coupon_code,
        total_amount, status, payment_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'pending')
    `, [
      guest_name, guest_email, guest_phone, check_in_date, check_out_date,
      adults, children, accommodation_id, rooms, meal_plan_id || null,
      coupon_code || null, total_amount
    ]);

    const bookingId = bookingResult.insertId;

    // Add activities
    if (activities && activities.length > 0) {
      for (const activityId of activities) {
        await connection.execute(
          'INSERT INTO booking_activities (booking_id, activity_id) VALUES (?, ?)',
          [bookingId, activityId]
        );
      }
    }

    // Update coupon usage if applicable
    if (coupon_code) {
      await connection.execute(
        'UPDATE coupons SET used_count = used_count + 1 WHERE code = ?',
        [coupon_code]
      );
    }

    await connection.commit();
    
    res.json({ 
      success: true, 
      booking_id: bookingId,
      message: 'Booking created successfully'
    });

  } catch (error) {
    await connection.rollback();
    console.error('Error creating booking:', error);
    res.status(500).json({ error: 'Failed to create booking' });
  } finally {
    connection.release();
  }
});

// Get booking details
app.get('/api/bookings/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const [bookings] = await pool.execute(`
      SELECT b.*, a.title as accommodation_title, a.price as accommodation_price,
             m.title as meal_plan_title, m.price as meal_plan_price
      FROM bookings b
      LEFT JOIN accommodations a ON b.accommodation_id = a.id
      LEFT JOIN meal_plans m ON b.meal_plan_id = m.id
      WHERE b.id = ?
    `, [id]);

    if (bookings.length === 0) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    const booking = bookings[0];

    // Get activities
    const [activities] = await pool.execute(`
      SELECT a.* FROM activities a
      JOIN booking_activities ba ON a.id = ba.activity_id
      WHERE ba.booking_id = ?
    `, [id]);

    booking.activities = activities;

    res.json(booking);
  } catch (error) {
    console.error('Error fetching booking:', error);
    res.status(500).json({ error: 'Failed to fetch booking' });
  }
});

// PayU Configuration - Use environment variables for security
const PAYU_CONFIG = {
  merchantId: process.env.PAYU_MERCHANT_KEY || 'rFrruE9E',
  salt: process.env.PAYU_SALT || 'DvYeVsKfYU',
  baseUrl: process.env.NODE_ENV === 'production' 
    ? 'https://secure.payu.in' 
    : 'https://test.payu.in', // Use test URL for development
};

// Utility function to generate PayU hash - CORRECTED VERSION
const generatePayUHash = (params, salt) => {
  const {
    key, txnid, amount, productinfo, firstname, email,
    udf1 = '', udf2 = '', udf3 = '', udf4 = '', udf5 = ''
  } = params;

  // PayU hash formula for v1: key|txnid|amount|productinfo|firstname|email|udf1|udf2|udf3|udf4|udf5||||||SALT
  const hashStringV1 = `${key}|${txnid}|${amount}|${productinfo}|${firstname}|${email}|${udf1}|${udf2}|${udf3}|${udf4}|${udf5}||||||${salt}`;
  
  // PayU hash formula for v2: SALT|txnid|amount|productinfo|firstname|email|udf1|udf2|udf3|udf4|udf5||||||key
  const hashStringV2 = `${salt}|${txnid}|${amount}|${productinfo}|${firstname}|${email}|${udf1}|${udf2}|${udf3}|${udf4}|${udf5}||||||${key}`;
  
  console.log("PayU Hash String V1:", hashStringV1);
  console.log("PayU Hash String V2:", hashStringV2);
  
  const hashV1 = crypto.createHash('sha512').update(hashStringV1).digest('hex');
  const hashV2 = crypto.createHash('sha512').update(hashStringV2).digest('hex');
  
  // PayU expects hash in JSON format with different v1 and v2 values
  return JSON.stringify({
    v1: hashV1,
    v2: hashV2
  });
};

// Utility function to verify PayU response hash
const verifyPayUHash = (params, salt) => {
  const {
    key, txnid, amount, productinfo, firstname, email, status,
    udf1 = '', udf2 = '', udf3 = '', udf4 = '', udf5 = ''
  } = params;

  // For response verification: SALT|status||||||udf5|udf4|udf3|udf2|udf1|email|firstname|productinfo|amount|txnid|key
  const hashString = `${salt}|${status}||||||${udf5}|${udf4}|${udf3}|${udf2}|${udf1}|${email}|${firstname}|${productinfo}|${amount}|${txnid}|${key}`;
  
  const hash = crypto.createHash('sha512').update(hashString).digest('hex');
  
  return hash;
};

// Initialize payment - CORRECTED VERSION
app.post('/api/payment/initialize', async (req, res) => {
  try {
    const { booking_id } = req.body;

    if (!booking_id) {
      return res.status(400).json({ error: 'Booking ID is required' });
    }

    // Get booking details
    const [bookings] = await pool.execute(
      'SELECT * FROM bookings WHERE id = ? AND payment_status IN ("pending", "failed")',
      [booking_id]
    );

    if (bookings.length === 0) {
      return res.status(404).json({ error: 'Booking not found or already paid' });
    }

    const booking = bookings[0];
    
    // Generate unique transaction ID
    const txnid = `TXN${Date.now()}${Math.random().toString(36).substr(2, 5)}`;
    const amount = parseFloat(booking.total_amount).toFixed(2);
    const productinfo = `Plumeria Retreat Booking #${booking_id}`;
    const firstname = booking.guest_name.split(' ')[0];
    const email = booking.guest_email;

    // Prepare hash parameters
    const hashParams = {
      key: PAYU_CONFIG.merchantId,
      txnid,
      amount,
      productinfo,
      firstname,
      email,
      udf1: booking_id.toString(), // Store booking_id in UDF1 for reference
      udf2: '',
      udf3: '',
      udf4: '',
      udf5: ''
    };

    // Generate hash
    const hash = generatePayUHash(hashParams, PAYU_CONFIG.salt);

    // Store payment record
    await pool.execute(`
      INSERT INTO payments (booking_id, payment_id, amount, status, created_at) 
      VALUES (?, ?, ?, 'pending', NOW())
      ON DUPLICATE KEY UPDATE 
      payment_id = VALUES(payment_id), 
      amount = VALUES(amount), 
      status = VALUES(status)
    `, [booking_id, txnid, amount]);

    // Update booking with payment ID
    await pool.execute(
      'UPDATE bookings SET payment_id = ? WHERE id = ?',
      [txnid, booking_id]
    );

    const payuData = {
      key: PAYU_CONFIG.merchantId,
      txnid: txnid,
      amount: amount,
      productinfo: productinfo,
      firstname: firstname,
      email: email,
      phone: booking.guest_phone || '',
      hash: hash,
      surl: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/payment/success`,
      furl: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/payment/failure`,
      curl: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/payment/cancel`,
      udf1: booking_id.toString(),
      udf2: '',
      udf3: '',
      udf4: '',
      udf5: ''
    };

    console.log('PayU Data:', payuData);

    res.json({
      success: true,
      payment_url: `${PAYU_CONFIG.baseUrl}/_payment`,
      payment_data: payuData
    });

  } catch (error) {
    console.error('Error initializing payment:', error);
    res.status(500).json({ error: 'Failed to initialize payment' });
  }
});

// Payment callback/webhook - CORRECTED VERSION
app.post('/api/payment/callback', async (req, res) => {
  const connection = await pool.getConnection();
  
  try {
    await connection.beginTransaction();

    const {
      txnid, amount, productinfo, firstname, email, status, hash,
      payuMoneyId, mihpayid, mode, bankcode, PG_TYPE, bank_ref_num,
      udf1, udf2, udf3, udf4, udf5
    } = req.body;

    console.log('PayU Callback Data:', req.body);

    if (!txnid || !status) {
      throw new Error('Missing required payment data');
    }

    // Verify hash for security
    const verificationParams = {
      key: PAYU_CONFIG.merchantId,
      txnid, amount, productinfo, firstname, email, status,
      udf1: udf1 || '', udf2: udf2 || '', udf3: udf3 || '', 
      udf4: udf4 || '', udf5: udf5 || ''
    };

    const expectedHash = verifyPayUHash(verificationParams, PAYU_CONFIG.salt);
    
    // Hash verification (optional but recommended)
    if (hash) {
      let receivedHash = hash;
      
      // If hash is JSON string, parse it and use v1 value
      if (hash.startsWith('{') && hash.includes('v1')) {
        try {
          const parsedHash = JSON.parse(hash);
          receivedHash = parsedHash.v1 || parsedHash.v2 || hash;
        } catch (e) {
          console.warn('Failed to parse hash JSON');
        }
      }
      
      if (receivedHash.toLowerCase() !== expectedHash.toLowerCase()) {
        console.warn('Hash mismatch - potential security issue');
        // You can choose to reject the transaction or log for investigation
      }
    }

    // Determine payment status
    const paymentStatus = status.toLowerCase() === 'success' ? 'success' : 'failed';
    const bookingStatus = status.toLowerCase() === 'success' ? 'confirmed' : 'pending';
    const paymentBookingStatus = status.toLowerCase() === 'success' ? 'paid' : 'failed';

    // Update payment record
    await connection.execute(`
      UPDATE payments 
      SET status = ?, payu_payment_id = ?, transaction_id = ?, 
          gateway_response = ?, mode = ?, updated_at = NOW()
      WHERE payment_id = ?
    `, [
      paymentStatus, 
      mihpayid || payuMoneyId, 
      bank_ref_num || payuMoneyId, 
      JSON.stringify(req.body),
      mode || '',
      txnid
    ]);

    // Update booking status
    await connection.execute(`
      UPDATE bookings 
      SET status = ?, payment_status = ?, updated_at = NOW()
      WHERE payment_id = ?
    `, [bookingStatus, paymentBookingStatus, txnid]);

    // If using UDF1 for booking_id, update that booking too
    if (udf1) {
      await connection.execute(`
        UPDATE bookings 
        SET status = ?, payment_status = ?, updated_at = NOW()
        WHERE id = ?
      `, [bookingStatus, paymentBookingStatus, udf1]);
    }

    await connection.commit();

    // Return appropriate response
    if (status.toLowerCase() === 'success') {
      res.json({ 
        success: true, 
        status: 'success',
        message: 'Payment successful',
        transaction_id: mihpayid || payuMoneyId
      });
    } else {
      res.json({ 
        success: false, 
        status: 'failed',
        message: 'Payment failed'
      });
    }

  } catch (error) {
    await connection.rollback();
    console.error('Error processing payment callback:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to process payment callback',
      message: error.message 
    });
  } finally {
    connection.release();
  }
});

// Payment success page handler
app.post('/api/payment/success', async (req, res) => {
  try {
    // This is called when user returns from PayU success page
    const { txnid, amount, status, hash } = req.body;
    
    // Get payment details
    const [payments] = await pool.execute(`
      SELECT p.*, b.id as booking_id, b.guest_name 
      FROM payments p
      JOIN bookings b ON p.booking_id = b.id
      WHERE p.payment_id = ?
    `, [txnid]);

    if (payments.length > 0) {
      const payment = payments[0];
      res.json({
        success: true,
        payment_status: payment.status,
        booking_id: payment.booking_id,
        transaction_id: payment.payu_payment_id
      });
    } else {
      res.status(404).json({ error: 'Payment not found' });
    }

  } catch (error) {
    console.error('Error handling payment success:', error);
    res.status(500).json({ error: 'Failed to process payment success' });
  }
});

// Payment failure page handler
app.post('/api/payment/failure', async (req, res) => {
  try {
    const { txnid, status, error: paymentError } = req.body;
    
    // Get payment details
    const [payments] = await pool.execute(`
      SELECT p.*, b.id as booking_id 
      FROM payments p
      JOIN bookings b ON p.booking_id = b.id
      WHERE p.payment_id = ?
    `, [txnid]);

    if (payments.length > 0) {
      res.json({
        success: false,
        payment_status: 'failed',
        booking_id: payments[0].booking_id,
        error: paymentError || 'Payment failed'
      });
    } else {
      res.status(404).json({ error: 'Payment not found' });
    }

  } catch (error) {
    console.error('Error handling payment failure:', error);
    res.status(500).json({ error: 'Failed to process payment failure' });
  }
});

// Get payment status - ENHANCED VERSION

// Get blocked dates
app.get('/api/blocked-dates', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT blocked_date FROM blocked_dates ORDER BY blocked_date'
    );
    res.json(rows.map(row => row.blocked_date));
  } catch (error) {
    console.error('Error fetching blocked dates:', error);
    res.status(500).json({ error: 'Failed to fetch blocked dates' });
  }
});


async function executeQuery(query) {
  try {
    const [rows] = await pool.execute(query);
    return rows;
  } catch (error) {
    console.error('Database query error:', error);
    throw error;
  }
}


app.get('/api/packages', async (req, res) => {
  try {
    const { active, limit, offset } = req.query;
    
    // `;
    const query = `select * from packages`;
    
   
    
    const packages = await executeQuery(query);
 
    
    res.json(packages);
  } catch (error) {
    console.error('Error fetching packages:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to fetch packages'
    });
  }
});

// GET /api/packages/:id - Get single package by ID
app.get('/api/packages/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const query = ` select * from packgaes where id = ? `;
    
    const packages = await executeQuery(query, [id]);
    
    if (packages.length === 0) {
      return res.status(404).json({
        error: 'Package not found'
      });
    }
    
    const pkg = packages[0];
    const formattedPackage = {
      ...pkg,
      includes: pkg.includes ? JSON.parse(pkg.includes) : [],
      accommodations: pkg.accommodations ? pkg.accommodations.split(',') : [],
      services: pkg.services ? pkg.services.split(',') : [],
      activities: pkg.activities ? pkg.activities.split(',') : [],
      active: Boolean(pkg.active),
      price: parseFloat(pkg.price)
    };
    
    res.json(formattedPackage);
  } catch (error) {
    console.error('Error fetching package:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to fetch package'
    });
  }
});



// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Server error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
  await testConnection();
});
