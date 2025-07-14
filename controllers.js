const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cloudinary = require('cloudinary').v2;
const nodemailer = require('nodemailer');
const { User, Transaction, Game, PlatformSettings } = require('./models');
const { generateNumericId, generateTransactionId, calculateCommission } = require('./utils');
const { createInitialBoard } = require('./gameLogic');
const config = require('./config');

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
});

const generateToken = (id) => {
    return jwt.sign({ id }, process.env.JWT_SECRET, {
        expiresIn: '30d',
    });
};

const authMiddleware = async (req, res, next) => {
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

const adminMiddleware = (req, res, next) => {
    if (req.user && req.user.role === 'admin') {
        next();
    } else {
        res.status(403).json({ message: 'Acesso negado. Rota para administradores.' });
    }
};

const register = async (req, res) => {
    const { username, email, password } = req.body;
    try {
        const userExists = await User.findOne({ $or: [{ email }, { username }] });
        if (userExists) {
            return res.status(400).json({ message: 'Usuário com este email ou nome de usuário já existe.' });
        }
        const user = await User.create({ username, email, password });
        res.status(201).json({
            _id: user._id,
            token: generateToken(user._id),
        });
    } catch (error) {
        res.status(500).json({ message: 'Erro do servidor.' });
    }
};

const login = async (req, res) => {
    const { email, password } = req.body;
    try {
        const user = await User.findOne({ email });
        if (user && (await user.comparePassword(password))) {
            if (user.isBlocked) {
                return res.status(403).json({ message: 'Sua conta está bloqueada.' });
            }
            res.json({
                _id: user._id,
                username: user.username,
                email: user.email,
                avatar: user.avatar,
                role: user.role,
                token: generateToken(user._id),
            });
        } else {
            res.status(401).json({ message: 'Email ou senha inválidos.' });
        }
    } catch (error) {
        res.status(500).json({ message: 'Erro do servidor.' });
    }
};

const forgotPassword = async (req, res) => {
    const { email } = req.body;
    try {
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(404).json({ message: 'Usuário não encontrado.' });
        }
        const resetCode = generateNumericId(6);
        user.passwordResetCode = resetCode;
        user.passwordResetExpires = Date.now() + 15 * 60 * 1000;
        await user.save();

        const mailOptions = {
            from: `"BrainSkill" <${process.env.EMAIL_USER}>`,
            to: user.email,
            subject: 'Recuperação de Senha - BrainSkill',
            html: `
                <div style="font-family: 'Oswald', sans-serif; background-color: #f4f4f4; padding: 20px; color: #333;">
                    <div style="max-width: 600px; margin: auto; background-color: #ffffff; padding: 30px; border-radius: 5px;">
                        <h2 style="color: #000000; text-align: center;">BrainSkill - Recuperação de Senha</h2>
                        <p>Olá ${user.username},</p>
                        <p>Recebemos uma solicitação para redefinir a sua senha. Use o código abaixo para concluir o processo.</p>
                        <p style="text-align: center; font-size: 24px; font-weight: bold; letter-spacing: 5px; margin: 20px 0; color: #000000;">
                            ${resetCode}
                        </p>
                        <p>Este código é válido por 15 minutos. Se você não solicitou esta alteração, por favor, ignore este email.</p>
                        <hr style="border: 0; border-top: 1px solid #eeeeee;">
                        <p style="font-size: 12px; color: #777777; text-align: center;">© 2025 BrainSkill. Todos os direitos reservados.</p>
                    </div>
                </div>
            `
        };
        await transporter.sendMail(mailOptions);
        res.json({ message: 'Email com código de redefinição enviado.' });
    } catch (error) {
        res.status(500).json({ message: 'Erro ao enviar email.' });
    }
};

