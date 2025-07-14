const express = require('express');
const multer = require('multer');
const path = require('path');
const {
    registerUser,
    loginUser,
    forgotPassword,
    resetPassword,
    getUserProfile,
    updateUserProfile,
    requestDeposit,
    requestWithdrawal,
    getTransactionHistory,
    getGameHistory,
    getRanking,
    getPublicProfile,
    getPlatformConfig,
    getAllUsers,
    toggleBlockUser,
    getPendingTransactions,
    reviewTransaction,
    adjustUserBalance,
    getPlatformStats
} = require('./controllers');
const { protect, admin } = require('./utils');

const router = express.Router();

const storage = multer.diskStorage({});

const fileFilter = (req, file, cb) => {
    const filetypes = /jpeg|jpg|png|gif/;
    const mimetype = filetypes.test(file.mimetype);
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());

    if (mimetype && extname) {
        return cb(null, true);
    }
    cb(new Error('Apenas imagens são permitidas!'));
};

const upload = multer({ 
    storage, 
    fileFilter,
    limits: { fileSize: 2 * 1024 * 1024 } // 2MB
});

// --- Rotas Públicas ---
router.post('/users/register', registerUser);
router.post('/users/login', loginUser);
router.post('/users/forgotpassword', forgotPassword);
router.put('/users/resetpassword', resetPassword);
router.get('/users/ranking', getRanking);
router.get('/users/public/:userId', getPublicProfile);
router.get('/platform/config', getPlatformConfig);

// --- Rotas de Utilizador (Protegidas) ---
router.route('/users/profile')
    .get(protect, getUserProfile)
    .put(protect, upload.single('avatar'), updateUserProfile);

router.route('/transactions/deposit')
    .post(protect, upload.single('proofImage'), requestDeposit);
router.route('/transactions/withdraw')
    .post(protect, requestWithdrawal);
router.route('/transactions/history')
    .get(protect, getTransactionHistory);
router.route('/games/history')
    .get(protect, getGameHistory);

// --- Rotas de Administrador (Protegidas) ---
router.route('/admin/users')
    .get(protect, admin, getAllUsers);

router.route('/admin/users/:id/block')
    .put(protect, admin, toggleBlockUser);

router.route('/admin/users/:id/balance')
    .put(protect, admin, adjustUserBalance);

router.route('/admin/transactions/pending')
    .get(protect, admin, getPendingTransactions);

router.route('/admin/transactions/:id/review')
    .put(protect, admin, reviewTransaction);
    
router.route('/admin/stats')
    .get(protect, admin, getPlatformStats);


module.exports = router;