const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const path = require('path');
const cors = require('cors');
const fs = require('fs');
const multer = require('multer');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Cloudinary Setup
const cloudinary = require('cloudinary').v2;
cloudinary.config({
  secure: true // Uses CLOUDINARY_URL from .env
});

// Ensure uploads dir exists
if (!fs.existsSync('public/uploads')) {
  fs.mkdirSync('public/uploads', { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'public/uploads/'),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});
const upload = multer({ storage: storage });

// MongoDB
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
});

// Models
const OrderSchema = new mongoose.Schema({
  customerName: String,
  email: String,
  number: Number,
  address: String,
  items: [
    {
      product: String,
      size: String,
      quantity: Number
    }
  ],
  status: { type: String, enum: ['Pending', 'Completed'], default: 'Pending' },
  createdAt: { type: Date, default: Date.now }
});
const Order = mongoose.model('Order', OrderSchema);

const ProductSchema = new mongoose.Schema({
  name: String,
  description: String,
  price: Number,
  imageUrls: [String]
});
const Product = mongoose.model('Product', ProductSchema);

app.use(session({
  secret: process.env.SESSION_SECRET || 'defaultsecret',
  resave: false,
  saveUninitialized: false
}));
// Middleware
app.use(cors());
app.use(bodyParser.json());


app.get('/admin', (req, res) => {
  if (req.session && req.session.authenticated) {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
  } else {
    res.redirect('/login');
  }
});
app.get('/admin.html', (req, res) => {
  res.redirect('/admin');
});
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});
app.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});



app.use(express.static(path.join(__dirname,'public'),{extensions: ['html','htm','css']}));

const authMiddleware = (req, res, next) => {
  if (req.session && req.session.authenticated) {
    return next();
  } else {
    return res.status(401).json({ message: 'Unauthorized' });
  }
};
// Login route
app.post('/login', (req, res) => {
  const { username, password } = req.body;

  const ADMIN_USER = process.env.ADMIN_USER || 'admin';
  const ADMIN_PASS = process.env.ADMIN_PASS || 'password123';

  if (username === ADMIN_USER && password === ADMIN_PASS) {
    req.session.authenticated = true;
    return res.json({ success: true });
  } else {
    return res.status(401).json({ message: 'Invalid credentials' });
  }
});

// Checkout
app.post('/checkout', async (req, res) => {
  try {
    const { customerName, email, number, address, cart } = req.body;
    if (!customerName || !email || !number || !address || !cart?.length)
      return res.status(400).json({ message: 'Missing required fields.' });

    const newOrder = new Order({ customerName, email, number, address, items: cart });
    await newOrder.save();
    res.json({ message: 'Checkout successful! Your order has been received.' });
  } catch (error) {
    res.status(500).json({ message: 'Error during checkout', error });
  }
});

// Orders
app.get('/admin/orders', authMiddleware, async (req, res) => {
  try {
    const orders = await Order.find().sort({ createdAt: -1 });
    res.json(orders);
  } catch (error) {
    res.status(500).json({ message: 'Failed to retrieve orders', error });
  }
});

app.patch('/admin/orders/:id', authMiddleware, async (req, res) => {
  try {
    const order = await Order.findByIdAndUpdate(
      req.params.id,
      { status: req.body.status },
      { new: true }
    );
    res.json(order);
  } catch (error) {
    res.status(500).json({ message: 'Failed to update order status', error });
  }
});

// Get all products
app.get('/admin/products', authMiddleware, async (req, res) => {
  const products = await Product.find();
  res.json(products);
});

// Add product
app.post('/admin/products', authMiddleware, upload.array('images', 5), async (req, res) => {
  const { name, description, price } = req.body;

  try {
    const uploadResults = await Promise.all(
      req.files.map(file => cloudinary.uploader.upload(file.path, { folder: 'tshirt-store' }))
    );

    // Delete local files
    req.files.forEach(file => fs.unlink(file.path, err => err && console.error(err)));

    const imageUrls = uploadResults.map(r => r.secure_url);
    const newProduct = new Product({ name, description, price, imageUrls });
    await newProduct.save();

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ message: 'Failed to upload product', error });
  }
});

// Update product
app.put('/admin/products/:id', authMiddleware, upload.array('images', 5), async (req, res) => {
  try {
    const { name, description, price } = req.body;
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ message: 'Product not found' });

    const updateData = { name, description, price: parseFloat(price) };

    // If new images are uploaded
    if (req.files?.length) {
      // Step 1: Delete old images from Cloudinary
      for (const url of product.imageUrls) {
        const parts = url.split('/');
        const filename = parts[parts.length - 1].split('.')[0]; // e.g., abc123
        const folder = parts[parts.length - 2]; // e.g., tshirt-store
        const publicId = `${folder}/${filename}`;

        try {
          await cloudinary.uploader.destroy(publicId);
        } catch (err) {
          console.error('Error deleting Cloudinary image:', err.message);
        }
      }

      // Step 2: Upload new images to Cloudinary
      const uploadResults = await Promise.all(
        req.files.map(file =>
          cloudinary.uploader.upload(file.path, { folder: 'tshirt-store' })
        )
      );

      // Step 3: Remove local image files
      req.files.forEach(file => fs.unlink(file.path, err => err && console.error(err)));

      // Step 4: Update new image URLs
      updateData.imageUrls = uploadResults.map(r => r.secure_url);
    }

    const updatedProduct = await Product.findByIdAndUpdate(req.params.id, updateData, { new: true });

    res.json({ success: true, product: updatedProduct });
  } catch (error) {
    res.status(500).json({ message: 'Failed to update product', error });
  }
});

// Delete product
app.delete('/admin/products/:id', authMiddleware, async (req, res) => {
  try {
    const product = await Product.findByIdAndDelete(req.params.id);
    if (!product) return res.status(404).json({ message: 'Product not found' });

    // Delete from Cloudinary
    if (product.imageUrls?.length) {
      for (const url of product.imageUrls) {
        const parts = url.split('/');
        const filename = parts[parts.length - 1].split('.')[0]; // public_id
        const folder = parts[parts.length - 2]; // assume folder like 'tshirt-store'
        const publicId = `${folder}/${filename}`;
        cloudinary.uploader.destroy(publicId, err => {
          if (err) console.error('Cloudinary delete error:', err.message);
        });
      }
    }

    res.json({ success: true, message: 'Product deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to delete product', error });
  }
});

// Serve products to frontend
app.get('/products', async (req, res) => {
  const products = await Product.find();
  res.json(products);
});

// Start Server
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