const resetPassword = async (req, res) => {
    const { code, password } = req.body;
    try {
        const user = await User.findOne({
            passwordResetCode: code,
            passwordResetExpires: { $gt: Date.now() },
        });
        if (!user) {
            return res.status(400).json({ message: 'Código inválido ou expirado.' });
        }
        user.password = password;
        user.passwordResetCode = undefined;
        user.passwordResetExpires = undefined;
        await user.save();
        res.json({ message: 'Senha redefinida com sucesso.' });
    } catch (error) {
        res.status(500).json({ message: 'Erro do servidor.' });
    }
};

const getMyProfile = async (req, res) => {
    try {
        const user = await User.findById(req.user._id).select('-password -passwordResetCode -passwordResetExpires');
        res.json(user);
    } catch (error) {
        res.status(500).json({ message: 'Erro do servidor.' });
    }
};

const updateMyProfile = async (req, res) => {
    const { bio } = req.body;
    try {
        const user = await User.findById(req.user._id);
        if (user) {
            user.bio = bio || user.bio;
            const updatedUser = await user.save();
            res.json({
                bio: updatedUser.bio,
            });
        } else {
            res.status(404).json({ message: 'Usuário não encontrado.' });
        }
    } catch (error) {
        res.status(500).json({ message: 'Erro do servidor.' });
    }
};

const updatePassword = async (req, res) => {
    const { oldPassword, newPassword } = req.body;
    try {
        const user = await User.findById(req.user._id);
        if (user && (await user.comparePassword(oldPassword))) {
            user.password = newPassword;
            await user.save();
            res.json({ message: 'Senha atualizada com sucesso.' });
        } else {
            res.status(401).json({ message: 'Senha antiga incorreta.' });
        }
    } catch (error) {
        res.status(500).json({ message: 'Erro do servidor.' });
    }
};

const uploadAvatar = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: 'Nenhum arquivo enviado.' });
        }
        const b64 = Buffer.from(req.file.buffer).toString('base64');
        let dataURI = "data:" + req.file.mimetype + ";base64," + b64;
        const result = await cloudinary.uploader.upload(dataURI, {
            folder: "brainskill_avatars"
        });
        const user = await User.findById(req.user._id);
        user.avatar = result.secure_url;
        await user.save();
        res.json({ avatar: result.secure_url });
    } catch (error) {
        res.status(500).json({ message: 'Erro ao fazer upload do avatar.' });
    }
};

const getUserPublicProfile = async (req, res) => {
    try {
        const user = await User.findOne({ username: req.params.username }).select('username avatar bio stats createdAt');
        if (user) {
            res.json(user);
        } else {
            res.status(404).json({ message: 'Usuário não encontrado.' });
        }
    } catch (error) {
        res.status(500).json({ message: 'Erro do servidor.' });
    }
};

const getRanking = async (req, res) => {
    try {
        const users = await User.find({ role: 'user' })
            .sort({ 'stats.wins': -1, 'stats.losses': 1 })
            .select('username avatar stats');
        res.json(users);
    } catch (error) {
        res.status(500).json({ message: 'Erro do servidor.' });
    }
};

const createGame = async (req, res) => {
    const { betAmount, isPrivate, lobbyDescription, gameTime } = req.body;
    const settings = await PlatformSettings.findOne();
    const effectiveMaxBet = settings ? settings.maxBet : config.maxBet;

    if (betAmount > effectiveMaxBet) {
        return res.status(400).json({ message: `A aposta não pode exceder ${effectiveMaxBet} MT.` });
    }
    if (req.user.balance < betAmount) {
        return res.status(400).json({ message: 'Saldo insuficiente.' });
    }

    try {
        req.user.balance -= betAmount;
        await req.user.save();

        const game = new Game({
            gameId: generateNumericId(5),
            players: [req.user._id],
            creator: req.user._id,
            boardState: createInitialBoard(),
            betAmount,
            isPrivate: isPrivate || false,
            lobbyDescription: isPrivate ? '' : lobbyDescription,
            gameTime: gameTime || 'sem tempo',
        });
        await game.save();
        res.status(201).json(game);
    } catch (error) {
        req.user.balance += betAmount;
        await req.user.save();
        res.status(500).json({ message: 'Erro ao criar jogo.' });
    }
};

