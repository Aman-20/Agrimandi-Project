const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const axios = require('axios');
require('dotenv').config();

const app = express();
const port = 3000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, '')));
app.use(session({
    secret: 'a-very-secret-key-for-agrimandi-app', // Use a strong, unique secret
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false } // Set to true if using HTTPS
}));

// MongoDB Connection
const uri = process.env.MONGO_URI;
const dbName = "agrimandi";
let db;

// CORRECTED initial data structure
// const initialMandiPrices = [
//   { state: 'Andhra Pradesh', crop: 'Rice', price: 2500 },
//   { state: 'Andhra Pradesh', crop: 'Maize', price: 2200 },
//   { state: 'Andhra Pradesh', crop: 'Cotton', price: 4500 },
// ];

async function connectToMongo() {
    const client = new MongoClient(uri);
    try {
        await client.connect();
        console.log("Connected to MongoDB");
        db = client.db(dbName);

        // const mandiCollection = db.collection('mandi_prices');
        // const count = await mandiCollection.countDocuments();
        // if (count === 0) {
        //     await mandiCollection.insertMany(initialMandiPrices);
        //     console.log("Mandi prices pre-populated.");
        // }

    } catch (err) {
        console.error("Failed to connect to MongoDB", err);
        process.exit(1);
    }
}
connectToMongo();

// --- Middleware for Authentication & Authorization ---
const isAuthenticated = (req, res, next) => {
    if (req.session.user) {
        next();
    } else {
        res.status(401).json({ message: "Unauthorized: Not logged in" });
    }
};

const isRole = (role) => (req, res, next) => {
    if (req.session.user && req.session.user.role === role) {
        next();
    } else {
        res.status(403).json({ message: `Forbidden: Requires ${role} role` });
    }
};

// --- NEW: CMS API ENDPOINTS (FOR NEWS, SCHEMES, ADVISORY) ---

// Generic function to handle GET requests
const getCollectionItems = async (collectionName, res) => {
    try {
        const items = await db.collection(collectionName).find({}).sort({ _id: -1 }).toArray();
        res.json(items);
    } catch (err) {
        res.status(500).json({ message: `Error fetching from ${collectionName}` });
    }
};

// Generic function to handle POST requests
const addCollectionItem = async (collectionName, req, res) => {
    try {
        const newItem = { ...req.body, createdAt: new Date() };
        await db.collection(collectionName).insertOne(newItem);
        res.status(201).json({ message: 'Item added successfully' });
    } catch (err) {
        res.status(500).json({ message: `Error adding to ${collectionName}` });
    }
};

// Generic function to handle DELETE requests
const deleteCollectionItem = async (collectionName, req, res) => {
    try {
        const { id } = req.params;
        const result = await db.collection(collectionName).deleteOne({ _id: new ObjectId(id) });
        if (result.deletedCount === 0) return res.status(404).json({ message: 'Item not found' });
        res.json({ message: 'Item deleted successfully' });
    } catch (err) {
        res.status(500).json({ message: `Error deleting from ${collectionName}` });
    }
};

// --- Public Routes (for anyone to view) ---
app.get('/api/news', (req, res) => getCollectionItems('news', res));
app.get('/api/schemes', (req, res) => getCollectionItems('schemes', res));
app.get('/api/advisory', (req, res) => getCollectionItems('advisory', res));


// --- Admin-Only Routes (for managing content) ---
const adminGuard = [isAuthenticated, isRole('admin')];

// News Management
app.post('/api/news', ...adminGuard, (req, res) => addCollectionItem('news', req, res));
app.delete('/api/news/:id', ...adminGuard, (req, res) => deleteCollectionItem('news', req, res));

// Schemes Management
app.post('/api/schemes', ...adminGuard, (req, res) => addCollectionItem('schemes', req, res));
app.delete('/api/schemes/:id', ...adminGuard, (req, res) => deleteCollectionItem('schemes', req, res));

// Advisory Management
app.post('/api/advisory', ...adminGuard, (req, res) => addCollectionItem('advisory', req, res));
app.delete('/api/advisory/:id', ...adminGuard, (req, res) => deleteCollectionItem('advisory', req, res));


