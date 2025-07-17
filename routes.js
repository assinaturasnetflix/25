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

// Rotas de Autenticação e Usuário
router.post('/register', controllers.registerUser);
router.post('/login', controllers.loginUser);
router.post('/forgot-password', controllers.forgotPassword);
router.post('/reset-password', controllers.resetPassword);
router.get('/profile', protect, controllers.getProfile);
router.put('/profile', protect, controllers.updateProfile);
router.post('/profile/avatar', protect, upload.single('avatar'), controllers.uploadAvatar);
router.get('/ranking', protect, controllers.getRanking);
router.get('/payment-methods', protect, controllers.getPublicPaymentMethods);
router.post('/transactions/deposit', protect, upload.single('proof'), controllers.createDeposit);
router.post('/transactions/withdrawal', protect, controllers.createWithdrawal);
router.get('/transactions/me', protect, controllers.getMyTransactions);
router.get('/games/me', protect, controllers.getMyGames);
router.delete('/games/me/:id', protect, controllers.hideGameFromHistory);


// Rotas de Administrador (precisam de token de admin)
router.get('/admin/users', protect, admin, controllers.getAllUsers);
router.put('/admin/users/:id/toggle-block', protect, admin, controllers.toggleBlockUser);
router.put('/admin/users/:id/balance', protect, admin, controllers.manualBalanceUpdate);

// NOVAS ROTAS DE ADMIN
router.patch('/admin/users/:userId/bonus-balance', protect, admin, controllers.adminUpdateUserBonusBalance); // NOVO: Editar saldo de bônus
router.get('/admin/users/:userId/history', protect, admin, controllers.adminGetUserHistory); // NOVO: Ver histórico de usuário

router.get('/admin/transactions', protect, admin, controllers.getAllTransactions);
router.put('/admin/transactions/:id/process', protect, admin, controllers.processTransaction);
router.get('/admin/stats', protect, admin, controllers.getDashboardStats);
router.get('/admin/settings', protect, admin, controllers.getPlatformSettings);
router.put('/admin/settings', protect, admin, controllers.updatePlatformSettings); // AGORA PODE ATUALIZAR minWithdrawal
router.get('/admin/payment-methods', protect, admin, controllers.getPaymentMethodsAdmin);
router.put('/admin/payment-methods', protect, admin, controllers.updatePaymentMethods);


module.exports = router;