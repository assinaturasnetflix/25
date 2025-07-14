const express = require('express');
const multer = require('multer');
const path = require('path');
const {
    authController,
    userController,
    transactionController,
    adminController,
    generalController
} = require('./controllers');

const router = express.Router();

const storage = multer.diskStorage({});
const upload = multer({
    storage,
    fileFilter: (req, file, cb) => {
        let ext = path.extname(file.originalname).toLowerCase();
        if (ext !== '.jpg' && ext !== '.jpeg' && ext !== '.png') {
            cb(new Error('Formato de ficheiro não suportado'), false);
            return;
        }
        cb(null, true);
    }
});

// --- Rotas de Autenticação (Públicas) ---
router.post('/auth/register', authController.register);
router.post('/auth/login', authController.login);
router.post('/auth/request-password-reset', authController.requestPasswordReset);
router.post('/auth/verify-reset-code', authController.verifyResetCode);
router.post('/auth/reset-password', authController.resetPassword);

// --- Rotas Gerais (Públicas e Protegidas) ---
router.get('/lobby', generalController.getLobby);
router.get('/ranking', userController.getRanking);
router.get('/profiles/:userId', userController.getPublicProfile);
router.get('/help', generalController.getHelpPage);
router.get('/payment-methods', generalController.getPaymentMethods);
router.get('/games/:gameId', userController.protect, generalController.getGameDetails);


// --- Rotas de Usuário (Protegidas) ---
router.use(userController.protect);

router.get('/users/me', userController.getMe);
router.patch('/users/update-me', upload.single('avatar'), userController.updateMe);
router.get('/users/history', userController.getGameHistory);

// --- Rotas de Transações (Protegidas) ---
router.get('/transactions', transactionController.getMyTransactions);
router.post('/transactions', upload.single('proof'), transactionController.createTransaction);


// --- Rotas de Administrador (Protegidas e com verificação de Admin) ---
router.use(adminController.isAdmin);

router.get('/admin/users', adminController.getAllUsers);
router.patch('/admin/users/:id/toggle-block', adminController.toggleUserBlock);
router.patch('/admin/users/update-balance', adminController.manualBalanceUpdate);

router.get('/admin/transactions', adminController.getTransactions);
router.post('/admin/transactions/process', adminController.processTransaction);

router.get('/admin/stats', adminController.getPlatformStats);
router.get('/admin/settings', adminController.getPlatformSettings);
router.patch('/admin/settings', adminController.updatePlatformSettings);


module.exports = router;