const express = require('express');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const { User } = require('./models');
const controllers = require('./controllers');

const router = express.Router();

const storage = multer.diskStorage({});
const upload = multer({ 
    storage: storage,
    fileFilter: (req, file, cb) => {
        let ext = path.extname(file.originalname);
        if (ext !== '.jpg' && ext !== '.jpeg' && ext !== '.png') {
            cb(new Error('Tipo de arquivo não suportado'), false);
            return;
        }
        cb(null, true);
    }
});

// Middleware de autenticação
const protect = async (req, res, next) => {
    let token;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        try {
            token = req.headers.authorization.split(' ')[1];
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            req.user = await User.findById(decoded.id).select('-password');
            if (req.user.isBlocked) {
                return res.status(403).json({ message: 'Sua conta está bloqueada.' });
            }
            next();
        } catch (error) {
            res.status(401).json({ message: 'Não autorizado, token falhou.' });
        }
    }
    if (!token) {
        res.status(401).json({ message: 'Não autorizado, sem token.' });
    }
};

const admin = (req, res, next) => {
    if (req.user && req.user.role === 'admin') {
        next();
    } else {
        res.status(403).json({ message: 'Acesso negado. Rota apenas para administradores.' });
    }
};

// Rotas de Autenticação e Usuário
router.post('/users/register', controllers.registerUser);
router.post('/users/login', controllers.loginUser);
router.post('/users/forgot-password', controllers.forgotPassword);
router.post('/users/reset-password', controllers.resetPassword);

// Rotas de Perfil (Protegidas)
router.get('/users/me', protect, controllers.getMe);
router.put('/users/profile', protect, controllers.updateProfile);
router.put('/users/password', protect, controllers.updatePassword);
router.post('/users/avatar', protect, upload.single('avatar'), controllers.uploadAvatar);

// Rotas Públicas
router.get('/users/profile/:id', controllers.getPublicProfile);
router.get('/ranking', controllers.getRanking);

// Rotas de Transações (Protegidas)
router.post('/transactions/deposit', protect, upload.single('proof'), controllers.createDeposit);
router.post('/transactions/withdrawal', protect, controllers.createWithdrawal);
router.get('/transactions/me', protect, controllers.getMyTransactions);

// Rotas de Histórico de Jogos
router.get('/games/me', protect, controllers.getMyGames);

// Rotas de Administrador (Protegidas por admin)
router.get('/admin/users', protect, admin, controllers.getAllUsers);
router.put('/admin/users/:id/toggle-block', protect, admin, controllers.toggleBlockUser);
router.put('/admin/users/:id/balance', protect, admin, controllers.manualBalanceUpdate);
router.get('/admin/transactions', protect, admin, controllers.getAllTransactions);
router.put('/admin/transactions/:id/process', protect, admin, controllers.processTransaction);
router.get('/admin/stats', protect, admin, controllers.getDashboardStats);
router.get('/admin/settings', protect, admin, controllers.getPlatformSettings);
router.put('/admin/settings', protect, admin, controllers.updatePlatformSettings);
router.get('/admin/payment-methods', protect, admin, controllers.getPaymentMethods);
router.put('/admin/payment-methods', protect, admin, controllers.updatePaymentMethods);

module.exports = router;