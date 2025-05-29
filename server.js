const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const path = require('path');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

const multer = require('multer');
const fs = require('fs');

// Create an uploads directory if not exists
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'public/uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});
const upload = multer({ storage: storage });



// MongoDB connection
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
});

// Order schema
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
  status: {
    type: String,
    enum: ['Pending', 'Completed'],
    default: 'Pending'
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
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


// Checkout route
app.post('/checkout', async (req, res) => {
  try {
    const { customerName, email, number, address, cart } = req.body;

    if (!customerName || !email || !number || !address || !cart?.length) {
      return res.status(400).json({ message: 'Missing required fields.' });
    }

    const newOrder = new Order({
      customerName,
      email,
      number,
      address,
      items: cart
    });

    await newOrder.save();
    res.json({ message: 'Checkout successful! Your order has been received.' });
  } catch (error) {
    res.status(500).json({ message: 'Error during checkout', error });
  }
});


// Admin route: Get all orders
app.get('/admin/orders', authMiddleware, async (req, res) => {
  try {
    const orders = await Order.find().sort({ createdAt: -1 });
    res.json(orders);
  } catch (error) {
    res.status(500).json({ message: 'Failed to retrieve orders', error });
  }
});

// Admin route: Update order status
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

// Add new product
app.post('/admin/products', upload.array('images', 5), async (req, res) => {
  const { name, description, price } = req.body;
  const imageUrls = req.files.map(file => `/uploads/${file.filename}`);
  const newProduct = new Product({ name, description, price, imageUrls });
  await newProduct.save();
  res.json({ success: true });
});


// Delete product

app.delete('/admin/products/:id', authMiddleware, async (req, res) => {
  try {
    const product = await Product.findByIdAndDelete(req.params.id);

    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    // Delete image files from the filesystem
    if (product.imageUrls && product.imageUrls.length > 0) {
      product.imageUrls.forEach(imageUrl => {
        const filePath = path.join(__dirname, 'public', imageUrl);
        fs.unlink(filePath, err => {
          if (err) {
            console.error(`Error deleting file ${filePath}:`, err.message);
          }
        });
      });
    }

    res.json({ success: true, message: 'Product and images deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to delete product', error: error.message });
  }
});


// Update product
app.put('/admin/products/:id', authMiddleware, (req, res) => {
  const uploadImages = upload.array('images', 5); // max 5 images per product

  uploadImages(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ message: 'Image upload error', error: err.message });
    }

    try {
      const { name, description, price } = req.body;

      // Build update object with required fields
      const updateData = {
        name,
        description,
        price: parseFloat(price)
      };

      // If new images uploaded, update imageUrls field
      if (req.files && req.files.length > 0) {
        updateData.imageUrls = req.files.map(file => `/uploads/${file.filename}`);
      }

      const updatedProduct = await Product.findByIdAndUpdate(req.params.id, updateData, { new: true });

      if (!updatedProduct) {
        return res.status(404).json({ message: 'Product not found' });
      }

      res.json({ success: true, product: updatedProduct });
    } catch (error) {
      res.status(500).json({ message: 'Failed to update product', error: error.message });
    }
  });
});


// Serve products to frontend
app.get('/products', async (req, res) => {
  const products = await Product.find();
  res.json(products);
});

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



app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
