const bcrypt = require('bcryptjs');
const jwt = 'jsonwebtoken';
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
    registerUser: async (req, res) => {
        const { username, email, password } = req.body;
        if (!username || !email || !password) {
            return res.status(400).json({ message: 'Por favor, preencha todos os campos.' });
        }
        if (password.length < 6) {
            return res.status(400).json({ message: 'A senha deve ter no mínimo 6 caracteres.' });
        }

        const userExists = await User.findOne({ $or: [{ email: email.toLowerCase() }, { username }] });
        if (userExists) {
            return res.status(400).json({ message: 'Utilizador ou email já registado.' });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        try {
            const user = await User.create({
                username,
                email: email.toLowerCase(),
                password: hashedPassword,
            });

            res.status(201).json({
                _id: user._id,
                username: user.username,
                avatar: user.avatar,
                token: generateToken(user._id),
            });
        } catch (error) {
            res.status(400).json({ message: 'Dados de utilizador inválidos.' });
        }
    },

    loginUser: async (req, res) => {
        const { email, password } = req.body;
        const user = await User.findOne({ email: email.toLowerCase() });

        if (user && (await bcrypt.compare(password, user.password))) {
            if (user.isBlocked) {
                return res.status(403).json({ message: 'Esta conta encontra-se bloqueada.' });
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
        const user = await User.findOne({ email: email.toLowerCase() });

        if (!user) {
            return res.status(404).json({ message: 'Nenhum utilizador encontrado com este email.' });
        }

        const resetCode = generateNumericId(6);
        user.passwordResetToken = crypto.createHash('sha256').update(resetCode).digest('hex');
        user.passwordResetExpires = Date.now() + config.passwordResetCodeValidity * 60 * 1000;

        await user.save({ validateBeforeSave: false });

        try {
            await sendPasswordResetEmail(user.email, resetCode);
            res.status(200).json({ message: 'Email com código de recuperação enviado.' });
        } catch (error) {
            user.passwordResetToken = undefined;
            user.passwordResetExpires = undefined;
            await user.save({ validateBeforeSave: false });
            res.status(500).json({ message: 'Erro ao enviar o email de recuperação.' });
        }
    },

    resetPassword: async (req, res) => {
        const { code, password } = req.body;
        if (!code || !password) {
            return res.status(400).json({ message: 'Por favor, forneça o código e a nova senha.' });
        }
        if (password.length < 6) {
             return res.status(400).json({ message: 'A nova senha deve ter no mínimo 6 caracteres.' });
        }
        const hashedToken = crypto.createHash('sha256').update(code).digest('hex');

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

    getPublicPaymentMethods: (req, res) => {
        const publicMethods = config.paymentMethods.map(m => ({
            name: m.name,
            number: m.number,
            holder: m.holder,
            instructions: m.instructions
        }));
        res.json(publicMethods);
    },

    getMe: async (req, res) => {
        const user = await User.findById(req.user.id).select('-password -passwordResetToken -passwordResetExpires');
        res.status(200).json(user);
    },
    
    getPublicProfile: async (req, res) => {
        const user = await User.findById(req.params.id).select('username avatar bio stats createdAt');
        if (!user) {
            return res.status(404).json({ message: 'Utilizador não encontrado.' });
        }
        res.status(200).json(user);
    },

    updateProfile: async (req, res) => {
        const { bio } = req.body;
        const user = await User.findById(req.user.id);

        if (user) {
            user.bio = bio;
            const updatedUser = await user.save();
            res.json({ bio: updatedUser.bio });
        } else {
            res.status(404).json({ message: 'Utilizador não encontrado.' });
        }
    },
    
    updatePassword: async (req, res) => {
        const { oldPassword, newPassword } = req.body;
        if (!oldPassword || !newPassword || newPassword.length < 6) {
            return res.status(400).json({ message: 'Dados inválidos fornecidos.'});
        }
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
        if (!req.file) return res.status(400).json({ message: 'Nenhum ficheiro enviado.' });

        try {
            const user = await User.findById(req.user.id);
            if (!user) return res.status(404).json({ message: 'Utilizador não encontrado' });
            
            if (user.avatar && user.avatar.public_id !== 'default_avatar_id') {
                await cloudinary.uploader.destroy(user.avatar.public_id);
            }
            const result = await cloudinary.uploader.upload(req.file.path, {
                folder: 'brainskill_avatars',
                width: 150, height: 150, crop: 'fill',
            });
            user.avatar = { public_id: result.public_id, url: result.secure_url };
            await user.save();
            res.status(200).json({ url: result.secure_url });
        } catch (error) {
            res.status(500).json({ message: 'Falha no upload da imagem.' });
        }
    },
    
    getRanking: async (req, res) => {
        const ranking = await User.find({ role: 'user' })
            .sort({ 'stats.wins': -1, 'stats.losses': 1, 'createdAt': 1 })
            .select('username avatar stats createdAt');
        res.status(200).json(ranking);
    },

    createDeposit: async (req, res) => {
        const { amount, method, proofText } = req.body;

        if (!amount || !method || (!proofText && !req.file)) {
            return res.status(400).json({ message: 'Dados insuficientes para o depósito.' });
        }
        if (Number(amount) < config.minDeposit) {
            return res.status(400).json({ message: `O depósito mínimo é de ${config.minDeposit} MT.` });
        }

        let proofData = proofText;
        if (req.file) {
            try {
                 const result = await cloudinary.uploader.upload(req.file.path, {
                    folder: 'brainskill_proofs',
                 });
                 proofData = result.secure_url;
            } catch(e) {
                return res.status(500).json({ message: 'Erro ao carregar o comprovativo.'});
            }
        }
        
        try {
            const transaction = await Transaction.create({
                userId: req.user.id,
                type: 'deposit',
                amount: Number(amount),
                method,
                proof: proofData,
            });
            res.status(201).json(transaction);
        } catch(e) {
            res.status(500).json({ message: 'Erro ao criar a transação.' });
        }
    },

    createWithdrawal: async (req, res) => {
        const { amount, method, holderName, phoneNumber } = req.body;
        const user = await User.findById(req.user.id);

        if (!amount || !method || !holderName || !phoneNumber) {
             return res.status(400).json({ message: 'Por favor, preencha todos os campos.' });
        }
        if (Number(amount) < config.minWithdrawal) {
            return res.status(400).json({ message: `O levantamento mínimo é de ${config.minWithdrawal} MT.` });
        }
        if (user.balance < Number(amount)) {
            return res.status(400).json({ message: 'Saldo insuficiente.' });
        }

        user.balance -= Number(amount);
        
        try {
            const transaction = await Transaction.create({
                userId: req.user.id,
                type: 'withdrawal',
                amount: Number(amount),
                method,
                holderName,
                phoneNumber
            });
            await user.save();
            res.status(201).json(transaction);
        } catch(e) {
            user.balance += Number(amount);
            await user.save();
            res.status(500).json({ message: 'Erro ao criar o pedido de levantamento.' });
        }
    },

    getMyTransactions: async (req, res) => {
        const transactions = await Transaction.find({ userId: req.user.id }).sort({ createdAt: -1 });
        res.status(200).json(transactions);
    },
    
    getMyGames: async (req, res) => {
        const games = await Game.find({ 
            players: req.user.id,
            hiddenBy: { $ne: req.user.id }
        })
        .populate('players', 'username avatar')
        .populate('winner', 'username')
        .sort({ createdAt: -1 });
        res.status(200).json(games);
    },
    
    hideGameFromHistory: async (req, res) => {
        try {
            const game = await Game.findById(req.params.id);

            if (!game) {
                return res.status(404).json({ message: 'Partida não encontrada.' });
            }
            if (!game.players.includes(req.user.id)) {
                return res.status(403).json({ message: 'Você não tem permissão para alterar esta partida.' });
            }
            const nonRemovableStatus = ['waiting', 'in_progress'];
            if (nonRemovableStatus.includes(game.status)) {
                return res.status(400).json({ message: 'Não é possível remover uma partida em andamento.' });
            }

            if (!game.hiddenBy.includes(req.user.id)) {
                game.hiddenBy.push(req.user.id);
                await game.save();
            }

            res.status(200).json({ message: 'Partida removida do histórico com sucesso.' });

        } catch (error) {
            res.status(500).json({ message: 'Erro no servidor ao tentar remover a partida.' });
        }
    },

    getAllUsers: async (req, res) => {
        const users = await User.find({}).select('-password');
        res.json(users);
    },

    toggleBlockUser: async (req, res) => {
        const user = await User.findById(req.params.id);
        if (user) {
            if(user.role === 'admin') return res.status(403).json({ message: 'Não é possível bloquear um administrador.'});
            user.isBlocked = !user.isBlocked;
            await user.save();
            res.json({ message: `Utilizador ${user.isBlocked ? 'bloqueado' : 'desbloqueado'}.` });
        } else {
            res.status(404).json({ message: 'Utilizador não encontrado.' });
        }
    },

    manualBalanceUpdate: async (req, res) => {
        const { amount } = req.body;
        const user = await User.findById(req.params.id);
        if (user) {
            const finalAmount = Number(amount);
            if(isNaN(finalAmount)) return res.status(400).json({ message: 'Valor inválido.' });

            user.balance += finalAmount;
            await user.save();
            res.json({ message: 'Saldo atualizado com sucesso.', newBalance: user.balance });
        } else {
            res.status(404).json({ message: 'Utilizador não encontrado.' });
        }
    },

    getAllTransactions: async (req, res) => {
        const transactions = await Transaction.find({}).populate('userId', 'username email').sort({ createdAt: -1 });
        res.json(transactions);
    },

    processTransaction: async (req, res) => {
        const { status, adminNotes } = req.body;
        const transaction = await Transaction.findById(req.params.id);

        if (!transaction || transaction.status !== 'pending') {
            return res.status(404).json({ message: 'Transação não encontrada ou já processada.' });
        }
        
        const user = await User.findById(transaction.userId);
        if (!user) {
            return res.status(404).json({ message: 'Utilizador da transação não encontrado.' });
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
        
        transaction.adminNotes = adminNotes;
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

        const totalCommission = await Game.aggregate([
            { $match: { status: 'completed', betAmount: { $exists: true } } },
            { $group: { _id: null, total: { $sum: { $multiply: ["$betAmount", config.platformCommission] } } } }
        ]);

        res.json({
            totalDeposited: totalDeposited.length > 0 ? totalDeposited[0].total : 0,
            totalWithdrawn: totalWithdrawn.length > 0 ? totalWithdrawn[0].total : 0,
            totalCommission: totalCommission.length > 0 ? totalCommission[0].total * 2 : 0,
            totalUsers: await User.countDocuments(),
            totalGames: await Game.countDocuments({ status: 'completed' }),
        });
    },
    
    getPlatformSettings: (req, res) => {
        res.json(config);
    },
    
    updatePlatformSettings: (req, res) => {
        const { commission, minDeposit, minBet } = req.body;
        
        if(commission) config.platformCommission = parseFloat(commission) / 100;
        if(minDeposit) config.minDeposit = parseFloat(minDeposit);
        if(minBet) config.minBet = parseFloat(minBet);

        res.json({ message: 'Configurações atualizadas.', newConfig: config });
    },
    
    getPaymentMethodsAdmin: (req, res) => {
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