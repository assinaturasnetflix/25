const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const { Server } = require('socket.io');
const { PlatformSettings } = require('./models');
const config = require('./config');

dotenv.config();

const app = express();
const httpServer = http.createServer(app);

const io = new Server(httpServer, {
    cors: {
        origin: "*",
        methods: ["GET", "POST", "PUT", "DELETE"],
        allowedHeaders: ["Content-Type", "Authorization"],
        credentials: true
    }
});

const connectDB = async () => {
    try {
        const conn = await mongoose.connect(process.env.MONGO_URI);
        console.log(`MongoDB Conectado: ${conn.connection.host}`);
        
        let settings = await PlatformSettings.findOne({ singleton: true });
        if (!settings) {
            console.log('Nenhuma configuração de plataforma encontrada. A criar uma com valores padrão...');
            const defaultPaymentMethods = [
                { name: 'M-Pesa', number: '840000000', holderName: 'Admin BrainSkill', instructions: 'Envie o valor para este número e submeta o ID da transação.', type: 'M-Pesa' },
                { name: 'e-Mola', number: '860000000', holderName: 'Admin BrainSkill', instructions: 'Envie o valor para este número e submeta o ID da transação.', type: 'e-Mola' }
            ];
            await PlatformSettings.create({ 
                singleton: true, 
                paymentMethods: defaultPaymentMethods,
                mainTexts: { helpPage: config.texts.helpPageContent }
            });
            console.log('Configurações padrão criadas.');
        }

    } catch (error) {
        console.error(`Erro ao conectar ao MongoDB: ${error.message}`);
        process.exit(1);
    }
};

connectDB();

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

const socketManager = require('./socketManager');
socketManager(io);

const apiRoutes = require('./routes');
app.use('/api', apiRoutes);

app.get('/', (req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.send('<h1>Servidor BrainSkill está a funcionar!</h1>');
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
    console.log(`Servidor a correr na porta ${PORT}`);
});