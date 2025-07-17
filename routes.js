const express = require('express');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const { User } = require('./models');
const controllers = require('./controllers');

const router = express.Router();

const storage = multer.diskStorage({});

const fileFilter = (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png/;
    const mimetype = allowedTypes.test(file.mimetype);
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());

    if (mimetype && extname) {
        return cb(null, true);
    }
    cb(new Error('Erro: Apenas são permitidos ficheiros de imagem (jpeg, jpg, png)!'), false);
};

const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: { fileSize: 2 * 1024 * 1024 }
});

const protect = async (req, res, next) => {
    let token;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        try {
            token = req.headers.authorization.split(' ')[1];
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            req.user = await User.findById(decoded.id).select('-password');
            if (!req.user) {
                return res.status(401).json({ message: 'Não autorizado, utilizador não encontrado.' });
            }
            if (req.user.isBlocked) {
                return res.status(403).json({ message: 'Sua conta foi bloqueada. Entre em contacto com o suporte.' });
            }
            next();
        } catch (error) {
            console.error('Erro na verificação do token:', error);
            if (error.name === 'TokenExpiredError') {
                return res.status(401).json({ message: 'Token expirado. Por favor, faça login novamente.' });
            }
            return res.status(401).json({ message: 'Não autorizado, token falhou.' });
        }
    } else {
        res.status(401).json({ message: 'Não autorizado, nenhum token.' });
    }
};

const admin = (req, res, next) => {
    if (req.user && req.user.role === 'admin') {
        next();
    } else {
        res.status(403).json({ message: 'Acesso negado. Apenas administradores.' });
    }
};

// --- ROTAS DE USUÁRIO E AUTENTICAÇÃO ---
router.post('/register', controllers.registerUser);
router.post('/login', controllers.loginUser);
router.post('/forgot-password', controllers.forgotPassword);
router.post('/reset-password', controllers.resetPassword);

// --- ROTAS DE PERFIL (PROTEGIDAS) ---
// ATUALIZADO: Rota /profile alterada para /users/me para corresponder ao frontend
router.get('/users/me', protect, controllers.getProfile); 
router.put('/users/profile', protect, controllers.updateProfile); // AGORA TAMBÉM ATUALIZA A 'bio'
router.post('/users/avatar', protect, upload.single('avatar'), controllers.uploadAvatar);
// NOVO: Rota para alterar a senha
router.put('/users/password', protect, controllers.changePassword); 
// NOVO: Rota para ver o perfil público de outro jogador (deve ser a última rota com /users/ para não conflitar)
router.get('/users/profile/:id', controllers.getPublicProfile); 

// --- ROTAS DE TRANSAÇÕES, JOGOS, ETC. (PROTEGIDAS) ---
router.get('/ranking', protect, controllers.getRanking);
router.get('/payment-methods', protect, controllers.getPublicPaymentMethods);
router.post('/transactions/deposit', protect, upload.single('proof'), controllers.createDeposit);
router.post('/transactions/withdrawal', protect, controllers.createWithdrawal);
router.get('/transactions/me', protect, controllers.getMyTransactions);
router.get('/games/me', protect, controllers.getMyGames);
router.delete('/games/me/:id', protect, controllers.hideGameFromHistory);


// --- ROTAS DE ADMINISTRADOR ---
router.get('/admin/users', protect, admin, controllers.getAllUsers);
router.put('/admin/users/:id/toggle-block', protect, admin, controllers.toggleBlockUser);
router.put('/admin/users/:id/balance', protect, admin, controllers.manualBalanceUpdate);
router.patch('/admin/users/:userId/bonus-balance', protect, admin, controllers.adminUpdateUserBonusBalance);
router.get('/admin/users/:userId/history', protect, admin, controllers.adminGetUserHistory);
router.get('/admin/transactions', protect, admin, controllers.getAllTransactions);
router.put('/admin/transactions/:id/process', protect, admin, controllers.processTransaction);
router.get('/admin/stats', protect, admin, controllers.getDashboardStats);
router.get('/admin/settings', protect, admin, controllers.getPlatformSettings);
router.put('/admin/settings', protect, admin, controllers.updatePlatformSettings);
router.get('/admin/payment-methods', protect, admin, controllers.getPaymentMethodsAdmin);
router.put('/admin/payment-methods', protect, admin, controllers.updatePaymentMethods);


module.exports = router;