const express = require('express');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const os = require('os');
const path = require('path');
const { User } = require('./models');
const {
    authController,
    userController,
    walletController,
    gameController,
    platformController,
    adminController,
} = require('./controllers');

const router = express.Router();

const protect = async (req, res, next) => {
    let token;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        try {
            token = req.headers.authorization.split(' ')[1];
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            req.user = await User.findById(decoded.id).select('-password');
            if (!req.user) {
                return res.status(401).json({ message: 'Não autorizado, usuário não encontrado.' });
            }
            next();
        } catch (error) {
            return res.status(401).json({ message: 'Não autorizado, token falhou.' });
        }
    }
    if (!token) {
        return res.status(401).json({ message: 'Não autorizado, sem token.' });
    }
};

const admin = (req, res, next) => {
    if (req.user && req.user.role === 'admin') {
        next();
    } else {
        res.status(403).json({ message: 'Acesso negado. Rota de administrador.' });
    }
};

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, os.tmpdir());
    },
    filename: (req, file, cb) => {
        cb(null, `${Date.now()}-${file.originalname}`);
    }
});

const fileFilter = (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif/;
    const mimetype = allowedTypes.test(file.mimetype);
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    if (mimetype && extname) {
        return cb(null, true);
    }
    cb(new Error('Apenas ficheiros de imagem são permitidos.'));
};

const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: { fileSize: 1024 * 1024 * 5 }
});

router.post('/auth/register', authController.registerUser);
router.post('/auth/login', authController.loginUser);
router.post('/auth/forgot-password', authController.forgotPassword);
router.post('/auth/reset-password', authController.resetPassword);

router.get('/users/profile', protect, userController.getProfile);
router.put('/users/profile', protect, userController.updateProfile);
router.post('/users/avatar', protect, upload.single('avatar'), userController.uploadAvatar);
router.get('/users/rankings', userController.getRanking);
router.get('/users/:numericId', userController.getPublicProfile);

router.get('/wallet', protect, walletController.getWalletInfo);
router.post('/wallet/deposit', protect, upload.single('proofImage'), walletController.requestDeposit);
router.post('/wallet/withdraw', protect, walletController.requestWithdrawal);
router.get('/wallet/payment-details', protect, walletController.getPaymentDetails);

router.get('/games/history', protect, gameController.getMatchHistory);
router.get('/games/lobby', protect, gameController.getLobbyGames);

router.get('/platform/help', platformController.getHelpPage);

router.get('/admin/users', protect, admin, adminController.getAllUsers);
router.put('/admin/users/toggle-block/:id', protect, admin, adminController.toggleBlockUser);
router.get('/admin/transactions', protect, admin, adminController.getAllTransactions);
router.put('/admin/transactions/:id/process', protect, admin, adminController.processTransaction);
router.post('/admin/balance/update', protect, admin, adminController.manualBalanceUpdate);
router.get('/admin/dashboard-stats', protect, admin, adminController.getDashboardStats);
router.get('/admin/settings', protect, admin, adminController.getPlatformSettings);
router.put('/admin/settings', protect, admin, adminController.updatePlatformSettings);

module.exports = router;