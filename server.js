require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const helmet = require('helmet');
const cors = require('cors');
const cron = require('node-cron');
const apiRoutes = require('./routes'); // Importa o apiRouter
const { checkExpiredPlans } = require('./systemControllers');

const app = express();

app.use(helmet());


// ================== CONFIGURAÇÃO DE CORS CORRIGIDA (via .env) ==================

const corsOptions = {
    // A origem é determinada pela variável de ambiente FRONTEND_URL.
    // Se for '*', permite tudo.
    // Se for 'url1,url2', cria uma lista de permissões a partir dessa string.
    origin: process.env.FRONTEND_URL === '*' 
        ? '*' 
        : process.env.FRONTEND_URL.split(',').map(url => url.trim()),

    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
};

// Usa as opções de CORS dinâmicas
app.use(cors(corsOptions));
// ==============================================================================


app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('MongoDB Connected successfully.');
    } catch (err) {
        console.error('MongoDB connection error:', err.message);
        process.exit(1);
    }
};

connectDB();


// Aplica todas as rotas da API sob o prefixo /api
app.use('/api', apiRoutes);


// Rota de "saúde" na raiz, para verificar se o servidor está no ar
app.get('/', (req, res) => {
    res.json({ message: 'API da Bizno está a funcionar corretamente. Bem-vindo!' });
});


// Middleware de tratamento de erros global
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ message: 'Ocorreu um erro inesperado no servidor.' });
});

// Tarefa agendada (Cron Job) para verificar planos expirados
cron.schedule('0 1 * * *', () => {
    console.log('A executar verificação de planos expirados...');
    checkExpiredPlans();
}, {
    timezone: "Africa/Maputo"
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Servidor a correr na porta ${PORT}`);
});