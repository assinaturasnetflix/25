require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const routes = require('./routes');
const socketManager = require('./socketManager');

const app = express();
const server = http.createServer(app);

// --- LÓGICA DE CORS INTELIGENTE ---
// Define a origem permitida. Se a variável de ambiente não estiver definida,
// permite qualquer origem (útil para desenvolvimento local).
const allowedOrigin = process.env.CORS_ORIGIN || '*';

const corsOptions = {
    origin: allowedOrigin,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"]
};

// --- FIM DA LÓGICA DE CORS ---


const io = new Server(server, {
    cors: corsOptions, // Usa as mesmas opções de CORS para o Socket.IO
    connectionStateRecovery: {
        maxDisconnectionDuration: 2 * 60 * 1000,
        skipMiddlewares: true,
    }
});


// --- MIDDLEWARE ---
// Aplica as opções de CORS a todas as requisições HTTP
app.use(cors(corsOptions));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));


// --- ROTAS DA API ---
app.use('/api', routes);


// Conexão com o MongoDB
const MONGO_URI = process.env.MONGO_URI;
mongoose.connect(MONGO_URI)
    .then(() => console.log('MongoDB Conectado...'))
    .catch(err => console.error('Erro de conexão com MongoDB:', err));


// Integração com Socket.IO
socketManager(io);


// Iniciar servidor
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor de API rodando na porta ${PORT}`);
    console.log(`Permitindo requisições da origem: ${allowedOrigin}`);
});