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

// --- INÍCIO DA ATUALIZAÇÃO DE CORS (EQUILÍBRIO FINAL) ---

const corsOptions = {
    origin: (origin, callback) => {
        const corsOrigin = process.env.CORS_ORIGIN;

        if (corsOrigin === '*') {
            return callback(null, true);
        }
        
        const whitelist = corsOrigin ? corsOrigin.split(',').map(item => item.trim()) : [];

        // --- CORREÇÃO APLICADA AQUI ---
        // Reintroduzimos a verificação '!origin'.
        // Isto permite pedidos de servidor para servidor (como o cron-job) que não têm origem,
        // mas continua a bloquear pedidos de navegadores de domínios não autorizados.
        if (!origin || whitelist.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            callback(new Error('Acesso não permitido pela política de CORS.'));
        }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"]
};

// --- FIM DA ATUALIZAÇÃO ---


const io = new Server(server, {
    cors: corsOptions, // Aplica as mesmas regras de CORS ao WebSocket
    connectionStateRecovery: {
        maxDisconnectionDuration: 2 * 60 * 1000,
        skipMiddlewares: true,
    }
});

// --- MIDDLEWARE ---
app.use(cors(corsOptions)); // Usa as opções de CORS atualizadas
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Endpoint de Health Check para impedir o servidor de adormecer (ping).
app.get("/", (req, res) => {
  res.status(200).send("Servidor BrainSkill está online e operacional.");
});

// --- ROTAS DA API ---
app.use('/api', routes);

// Conexão com o MongoDB
const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
    console.error("Erro: A variável de ambiente MONGO_URI não está definida.");
    process.exit(1);
}

mongoose.connect(MONGO_URI)
    .then(() => console.log('MongoDB Conectado...'))
    .catch(err => console.error('Erro de conexão com MongoDB:', err));

// Integração com Socket.IO
socketManager(io);

// Iniciar servidor
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor de API da BrainSkill a rodar na porta ${PORT}`);
});