const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const jwt = require('jsonwebtoken');
const { User } = require('./models');
const config = require('./config');

const controllers = require('./controllers');

const storage = multer.diskStorage({});
const upload = multer({ 
    storage: storage,
    fileFilter: (req, file, cb) => {
        let ext = path.extname(file.originalname).toLowerCase();
        if (ext !== '.jpg' && ext !== '.jpeg' && ext !== '.png') {
            return cb(new Error('Apenas imagens são permitidas'), false);
        }
        cb(null, true);
    }
});


const authMiddleware = async (req, res, next) => {
    const token = req.header('x-auth-token');
    if (!token) {
        return res.status(401).json({ message: 'Sem token, autorização negada.' });
    }
    try {
        const decoded = jwt.verify(token, config.JWT.SECRET);
        req.user = await User.findById(decoded.user.id).select('-password');
        if (!req.user) {
             return res.status(401).json({ msg: 'Token não é válido' });
        }
        if (req.user.isBlocked) {
            return res.status(403).json({ message: 'Sua conta está bloqueada.' });
        }
        next();
    } catch (err) {
        res.status(401).json({ message: 'Token inválido.' });
    }
};

const adminMiddleware = (req, res, next) => {
    if (req.user && req.user.role === 'admin') {
        next();
    } else {
        res.status(403).json({ message: 'Acesso negado. Requer privilégios de administrador.' });
    }
};

// Auth Routes
router.post('/auth/register', controllers.register);
router.post('/auth/login', controllers.login);
router.post('/auth/forgot-password', controllers.forgotPassword);
router.post('/auth/reset-password', controllers.resetPassword);

// User Profile Routes
router.get('/profile', authMiddleware, controllers.getProfile);
router.put('/profile', authMiddleware, controllers.updateProfile);
router.put('/profile/avatar', authMiddleware, upload.single('avatar'), controllers.updateAvatar);
router.put('/profile/password', authMiddleware, controllers.changePassword);
router.get('/users/:userId', authMiddleware, controllers.getPublicProfile);

// Ranking
router.get('/ranking', authMiddleware, controllers.getRanking);

// Transaction Routes
router.post('/transactions/deposit', authMiddleware, upload.single('proofImage'), controllers.requestDeposit);
router.post('/transactions/withdrawal', authMiddleware, controllers.requestWithdrawal);
router.get('/transactions', authMiddleware, controllers.getTransactionHistory);

// Lobby & Game Routes
router.post('/lobby/bets', authMiddleware, controllers.createLobbyBet);
router.get('/lobby/bets', authMiddleware, controllers.getLobbyBets);
router.put('/lobby/bets/:betId/cancel', authMiddleware, controllers.cancelLobbyBet);
router.get('/games/history', authMiddleware, controllers.getGameHistory);
router.get('/games/active', authMiddleware, controllers.getActiveGame);

// Admin Routes
router.get('/admin/users', authMiddleware, adminMiddleware, controllers.getAllUsers);
router.put('/admin/users/:userId/toggle-block', authMiddleware, adminMiddleware, controllers.toggleUserBlock);
router.put('/admin/users/:userId/balance', authMiddleware, adminMiddleware, controllers.manualBalanceUpdate);
router.get('/admin/transactions/pending', authMiddleware, adminMiddleware, controllers.getPendingTransactions);
router.put('/admin/transactions/:transactionId/process', authMiddleware, adminMiddleware, controllers.processTransaction);
router.get('/admin/stats', authMiddleware, adminMiddleware, controllers.getPlatformStats);
router.get('/admin/config', authMiddleware, adminMiddleware, controllers.getPlatformConfig);
router.put('/admin/config', authMiddleware, adminMiddleware, controllers.updatePlatformConfig);

module.exports = router;