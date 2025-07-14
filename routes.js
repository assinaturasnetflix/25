const express = require('express');
const multer = require('multer');
const router = express.Router();

const {
    authMiddleware,
    adminMiddleware,
    register,
    login,
    forgotPassword,
    resetPassword,
    getMyProfile,
    updateMyProfile,
    updatePassword,
    uploadAvatar,
    getUserPublicProfile,
    getRanking,
    createGame,
    joinPrivateGame,
    getGameHistory,
    abandonGame,
    getGameById,
    getLobby,
    createDeposit,
    createWithdrawal,
    getTransactionHistory,
    adminGetAllUsers,
    adminToggleBlockUser,
    adminGetAllTransactions,
    adminApproveTransaction,
    adminRejectTransaction,
    adminAdjustUserBalance,
    adminGetDashboardStats,
    adminGetSettings,
    adminUpdateSettings,
    adminConfirmPlayerReady
} = require('./controllers');

const storage = multer.memoryStorage();
const upload = multer({ storage });

router.post('/api/auth/register', register);
router.post('/api/auth/login', login);
router.post('/api/auth/forgot-password', forgotPassword);
router.post('/api/auth/reset-password', resetPassword);

router.get('/api/users/me', authMiddleware, getMyProfile);
router.put('/api/users/me', authMiddleware, updateMyProfile);
router.put('/api/users/me/password', authMiddleware, updatePassword);
router.put('/api/users/me/avatar', authMiddleware, upload.single('avatar'), uploadAvatar);
router.get('/api/users/profile/:username', getUserPublicProfile);
router.get('/api/users/ranking', getRanking);

router.get('/api/games/lobby', getLobby);
router.post('/api/games/create', authMiddleware, createGame);
router.post('/api/games/join/private', authMiddleware, joinPrivateGame);
router.get('/api/games/history', authMiddleware, getGameHistory);
router.get('/api/games/:gameId', authMiddleware, getGameById);
router.post('/api/games/:gameId/abandon', authMiddleware, abandonGame);
router.post('/api/games/:gameId/ready', authMiddleware, adminConfirmPlayerReady);

router.post('/api/transactions/deposit', authMiddleware, upload.single('proof'), createDeposit);
router.post('/api/transactions/withdrawal', authMiddleware, createWithdrawal);
router.get('/api/transactions/history', authMiddleware, getTransactionHistory);

router.get('/api/admin/users', authMiddleware, adminMiddleware, adminGetAllUsers);
router.put('/api/admin/users/:userId/toggle-block', authMiddleware, adminMiddleware, adminToggleBlockUser);
router.post('/api/admin/users/:userId/balance', authMiddleware, adminMiddleware, adminAdjustUserBalance);

router.get('/api/admin/transactions', authMiddleware, adminMiddleware, adminGetAllTransactions);
router.put('/api/admin/transactions/:transactionId/approve', authMiddleware, adminMiddleware, adminApproveTransaction);
router.put('/api/admin/transactions/:transactionId/reject', authMiddleware, adminMiddleware, adminRejectTransaction);

router.get('/api/admin/dashboard', authMiddleware, adminMiddleware, adminGetDashboardStats);
router.get('/api/admin/settings', authMiddleware, adminMiddleware, adminGetSettings);
router.put('/api/admin/settings', authMiddleware, adminMiddleware, adminUpdateSettings);

module.exports = router;