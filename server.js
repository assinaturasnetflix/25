const express = require('express');
const mongoose = require('mongoose');
const http = require('http');
const { Server } = require('socket.io');
const dotenv = require('dotenv');
const cors = require('cors');
const cloudinary = require('cloudinary').v2;
const routes = require('./routes');
const socketManager = require('./socketManager');

dotenv.config({ path: './.env' });

const app = express();
const server = http.createServer(app);

const corsOptions = {
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

const DB = process.env.MONGO_URI;

mongoose.connect(DB).then(() => {
    console.log('Conexão com MongoDB estabelecida com sucesso!');
}).catch(err => {
    console.error('Erro na conexão com MongoDB:', err.message);
    process.exit(1);
});

app.use('/api', routes);

app.use((req, res, next) => {
    const error = new Error(`Não encontrado - ${req.originalUrl}`);
    res.status(404);
    next(error);
});

app.use((err, req, res, next) => {
    const statusCode = res.statusCode === 200 ? 500 : res.statusCode;
    res.status(statusCode);
    res.json({
        message: err.message,
        stack: process.env.NODE_ENV === 'production' ? null : err.stack,
    });
});

const io = new Server(server, {
    cors: {
        origin: process.env.CORS_ORIGIN || '*',
        methods: ["GET", "POST"]
    },
    connectionStateRecovery: {
        maxDisconnectionDuration: 2 * 60 * 1000,
        skipMiddlewares: true,
    }
});

socketManager(io);

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(`Servidor a correr em http://localhost:${PORT}`);
});

process.on('unhandledRejection', (err) => {
    console.log('UNHANDLED REJECTION! 💥 Desligando...');
    console.log(err.name, err.message);
    server.close(() => {
        process.exit(1);
    });
});