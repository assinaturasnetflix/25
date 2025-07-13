const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const cloudinary = require('cloudinary').v2;
const { User, Transaction, Game, LobbyGame, PlatformSettings } = require('./models');
const { generateUserId, generateTransactionId, sendPasswordResetEmail } = require('./utils');
const config = require('./config');

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});

const generateToken = (id) => {
    return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '30d' });
};

const protect = async (req, res, next) => {
    let token;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        try {
            token = req.headers.authorization.split(' ')[1];
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            req.user = await User.findById(decoded.id).select('-password');
            if (!req.user || req.user.isBlocked) {
                return res.status(401).json({ message: 'Não autorizado, utilizador bloqueado.' });
            }
            next();
        } catch (error) {
            res.status(401).json({ message: 'Não autorizado, token inválido.' });
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
        res.status(403).json({ message: 'Acesso negado. Apenas para administradores.' });
    }
};

const registerUser = async (req, res) => {
    const { username, email, password } = req.body;
    try {
        if (!username || !email || !password) {
            return res.status(400).json({ message: 'Por favor, preencha todos os campos.' });
        }
        const userExists = await User.findOne({ $or: [{ email }, { username }] });
        if (userExists) {
            return res.status(400).json({ message: 'Utilizador ou email já existe.' });
        }
        const userId = await generateUserId(User);
        const user = await User.create({ username, email, password, userId });
        res.status(201).json({
            _id: user._id,
            token: generateToken(user._id),
        });
    } catch (error) {
        res.status(500).json({ message: 'Erro no servidor' });
    }
};

const loginUser = async (req, res) => {
    const { email, password } = req.body;
    try {
        const user = await User.findOne({ email });
        if (user && (await user.matchPassword(password))) {
            if (user.isBlocked) {
                return res.status(403).json({ message: 'Esta conta está bloqueada.' });
            }
            res.json({
                _id: user._id,
                token: generateToken(user._id),
                role: user.role,
            });
        } else {
            res.status(401).json({ message: 'Email ou senha inválidos.' });
        }
    } catch (error) {
        res.status(500).json({ message: 'Erro no servidor' });
    }
};

const forgotPassword = async (req, res) => {
    const { email } = req.body;
    try {
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(404).json({ message: 'Utilizador não encontrado.' });
        }
        const resetToken = crypto.randomBytes(3).toString('hex').toUpperCase();
        user.passwordResetToken = crypto.createHash('sha256').update(resetToken).digest('hex');
        user.passwordResetExpires = Date.now() + config.user.passwordResetTokenExpiresIn;
        await user.save();
        await sendPasswordResetEmail(user.email, resetToken);
        res.json({ message: 'Email com código de recuperação enviado.' });
    } catch (error) {
        res.status(500).json({ message: 'Falha ao enviar o email.' });
    }
};

const resetPassword = async (req, res) => {
    const { token, password } = req.body;
    try {
        const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
        const user = await User.findOne({
            passwordResetToken: hashedToken,
            passwordResetExpires: { $gt: Date.now() },
        });
        if (!user) {
            return res.status(400).json({ message: 'Código inválido ou expirado.' });
        }
        user.password = password;
        user.passwordResetToken = undefined;
        user.passwordResetExpires = undefined;
        await user.save();
        res.json({ message: 'Senha redefinida com sucesso.' });
    } catch (error) {
        res.status(500).json({ message: 'Erro no servidor' });
    }
};

const getMyProfile = async (req, res) => {
    res.json(req.user);
};

const updateMyProfile = async (req, res) => {
    const { bio } = req.body;
    try {
        const user = await User.findById(req.user._id);
        if (user) {
            user.bio = bio || user.bio;
            if (req.file) {
                const result = await cloudinary.uploader.upload(req.file.path || `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`, {
                    folder: 'brainskill_avatars',
                    public_id: user._id,
                    overwrite: true,
                });
                user.avatar = result.secure_url;
            }
            const updatedUser = await user.save();
            res.json(updatedUser);
        } else {
            res.status(404).json({ message: 'Utilizador não encontrado.' });
        }
    } catch (error) {
        res.status(500).json({ message: 'Erro no servidor' });
    }
};