const joinPrivateGame = async (req, res) => {
    const { gameId } = req.body;
    try {
        const game = await Game.findOne({ gameId, isPrivate: true, status: 'waiting' });
        if (!game) {
            return res.status(404).json({ message: 'Jogo privado não encontrado ou já iniciado.' });
        }
        if (req.user.balance < game.betAmount) {
            return res.status(400).json({ message: 'Saldo insuficiente para entrar nesta aposta.' });
        }
        if (game.players.includes(req.user._id)) {
            return res.status(400).json({ message: 'Você não pode entrar no seu próprio jogo.' });
        }
        
        req.user.balance -= game.betAmount;
        await req.user.save();

        game.players.push(req.user._id);
        game.status = 'in_progress';
        await game.save();

        res.json(game);
    } catch (error) {
        res.status(500).json({ message: 'Erro ao entrar no jogo.' });
    }
};

const getLobby = async (req, res) => {
    try {
        const games = await Game.find({ isPrivate: false, status: 'waiting' })
            .populate('creator', 'username avatar');
        res.json(games);
    } catch (error) {
        res.status(500).json({ message: 'Erro ao buscar lobby.' });
    }
};

const getGameHistory = async (req, res) => {
    try {
        const games = await Game.find({ players: req.user._id })
            .populate('players', 'username avatar')
            .populate('winner', 'username')
            .sort({ createdAt: -1 });
        res.json(games);
    } catch (error) {
        res.status(500).json({ message: 'Erro ao buscar histórico.' });
    }
};

const getGameById = async (req, res) => {
    try {
        const game = await Game.findOne({ gameId: req.params.gameId, players: req.user._id })
            .populate('players', 'username avatar');
        if (!game) {
            return res.status(404).json({ message: 'Jogo não encontrado ou acesso negado.' });
        }
        res.json(game);
    } catch (error) {
        res.status(500).json({ message: 'Erro do servidor.' });
    }
};

const abandonGame = async (req, res) => {
    try {
        const game = await Game.findOne({ gameId: req.params.gameId, status: 'in_progress', players: req.user._id });
        if (!game) {
            return res.status(404).json({ message: 'Jogo em progresso não encontrado.' });
        }

        const opponentId = game.players.find(p => !p.equals(req.user._id));
        game.status = 'completed';
        game.winner = opponentId;
        await game.save();

        const winner = await User.findById(opponentId);
        const settings = await PlatformSettings.findOne();
        const commissionRate = settings ? settings.commissionRate : config.commissionRate;
        const { netAmount, commission } = calculateCommission(game.betAmount * 2, commissionRate);
        
        winner.balance += netAmount;
        winner.stats.wins += 1;
        await winner.save();

        const loser = await User.findById(req.user._id);
        loser.stats.losses += 1;
        await loser.save();
        
        // Em um cenário real, o socketManager notificaria o oponente.
        res.json({ message: 'Você desistiu da partida. O oponente venceu.' });
    } catch (error) {
        res.status(500).json({ message: 'Erro ao desistir do jogo.' });
    }
};

const adminConfirmPlayerReady = async (req, res) => {
    const { gameId } = req.params;
    const userId = req.user._id;

    try {
        const game = await Game.findOne({ gameId });
        if (!game) {
            return res.status(404).json({ message: 'Jogo não encontrado.' });
        }
        if (game.status !== 'waiting') {
             return res.status(400).json({ message: 'Não é possível confirmar, o jogo não está em espera.' });
        }
        if (!game.players.some(p => p.equals(userId))) {
            return res.status(403).json({ message: 'Você não é um jogador nesta partida.' });
        }

        if (!game.waitingForConfirmation.some(p => p.equals(userId))) {
            game.waitingForConfirmation.push(userId);
        }

        if (game.waitingForConfirmation.length === 2) {
            game.status = 'in_progress';
        }
        
        await game.save();
        res.json(game);

    } catch (error) {
        res.status(500).json({ message: 'Erro ao confirmar prontidão.' });
    }
};


