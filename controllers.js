const { User, Match, Transaction, PlatformSettings } = require('./models');
const utils = require('./utils');
const config = require('./config');
const mongoose = require('mongoose');

const authController = {
    registerUser: async (req, res) => {
        const { username, email, password } = req.body;
        try {
            if (!username || !email || !password) {
                return res.status(400).json({ message: 'Por favor, preencha todos os campos.' });
            }
            let user = await User.findOne({ $or: [{ email }, { username }] });
            if (user) {
                return res.status(400).json({ message: 'Email ou nome de usuário já existe.' });
            }

            const hashedPassword = await utils.hashPassword(password);
            const numericId = await utils.generateUniqueNumericId(User, 'numericId', config.ids.userNumericIdLength);

            user = new User({ username, email, password: hashedPassword, numericId });
            await user.save();
            
            const token = utils.generateToken(user._id);
            res.status(201).json({
                token,
                user: { _id: user._id, username: user.username, email: user.email, avatar: user.avatar, role: user.role }
            });
        } catch (error) {
            res.status(500).json({ message: 'Erro no servidor ao registar usuário.' });
        }
    },
    loginUser: async (req, res) => {
        const { email, password } = req.body;
        try {
            const user = await User.findOne({ email }).select('+password');
            if (!user || !(await utils.comparePassword(password, user.password))) {
                return res.status(401).json({ message: 'Credenciais inválidas.' });
            }
            if (user.isBlocked) {
                return res.status(403).json({ message: 'Esta conta está bloqueada.' });
            }
            const token = utils.generateToken(user._id);
            res.status(200).json({
                token,
                user: { _id: user._id, username: user.username, email: user.email, avatar: user.avatar, role: user.role }
            });
        } catch (error) {
            res.status(500).json({ message: 'Erro no servidor ao fazer login.' });
        }
    },
    forgotPassword: async (req, res) => {
        const { email } = req.body;
        try {
            const user = await User.findOne({ email });
            if (user) {
                const resetCode = utils.generateRandomCode(6);
                user.passwordResetCode = resetCode;
                user.passwordResetExpires = Date.now() + config.security.passwordResetTokenExpiresIn;
                await user.save();

                const emailHtml = `
                    <div style="font-family: Oswald, sans-serif; text-align: center; color: #333; background-color: #f4f4f4; padding: 20px;">
                        <div style="max-width: 600px; margin: auto; background: white; padding: 20px; border: 1px solid #ddd;">
                            <h1 style="color: black;">BrainSkill</h1>
                            <h2>Recuperação de Senha</h2>
                            <p>Olá, ${user.username}.</p>
                            <p>Recebemos um pedido para redefinir a sua senha. Use o código abaixo para criar uma nova.</p>
                            <p style="font-size: 24px; font-weight: bold; letter-spacing: 5px; color: black; background-color: #eee; padding: 10px 20px; margin: 20px 0;">${resetCode}</p>
                            <p>Este código é válido por 15 minutos. Se não solicitou esta alteração, pode ignorar este email.</p>
                        </div>
                    </div>`;

                await utils.sendEmail({ to: user.email, subject: 'Código de Recuperação de Senha - BrainSkill', html: emailHtml });
            }
            res.status(200).json({ message: 'Se o email estiver registado, receberá um código de recuperação.' });
        } catch (error) {
            res.status(500).json({ message: 'Erro ao enviar o email.' });
        }
    },
    resetPassword: async (req, res) => {
        const { code, password } = req.body;
        try {
            const user = await User.findOne({
                passwordResetCode: code,
                passwordResetExpires: { $gt: Date.now() }
            });
            if (!user) {
                return res.status(400).json({ message: 'Código inválido ou expirado.' });
            }
            user.password = await utils.hashPassword(password);
            user.passwordResetCode = undefined;
            user.passwordResetExpires = undefined;
            await user.save();
            res.status(200).json({ message: 'Senha redefinida com sucesso.' });
        } catch (error) {
            res.status(500).json({ message: 'Erro ao redefinir a senha.' });
        }
    },
};