const changePassword = async (req, res) => {
    const { oldPassword, newPassword } = req.body;
    try {
        const user = await User.findById(req.user._id);
        if (user && (await user.matchPassword(oldPassword))) {
            user.password = newPassword;
            await user.save();
            res.json({ message: 'Senha alterada com sucesso.' });
        } else {
            res.status(401).json({ message: 'Senha antiga incorreta.' });
        }
    } catch (error) {
        res.status(500).json({ message: 'Erro no servidor.' });
    }
};

const getUserProfile = async (req, res) => {
    try {
        const user = await User.findOne({ userId: req.params.userId }).select('username userId avatar bio wins losses createdAt');
        if (user) {
            res.json(user);
        } else {
            res.status(404).json({ message: 'Utilizador não encontrado.' });
        }
    } catch (error) {
        res.status(500).json({ message: 'Erro no servidor.' });
    }
};

const getRanking = async (req, res) => {
    try {
        const ranking = await User.find({ role: 'user' }).sort({ wins: -1, losses: 1 }).limit(100).select('username userId avatar wins losses');
        res.json(ranking);
    } catch (error) {
        res.status(500).json({ message: 'Erro no servidor.' });
    }
};

const createDepositRequest = async (req, res) => {
    const { amount, method, userPhone } = req.body;
    try {
        const settings = await PlatformSettings.findOne({ singleton: true });
        if (amount < settings.minDeposit || amount > settings.maxDeposit) {
            return res.status(400).json({ message: `O valor do depósito deve estar entre ${settings.minDeposit} MT e ${settings.maxDeposit} MT.` });
        }
        if (!req.file) {
            return res.status(400).json({ message: 'O comprovativo é obrigatório.' });
        }
        const result = await cloudinary.uploader.upload(`data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`, {
            folder: 'brainskill_proofs'
        });
        
        const transaction = await Transaction.create({
            transactionId: await generateTransactionId(),
            user: req.user._id,
            type: 'deposit',
            amount,
            method,
            userPhone,
            proof: result.secure_url,
        });
        res.status(201).json(transaction);
    } catch (error) {
        res.status(500).json({ message: 'Erro ao criar pedido de depósito.' });
    }
};

const createWithdrawalRequest = async (req, res) => {
    const { amount, method, userPhone } = req.body;
    try {
        const settings = await PlatformSettings.findOne({ singleton: true });
        if (amount < settings.minWithdrawal || amount > settings.maxWithdrawal) {
            return res.status(400).json({ message: `O valor do levantamento deve estar entre ${settings.minWithdrawal} MT e ${settings.maxWithdrawal} MT.` });
        }
        if (req.user.balance < amount) {
            return res.status(400).json({ message: 'Saldo insuficiente.' });
        }
        req.user.balance -= amount;
        await req.user.save();

        const transaction = await Transaction.create({
            transactionId: await generateTransactionId(),
            user: req.user._id,
            type: 'withdrawal',
            amount,
            method,
            userPhone,
        });
        res.status(201).json(transaction);
    } catch (error) {
        res.status(500).json({ message: 'Erro ao criar pedido de levantamento.' });
    }
};

const getTransactionHistory = async (req, res) => {
    try {
        const transactions = await Transaction.find({ user: req.user._id }).sort({ createdAt: -1 });
        res.json(transactions);
    } catch (error) {
        res.status(500).json({ message: 'Erro ao buscar histórico.' });
    }
};

