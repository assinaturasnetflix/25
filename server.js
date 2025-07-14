require('dotenv').config();
const http = require('http');
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: process.env.FRONTEND_URL || '*',
        methods: ['GET', 'POST']
    }
});

const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('MongoDB Conectado com Sucesso!');
    } catch (err) {
        console.error('Falha na conexão com MongoDB:', err.message);
        process.exit(1);
    }
};

connectDB();

app.use(cors({
    origin: process.env.FRONTEND_URL || '*'
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/api', require('./routes.js'));

require('./socketManager.js')(io);

app.get('/', (req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.send('<h1>BrainSkill Backend</h1><p>Servidor está a postos e a aguardar conecções.</p>');
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
    console.log(`Frontend URL permitida: ${process.env.FRONTEND_URL || '*'}`);
});

// A plataforma Render.com gerencia o HTTPS/SSL.
// O servidor Node.js só precisa rodar em HTTP.
// O Render irá receber o tráfego HTTPS na porta 443 e encaminhá-lo
// como tráfego HTTP para a porta interna do nosso container (PORT).
// Por isso, criar um servidor HTTPS aqui não é necessário e nem recomendado
// para este tipo de ambiente de implantação.