const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const config = require('./config');
const routes = require('./routes');
const { initializeSocket } = require('./socketManager');
const { PlatformConfig } = require('./models');

const app = express();
const server = http.createServer(app);

app.use(cors({
    origin: config.CORS_ORIGIN,
    credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

mongoose.connect(process.env.MONGO_URI)
    .then(async () => {
        console.log('MongoDB Conectado...');
        let platformConfig = await PlatformConfig.findOne({ key: 'main_config' });
        if (!platformConfig) {
            console.log('Criando configurações iniciais da plataforma...');
            platformConfig = new PlatformConfig();
            await platformConfig.save();
        }
    })
    .catch(err => console.error('Erro de conexão com MongoDB:', err));

initializeSocket(server);

app.use('/api', routes);

app.get('/', (req, res) => {
    res.send('Servidor BrainSkill está a funcionar!');
});

server.listen(config.SERVER_PORT, () => {
    console.log(`Servidor a correr na porta ${config.SERVER_PORT}`);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    process.exit(1);
});