const createLobbyGame = async (req, res) => {
    const { betAmount, description, timeLimit } = req.body;
    try {
        const ongoingGame = await Game.findOne({ players: req.user._id, status: { $in: ['waiting', 'in_progress'] } });
        if (ongoingGame) {
            return res.status(400).json({ message: 'Você já tem uma partida em andamento. Termine-a antes de criar uma nova.' });
        }
        const settings = await PlatformSettings.findOne({ singleton: true });
        if (betAmount < settings.minBet || betAmount > settings.maxBet) {
             return res.status(400).json({ message: `O valor da aposta deve estar entre ${settings.minBet} MT e ${settings.maxBet} MT.` });
        }
        if (req.user.balance < betAmount) {
            return res.status(400).json({ message: 'Saldo insuficiente para criar esta aposta.' });
        }
        const lobbyGame = await LobbyGame.create({
            creator: req.user._id,
            betAmount,
            description,
            timeLimit,
        });
        res.status(201).json(lobbyGame);
    } catch (error) {
        res.status(500).json({ message: 'Erro ao criar jogo no lobby.' });
    }
};

const getLobbyGames = async (req, res) => {
    try {
        const games = await LobbyGame.find({ status: 'open' }).populate('creator', 'username avatar').sort({ createdAt: -1 });
        res.json(games);
    } catch (error) {
        res.status(500).json({ message: 'Erro ao buscar jogos no lobby.' });
    }
};

const getGameHistory = async (req, res) => {
    try {
        const games = await Game.find({ players: req.user._id }).populate('players', 'username avatar').sort({ createdAt: -1 });
        res.json(games);
    } catch (error) {
        res.status(500).json({ message: 'Erro ao buscar histórico de partidas.' });
    }
};

const abandonGame = async (req, res) => {
    try {
        const game = await Game.findById(req.params.id);
        if (!game) return res.status(404).json({ message: "Partida não encontrada." });
        
        const playerIndex = game.players.findIndex(p => p.equals(req.user._id));
        if (playerIndex === -1) return res.status(403).json({ message: "Não autorizado." });

        if (game.status !== 'in_progress' && game.status !== 'waiting') {
            return res.status(400).json({ message: 'Apenas partidas não concluídas podem ser abandonadas.' });
        }

        const opponentIndex = 1 - playerIndex;
        const winnerId = game.players[opponentIndex];

        const settings = await PlatformSettings.findOne({ singleton: true });
        const commission = settings ? settings.commissionRate : 0.15;
        const totalPot = game.betAmount * 2;
        const fee = totalPot * commission;
        const winnings = totalPot - fee;

        game.status = 'abandoned';
        game.winner = winnerId;
        game.platformFee = fee;
        await game.save();

        const winner = await User.findById(winnerId);
        winner.balance += winnings;
        winner.wins += 1;
        await winner.save();

        req.user.losses += 1;
        await req.user.save();

        res.json({ message: "Partida abandonada. O oponente foi declarado vencedor." });
    } catch (error) {
        res.status(500).json({ message: 'Erro ao abandonar a partida.' });
    }
};

const getHelpContent = async (req, res) => {
    try {
        const settings = await PlatformSettings.findOne({ singleton: true });
        res.json({ content: settings ? settings.mainTexts.helpPage : config.texts.helpPageContent });
    } catch (error) {
        res.status(500).json({ message: 'Erro ao buscar conteúdo de ajuda.' });
    }
};

const adminGetAllUsers = async (req, res) => {
    try {
        const users = await User.find({}).sort({ createdAt: -1 });
        res.json(users);
    } catch (error) {
        res.status(500).json({ message: 'Erro no servidor.' });
    }
};

const adminToggleUserBlock = async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (user) {
            user.isBlocked = !user.isBlocked;
            await user.save();
            res.json({ message: `Utilizador ${user.isBlocked ? 'bloqueado' : 'desbloqueado'}.` });
        } else {
            res.status(404).json({ message: 'Utilizador não encontrado.' });
        }
    } catch (error) {
        res.status(500).json({ message: 'Erro no servidor.' });
    }
};

const adminAdjustUserBalance = async (req, res) => {
    const { amount, action } = req.body;
    try {
        const user = await User.findById(req.params.id);
        if (user) {
            if (action === 'add') {
                user.balance += Number(amount);
            } else if (action === 'remove') {
                user.balance -= Number(amount);
                if (user.balance < 0) user.balance = 0;
            } else {
                return res.status(400).json({ message: 'Ação inválida.' });
            }
            await user.save();
            res.json({ newBalance: user.balance });
        } else {
            res.status(404).json({ message: 'Utilizador não encontrado.' });
        }
    } catch (error) {
        res.status(500).json({ message: 'Erro no servidor.' });
    }
};

