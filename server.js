const express = require('express');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const path = require('path');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

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
  imageUrl: String
});

const Product = mongoose.model('Product', ProductSchema);

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

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
app.get('/admin/orders', async (req, res) => {
  try {
    const orders = await Order.find().sort({ createdAt: -1 });
    res.json(orders);
  } catch (error) {
    res.status(500).json({ message: 'Failed to retrieve orders', error });
  }
});

// Admin route: Update order status
app.patch('/admin/orders/:id', async (req, res) => {
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
app.get('/admin/products', async (req, res) => {
  const products = await Product.find();
  res.json(products);
});

// Add new product
app.post('/admin/products', async (req, res) => {
  const { name, description, price, imageUrl } = req.body;
  const newProduct = new Product({ name, description, price, imageUrl });
  await newProduct.save();
  res.json({ success: true });
});

// Delete product
app.delete('/admin/products/:id', async (req, res) => {
  await Product.findByIdAndDelete(req.params.id);
  res.json({ success: true });
});

// Update product
app.put('/admin/products/:id', async (req, res) => {
  const { name, description, price, imageUrl } = req.body;
  await Product.findByIdAndUpdate(req.params.id, { name, description, price, imageUrl });
  res.json({ success: true });
});

// Serve products to frontend
app.get('/products', async (req, res) => {
  const products = await Product.find();
  res.json(products);
});


app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
