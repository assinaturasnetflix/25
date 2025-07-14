require('dotenv').config();
const http = require('http');
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const { Server } = require('socket.io');

const socketManager = require('./socketManager');
const apiRoutes = require('./routes');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: process.env.CORS_ORIGIN || "*",
        methods: ["GET", "POST", "PUT", "DELETE"]
    }
});

const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI;

app.use(cors({
    origin: process.env.CORS_ORIGIN || "*"
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/', apiRoutes);

socketManager(io);

mongoose.connect(MONGO_URI)
    .then(() => {
        console.log('MongoDB Conectado...');
        server.listen(PORT, () => {
            console.log(`Servidor rodando na porta ${PORT}`);
        });
    })
    .catch(err => {
        console.error('Falha na conexão com MongoDB:', err.message);
        process.exit(1);
    });