const adminGetAllTransactions = async (req, res) => {
    try {
        const transactions = await Transaction.find({}).populate('user', 'username userId').sort({ createdAt: -1 });
        res.json(transactions);
    } catch (error) {
        res.status(500).json({ message: 'Erro no servidor.' });
    }
};

const adminUpdateTransactionStatus = async (req, res) => {
    const { status, adminNotes } = req.body;
    const { id } = req.params;
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const transaction = await Transaction.findById(id).session(session);
        if (!transaction || transaction.status !== 'pending') {
            throw new Error('Transação não encontrada ou já processada.');
        }

        const user = await User.findById(transaction.user).session(session);
        if (!user) {
            throw new Error('Utilizador associado à transação não encontrado.');
        }

        if (status === 'approved') {
            if (transaction.type === 'deposit') {
                user.balance += transaction.amount;
            }
        } else if (status === 'rejected') {
            if (transaction.type === 'withdrawal') {
                user.balance += transaction.amount;
            }
        } else {
            throw new Error('Status inválido.');
        }

        transaction.status = status;
        transaction.adminNotes = adminNotes;

        await user.save({ session });
        await transaction.save({ session });
        
        await session.commitTransaction();
        res.json(transaction);
    } catch (error) {
        await session.abortTransaction();
        res.status(500).json({ message: error.message || 'Erro ao atualizar transação.' });
    } finally {
        session.endSession();
    }
};

const adminGetDashboardStats = async (req, res) => {
    try {
        const totalUsers = await User.countDocuments();
        const totalDeposits = await Transaction.aggregate([
            { $match: { type: 'deposit', status: 'approved' } },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]);
        const totalWithdrawals = await Transaction.aggregate([
            { $match: { type: 'withdrawal', status: 'approved' } },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]);
        const totalPlatformFees = await Game.aggregate([
            { $match: { status: { $in: ['completed', 'abandoned'] } } },
            { $group: { _id: null, total: { $sum: '$platformFee' } } }
        ]);
        const activeGames = await Game.countDocuments({ status: 'in_progress' });
        
        res.json({
            totalUsers,
            activeGames,
            totalDeposits: totalDeposits[0]?.total || 0,
            totalWithdrawals: totalWithdrawals[0]?.total || 0,
            totalPlatformFees: totalPlatformFees[0]?.total || 0,
        });
    } catch (error) {
        res.status(500).json({ message: 'Erro ao buscar estatísticas.' });
    }
};

const adminGetPlatformSettings = async (req, res) => {
    try {
        let settings = await PlatformSettings.findOne({ singleton: true });
        if (!settings) {
            settings = await PlatformSettings.create({ singleton: true });
        }
        res.json(settings);
    } catch (error) {
        res.status(500).json({ message: 'Erro ao buscar configurações.' });
    }
};

const adminUpdatePlatformSettings = async (req, res) => {
    try {
        const settings = await PlatformSettings.findOneAndUpdate({ singleton: true }, req.body, { new: true, upsert: true });
        res.json(settings);
    } catch (error) {
        res.status(500).json({ message: 'Erro ao atualizar configurações.' });
    }
};

module.exports = {
    protect, admin, registerUser, loginUser, forgotPassword, resetPassword,
    getMyProfile, updateMyProfile, changePassword, getUserProfile, getRanking,
    createDepositRequest, createWithdrawalRequest, getTransactionHistory,
    createLobbyGame, getLobbyGames, getGameHistory, abandonGame, getHelpContent,
    adminGetAllUsers, adminToggleUserBlock, adminAdjustUserBalance,
    adminGetAllTransactions, adminUpdateTransactionStatus,
    adminGetDashboardStats, adminGetPlatformSettings, adminUpdatePlatformSettings
};