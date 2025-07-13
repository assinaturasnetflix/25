const express = require('express');
const multer = require('multer');
const {
    protect,
    admin,
    registerUser,
    loginUser,
    forgotPassword,
    resetPassword,
    getMyProfile,
    updateMyProfile,
    changePassword,
    getUserProfile,
    getRanking,
    createDepositRequest,
    createWithdrawalRequest,
    getTransactionHistory,
    createLobbyGame,
    getLobbyGames,
    getGameHistory,
    abandonGame,
    adminGetAllUsers,
    adminToggleUserBlock,
    adminAdjustUserBalance,
    adminGetAllTransactions,
    adminUpdateTransactionStatus,
    adminGetDashboardStats,
    adminGetPlatformSettings,
    adminUpdatePlatformSettings,
    getHelpContent,
} = require('./controllers');

const router = express.Router();
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

router.post('/auth/register', registerUser);
router.post('/auth/login', loginUser);
router.post('/auth/forgot-password', forgotPassword);
router.post('/auth/reset-password', resetPassword);

router.get('/users/me', protect, getMyProfile);
router.put('/users/me', protect, upload.single('avatar'), updateMyProfile);
router.put('/users/me/password', protect, changePassword);
router.get('/users/profile/:userId', protect, getUserProfile);
router.get('/users/ranking', protect, getRanking);

router.post('/wallet/deposit', protect, upload.single('proof'), createDepositRequest);
router.post('/wallet/withdraw', protect, createWithdrawalRequest);
router.get('/wallet/history', protect, getTransactionHistory);

router.post('/lobby/create', protect, createLobbyGame);
router.get('/lobby', protect, getLobbyGames);
router.get('/games/history', protect, getGameHistory);
router.post('/games/:id/abandon', protect, abandonGame);

router.get('/platform/help', getHelpContent);

router.get('/admin/users', protect, admin, adminGetAllUsers);
router.put('/admin/users/:id/toggle-block', protect, admin, adminToggleUserBlock);
router.put('/admin/users/:id/balance', protect, admin, adminAdjustUserBalance);
router.get('/admin/transactions', protect, admin, adminGetAllTransactions);
router.put('/admin/transactions/:id/status', protect, admin, adminUpdateTransactionStatus);
router.get('/admin/dashboard', protect, admin, adminGetDashboardStats);
router.get('/admin/settings', protect, admin, adminGetPlatformSettings);
router.put('/admin/settings', protect, admin, adminUpdatePlatformSettings);

module.exports = router;