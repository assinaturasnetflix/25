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
        console.warn("Aviso: RECAPTCHA_SECRET_KEY não definida. A verificação será ignorada em ambiente de desenvolvimento.");
        return true;
    }
    // Se nenhum token for passado (por exemplo, em testes), falhe a validação
    if (!token) {
        console.error("Erro: Token do reCAPTCHA não foi fornecido para verificação.");
        return false;
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


const generateToken = (id, role) => {
    return jwt.sign({ id, role }, process.env.JWT_SECRET, {
        expiresIn: '1d',
    });
};

const controllers = {
    registerUser: async (req, res) => {
        // --- CORREÇÃO APLICADA AQUI ---
        const { username, email, password } = req.body;
        const recaptchaToken = req.body['g-recaptcha-response'];

        const isRecaptchaValid = await verifyRecaptcha(recaptchaToken);
        if (!isRecaptchaValid) {
            return res.status(400).json({ message: 'Verificação reCAPTCHA falhou. Por favor, tente novamente.' });
        }

        try {
            const hashedPassword = await bcrypt.hash(password, 10);
            const user = new User({ username, email, password: hashedPassword });
            await user.save();

            const settings = await getLiveSettings();
            if (settings.isBonusEnabled && settings.welcomeBonusAmount > 0) {
                user.bonusBalance += settings.welcomeBonusAmount;
                await user.save();
            }

            const token = generateToken(user._id, user.role);
            res.status(201).json({ message: 'Usuário registrado com sucesso!', token, _id: user._id, username: user.username, email: user.email, role: user.role });
        } catch (error) {
            if (error.code === 11000) {
                return res.status(400).json({ message: 'Nome de usuário ou e-mail já existe.' });
            }
            res.status(500).json({ message: 'Erro ao registrar usuário.', error: error.message });
        }
    },

    loginUser: async (req, res) => {
        // --- CORREÇÃO APLICADA AQUI ---
        const { email, password } = req.body;
        const recaptchaToken = req.body['g-recaptcha-response'];

        const isRecaptchaValid = await verifyRecaptcha(recaptchaToken);
        if (!isRecaptchaValid) {
            return res.status(400).json({ message: 'Verificação reCAPTCHA falhou. Por favor, tente novamente.' });
        }

        try {
            const user = await User.findOne({ email });
            if (!user) {
                return res.status(400).json({ message: 'Credenciais inválidas.' });
            }

            if (user.isBlocked) {
                return res.status(403).json({ message: 'Sua conta foi bloqueada. Entre em contacto com o suporte.' });
            }

            const isMatch = await bcrypt.compare(password, user.password);
            if (!isMatch) {
                return res.status(400).json({ message: 'Credenciais inválidas.' });
            }

            const token = generateToken(user._id, user.role);
            res.status(200).json({ message: 'Login bem-sucedido!', token, _id: user._id, username: user.username, email: user.email, role: user.role });
        } catch (error) {
            res.status(500).json({ message: 'Erro ao fazer login.', error: error.message });
        }
    },

    forgotPassword: async (req, res) => {
        const { email } = req.body;
        try {
            const user = await User.findOne({ email });
            if (!user) {
                return res.status(404).json({ message: 'Usuário não encontrado.' });
            }

            const resetToken = crypto.randomBytes(20).toString('hex');
            user.passwordResetToken = crypto.createHash('sha256').update(resetToken).digest('hex');

            const settings = await getLiveSettings();
            user.passwordResetExpires = Date.now() + settings.passwordResetTokenExpiresIn * 60 * 1000;
            await user.save();

            await sendPasswordResetEmail(user.email, resetToken);
            res.status(200).json({ message: 'Email de recuperação de senha enviado.' });
        } catch (error) {
            res.status(500).json({ message: 'Erro ao enviar email de recuperação.', error: error.message });
        }
    },

    resetPassword: async (req, res) => {
        const { token, newPassword } = req.body;
        const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

        try {
            const user = await User.findOne({
                passwordResetToken: hashedToken,
                passwordResetExpires: { $gt: Date.now() }
            });

            if (!user) {
                return res.status(400).json({ message: 'Token inválido ou expirado.' });
            }

            user.password = await bcrypt.hash(newPassword, 10);
            user.passwordResetToken = undefined;
            user.passwordResetExpires = undefined;
            await user.save();

            res.status(200).json({ message: 'Senha redefinida com sucesso!' });
        } catch (error) {
            res.status(500).json({ message: 'Erro ao redefinir senha.', error: error.message });
        }
    },

    getProfile: async (req, res) => {
        try {
            const user = await User.findById(req.user.id).select('-password');
            if (!user) {
                return res.status(404).json({ message: 'Perfil não encontrado.' });
            }
            res.status(200).json(user);
        } catch (error) {
            res.status(500).json({ message: 'Erro ao buscar perfil.', error: error.message });
        }
    },

    updateProfile: async (req, res) => {
        const { username, email } = req.body;
        try {
            const user = await User.findById(req.user.id);
            if (!user) {
                return res.status(404).json({ message: 'Perfil não encontrado.' });
            }

            user.username = username || user.username;
            user.email = email || user.email;

            await user.save();
            res.status(200).json({ message: 'Perfil atualizado com sucesso!', user: user });
        } catch (error) {
            if (error.code === 11000) {
                return res.status(400).json({ message: 'Nome de usuário ou e-mail já existe.' });
            }
            res.status(500).json({ message: 'Erro ao atualizar perfil.', error: error.message });
        }
    },

    uploadAvatar: async (req, res) => {
        try {
            const user = await User.findById(req.user.id);
            if (!user) {
                return res.status(404).json({ message: 'Usuário não encontrado.' });
            }

            if (!req.file) {
                return res.status(400).json({ message: 'Nenhum arquivo enviado.' });
            }

            const result = await cloudinary.uploader.upload(req.file.path, {
                folder: 'brainskill_avatars',
                width: 150,
                height: 150,
                crop: 'fill'
            });

            if (user.avatar) {
                const publicId = user.avatar.split('/').pop().split('.')[0];
                await cloudinary.uploader.destroy(`brainskill_avatars/${publicId}`);
            }

            user.avatar = result.secure_url;
            await user.save();
            res.status(200).json({ message: 'Avatar atualizado com sucesso!', avatarUrl: user.avatar });
        } catch (error) {
            console.error('Erro ao fazer upload do avatar:', error);
            res.status(500).json({ message: 'Erro ao fazer upload do avatar.', error: error.message });
        }
    },

    getRanking: async (req, res) => {
        try {
            const users = await User.find({ isBlocked: false }).sort({ balance: -1, username: 1 }).select('username balance avatar').limit(10);
            res.status(200).json(users);
        } catch (error) {
            res.status(500).json({ message: 'Erro ao buscar ranking.', error: error.message });
        }
    },

    getPublicPaymentMethods: async (req, res) => {
        try {
            const settings = await getLiveSettings();
            res.status(200).json(settings.paymentMethods.filter(method => method.isActive));
        } catch (error) {
            res.status(500).json({ message: 'Erro ao buscar métodos de pagamento.', error: error.message });
        }
    },

    createDeposit: async (req, res) => {
        const { amount, paymentMethodId, transactionId } = req.body;
        const userId = req.user.id;

        try {
            const settings = await getLiveSettings();
            if (amount < settings.minDeposit || amount > settings.maxDeposit) {
                return res.status(400).json({ message: `O valor do depósito deve estar entre ${settings.minDeposit} MT e ${settings.maxDeposit} MT.` });
            }

            const paymentMethod = settings.paymentMethods.id(paymentMethodId);
            if (!paymentMethod || !paymentMethod.isActive) {
                return res.status(400).json({ message: 'Método de pagamento inválido ou inativo.' });
            }

            let proofOfPaymentUrl = '';
            if (req.file) {
                const result = await cloudinary.uploader.upload(req.file.path, {
                    folder: 'brainskill_proofs',
                    quality: 'auto',
                    fetch_format: 'auto'
                });
                proofOfPaymentUrl = result.secure_url;
            }

            const transaction = new Transaction({
                user: userId,
                type: 'deposit',
                amount: amount,
                status: 'pending',
                paymentMethod: paymentMethod.name,
                transactionId: transactionId,
                proofOfPayment: proofOfPaymentUrl
            });
            await transaction.save();

            res.status(201).json({ message: 'Depósito enviado para aprovação.', transaction });
        } catch (error) {
            console.error('Erro ao criar depósito:', error);
            res.status(500).json({ message: 'Erro ao criar depósito.', error: error.message });
        }
    },

    createWithdrawal: async (req, res) => {
        const { amount, paymentMethodId, recipientAccount, recipientName } = req.body;
        const userId = req.user.id;

        try {
            const user = await User.findById(userId);
            if (!user) {
                return res.status(404).json({ message: 'Usuário não encontrado.' });
            }

            const settings = await getLiveSettings();
            const minWithdrawal = settings ? settings.minWithdrawal : defaultConfig.minWithdrawal;
            const maxWithdrawal = settings ? settings.maxWithdrawal : defaultConfig.maxWithdrawal;


            if (amount < minWithdrawal || amount > maxWithdrawal) {
                return res.status(400).json({ message: `O valor do levantamento deve estar entre ${minWithdrawal} MT e ${maxWithdrawal} MT.` });
            }

            if (user.balance < amount) {
                return res.status(400).json({ message: 'Saldo insuficiente.' });
            }

            const paymentMethod = settings.paymentMethods.id(paymentMethodId);
            if (!paymentMethod || !paymentMethod.isActive) {
                return res.status(400).json({ message: 'Método de pagamento inválido ou inativo.' });
            }

            user.balance -= amount;
            await user.save();

            const transaction = new Transaction({
                user: userId,
                type: 'withdrawal',
                amount: amount,
                status: 'pending',
                paymentMethod: paymentMethod.name,
                recipientAccount,
                recipientName
            });
            await transaction.save();

            res.status(201).json({ message: 'Pedido de levantamento enviado para aprovação.', transaction });
        } catch (error) {
            console.error('Erro ao criar levantamento:', error);
            res.status(500).json({ message: 'Erro ao criar levantamento.', error: error.message });
        }
    },

    getMyTransactions: async (req, res) => {
        try {
            const transactions = await Transaction.find({ user: req.user.id }).sort({ createdAt: -1 });
            res.status(200).json(transactions);
        } catch (error) {
            res.status(500).json({ message: 'Erro ao buscar transações.', error: error.message });
        }
    },

    getMyGames: async (req, res) => {
        try {
            const games = await Game.find({
                $or: [{ player1: req.user.id }, { player2: req.user.id }],
                hiddenBy: { $ne: req.user.id }
            })
                .populate('player1', 'username avatar')
                .populate('player2', 'username avatar')
                .sort({ createdAt: -1 });
            res.status(200).json(games);
        } catch (error) {
            res.status(500).json({ message: 'Erro ao buscar jogos.', error: error.message });
        }
    },

    hideGameFromHistory: async (req, res) => {
        try {
            const { id: gameId } = req.params;
            const userId = req.user.id;

            const game = await Game.findById(gameId);

            if (!game) {
                return res.status(404).json({ message: 'Jogo não encontrado.' });
            }

            if (!game.players.includes(userId)) {
                return res.status(403).json({ message: 'Você não tem permissão para esconder este jogo.' });
            }

            if (!game.hiddenBy.includes(userId)) {
                game.hiddenBy.push(userId);
                await game.save();
            }

            res.status(200).json({ message: 'Jogo escondido do histórico com sucesso.' });
        } catch (error) {
            console.error('Erro ao esconder jogo do histórico:', error);
            res.status(500).json({ message: 'Erro interno do servidor ao esconder jogo.' });
        }
    },


    // --- FUNÇÕES DE ADMIN ---

    getAllUsers: async (req, res) => {
        try {
            const users = await User.find({}).select('-password').sort({ createdAt: -1 });
            res.status(200).json(users);
        } catch (error) {
            res.status(500).json({ message: 'Erro ao buscar usuários.', error: error.message });
        }
    },

    toggleBlockUser: async (req, res) => {
        try {
            const { id } = req.params;
            const user = await User.findById(id);
            if (!user) {
                return res.status(404).json({ message: 'Usuário não encontrado.' });
            }
            user.isBlocked = !user.isBlocked;
            await user.save();
            res.status(200).json({ message: 'Status do usuário atualizado.', user });
        } catch (error) {
            res.status(500).json({ message: 'Erro ao bloquear/desbloquear usuário.', error: error.message });
        }
    },

    manualBalanceUpdate: async (req, res) => {
        try {
            const { id } = req.params;
            const { amount } = req.body;

            if (typeof amount !== 'number') {
                return res.status(400).json({ message: 'Valor inválido.' });
            }

            const user = await User.findById(id);
            if (!user) {
                return res.status(404).json({ message: 'Usuário não encontrado.' });
            }

            user.balance += amount;
            await user.save();

            res.status(200).json({ message: 'Saldo atualizado com sucesso.', user });
        } catch (error) {
            res.status(500).json({ message: 'Erro ao atualizar saldo.', error: error.message });
        }
    },

    adminUpdateUserBonusBalance: async (req, res) => {
        try {
            const { userId } = req.params;
            const { bonusBalanceChange, type } = req.body;

            if (typeof bonusBalanceChange !== 'number' || bonusBalanceChange <= 0) {
                return res.status(400).json({ message: 'Valor de alteração de bônus inválido.' });
            }

            const user = await User.findById(userId);
            if (!user) {
                return res.status(404).json({ message: 'Usuário não encontrado.' });
            }

            if (type === 'add') {
                user.bonusBalance += bonusBalanceChange;
                await user.save();
                return res.status(200).json({ message: 'Saldo de bônus adicionado com sucesso.', user });
            } else if (type === 'remove') {
                if (user.bonusBalance < bonusBalanceChange) {
                    return res.status(400).json({ message: 'Saldo de bônus insuficiente para remover este valor.' });
                }
                user.bonusBalance -= bonusBalanceChange;
                await user.save();
                return res.status(200).json({ message: 'Saldo de bônus removido com sucesso.', user });
            } else {
                return res.status(400).json({ message: 'Tipo de operação de bônus inválido. Use "add" ou "remove".' });
            }

        } catch (error) {
            console.error('Erro ao atualizar saldo de bônus do usuário:', error);
            res.status(500).json({ message: 'Erro interno do servidor ao atualizar saldo de bônus.' });
        }
    },

    adminGetUserHistory: async (req, res) => {
        try {
            const { userId } = req.params;

            const user = await User.findById(userId);
            if (!user) {
                return res.status(404).json({ message: 'Usuário não encontrado.' });
            }

            const transactions = await Transaction.find({ user: userId }).sort({ createdAt: -1 });

            const games = await Game.find({
                $or: [{ player1: userId }, { player2: userId }]
            }).sort({ createdAt: -1 })
              .populate('player1', 'username avatar')
              .populate('player2', 'username avatar');

            res.status(200).json({
                user: {
                    _id: user._id,
                    username: user.username,
                    email: user.email,
                    balance: user.balance,
                    bonusBalance: user.bonusBalance,
                    isBlocked: user.isBlocked,
                    role: user.role,
                    createdAt: user.createdAt,
                },
                transactions,
                games,
            });

        } catch (error) {
            console.error('Erro ao buscar histórico do usuário:', error);
            res.status(500).json({ message: 'Erro interno do servidor ao buscar histórico do usuário.' });
        }
    },


    getAllTransactions: async (req, res) => {
        try {
            const transactions = await Transaction.find({})
                .populate('user', 'username email')
                .sort({ createdAt: -1 });
            res.status(200).json(transactions);
        } catch (error) {
            res.status(500).json({ message: 'Erro ao buscar transações.', error: error.message });
        }
    },

    processTransaction: async (req, res) => {
        const { id } = req.params;
        const { status } = req.body;

        try {
            const transaction = await Transaction.findById(id);
            if (!transaction) {
                return res.status(404).json({ message: 'Transação não encontrada.' });
            }

            if (transaction.status !== 'pending') {
                return res.status(400).json({ message: `Transação já foi ${transaction.status}.` });
            }

            const user = await User.findById(transaction.user);
            if (!user) {
                return res.status(404).json({ message: 'Usuário da transação não encontrado.' });
            }

            transaction.status = status;

            if (status === 'approved') {
                if (transaction.type === 'deposit') {
                    user.balance += transaction.amount;
                }
                await user.save();
                await transaction.save();
                res.status(200).json({ message: 'Transação aprovada com sucesso!', transaction });
            } else if (status === 'rejected') {
                if (transaction.type === 'withdrawal') {
                    user.balance += transaction.amount;
                }
                await user.save();
                await transaction.save();
                res.status(200).json({ message: 'Transação rejeitada com sucesso!', transaction });
            } else {
                res.status(400).json({ message: 'Status de transação inválido.' });
            }

        } catch (error) {
            res.status(500).json({ message: 'Erro ao processar transação.', error: error.message });
        }
    },

    getDashboardStats: async (req, res) => {
        try {
            const totalUsers = await User.countDocuments();
            const totalGames = await Game.countDocuments();

            const totalDepositedResult = await Transaction.aggregate([
                { $match: { type: 'deposit', status: 'approved' } },
                { $group: { _id: null, total: { $sum: '$amount' } } }
            ]);
            const totalDeposited = totalDepositedResult.length > 0 ? totalDepositedResult[0].total : 0;

            const totalWithdrawnResult = await Transaction.aggregate([
                { $match: { type: 'withdrawal', status: 'approved' } },
                { $group: { _id: null, total: { $sum: '$amount' } } }
            ]);
            const totalWithdrawn = totalWithdrawnResult.length > 0 ? totalWithdrawnResult[0].total : 0;

            const totalCommissionResult = await Transaction.aggregate([
                { $match: { type: 'commission' } },
                { $group: { _id: null, total: { $sum: '$amount' } } }
            ]);
            const totalCommission = totalCommissionResult.length > 0 ? totalCommissionResult[0].total : 0;

            const totalTransactedInGamesResult = await Transaction.aggregate([
                { $match: { type: { $in: ['game_bet', 'game_win'] }, status: 'approved' } },
                { $group: { _id: null, total: { $sum: '$amount' } } }
            ]);
            const totalTransactedInGames = totalTransactedInGamesResult.length > 0 ? totalTransactedInGamesResult[0].total : 0;


            res.status(200).json({
                totalUsers,
                totalGames,
                totalDeposited,
                totalWithdrawn,
                totalCommission,
                totalTransactedInGames
            });
        } catch (error) {
            console.error('Erro ao buscar estatísticas do dashboard:', error);
            res.status(500).json({ message: 'Erro ao buscar estatísticas do dashboard.', error: error.message });
        }
    },

    getPlatformSettings: async (req, res) => {
        try {
            const settings = await getLiveSettings();
            res.status(200).json(settings);
        } catch (error) {
            res.status(500).json({ message: "Erro ao buscar as configurações da plataforma.", error: error.message });
        }
    },

    updatePlatformSettings: async (req, res) => {
        try {
            const { platformCommission, minDeposit, maxDeposit, minWithdrawal, maxWithdrawal, maxBet, minBet, passwordResetTokenExpiresIn, platformName, isBonusEnabled, welcomeBonusAmount } = req.body;

            const updateData = {};
            if (platformCommission !== undefined) updateData.platformCommission = platformCommission;
            if (minDeposit !== undefined) updateData.minDeposit = minDeposit;
            if (maxDeposit !== undefined) updateData.maxDeposit = maxDeposit;
            if (minWithdrawal !== undefined) updateData.minWithdrawal = minWithdrawal;
            if (maxWithdrawal !== undefined) updateData.maxWithdrawal = maxWithdrawal;
            if (maxBet !== undefined) updateData.maxBet = maxBet;
            if (minBet !== undefined) updateData.minBet = minBet;
            if (passwordResetTokenExpiresIn !== undefined) updateData.passwordResetTokenExpiresIn = passwordResetTokenExpiresIn;
            if (platformName !== undefined) updateData.platformName = platformName;
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