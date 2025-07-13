require('dotenv').config();
const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const cors = require('cors');
const { Server } = require('socket.io');
const { initializeSocketManager } = require('./socketManager');
const apiRoutes = require('./routes');
const { PlatformSettings } = require('./models');
const config = require('./config');

const app = express();
const server = http.createServer(app);

const corsOptions = {
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const io = new Server(server, {
    cors: corsOptions,
    pingInterval: 10000,
    pingTimeout: 5000,
    transports: ['websocket', 'polling']
});

initializeSocketManager(io);

app.use('/api', apiRoutes);

app.get('/', (req, res) => {
    res.send(`BrainSkill Server is running. Ready to accept connections.`);
});

const PORT = process.env.PORT || 3000;

const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('MongoDB Connected...');
        
        const settings = await PlatformSettings.findOne({ singleton: true });
        if (!settings) {
            console.log('Initializing platform settings...');
            await PlatformSettings.create({ singleton: true });
        }
    } catch (err) {
        console.error('MongoDB Connection Error:', err.message);
        process.exit(1);
    }
};

connectDB().then(() => {
    server.listen(PORT, '0.0.0.0', () => {
        console.log(`Server running on port ${PORT}`);
        if(process.env.NODE_ENV !== 'production') {
            console.log(`Development server running at http://localhost:${PORT}`);
        }
    });
}).catch(err => {
    console.error("Failed to connect to the database, server will not start.", err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception thrown:', error);
    process.exit(1);
});