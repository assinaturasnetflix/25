// ==========================================================
// FICHEIRO: server.js (VERSÃO FINAL E ROBUSTA)
// ==========================================================

require('dotenv').config();
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

// --- CONFIGURAÇÃO VAPID (como estava) ---
const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
if (vapidPublicKey && vapidPrivateKey) {
    webpush.setVapidDetails('mailto:seuemail@exemplo.com', vapidPublicKey, vapidPrivateKey);
    console.log("Configuração VAPID carregada.");
} else {
    console.warn("AVISO: Chaves VAPID não definidas. Push notifications não funcionarão.");
}

// --- CONFIGURAÇÃO DE CORS (como estava) ---
const corsOptions = {
    origin: (origin, callback) => {
        const corsOrigin = process.env.CORS_ORIGIN || '*';
        if (corsOrigin === '*') return callback(null, true);
        const whitelist = corsOrigin.split(',').map(item => item.trim());
        if (!origin || whitelist.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            callback(new Error('Acesso não permitido por CORS.'));
        }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"]
};

// --- MIDDLEWARE (como estava) ---
app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.get("/", (req, res) => res.status(200).send("Servidor BrainSkill online."));
app.use('/api', routes);
console.log(">>> Rotas da API carregadas. Aguardando conexão com a base de dados... <<<");

// --- FUNÇÃO PARA INICIAR O SERVIDOR ---
// Criámos uma função para organizar o arranque.
async function startServer() {
    try {
        // 1. CONECTAR À BASE DE DADOS
        const MONGO_URI = process.env.MONGO_URI;
        if (!MONGO_URI) {
            console.error("Erro Crítico: A variável de ambiente MONGO_URI não está definida.");
            process.exit(1);
        }
        await mongoose.connect(MONGO_URI);
        console.log('MongoDB Conectado com sucesso!');

        // 2. CORRIGIR O ÍNDICE (a nossa lógica de correção)
        console.log("A verificar e a corrigir o índice 'gameCode_1'...");
        const gameCollection = mongoose.connection.collection('games');
        const indexes = await gameCollection.indexes();
        const gameCodeIndex = indexes.find(idx => idx.name === 'gameCode_1');
        
        if (gameCodeIndex && !gameCodeIndex.sparse) {
            console.log("Índice incorreto encontrado. A remover...");
            await gameCollection.dropIndex('gameCode_1');
            console.log("Índice antigo removido. Será recriado corretamente.");
        } else {
            console.log("Índice 'gameCode_1' está correto ou não existe (será criado).");
        }
        console.log("Verificação da Base de Dados completa.");

        // 3. SÓ AGORA INICIAMOS O SOCKET.IO E O SERVIDOR HTTP
        const io = new Server(server, { cors: corsOptions });
        socketManager(io);

        const PORT = process.env.PORT || 3000;
        server.listen(PORT, () => {
            console.log(`====================================================`);
            console.log(`>>> SERVIDOR PRONTO E A RODAR NA PORTA ${PORT} <<<`);
            console.log(`====================================================`);
        });

    } catch (error) {
        console.error('!!!!!!!!!! FALHA CRÍTICA AO INICIAR O SERVIDOR !!!!!!!!!!');
        console.error(error);
        process.exit(1);
    }
}

// --- CHAMAR A FUNÇÃO PARA ARRANCAR TUDO ---
startServer();