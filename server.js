require('dotenv').config(); // Garante que as variáveis de .env são carregadas primeiro
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const routes = require('./routes');
const socketManager = require('./socketManager');
const webpush = require('web-push');

const app = express();
const server = http.createServer(app);

// --- CONFIGURAR AS CHAVES VAPID ---
const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;

if (!vapidPublicKey || !vapidPrivateKey) {
    console.warn("AVISO: Chaves VAPID não definidas no arquivo .env. As notificações push não funcionarão.");
} else {
    webpush.setVapidDetails(
        'mailto:acaciofariav@gmail.com', // Substitua pelo seu email de contato
        vapidPublicKey,
        vapidPrivateKey
    );
    console.log("Configuração VAPID para notificações push carregada.");
}

// --- INÍCIO DA ATUALIZAÇÃO DE CORS (EQUILÍBRIO FINAL) ---

const corsOptions = {
    origin: (origin, callback) => {
        const corsOrigin = process.env.CORS_ORIGIN;

        if (corsOrigin === '*') {
            return callback(null, true);
        }
        
        const whitelist = corsOrigin ? corsOrigin.split(',').map(item => item.trim()) : [];

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
    cors: corsOptions,
    connectionStateRecovery: {
        maxDisconnectionDuration: 2 * 60 * 1000,
        skipMiddlewares: true,
    }
});

// --- MIDDLEWARE ---
app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Endpoint de Health Check para impedir o servidor de adormecer (ping).
app.get("/", (req, res) => {
  res.status(200).send("Servidor BrainSkill está online e operacional.");
});

// --- ROTAS DA API ---
app.use('/api', routes);
console.log(">>> O arquivo de rotas foi carregado com sucesso. Versão: 1.0 <<<"); // <-- LINHA DE DEBUG ADICIONADA

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