const createDeposit = async (req, res) => {
    const { amount, method } = req.body;
    const settings = await PlatformSettings.findOne();
    const effectiveMinDeposit = settings ? settings.minDeposit : config.minDeposit;
    const effectiveMaxDeposit = settings ? settings.maxDeposit : config.maxDeposit;

    if (!req.file) {
        return res.status(400).json({ message: 'Comprovativo é obrigatório.' });
    }
    if (amount < effectiveMinDeposit || amount > effectiveMaxDeposit) {
        return res.status(400).json({ message: `Valor do depósito deve ser entre ${effectiveMinDeposit} e ${effectiveMaxDeposit} MT.` });
    }

    try {
        const b64 = Buffer.from(req.file.buffer).toString('base64');
        let dataURI = "data:" + req.file.mimetype + ";base64," + b64;
        const result = await cloudinary.uploader.upload(dataURI, {
            folder: "brainskill_proofs"
        });

        const transaction = new Transaction({
            userId: req.user._id,
            transactionId: generateTransactionId(),
            type: 'deposit',
            method,
            amount,
            status: 'pending',
            proof: result.secure_url
        });
        await transaction.save();
        res.status(201).json(transaction);
    } catch (error) {
        res.status(500).json({ message: 'Erro ao criar depósito.' });
    }
};

const createWithdrawal = async (req, res) => {
    const { amount, method } = req.body;
    const user = await User.findById(req.user._id);
    const settings = await PlatformSettings.findOne();
    const effectiveMinWithdrawal = settings ? settings.minWithdrawal : config.minWithdrawal;
    const effectiveMaxWithdrawal = settings ? settings.maxWithdrawal : config.maxWithdrawal;
    
    if (amount > user.balance) {
        return res.status(400).json({ message: 'Saldo insuficiente.' });
    }
    if (amount < effectiveMinWithdrawal || amount > effectiveMaxWithdrawal) {
        return res.status(400).json({ message: `Valor do levantamento deve ser entre ${effectiveMinWithdrawal} e ${effectiveMaxWithdrawal} MT.` });
    }
    
    try {
        user.balance -= amount;
        await user.save();

        const transaction = new Transaction({
            userId: req.user._id,
            transactionId: generateTransactionId(),
            type: 'withdrawal',
            method,
            amount,
            status: 'pending',
            proof: 'N/A' // Prova não se aplica a levantamentos iniciados pelo usuário
        });
        await transaction.save();
        res.status(201).json(transaction);
    } catch (error) {
        user.balance += amount;
        await user.save();
        res.status(500).json({ message: 'Erro ao criar levantamento.' });
    }
};

const getTransactionHistory = async (req, res) => {
    try {
        const transactions = await Transaction.find({ userId: req.user._id }).sort({ createdAt: -1 });
        res.json(transactions);
    } catch (error) {
        res.status(500).json({ message: 'Erro ao buscar histórico de transações.' });
    }
};

const adminGetAllUsers = async (req, res) => {
    try {
        const users = await User.find({}).select('-password');
        res.json(users);
    } catch (error) {
        res.status(500).json({ message: 'Erro do servidor.' });
    }
};

const adminToggleBlockUser = async (req, res) => {
    try {
        const user = await User.findById(req.params.userId);
        if (user) {
            user.isBlocked = !user.isBlocked;
            await user.save();
            res.json({ message: `Usuário ${user.isBlocked ? 'bloqueado' : 'desbloqueado'} com sucesso.` });
        } else {
            res.status(404).json({ message: 'Usuário não encontrado.' });
        }
    } catch (error) {
        res.status(500).json({ message: 'Erro do servidor.' });
    }
};

