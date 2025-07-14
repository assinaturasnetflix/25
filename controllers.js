const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const cloudinary = require('cloudinary').v2;
const { User, Transaction, Game } = require('./models');
const config = require('./config');
const { sendPasswordResetEmail, generateNumericId } = require('./utils');

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});

const generateToken = (id) => {
    return jwt.sign({ id }, process.env.JWT_SECRET, {
        expiresIn: '30d',
    });
};

const controllers = {
    // Auth Controllers
    registerUser: async (req, res) => {
        const { username, email, password } = req.body;
        if (!username || !email || !password) {
            return res.status(400).json({ message: 'Por favor, preencha todos os campos.' });
        }

        const userExists = await User.findOne({ $or: [{ email }, { username }] });
        if (userExists) {
            return res.status(400).json({ message: 'Usuário ou email já cadastrado.' });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const user = await User.create({
            username,
            email,
            password: hashedPassword,
        });

        if (user) {
            res.status(201).json({
                _id: user._id,
                username: user.username,
                email: user.email,
                token: generateToken(user._id),
            });
        } else {
            res.status(400).json({ message: 'Dados de usuário inválidos.' });
        }
    },

    loginUser: async (req, res) => {
        const { email, password } = req.body;
        const user = await User.findOne({ email });

        if (user && (await bcrypt.compare(password, user.password))) {
            if (user.isBlocked) {
                return res.status(403).json({ message: 'Esta conta está bloqueada.' });
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
    },

    forgotPassword: async (req, res) => {
        const { email } = req.body;
        const user = await User.findOne({ email });

        if (!user) {
            return res.status(404).json({ message: 'Nenhum usuário encontrado com este email.' });
        }

        const resetToken = generateNumericId(6);
        user.passwordResetToken = crypto.createHash('sha256').update(resetToken).digest('hex');
        user.passwordResetExpires = Date.now() + config.passwordResetTokenExpiresIn * 60 * 1000;

        await user.save();

        try {
            await sendPasswordResetEmail(user.email, resetToken);
            res.status(200).json({ message: 'Email com código de recuperação enviado.' });
        } catch (error) {
            user.passwordResetToken = undefined;
            user.passwordResetExpires = undefined;
            await user.save();
            res.status(500).json({ message: 'Erro ao enviar o email.' });
        }
    },

    resetPassword: async (req, res) => {
        const { token, password } = req.body;
        const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

        const user = await User.findOne({
            passwordResetToken: hashedToken,
            passwordResetExpires: { $gt: Date.now() },
        });

        if (!user) {
            return res.status(400).json({ message: 'Código inválido ou expirado.' });
        }

        const salt = await bcrypt.genSalt(10);
        user.password = await bcrypt.hash(password, salt);
        user.passwordResetToken = undefined;
        user.passwordResetExpires = undefined;
        await user.save();

        res.status(200).json({ message: 'Senha redefinida com sucesso.' });
    },

    // User Profile Controllers
    getMe: async (req, res) => {
        const user = await User.findById(req.user.id).select('-password');
        res.status(200).json(user);
    },
    
    getPublicProfile: async (req, res) => {
        const user = await User.findById(req.params.id).select('username avatar bio stats createdAt');
        if (!user) {
            return res.status(404).json({ message: 'Usuário não encontrado.' });
        }
        res.status(200).json(user);
    },

    updateProfile: async (req, res) => {
        const { bio } = req.body;
        const user = await User.findById(req.user.id);

        if (user) {
            user.bio = bio || user.bio;
            const updatedUser = await user.save();
            res.json({
                bio: updatedUser.bio,
            });
        } else {
            res.status(404).json({ message: 'Usuário não encontrado.' });
        }
    },
    
    updatePassword: async (req, res) => {
        const { oldPassword, newPassword } = req.body;
        const user = await User.findById(req.user.id);
        
        if (user && (await bcrypt.compare(oldPassword, user.password))) {
             const salt = await bcrypt.genSalt(10);
             user.password = await bcrypt.hash(newPassword, salt);
             await user.save();
             res.status(200).json({ message: 'Senha alterada com sucesso.' });
        } else {
            res.status(401).json({ message: 'Senha antiga incorreta.' });
        }
    },

    uploadAvatar: async (req, res) => {
        try {
            const user = await User.findById(req.user.id);
            if (!user) {
                return res.status(404).json({ message: 'Usuário não encontrado' });
            }
            if(user.avatar && user.avatar.public_id !== 'default_avatar_id') {
                await cloudinary.uploader.destroy(user.avatar.public_id);
            }
            const result = await cloudinary.uploader.upload(req.file.path, {
                folder: 'brainskill_avatars',
                width: 150,
                height: 150,
                crop: 'fill',
            });
            user.avatar = {
                public_id: result.public_id,
                url: result.secure_url,
            };
            await user.save();
            res.status(200).json({ url: result.secure_url });
        } catch (error) {
            res.status(500).json({ message: 'Falha no upload da imagem.' });
        }
    },
    
    getRanking: async (req, res) => {
        const ranking = await User.find({ role: 'user' })
            .sort({ 'stats.wins': -1, 'stats.losses': 1 })
            .select('username avatar stats createdAt');
        res.status(200).json(ranking);
    },

    // Transaction Controllers
    createDeposit: async (req, res) => {
        const { amount, method, proof } = req.body;
        if (amount < config.minDeposit) {
            return res.status(400).json({ message: `O depósito mínimo é de ${config.minDeposit} MT.` });
        }

        let proofData = proof;
        if (req.file) {
             const result = await cloudinary.uploader.upload(req.file.path, {
                folder: 'brainskill_proofs',
             });
             proofData = result.secure_url;
        }

        const transaction = await Transaction.create({
            userId: req.user.id,
            type: 'deposit',
            amount,
            method,
            proof: proofData,
        });
        res.status(201).json(transaction);
    },

    createWithdrawal: async (req, res) => {
        const { amount, method } = req.body;
        const user = await User.findById(req.user.id);

        if (amount < config.minWithdrawal) {
            return res.status(400).json({ message: `O levantamento mínimo é de ${config.minWithdrawal} MT.` });
        }
        if (user.balance < amount) {
            return res.status(400).json({ message: 'Saldo insuficiente.' });
        }

        user.balance -= amount;
        
        const transaction = await Transaction.create({
            userId: req.user.id,
            type: 'withdrawal',
            amount,
            method,
            proof: `Retirada para ${method}`,
        });

        await user.save();
        res.status(201).json(transaction);
    },

    getMyTransactions: async (req, res) => {
        const transactions = await Transaction.find({ userId: req.user.id }).sort({ createdAt: -1 });
        res.status(200).json(transactions);
    },
    
    // Game History
    getMyGames: async (req, res) => {
        const games = await Game.find({ players: req.user.id })
            .populate('players', 'username avatar')
            .populate('winner', 'username')
            .sort({ createdAt: -1 });
        res.status(200).json(games);
    },

    // Admin Controllers
    getAllUsers: async (req, res) => {
        const users = await User.find({}).select('-password');
        res.json(users);
    },

    toggleBlockUser: async (req, res) => {
        const user = await User.findById(req.params.id);
        if (user) {
            user.isBlocked = !user.isBlocked;
            await user.save();
            res.json({ message: `Usuário ${user.isBlocked ? 'bloqueado' : 'desbloqueado'}.` });
        } else {
            res.status(404).json({ message: 'Usuário não encontrado.' });
        }
    },

    manualBalanceUpdate: async (req, res) => {
        const { amount } = req.body;
        const user = await User.findById(req.params.id);
        if (user) {
            user.balance += Number(amount);
            await user.save();
            res.json({ message: 'Saldo atualizado com sucesso.', newBalance: user.balance });
        } else {
            res.status(404).json({ message: 'Usuário não encontrado.' });
        }
    },

    getAllTransactions: async (req, res) => {
        const transactions = await Transaction.find({}).populate('userId', 'username email').sort({ createdAt: -1 });
        res.json(transactions);
    },

    processTransaction: async (req, res) => {
        const { status } = req.body;
        const transaction = await Transaction.findById(req.params.id);

        if (!transaction || transaction.status !== 'pending') {
            return res.status(404).json({ message: 'Transação não encontrada ou já processada.' });
        }
        
        const user = await User.findById(transaction.userId);
        if (!user) {
            return res.status(404).json({ message: 'Usuário da transação não encontrado.' });
        }

        if (status === 'approved') {
            if (transaction.type === 'deposit') {
                user.balance += transaction.amount;
            }
            transaction.status = 'approved';
        } else if (status === 'rejected') {
             if (transaction.type === 'withdrawal') {
                user.balance += transaction.amount;
             }
            transaction.status = 'rejected';
        } else {
            return res.status(400).json({ message: 'Status inválido.' });
        }
        
        await user.save();
        await transaction.save();
        res.json({ message: `Transação ${status}.` });
    },
    
    getDashboardStats: async (req, res) => {
        const totalDeposited = await Transaction.aggregate([
            { $match: { type: 'deposit', status: 'approved' } },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]);

        const totalWithdrawn = await Transaction.aggregate([
            { $match: { type: 'withdrawal', status: 'approved' } },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]);

        const completedGames = await Game.find({ status: 'completed' });
        const totalCommission = completedGames.reduce((acc, game) => acc + (game.betAmount * config.platformCommission), 0);

        res.json({
            totalDeposited: totalDeposited.length > 0 ? totalDeposited[0].total : 0,
            totalWithdrawn: totalWithdrawn.length > 0 ? totalWithdrawn[0].total : 0,
            totalCommission: totalCommission,
            totalUsers: await User.countDocuments(),
            totalGames: await Game.countDocuments({ status: 'completed' }),
        });
    },
    
    getPlatformSettings: (req, res) => {
        res.json(config);
    },
    
    updatePlatformSettings: (req, res) => {
        const { commission, minDeposit, minBet } = req.body;
        config.platformCommission = commission || config.platformCommission;
        config.minDeposit = minDeposit || config.minDeposit;
        config.minBet = minBet || config.minBet;
        res.json({ message: 'Configurações atualizadas.', newConfig: config });
    },
    
    getPaymentMethods: (req, res) => {
        res.json(config.paymentMethods);
    },
    
    updatePaymentMethods: (req, res) => {
        const { methods } = req.body;
        if(Array.isArray(methods)) {
            config.paymentMethods = methods;
            res.json({ message: 'Métodos de pagamento atualizados.', newMethods: config.paymentMethods });
        } else {
            res.status(400).json({ message: 'Formato inválido.' });
        }
    }
};

module.exports = controllers;