const userController = {
    getProfile: async (req, res) => {
        try {
            const user = await User.findById(req.user.id).select('-password');
            res.json(user);
        } catch (error) {
            res.status(500).json({ message: 'Erro ao buscar perfil.' });
        }
    },
    updateProfile: async (req, res) => {
        const { username, bio, newPassword, currentPassword } = req.body;
        try {
            const user = await User.findById(req.user.id).select('+password');
            if (username && username !== user.username) {
                const existingUser = await User.findOne({ username });
                if (existingUser) return res.status(400).json({ message: 'Nome de usuário já em uso.' });
                user.username = username;
            }
            if (bio) user.bio = bio;
            if (newPassword && currentPassword) {
                const isMatch = await utils.comparePassword(currentPassword, user.password);
                if (!isMatch) return res.status(400).json({ message: 'Senha atual incorreta.' });
                user.password = await utils.hashPassword(newPassword);
            }
            await user.save();
            res.json({ message: 'Perfil atualizado com sucesso.' });
        } catch (error) {
            res.status(500).json({ message: 'Erro ao atualizar o perfil.' });
        }
    },
    uploadAvatar: async (req, res) => {
        try {
            if (!req.file) return res.status(400).json({ message: 'Nenhum ficheiro enviado.' });
            const result = await utils.uploadToCloudinary(req.file.path);
            if (!result.success) return res.status(500).json({ message: result.message });
            
            const user = await User.findById(req.user.id);
            user.avatar = result.url;
            await user.save();
            res.json({ avatar: result.url });
        } catch (error) {
            res.status(500).json({ message: 'Erro ao fazer upload do avatar.' });
        }
    },
    getPublicProfile: async (req, res) => {
        try {
            const user = await User.findOne({ numericId: req.params.numericId }).select('username numericId avatar bio stats createdAt');
            if (!user) return res.status(404).json({ message: 'Usuário não encontrado.' });
            res.json(user);
        } catch (error) {
            res.status(500).json({ message: 'Erro ao buscar perfil público.' });
        }
    },
    getRanking: async (req, res) => {
        try {
             const users = await User.find({ role: 'user' }).sort({ 'stats.wins': -1, 'stats.losses': 1 }).limit(100).select('username numericId avatar stats');
             res.json(users);
        } catch (error) {
             res.status(500).json({ message: 'Erro ao buscar o ranking.' });
        }
    }
};

const walletController = {
    getWalletInfo: async (req, res) => {
        try {
            const user = await User.findById(req.user.id).select('balance');
            const transactions = await Transaction.find({ user: req.user.id }).sort({ createdAt: -1 }).limit(50);
            res.json({ balance: user.balance, transactions });
        } catch (error) {
            res.status(500).json({ message: 'Erro ao buscar informações da carteira.' });
        }
    },
    requestDeposit: async (req, res) => {
        const { amount, method, proofText } = req.body;
        const settings = await PlatformSettings.findOne({ singleton: true });
        if (!amount || !method) return res.status(400).json({ message: 'Valor e método são obrigatórios.' });
        if (amount < settings.minDeposit || amount > settings.maxDeposit) {
            return res.status(400).json({ message: `Valor do depósito deve ser entre ${settings.minDeposit} e ${settings.maxDeposit}.`});
        }
        if (!req.file && !proofText) return res.status(400).json({ message: 'É necessário enviar um comprovativo (imagem ou texto).' });
        
        try {
            let proofUrl = proofText || '';
            if (req.file) {
                const result = await utils.uploadToCloudinary(req.file.path);
                if (!result.success) return res.status(500).json({ message: result.message });
                proofUrl = result.url;
            }
            
            const transactionId = await utils.generateUniqueNumericId(Transaction, 'transactionId', config.ids.transactionIdLength);
            const transaction = new Transaction({
                transactionId,
                user: req.user.id,
                type: 'deposit',
                amount,
                method,
                proof: proofUrl,
                status: 'pending'
            });
            await transaction.save();
            res.status(201).json({ message: 'Pedido de depósito enviado para aprovação.' });
        } catch (error) {
            res.status(500).json({ message: 'Erro ao processar o pedido de depósito.' });
        }
    },
    requestWithdrawal: async (req, res) => {
        const { amount, method, number } = req.body; 
        const settings = await PlatformSettings.findOne({ singleton: true });
        if (!amount || !method || !number) return res.status(400).json({ message: 'Valor, método e número são obrigatórios.' });
        if (amount < settings.minWithdrawal || amount > settings.maxWithdrawal) {
             return res.status(400).json({ message: `Valor do levantamento deve ser entre ${settings.minWithdrawal} e ${settings.maxWithdrawal}.`});
        }

        const session = await mongoose.startSession();
        session.startTransaction();
        try {
            const user = await User.findById(req.user.id).session(session);
            if (user.balance < amount) {
                await session.abortTransaction();
                return res.status(400).json({ message: 'Saldo insuficiente.' });
            }
            user.balance -= amount;
            await user.save({ session });

            const transactionId = await utils.generateUniqueNumericId(Transaction, 'transactionId', config.ids.transactionIdLength);
            const transaction = new Transaction({
                transactionId,
                user: req.user.id,
                type: 'withdrawal',
                amount,
                method,
                proof: `Levantamento para o número: ${number}`, 
                status: 'pending'
            });
            await transaction.save({ session });
            
            await session.commitTransaction();
            res.status(201).json({ message: 'Pedido de levantamento enviado para aprovação.' });
        } catch (error) {
            await session.abortTransaction();
            res.status(500).json({ message: 'Erro ao processar o pedido de levantamento.' });
        } finally {
            session.endSession();
        }
    },
     getPaymentDetails: async (req, res) => {
        try {
            const settings = await PlatformSettings.findOne({ singleton: true }).select('paymentDetails');
            res.json(settings.paymentDetails);
        } catch (error) {
            res.status(500).json({ message: 'Erro ao buscar detalhes de pagamento.' });
        }
    },
};

