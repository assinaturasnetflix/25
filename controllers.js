const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const cloudinary = require('cloudinary').v2;
const { User, Transaction, Game, Setting } = require('./models');
const defaultConfig = require('./config');
const { sendPasswordResetEmail, generateNumericId } = require('./utils');
const axios = require('axios');

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});

async function verifyRecaptcha(token) {
    const secretKey = process.env.RECAPTCHA_SECRET_KEY;
    if (!secretKey) {
        console.warn("Aviso: RECAPTCHA_SECRET_KEY não definida. Verificação ignorada.");
        return true;
    }
    try {
        const response = await axios.post(`https://www.google.com/recaptcha/api/siteverify?secret=${secretKey}&response=${token}`);
        return response.data.success;
    } catch (error) {
        console.error("Erro na verificação do reCAPTCHA:", error.message);
        return false;
    }
}

const getLiveSettings = async () => {
    let settings = await Setting.findOne({ singleton: 'main_settings' });
    if (!settings) {
        settings = await Setting.create({ singleton: 'main_settings', ...defaultConfig });
    }
    return settings;
};

const generateToken = (id) => {
    return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '30d' });
};

const controllers = {
    registerUser: async (req, res) => {
        const recaptchaToken = req.body['g-recaptcha-response'];
        if (!recaptchaToken || !(await verifyRecaptcha(recaptchaToken))) {
            return res.status(400).json({ message: 'Falha na verificação reCAPTCHA. Tente novamente.' });
        }

        const { username, email, password } = req.body;
        if (!username || !email || !password || password.length < 6) {
            return res.status(400).json({ message: 'Dados inválidos. A senha deve ter no mínimo 6 caracteres.' });
        }

        const userExists = await User.findOne({ $or: [{ email: email.toLowerCase() }, { username }] });
        if (userExists) {
            return res.status(400).json({ message: 'Utilizador ou email já registado.' });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        const settings = await getLiveSettings();

        try {
            const user = await User.create({
                username,
                email: email.toLowerCase(),
                password: hashedPassword,
                bonusBalance: settings.isBonusEnabled ? settings.welcomeBonusAmount : 0,
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
        const { email, password, recaptchaToken } = req.body;
        const potentialUser = await User.findOne({ email: email.toLowerCase() }).select('+role');
        
        if (potentialUser && potentialUser.role === 'admin') {
            if (!recaptchaToken || !(await verifyRecaptcha(recaptchaToken))) {
                return res.status(400).json({ message: 'Falha na verificação reCAPTCHA. Tente novamente.' });
            }
        }

        if (!potentialUser) {
            return res.status(401).json({ message: 'Email ou senha inválidos.' });
        }

        if (await bcrypt.compare(password, potentialUser.password)) {
            if (potentialUser.isBlocked) {
                return res.status(403).json({ message: 'Esta conta encontra-se bloqueada.' });
            }
            res.json({
                _id: potentialUser._id,
                username: potentialUser.username,
                email: potentialUser.email,
                avatar: potentialUser.avatar,
                role: potentialUser.role,
                token: generateToken(potentialUser._id),
            });
        } else {
            res.status(401).json({ message: 'Email ou senha inválidos.' });
        }
    },

    forgotPassword: async (req, res) => {
        const { email } = req.body;
        const user = await User.findOne({ email: email.toLowerCase() });

        if (!user) {
            return res.status(200).json({ message: 'Se um utilizador com este email existir, um código de recuperação foi enviado.' });
        }
        
        const settings = await getLiveSettings();
        const resetCode = generateNumericId(6);
        user.passwordResetToken = crypto.createHash('sha256').update(resetCode).digest('hex');
        user.passwordResetExpires = Date.now() + (settings.passwordResetTokenExpiresIn * 60 * 1000);

        await user.save({ validateBeforeSave: false });

        try {
            await sendPasswordResetEmail(user.email, resetCode, settings.platformName, settings.passwordResetTokenExpiresIn);
            res.status(200).json({ message: 'Email com código de recuperação enviado.' });
        } catch (error) {
            console.error("Erro ao enviar email:", error);
            user.passwordResetToken = undefined;
            user.passwordResetExpires = undefined;
            await user.save({ validateBeforeSave: false });
            res.status(500).json({ message: 'Erro ao enviar o email de recuperação.' });
        }
    },

    resetPassword: async (req, res) => {
        const { code, password } = req.body;
        if (!code || !password || password.length < 6) {
             return res.status(400).json({ message: 'Por favor, forneça o código e uma nova senha com no mínimo 6 caracteres.' });
        }
        
        const hashedToken = crypto.createHash('sha256').update(code).digest('hex');

        try {
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
        } catch (error) {
            console.error("Erro ao redefinir senha:", error);
            res.status(500).json({ message: "Ocorreu um erro no servidor." });
        }
    },

    getPublicPaymentMethods: async (req, res) => {
        const settings = await getLiveSettings();
        res.json(settings.paymentMethods.map(m => ({
            name: m.name,
            number: m.accountNumber,
            holder: m.accountName,
            instructions: m.instructions
        })));
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
        const settings = await getLiveSettings();
        if (!amount || !method || (!proofText && !req.file)) {
            return res.status(400).json({ message: 'Dados insuficientes para o depósito.' });
        }
        if (Number(amount) < settings.minDeposit) {
            return res.status(400).json({ message: `O depósito mínimo é de ${settings.minDeposit} MT.` });
        }
        let proofData = proofText;
        if (req.file) {
            try {
                 const result = await cloudinary.uploader.upload(req.file.path, { folder: 'brainskill_proofs' });
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
        const settings = await getLiveSettings();
        if (!amount || !method || !holderName || !phoneNumber) {
             return res.status(400).json({ message: 'Por favor, preencha todos os campos.' });
        }
        if (Number(amount) < settings.minWithdrawal) {
            return res.status(400).json({ message: `O levantamento mínimo é de ${settings.minWithdrawal} MT.` });
        }
        if (user.balance < Number(amount)) {
            return res.status(400).json({ message: 'Saldo real insuficiente para levantamento.' });
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
        const games = await Game.find({ players: req.user.id, hiddenBy: { $ne: req.user.id } })
        .populate('players', 'username avatar')
        .populate('winner', 'username')
        .sort({ createdAt: -1 });
        res.status(200).json(games);
    },
    
    hideGameFromHistory: async (req, res) => {
        try {
            const game = await Game.findById(req.params.id);
            if (!game) { return res.status(404).json({ message: 'Partida não encontrada.' }); }
            if (!game.players.includes(req.user.id)) {
                return res.status(403).json({ message: 'Você não tem permissão para alterar esta partida.' });
            }
            if (['waiting', 'in_progress'].includes(game.status)) {
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
        const { amount, balanceType = 'balance' } = req.body;
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ message: 'Utilizador não encontrado.' });
        
        const finalAmount = Number(amount);
        if(isNaN(finalAmount)) return res.status(400).json({ message: 'Valor inválido.' });

        if (balanceType === 'bonus') {
            user.bonusBalance += finalAmount;
        } else {
            user.balance += finalAmount;
        }

        await user.save();
        res.json({ message: 'Saldo atualizado com sucesso.', newBalance: user.balance, newBonusBalance: user.bonusBalance });
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
        if (!user) return res.status(404).json({ message: 'Utilizador da transação não encontrado.' });

        if (status === 'approved' && transaction.type === 'deposit') {
            user.balance += transaction.amount;
        } else if (status === 'rejected' && transaction.type === 'withdrawal') {
            user.balance += transaction.amount;
        }
        
        transaction.status = status;
        transaction.adminNotes = adminNotes;
        await user.save();
        await transaction.save();
        res.json({ message: `Transação ${status}.` });
    },
    
    getDashboardStats: async (req, res) => {
        const totalDepositedResult = await Transaction.aggregate([ { $match: { type: 'deposit', status: 'approved' } }, { $group: { _id: null, total: { $sum: '$amount' } } } ]);
        const totalWithdrawnResult = await Transaction.aggregate([ { $match: { type: 'withdrawal', status: 'approved' } }, { $group: { _id: null, total: { $sum: '$amount' } } } ]);
        const totalCommissionResult = await Game.aggregate([ { $match: { status: 'completed' } }, { $group: { _id: null, total: { $sum: '$commissionAmount' } } } ]);
        
        const totalDeposited = totalDepositedResult.length > 0 ? totalDepositedResult[0].total : 0;
        const totalWithdrawn = totalWithdrawnResult.length > 0 ? totalWithdrawnResult[0].total : 0;
        const lossRevenue = totalDeposited - totalWithdrawn;

        res.json({
            totalDeposited,
            totalWithdrawn,
            totalCommission: totalCommissionResult.length > 0 ? totalCommissionResult[0].total : 0,
            lossRevenue,
            totalUsers: await User.countDocuments(),
            totalGames: await Game.countDocuments({ status: 'completed' }),
        });
    },
    
    getPlatformSettings: async (req, res) => {
        const settings = await getLiveSettings();
        res.json(settings);
    },
    
    updatePlatformSettings: async (req, res) => {
        try {
            const { platformCommission, minDeposit, minBet, isBonusEnabled, welcomeBonusAmount } = req.body;
            const updateData = {};

            if (platformCommission !== undefined) updateData.platformCommission = platformCommission / 100;
            if (minDeposit !== undefined) updateData.minDeposit = minDeposit;
            if (minBet !== undefined) updateData.minBet = minBet;
            if (isBonusEnabled !== undefined) updateData.isBonusEnabled = isBonusEnabled;
            if (welcomeBonusAmount !== undefined) updateData.welcomeBonusAmount = welcomeBonusAmount;

            await Setting.findOneAndUpdate({ singleton: 'main_settings' }, { $set: updateData }, { new: true, upsert: true });
            res.status(200).json({ message: "Configurações gerais atualizadas com sucesso." });
        } catch (error) {
             res.status(500).json({ message: "Erro ao atualizar as configurações.", error: error.message });
        }
    },
    
    getPaymentMethodsAdmin: async (req, res) => {
        const settings = await getLiveSettings();
        res.json(settings.paymentMethods);
    },
    
    updatePaymentMethods: async (req, res) => {
        const { methods } = req.body;
        if (!Array.isArray(methods)) {
            return res.status(400).json({ message: 'Formato inválido.' });
        }
        try {
            const updatedSettings = await Setting.findOneAndUpdate(
                { singleton: 'main_settings' },
                { $set: { paymentMethods: methods } },
                { new: true, upsert: true, runValidators: true }
            );
            res.json({ message: 'Métodos de pagamento atualizados.', newMethods: updatedSettings.paymentMethods });
        } catch (error) {
            res.status(500).json({ message: 'Erro ao salvar os métodos de pagamento.', error: error.message });
        }
    }
};

module.exports = controllers;