const adminAdjustUserBalance = async (req, res) => {
    const { amount, reason } = req.body;
    try {
        const user = await User.findById(req.params.userId);
        if (user) {
            user.balance += Number(amount);
            await user.save();
            res.json({ newBalance: user.balance });
        } else {
            res.status(404).json({ message: 'Usuário não encontrado.' });
        }
    } catch (error) {
        res.status(500).json({ message: 'Erro do servidor.' });
    }
};

const adminGetAllTransactions = async (req, res) => {
    try {
        const transactions = await Transaction.find({}).populate('userId', 'username email').sort({ createdAt: -1 });
        res.json(transactions);
    } catch (error) {
        res.status(500).json({ message: 'Erro do servidor.' });
    }
};

const adminApproveTransaction = async (req, res) => {
    try {
        const transaction = await Transaction.findOne({ transactionId: req.params.transactionId });
        if (!transaction || transaction.status !== 'pending') {
            return res.status(404).json({ message: 'Transação não encontrada ou já processada.' });
        }

        if (transaction.type === 'deposit') {
            const user = await User.findById(transaction.userId);
            user.balance += transaction.amount;
            await user.save();
        }
        
        transaction.status = 'approved';
        await transaction.save();
        res.json(transaction);
    } catch (error) {
        res.status(500).json({ message: 'Erro do servidor.' });
    }
};

const adminRejectTransaction = async (req, res) => {
    try {
        const transaction = await Transaction.findOne({ transactionId: req.params.transactionId });
        if (!transaction || transaction.status !== 'pending') {
            return res.status(404).json({ message: 'Transação não encontrada ou já processada.' });
        }

        if (transaction.type === 'withdrawal') {
            const user = await User.findById(transaction.userId);
            user.balance += transaction.amount;
            await user.save();
        }

        transaction.status = 'rejected';
        await transaction.save();
        res.json(transaction);
    } catch (error) {
        res.status(500).json({ message: 'Erro do servidor.' });
    }
};

const adminGetDashboardStats = async (req, res) => {
    try {
        const totalDeposited = await Transaction.aggregate([
            { $match: { type: 'deposit', status: 'approved' } },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]);

        const totalWithdrawn = await Transaction.aggregate([
            { $match: { type: 'withdrawal', status: 'approved' } },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]);

        const completedGames = await Game.find({ status: 'completed' });
        const settings = await PlatformSettings.findOne();
        const commissionRate = settings ? settings.commissionRate : config.commissionRate;
        let totalCommission = 0;
        completedGames.forEach(game => {
            totalCommission += (game.betAmount * 2) * commissionRate;
        });

        res.json({
            totalDeposited: totalDeposited.length > 0 ? totalDeposited[0].total : 0,
            totalWithdrawn: totalWithdrawn.length > 0 ? totalWithdrawn[0].total : 0,
            totalCommission,
            userCount: await User.countDocuments(),
            gamesPlayed: completedGames.length
        });
    } catch (error) {
        res.status(500).json({ message: 'Erro ao buscar estatísticas.' });
    }
};

const adminGetSettings = async (req, res) => {
    try {
        let settings = await PlatformSettings.findOne();
        if (!settings) {
            settings = await PlatformSettings.create(config);
        }
        res.json(settings);
    } catch (error) {
        res.status(500).json({ message: 'Erro ao buscar configurações.' });
    }
};

const adminUpdateSettings = async (req, res) => {
    try {
        let settings = await PlatformSettings.findOneAndUpdate({}, req.body, { new: true, upsert: true });
        res.json(settings);
    } catch (error) {
        res.status(500).json({ message: 'Erro ao atualizar configurações.' });
    }
};

module.exports = {
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
    adminConfirmPlayerReady,
};