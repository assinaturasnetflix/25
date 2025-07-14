const express = require('express');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const { User } = require('./models.js');
const controllers = require('./controllers.js');

const router = express.Router();

const storage = multer.diskStorage({});
const upload = multer({
    storage: storage,
    fileFilter: (req, file, cb) => {
        let ext = path.extname(file.originalname);
        if (ext !== ".jpg" && ext !== ".jpeg" && ext !== ".png") {
            cb(new Error("Formato de arquivo não suportado"), false);
            return;
        }
        cb(null, true);
    },
});

const authMiddleware = async (req, res, next) => {
    let token;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        try {
            token = req.headers.authorization.split(' ')[1];
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            req.user = await User.findById(decoded.id).select('-password');
            if (!req.user) {
                return res.status(401).json({ message: 'Usuário não encontrado.' });
            }
            if (req.user.isBlocked) {
                return res.status(403).json({ message: 'Esta conta está bloqueada.' });
            }
            next();
        } catch (error) {
            res.status(401).json({ message: 'Token inválido ou expirado. Faça login novamente.' });
        }
    }
    if (!token) {
        res.status(401).json({ message: 'Acesso negado. Nenhum token fornecido.' });
    }
};

const adminMiddleware = (req, res, next) => {
    if (req.user && req.user.role === 'admin') {
        next();
    } else {
        res.status(403).json({ message: 'Acesso negado. Requer privilégios de administrador.' });
    }
};

// --- Rotas de Autenticação (Públicas) ---
router.post('/auth/register', controllers.register);
router.post('/auth/login', controllers.login);
router.post('/auth/forgot-password', controllers.forgotPassword);
router.post('/auth/reset-password/:token', controllers.resetPassword);

// --- Rotas de Usuário (Protegidas) ---
router.get('/users/me', authMiddleware, controllers.getProfile);
router.put('/users/me', authMiddleware, upload.single('avatar'), controllers.updateProfile);
router.put('/users/password', authMiddleware, controllers.updatePassword);
router.get('/users/profile/:userId', authMiddleware, controllers.getUserPublicProfile);
router.get('/users/wallet', authMiddleware, controllers.getWallet);
router.get('/users/unfinished-game', authMiddleware, controllers.getUnfinishedGame);

// --- Rotas de Transações (Protegidas) ---
router.post('/transactions/deposit', authMiddleware, controllers.requestDeposit);
router.post('/transactions/withdrawal', authMiddleware, controllers.requestWithdrawal);

// --- Rotas de Jogo (Protegidas) ---
router.get('/games/lobbies', authMiddleware, controllers.getGameLobbies);
router.get('/games/history', authMiddleware, controllers.getMatchHistory);
router.get('/games/find-by-code/:inviteCode', authMiddleware, controllers.findGameByInviteCode);

// --- Rotas de Configuração Pública ---
router.get('/platform/config', controllers.getPublicPlatformConfig);
router.get('/platform/ranking', controllers.getRanking);

// --- Rotas de Administrador (Protegidas por Auth e Admin) ---
const adminRoutes = express.Router();
adminRoutes.use(authMiddleware, adminMiddleware);

adminRoutes.get('/users', controllers.adminGetAllUsers);
adminRoutes.put('/users/:userId/status', controllers.adminUpdateUserStatus);
adminRoutes.put('/users/:userId/balance', controllers.adminAdjustUserBalance);
adminRoutes.get('/transactions', controllers.adminGetTransactions);
adminRoutes.put('/transactions/:transactionId/process', controllers.adminProcessTransaction);
adminRoutes.get('/stats', controllers.adminGetPlatformStats);
adminRoutes.get('/config', controllers.adminGetPlatformConfig);
adminRoutes.put('/config', controllers.adminUpdatePlatformConfig);

router.use('/admin', adminRoutes);

module.exports = router;