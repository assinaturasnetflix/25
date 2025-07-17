// ==========================================================
// FICHEIRO: server.js (Versão Completa e Corrigida)
// ==========================================================

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
        'mailto:acaciofariav@gmail.com', // O seu email de contato
        vapidPublicKey,
        vapidPrivateKey
    );
    console.log("Configuração VAPID para notificações push carregada.");
}

// --- CONFIGURAÇÃO DE CORS ---
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

// --- INICIALIZAÇÃO DO SOCKET.IO ---
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
console.log(">>> O arquivo de rotas foi carregado com sucesso. <<<");

// --- CONEXÃO COM O MONGODB ---
const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
    console.error("Erro: A variável de ambiente MONGO_URI não está definida.");
    process.exit(1);
}

mongoose.connect(MONGO_URI)
    .then(async () => { // Tornamos o callback assíncrono
        console.log('MongoDB Conectado...');

        // --- INÍCIO DO CÓDIGO DE CORREÇÃO AUTOMÁTICA DO ÍNDICE ---
        // Garante que o índice 'gameCode' está configurado corretamente como 'sparse'.
        try {
            const gameCollection = mongoose.connection.collection('games');
            const indexes = await gameCollection.indexes();
            const gameCodeIndex = indexes.find(idx => idx.name === 'gameCode_1');

            // Se o índice existe mas NÃO é sparse, removemo-lo.
            if (gameCodeIndex && !gameCodeIndex.sparse) {
                console.log("Índice 'gameCode_1' antigo e incorreto encontrado. A remover...");
                await gameCollection.dropIndex('gameCode_1');
                console.log("Índice antigo removido. O Mongoose irá recriá-lo corretamente.");
            } else if (gameCodeIndex) {
                console.log("Índice 'gameCode_1' já está configurado corretamente.");
            } else {
                console.log("Índice 'gameCode_1' não encontrado. O Mongoose irá criá-lo.");
            }
        } catch (err) {
            // Este erro pode acontecer se a coleção ainda não existir, o que é normal.
            console.warn("Aviso ao verificar/corrigir o índice 'gameCode_1'.", err.message);
        }
        // --- FIM DO CÓDIGO DE CORREÇÃO ---

    })
    .catch(err => console.error('Erro de conexão com MongoDB:', err));

// --- INTEGRAÇÃO COM SOCKET.IO ---
socketManager(io);

// --- INICIAR SERVIDOR ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor de API da BrainSkill a rodar na porta ${PORT}`);
});