const gameController = {
    getMatchHistory: async (req, res) => {
        try {
            const matches = await Match.find({ players: req.user.id })
                .populate('players', 'username avatar numericId')
                .populate('winner', 'username')
                .sort({ createdAt: -1 });
            res.json(matches);
        } catch (error) {
            res.status(500).json({ message: 'Erro ao buscar histórico de partidas.' });
        }
    },
    getLobbyGames: async (req, res) => {
        try {
            const games = await Match.find({ status: 'waiting', isPrivate: false })
                .populate('lobbyInfo.createdBy', 'username avatar numericId')
                .sort({ createdAt: -1 });
            res.json(games);
        } catch (error) {
            res.status(500).json({ message: 'Erro ao buscar jogos do lobby.' });
        }
    }
};

const platformController = {
    getHelpPage: async (req, res) => {
        try {
            const settings = await PlatformSettings.findOne({ singleton: true }).select('helpContent');
            res.json({ helpContent: settings.helpContent });
        } catch (error) {
            res.status(500).json({ message: 'Erro ao carregar a página de ajuda.' });
        }
    }
};

const adminController = {
    getAllUsers: async (req, res) => {
        try {
            const users = await User.find().sort({ createdAt: -1 });
            res.json(users);
        } catch (error) {
            res.status(500).json({ message: 'Erro ao buscar usuários.' });
        }
    },
    toggleBlockUser: async (req, res) => {
        try {
            const user = await User.findById(req.params.id);
            if (!user) return res.status(404).json({ message: 'Usuário não encontrado.' });
            user.isBlocked = !user.isBlocked;
            await user.save();
            res.json({ message: `Usuário ${user.isBlocked ? 'bloqueado' : 'desbloqueado'} com sucesso.` });
        } catch (error) {
            res.status(500).json({ message: 'Erro ao atualizar status do usuário.' });
        }
    },
    getAllTransactions: async (req, res) => {
        try {
            const transactions = await Transaction.find().populate('user', 'username numericId').populate('processedBy', 'username').sort({ createdAt: -1 });
            res.json(transactions);
        } catch (error) {
            res.status(500).json({ message: 'Erro ao buscar transações.' });
        }
    },
    processTransaction: async (req, res) => {
        const { id } = req.params;
        const { status, adminNotes } = req.body;

        const session = await mongoose.startSession();
        session.startTransaction();
        try {
            const transaction = await Transaction.findById(id).session(session);
            if (!transaction || transaction.status !== 'pending') {
                await session.abortTransaction();
                return res.status(400).json({ message: 'Transação não encontrada ou já processada.' });
            }

            const user = await User.findById(transaction.user).session(session);
            if (status === 'approved') {
                if (transaction.type === 'deposit') {
                    user.balance += transaction.amount;
                }
            } else if (status === 'rejected') {
                if (transaction.type === 'withdrawal') {
                    user.balance += transaction.amount;
                }
            } else {
                 await session.abortTransaction();
                 return res.status(400).json({ message: 'Status inválido.' });
            }

            transaction.status = status;
            transaction.adminNotes = adminNotes;
            transaction.processedBy = req.user.id;
            
            await user.save({ session });
            await transaction.save({ session });
            
            await session.commitTransaction();
            res.json({ message: `Transação ${status} com sucesso.` });
        } catch (error) {
            await session.abortTransaction();
            res.status(500).json({ message: 'Erro ao processar transação.' });
        } finally {
            session.endSession();
        }
    },
    manualBalanceUpdate: async (req, res) => {
        const { userId, amount, reason } = req.body;
        const session = await mongoose.startSession();
        session.startTransaction();
        try {
            const user = await User.findById(userId).session(session);
            if (!user) {
                await session.abortTransaction();
                return res.status(404).json({ message: 'Usuário não encontrado.' });
            }
            
            user.balance += amount;

            const transactionId = await utils.generateUniqueNumericId(Transaction, 'transactionId', config.ids.transactionIdLength);
            const transaction = new Transaction({
                transactionId,
                user: userId,
                type: 'manual_adjustment',
                amount: amount,
                method: 'Platform',
                status: 'approved',
                adminNotes: reason,
                processedBy: req.user.id,
            });
            
            await user.save({ session });
            await transaction.save({ session });

            await session.commitTransaction();
            res.json({ message: 'Saldo atualizado manualmente com sucesso.' });
        } catch (error) {
            await session.abortTransaction();
            res.status(500).json({ message: 'Erro ao atualizar saldo.' });
        } finally {
            session.endSession();
        }
    },
    getDashboardStats: async (req, res) => {
        try {
            const totalUsers = await User.countDocuments();
            const totalMatches = await Match.countDocuments({ status: 'completed' });
            const settings = await PlatformSettings.findOne({ singleton: true });

            const deposits = await Transaction.aggregate([
                { $match: { type: 'deposit', status: 'approved' } },
                { $group: { _id: null, total: { $sum: '$amount' } } }
            ]);
            const withdrawals = await Transaction.aggregate([
                { $match: { type: 'withdrawal', status: 'approved' } },
                { $group: { _id: null, total: { $sum: '$amount' } } }
            ]);
            const totalBetsValue = await Match.aggregate([
                 { $match: { status: 'completed' } },
                 { $group: { _id: null, total: { $sum: '$betAmount' } } }
            ]);
            
            const totalCommission = (totalBetsValue[0]?.total || 0) * 2 * settings.commissionRate;
            
            res.json({
                totalUsers,
                totalMatches,
                totalDeposited: deposits[0]?.total || 0,
                totalWithdrawn: withdrawals[0]?.total || 0,
                totalWagered: (totalBetsValue[0]?.total || 0) * 2,
                totalCommission,
            });
        } catch (error) {
            res.status(500).json({ message: 'Erro ao buscar estatísticas.' });
        }
    },
    getPlatformSettings: async (req, res) => {
        try {
            const settings = await PlatformSettings.findOne({ singleton: true });
            res.json(settings);
        } catch (error) {
            res.status(500).json({ message: 'Erro ao buscar configurações.' });
        }
    },
    updatePlatformSettings: async (req, res) => {
        try {
            const settings = await PlatformSettings.findOneAndUpdate({ singleton: true }, req.body, { new: true, upsert: true });
            res.json({ message: 'Configurações atualizadas com sucesso.', settings });
        } catch (error) {
            res.status(500).json({ message: 'Erro ao atualizar configurações.' });
        }
    },
};


module.exports = {
    authController,
    userController,
    walletController,
    gameController,
    platformController,
    adminController,
};