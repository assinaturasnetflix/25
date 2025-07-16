require('dotenv').config(); // Garante que as variáveis de .env são carregadas primeiro
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const routes = require('./routes');
const socketManager = require('./socketManager');

const app = express();
const server = http.createServer(app);

// --- INÍCIO DA ATUALIZAÇÃO DE CORS DINÂMICO ---

const corsOptions = {
    // A função 'origin' lê dinamicamente a sua variável de ambiente
    origin: (origin, callback) => {
        const corsOrigin = process.env.CORS_ORIGIN;

        // Se CORS_ORIGIN for '*', permite tudo.
        if (corsOrigin === '*') {
            return callback(null, true);
        }
        
        // Se CORS_ORIGIN estiver definido, cria uma lista de permissões
        // Ele suporta múltiplos domínios separados por vírgula. Ex: "url1.com,url2.com"
        const whitelist = corsOrigin ? corsOrigin.split(',') : [];

        // Verifica se a origem do pedido está na lista de permissões
        // ou se o pedido não tem origem (ex: Postman, apps mobile)
        if (!origin || whitelist.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            // Se a origem não estiver na lista, bloqueia o pedido.
            callback(new Error('Acesso não permitido pela política de CORS.'));
        }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"]
};

// --- FIM DA ATUALIZAÇÃO DE CORS DINÂMICO ---

const io = new Server(server, {
    cors: corsOptions, // Aplica as mesmas regras de CORS ao WebSocket
    connectionStateRecovery: {
        maxDisconnectionDuration: 2 * 60 * 1000,
        skipMiddlewares: true,
    }
});

// --- MIDDLEWARE ---
app.use(cors(corsOptions)); // Usa as opções de CORS dinâmicas
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
});