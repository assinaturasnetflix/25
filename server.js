// ==========================================================
// FICHEIRO: server.js (VERSÃO FINAL COM CORREÇÃO DE CORS)
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

const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
if (vapidPublicKey && vapidPrivateKey) {
    webpush.setVapidDetails('mailto:seuemail@exemplo.com', vapidPublicKey, vapidPrivateKey);
    console.log("Configuração VAPID carregada.");
} else {
    console.warn("AVISO: Chaves VAPID não definidas. Push notifications não funcionarão.");
}

// --- CONFIGURAÇÃO DE CORS (PONTO CRÍTICO DA CORREÇÃO) ---
const corsOptions = {
    origin: (origin, callback) => {
        // A variável de ambiente DEVE conter o seu domínio de frontend.
        // Ex: "https://brainskill.site" ou "https://brainskill.site,http://localhost:8080"
        const corsOrigin = process.env.CORS_ORIGIN;

        // Se a variável não estiver definida no ambiente do servidor, o acesso é bloqueado por segurança.
        if (!corsOrigin) {
             return callback(new Error('CORS_ORIGIN não configurado no servidor. Acesso negado.'));
        }

        const whitelist = corsOrigin.split(',').map(item => item.trim());

        // Permite a origem se estiver na whitelist (ou se a origem for indefinida, como em requests de apps mobile ou Postman)
        if (!origin || whitelist.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            console.error(`CORS: Acesso negado para a origem não autorizada: ${origin}`); // Adiciona um log para debugging no servidor
            callback(new Error('Acesso não permitido por CORS.'));
        }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"]
};

// --- MIDDLEWARE ---
// Aplica as opções de CORS tanto à API Express como ao Socket.IO
app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.get("/", (req, res) => res.status(200).send("Servidor BrainSkill online."));
app.use('/api', routes);
console.log(">>> Rotas da API carregadas. Aguardando conexão com a base de dados... <<<");

async function startServer() {
    try {
        const MONGO_URI = process.env.MONGO_URI;
        if (!MONGO_URI) {
            console.error("Erro Crítico: A variável de ambiente MONGO_URI não está definida.");
            process.exit(1);
        }
        await mongoose.connect(MONGO_URI);
        console.log('MongoDB Conectado com sucesso!');

        console.log("A iniciar a verificação do índice 'gameCode_1'...");
        const gameCollection = mongoose.connection.collection('games');
        const indexes = await gameCollection.indexes();
        const gameCodeIndex = indexes.find(idx => idx.name === 'gameCode_1');
        
        // Se o índice existir mas não for 'sparse', ele será recriado na próxima inicialização pelo Mongoose
        if (gameCodeIndex && !gameCodeIndex.sparse) {
            console.warn("AVISO: O índice 'gameCode_1' existe mas não é 'sparse'. Recomenda-se remover e reiniciar.");
            // Lógica para remover o índice se necessário (mais seguro fazer manualmente na base de dados)
            // await gameCollection.dropIndex('gameCode_1');
            // console.log("Índice antigo removido. Será recriado na inicialização.");
        } else {
            console.log("Índice 'gameCode_1' está configurado corretamente como 'sparse' ou será criado.");
        }
        console.log("Verificação da Base de Dados completa.");

        // Inicia o Socket.IO com as mesmas opções de CORS
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

startServer();