// --- NEW: WEATHER API ENDPOINT ---
app.get('/api/weather', async (req, res) => {
    const { lat, lon } = req.query;
    if (!lat || !lon) {
        return res.status(400).json({ message: "Latitude and longitude are required." });
    }

    const apiKey = process.env.OPENWEATHER_API_KEY;
    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric`;

    try {
        const response = await axios.get(url);
        const data = response.data;

        // Send a simplified weather object to the frontend
        res.json({
            location: data.name,
            temperature: data.main.temp,
            condition: data.weather[0].main,
            humidity: data.main.humidity,
            windSpeed: data.wind.speed, // in meter/sec
        });
    } catch (error) {
        console.error("Error fetching weather data:", error.response?.data || error.message);
        res.status(500).json({ message: "Failed to fetch weather data." });
    }
});


// --- AUTHENTICATION API ENDPOINTS ---
app.post('/api/auth/register', async (req, res) => {
    const { email, password, name, role } = req.body;
    if (!email || !password || !name || !role || !['farmer', 'buyer', 'admin'].includes(role)) {
        return res.status(400).json({ message: "All fields are required and role must be valid" });
    }
    try {
        if (await db.collection('users').findOne({ email })) {
            return res.status(409).json({ message: "User with this email already exists" });
        }
        const hashedPassword = await bcrypt.hash(password, 10);
        await db.collection('users').insertOne({ email, password: hashedPassword, name, role });
        res.status(201).json({ message: "User registered successfully" });
    } catch (err) {
        res.status(500).json({ message: "Error registering user", error: err.message });
    }
});

app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ message: "Email and password are required" });
    try {
        const user = await db.collection('users').findOne({ email });
        if (!user || !await bcrypt.compare(password, user.password)) {
            return res.status(401).json({ message: "Invalid credentials" });
        }
        req.session.user = { id: user._id, email: user.email, name: user.name, role: user.role };
        res.json({ message: "Logged in successfully", user: req.session.user });
    } catch (err) {
        res.status(500).json({ message: "Error logging in", error: err.message });
    }
});

app.post('/api/auth/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) return res.status(500).json({ message: "Could not log out." });
        res.clearCookie('connect.sid').json({ message: "Logged out successfully" });
    });
});

app.get('/api/auth/status', (req, res) => {
    res.json({ loggedIn: !!req.session.user, user: req.session.user || null });
});

// --- MANDI PRICE API ENDPOINTS ---
app.get('/api/mandi', async (req, res) => {
    try {
        res.json(await db.collection('mandi_prices').find({}).toArray());
    } catch (err) {
        res.status(500).json({ message: "Error fetching mandi prices", error: err.message });
    }
});

// NEW: ADD THIS MISSING ROUTE TO YOUR SERVER FILE
app.put('/api/mandi/update', isAuthenticated, async (req, res) => {
    const { state, crop, price } = req.body;
    if (!state || !crop || !price) {
        return res.status(400).json({ message: "State, crop, and price are required." });
    }
    try {
        const result = await db.collection('mandi_prices').updateOne(
            { state: state, crop: crop },
            { $set: { price: parseFloat(price) } },
            { upsert: true } // Creates the document if it doesn't exist
        );
        res.json({ message: "Price updated successfully", modifiedCount: result.modifiedCount, upsertedId: result.upsertedId });
    } catch (err) {
        res.status(500).json({ message: "Error updating price", error: err.message });
    }
});

// --- BUYER & FARMER API ENDPOINTS ---
app.get('/api/buyers', async (req, res) => {
    try {
        const buyers = await db.collection('buyers').find({}).sort({ createdAt: -1 }).toArray();
        res.json(buyers);
    } catch (err) {
        res.status(500).json({ message: "Error fetching buyer requests", error: err.message });
    }
});

app.post('/api/buyers', isAuthenticated, async (req, res) => {
    const { crop, quantity, contactNumber } = req.body;
    if (!crop || !quantity || !contactNumber) {
        return res.status(400).json({ message: "Crop, quantity, and contact number are required" });
    }
    try {
        const newRequest = {
            buyerId: new ObjectId(req.session.user.id),
            buyerName: req.session.user.name,
            contactNumber,
            crop,
            quantity: parseFloat(quantity),
            status: 'open',
            createdAt: new Date()
        };
        await db.collection('buyers').insertOne(newRequest);
        res.status(201).json({ message: "Buyer request submitted successfully" });
    } catch (err) {
        res.status(500).json({ message: "Error submitting buyer request", error: err.message });
    }
});


// NEW: GET all farmer listings (for everyone to see)
app.get('/api/farmer-listings', async (req, res) => {
    try {
        const listings = await db.collection('farmer_listings').find({}).sort({ createdAt: -1 }).toArray();
        res.json(listings);
    } catch (err) {
        res.status(500).json({ message: "Error fetching farmer listings" });
    }
});

// NEW: POST a new farmer listing (farmers only)
app.post('/api/farmer-listings', isAuthenticated, async (req, res) => {
    const { crop, quantity, price, contactNumber } = req.body;
    if (!crop || !quantity || !price || !contactNumber) {
        return res.status(400).json({ message: "Crop, quantity, and price are required." });
    }
    try {
        const newListing = {
            farmerId: new ObjectId(req.session.user.id),
            farmerName: req.session.user.name,
            contactNumber,
            crop,
            quantity: parseFloat(quantity),
            price: parseFloat(price), // Price per quintal
            status: 'available',
            createdAt: new Date()
        };
        await db.collection('farmer_listings').insertOne(newListing);
        res.status(201).json({ message: "Listing posted successfully" });
    } catch (err) {
        res.status(500).json({ message: "Error posting listing" });
    }
});

// NEW: DELETE a farmer's own listing
app.delete('/api/farmer-listings/:id', isAuthenticated, async (req, res) => {
    try {
        const listing = await db.collection('farmer_listings').findOne({ _id: new ObjectId(req.params.id) });
        if (!listing) {
            return res.status(404).json({ message: "Listing not found." });
        }
        // Security check: ensure the user owns this listing
        if (listing.farmerId.toString() !== req.session.user.id) {
            return res.status(403).json({ message: "Forbidden: You do not own this listing." });
        }
        await db.collection('farmer_listings').deleteOne({ _id: new ObjectId(req.params.id) });
        res.json({ message: "Listing deleted successfully." });
    } catch (err) {
        res.status(500).json({ message: "Error deleting listing." });
    }
});


// NEW: GET all posts by the currently logged-in user
app.get('/api/my-posts', isAuthenticated, async (req, res) => {
    const userId = new ObjectId(req.session.user.id);
    const userRole = req.session.user.role;

    try {
        let posts = [];
        if (userRole === 'buyer') {
            posts = await db.collection('buyers').find({ buyerId: userId }).sort({ createdAt: -1 }).toArray();
        } else if (userRole === 'farmer') {
            posts = await db.collection('farmer-listings').find({ farmerId: userId }).sort({ createdAt: -1 }).toArray();
        }
        res.json(posts);
    } catch (err) {
        res.status(500).json({ message: "Error fetching your posts" });
    }
});

// ADD THIS NEW ROUTE
app.put('/api/posts/:collection/:id/complete', isAuthenticated, async (req, res) => {
    const { collection, id } = req.params;
    //const validCollections = ['buyers', 'farmer_listings'];
    const validCollections = ['buyers', 'farmer-listings'];

    if (!validCollections.includes(collection)) {
        return res.status(400).json({ message: "Invalid post type." });
    }

    try {
        // Map the URL parameter 'farmer-listings' to the database collection 'farmer_listings'
        const dbCollectionName = collection === 'farmer-listings' ? 'farmer_listings' : collection;

        const post = await db.collection(collection).findOne({ _id: new ObjectId(id) });
        if (!post) return res.status(404).json({ message: "Post not found." });
        
        // Security Check: Is the current user the owner of the post?
        const ownerIdField = collection === 'buyers' ? 'buyerId' : 'farmerId';
        if (post[ownerIdField].toString() !== req.session.user.id) {
            return res.status(403).json({ message: "Forbidden: You do not own this post." });
        }

        // Change status from 'open' or 'available' to 'completed'
        const result = await db.collection(collection).updateOne(
            { _id: new ObjectId(id) },
            { $set: { status: 'completed', completedAt: new Date() } }
        );
        
        if (result.modifiedCount === 0) return res.status(404).json({ message: "Post not found or already completed." });
        res.json({ message: "Post marked as complete." });
    } catch (err) {
        res.status(500).json({ message: "Error updating post", error: err.message });
    }
});

// ADD THIS NEW ROUTE
app.delete('/api/buyers/:id', isAuthenticated, async (req, res) => {
    try {
        const request = await db.collection('buyers').findOne({ _id: new ObjectId(req.params.id) });
        if (!request) {
            return res.status(404).json({ message: "Request not found." });
        }
        // Security check: ensure the user owns this request
        if (request.buyerId.toString() !== req.session.user.id) {
            return res.status(403).json({ message: "Forbidden: You do not own this request." });
        }
        await db.collection('buyers').deleteOne({ _id: new ObjectId(req.params.id) });
        res.json({ message: "Request deleted successfully." });
    } catch (err) {
        res.status(500).json({ message: "Error deleting request." });
    }
});

// --- Serve HTML and Start Server ---
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});


app.listen(port, () => {
    console.log(`Server listening at http://localhost:${port}`);
});