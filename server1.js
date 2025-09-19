const express = require('express');
const { MongoClient } = require('mongodb');
const path = require('path');
require('dotenv').config();

const app = express();
const port = 3000;

// Middleware to parse JSON bodies
app.use(express.json());
app.use(express.static(path.join(__dirname, '')));

// MongoDB Connection URI and Database Name
const uri = process.env.MONGO_URI; // Change this if your MongoDB instance is different
const dbName = "agrimandi";
let db;

// Data for Mandi Prices
const mandiPrices = [
    { state: "Maharashtra", district: "Pune", crop: "Wheat", todayPrice: 2150, yesterdayPrice: 2120 },
    { state: "Maharashtra", district: "Pune", crop: "Rice", todayPrice: 1800, yesterdayPrice: 1820 },
    { state: "Maharashtra", district: "Nashik", crop: "Onion", todayPrice: 1500, yesterdayPrice: 1480 },
    { state: "Karnataka", district: "Bengaluru", crop: "Potato", todayPrice: 2500, yesterdayPrice: 2550 },
    { state: "Karnataka", district: "Mysuru", crop: "Tomato", todayPrice: 1200, yesterdayPrice: 1150 },
    { state: "Uttar Pradesh", district: "Varanasi", crop: "Gram", todayPrice: 3500, yesterdayPrice: 3450 },
    { state: "Uttar Pradesh", district: "Lucknow", crop: "Maize", todayPrice: 1600, yesterdayPrice: 1580 },
];

async function connectToMongo() {
    const client = new MongoClient(uri);
    try {
        await client.connect();
        console.log("Connected to MongoDB");
        db = client.db(dbName);

        // Optional: Pre-populate mandi prices collection if it's empty
        const mandiCollection = db.collection('mandi_prices');
        const count = await mandiCollection.countDocuments();
        if (count === 0) {
            await mandiCollection.insertMany(mandiPrices);
            console.log("Mandi prices pre-populated.");
        }
    } catch (err) {
        console.error("Failed to connect to MongoDB", err);
        // Exit process or handle error appropriately in a real-world app
        process.exit(1);
    }
}

connectToMongo();

// API endpoint to get mandi prices
app.get('/api/mandi', async (req, res) => {
    try {
        const prices = await db.collection('mandi_prices').find({}).toArray();
        res.json(prices);
    } catch (err) {
        res.status(500).json({ message: "Error fetching mandi prices", error: err.message });
    }
});

// API endpoint to get buyer requests
app.get('/api/buyers', async (req, res) => {
    try {
        const buyers = await db.collection('buyers').find({}).toArray();
        res.json(buyers);
    } catch (err) {
        res.status(500).json({ message: "Error fetching buyer requests", error: err.message });
    }
});

// API endpoint to submit a new buyer request
app.post('/api/buyers', async (req, res) => {
    const { name, crop, quantity, contact } = req.body;
    if (!name || !crop || !quantity || !contact) {
        return res.status(400).json({ message: "All fields are required" });
    }

    try {
        const result = await db.collection('buyers').insertOne(req.body);
        res.status(201).json({ message: "Buyer request submitted successfully", _id: result.insertedId });
    } catch (err) {
        res.status(500).json({ message: "Error submitting buyer request", error: err.message });
    }
});

// Serve the HTML file
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Start the server
app.listen(port, () => {
    console.log(`Server listening at http://localhost:${port}`);
});
