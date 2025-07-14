const bcrypt = require('bcryptjs');
const jwt = 'jsonwebtoken';
const crypto = require('crypto');
const cloudinary = require('cloudinary').v2;
const { User, Game, Transaction, PlatformSettings } = require('./models');
const { 
    generateUniqueId, 
    generatePasswordResetCode, 
    sendStyledEmail, 
    getPasswordResetEmailHTML 
} = require('./utils');
const config = require('./config');

const signToken = (id) => {
    return require('jsonwebtoken').sign({ id }, process.env.JWT_SECRET, {
        expiresIn: '90d',
    });
};

const createSendToken = (user, statusCode, res) => {
    const token = signToken(user._id);
    user.password = undefined;
    res.status(statusCode).json({
        status: 'success',
        token,
        data: {
            user,
        },
    });
};

exports.authController = {
    register: async (req, res) => {
        try {
            const { username, email, password } = req.body;
            if (!username || !email || !password) {
                return res.status(400).json({ status: 'fail', message: 'Forneça nome de usuário, email e senha.' });
            }

            const existingUser = await User.findOne({ $or: [{ email }, { username }] });
            if (existingUser) {
                return res.status(400).json({ status: 'fail', message: 'Email ou nome de usuário já existem.' });
            }
            
            let newUserId;
            let isUnique = false;
            while (!isUnique) {
                newUserId = generateUniqueId(5);
                const userWithId = await User.findOne({ userId: newUserId });
                if (!userWithId) {
                    isUnique = true;
                }
            }

            const newUser = await User.create({
                userId: newUserId,
                username,
                email,
                password,
            });

            createSendToken(newUser, 201, res);
        } catch (error) {
            res.status(500).json({ status: 'error', message: 'Erro interno do servidor.' });
        }
    },

    login: async (req, res) => {
        try {
            const { email, password } = req.body;
            if (!email || !password) {
                return res.status(400).json({ status: 'fail', message: 'Forneça email e senha.' });
            }

            const user = await User.findOne({ email }).select('+password');
            if (!user || !(await user.comparePassword(password))) {
                return res.status(401).json({ status: 'fail', message: 'Email ou senha incorretos.' });
            }

            if (user.status === 'blocked') {
                return res.status(403).json({ status: 'fail', message: 'Esta conta está bloqueada.' });
            }

            createSendToken(user, 200, res);
        } catch (error) {
            res.status(500).json({ status: 'error', message: 'Erro interno do servidor.' });
        }
    },
    
    requestPasswordReset: async (req, res) => {
        try {
            const user = await User.findOne({ email: req.body.email });
            if (!user) {
                return res.status(404).json({ status: 'fail', message: 'Não há usuário com este email.' });
            }

            const resetCode = generatePasswordResetCode();
            user.passwordResetCode = crypto.createHash('sha256').update(resetCode).digest('hex');
            user.passwordResetExpires = Date.now() + config.passwordReset.tokenLife;
            await user.save({ validateBeforeSave: false });

            const emailHTML = getPasswordResetEmailHTML(resetCode);
            await sendStyledEmail(user.email, 'Recuperação de Senha - BrainSkill', emailHTML);
            
            res.status(200).json({ status: 'success', message: 'Código de recuperação enviado para o email.' });
        } catch (error) {
            res.status(500).json({ status: 'error', message: 'Houve um erro ao enviar o email. Tente novamente mais tarde.' });
        }
    },
    
    verifyResetCode: async (req, res) => {
        try {
            const { email, code } = req.body;
            const hashedCode = crypto.createHash('sha256').update(code).digest('hex');
            const user = await User.findOne({
                email,
                passwordResetCode: hashedCode,
                passwordResetExpires: { $gt: Date.now() },
            });

            if (!user) {
                return res.status(400).json({ status: 'fail', message: 'Código inválido ou expirado.' });
            }
            
            res.status(200).json({ status: 'success', message: 'Código verificado com sucesso.' });
        } catch(error) {
            res.status(500).json({ status: 'error', message: 'Erro interno do servidor.' });
        }
    },

    resetPassword: async (req, res) => {
        try {
            const { email, code, password } = req.body;
            const hashedCode = crypto.createHash('sha256').update(code).digest('hex');

            const user = await User.findOne({
                email,
                passwordResetCode: hashedCode,
                passwordResetExpires: { $gt: Date.now() },
            });

            if (!user) {
                return res.status(400).json({ status: 'fail', message: 'Código inválido ou expirado.' });
            }

            user.password = password;
            user.passwordResetCode = undefined;
            user.passwordResetExpires = undefined;
            await user.save();
            
            createSendToken(user, 200, res);

        } catch (error) {
            res.status(500).json({ status: 'error', message: 'Erro interno do servidor.' });
        }
    },
};

exports.userController = {
    protect: async (req, res, next) => {
        let token;
        if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
            token = req.headers.authorization.split(' ')[1];
        }

        if (!token) {
            return res.status(401).json({ status: 'fail', message: 'Não está logado. Por favor, faça login para obter acesso.' });
        }

        try {
            const decoded = await require('util').promisify(require('jsonwebtoken').verify)(token, process.env.JWT_SECRET);
            const currentUser = await User.findById(decoded.id);

            if (!currentUser) {
                return res.status(401).json({ status: 'fail', message: 'O usuário pertencente a este token já não existe.' });
            }
            if (currentUser.status === 'blocked') {
                return res.status(403).json({ status: 'fail', message: 'Esta conta foi bloqueada.' });
            }

            req.user = currentUser;
            next();
        } catch (error) {
            return res.status(401).json({ status: 'fail', message: 'Token inválido ou expirado.' });
        }
    },
    
    getMe: (req, res) => {
        res.status(200).json({ status: 'success', data: { user: req.user } });
    },
    
    updateMe: async (req, res) => {
        try {
            const { username, bio, oldPassword, newPassword } = req.body;
            
            const user = await User.findById(req.user.id).select('+password');
            
            if (username) user.username = username;
            if (bio) user.bio = bio;
            
            if (req.file) {
                 const result = await cloudinary.uploader.upload(req.file.path);
                 user.avatar = result.secure_url;
            }

            if (oldPassword && newPassword) {
                if (!(await user.comparePassword(oldPassword))) {
                    return res.status(401).json({ status: 'fail', message: 'Senha antiga incorreta.' });
                }
                user.password = newPassword;
            }
            
            const updatedUser = await user.save();
            updatedUser.password = undefined;

            res.status(200).json({ status: 'success', data: { user: updatedUser } });
        } catch (error) {
             if (error.code === 11000) {
                return res.status(400).json({ status: 'fail', message: 'Esse nome de usuário já está em uso.' });
            }
            res.status(500).json({ status: 'error', message: 'Erro ao atualizar perfil.' });
        }
    },

    getPublicProfile: async (req, res) => {
        try {
            const user = await User.findOne({ userId: req.params.userId }).select('userId username avatar bio stats createdAt');
            if (!user) {
                return res.status(404).json({ status: 'fail', message: 'Usuário não encontrado.' });
            }
            res.status(200).json({ status: 'success', data: { user } });
        } catch (error) {
            res.status(500).json({ status: 'error', message: 'Erro interno do servidor.' });
        }
    },
    
    getRanking: async (req, res) => {
        try {
            const users = await User.find({ role: 'user' }).sort({ 'stats.wins': -1, 'stats.losses': 1 }).select('userId username avatar stats createdAt');
            res.status(200).json({ status: 'success', results: users.length, data: { users } });
        } catch (error) {
            res.status(500).json({ status: 'error', message: 'Erro ao buscar o ranking.' });
        }
    },
    
    getGameHistory: async (req, res) => {
        try {
            const games = await Game.find({ players: req.user.id })
                .populate('players', 'userId username avatar')
                .populate('winner', 'userId username')
                .sort({ updatedAt: -1 });
            res.status(200).json({ status: 'success', data: { games } });
        } catch (error) {
            res.status(500).json({ status: 'error', message: 'Erro ao buscar histórico de partidas.' });
        }
    }
};

exports.transactionController = {
    createTransaction: async (req, res) => {
        try {
            const { type, amount, method, paymentInfo } = req.body;
            const parsedAmount = parseFloat(amount);
            
            const settings = await PlatformSettings.findOne();
            const minLimit = type === 'deposit' ? settings.limits.minDeposit : settings.limits.minWithdrawal;
            
            if (parsedAmount < minLimit) {
                return res.status(400).json({ status: 'fail', message: `O valor mínimo para ${type === 'deposit' ? 'depósito' : 'levantamento'} é de ${minLimit} MT.` });
            }

            if (type === 'withdrawal') {
                if(req.user.balance < parsedAmount) {
                    return res.status(400).json({ status: 'fail', message: 'Saldo insuficiente para levantamento.' });
                }
            }

            let proofData;
            if (req.file) {
                const result = await cloudinary.uploader.upload(req.file.path);
                proofData = result.secure_url;
            } else if (req.body.proofText) {
                proofData = req.body.proofText;
            } else {
                 return res.status(400).json({ status: 'fail', message: 'É necessário enviar um comprovativo (imagem ou texto).' });
            }

            const transaction = await Transaction.create({
                user: req.user.id,
                type,
                amount: parsedAmount,
                method,
                proof: proofData,
                paymentInfo: type === 'withdrawal' ? JSON.parse(paymentInfo) : undefined,
            });

            res.status(201).json({ status: 'success', message: `Pedido de ${type === 'deposit' ? 'depósito' : 'levantamento'} recebido. Aguardando aprovação.`, data: { transaction } });
        } catch (error) {
            res.status(500).json({ status: 'error', message: 'Erro ao criar a transação.' });
        }
    },
    
    getMyTransactions: async (req, res) => {
        try {
            const transactions = await Transaction.find({ user: req.user.id }).sort({ createdAt: -1 });
            res.status(200).json({ status: 'success', data: { transactions } });
        } catch (error) {
            res.status(500).json({ status: 'error', message: 'Erro ao buscar transações.' });
        }
    }
};

exports.adminController = {
    isAdmin: (req, res, next) => {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ status: 'fail', message: 'Acesso negado. Ação restrita a administradores.' });
        }
        next();
    },

    getAllUsers: async (req, res) => {
        try {
            const users = await User.find().sort({ createdAt: -1 });
            res.status(200).json({ status: 'success', data: { users } });
        } catch (error) {
            res.status(500).json({ status: 'error', message: 'Erro ao buscar usuários.' });
        }
    },
    
    toggleUserBlock: async (req, res) => {
        try {
            const user = await User.findById(req.params.id);
            if (!user) return res.status(404).json({ status: 'fail', message: 'Usuário não encontrado.' });
            
            user.status = user.status === 'active' ? 'blocked' : 'active';
            await user.save({ validateBeforeSave: false });
            
            res.status(200).json({ status: 'success', message: `Usuário ${user.status === 'blocked' ? 'bloqueado' : 'desbloqueado'}.`, data: { user } });
        } catch (error) {
            res.status(500).json({ status: 'error', message: 'Erro ao atualizar status do usuário.' });
        }
    },
    
    getTransactions: async (req, res) => {
        try {
            const filter = req.query.status ? { status: req.query.status } : {};
            const transactions = await Transaction.find(filter).populate('user', 'username userId').sort({ createdAt: -1 });
            res.status(200).json({ status: 'success', data: { transactions } });
        } catch (error) {
            res.status(500).json({ status: 'error', message: 'Erro ao buscar transações.' });
        }
    },

    processTransaction: async (req, res) => {
        try {
            const { transactionId, action, adminNotes } = req.body; // action: 'approve' ou 'reject'
            const transaction = await Transaction.findById(transactionId);

            if (!transaction || transaction.status !== 'pending') {
                return res.status(404).json({ status: 'fail', message: 'Transação não encontrada ou já processada.' });
            }

            const user = await User.findById(transaction.user);
            if (!user) return res.status(404).json({ status: 'fail', message: 'Usuário associado não encontrado.' });
            
            if (action === 'approve') {
                if (transaction.type === 'deposit') {
                    user.balance += transaction.amount;
                } else {
                    if (user.balance < transaction.amount) {
                         transaction.status = 'rejected';
                         transaction.adminNotes = 'Saldo insuficiente no momento da aprovação.';
                         await transaction.save();
                         return res.status(400).json({ status: 'fail', message: 'Usuário não tem saldo suficiente. Transação rejeitada.' });
                    }
                    user.balance -= transaction.amount;
                }
                transaction.status = 'approved';
            } else if (action === 'reject') {
                transaction.status = 'rejected';
            } else {
                return res.status(400).json({ status: 'fail', message: 'Ação inválida.' });
            }

            transaction.processedBy = req.user.id;
            if(adminNotes) transaction.adminNotes = adminNotes;

            await user.save();
            await transaction.save();

            res.status(200).json({ status: 'success', message: `Transação ${action === 'approve' ? 'aprovada' : 'rejeitada'}.`, data: { transaction } });

        } catch (error) {
            res.status(500).json({ status: 'error', message: 'Erro ao processar a transação.' });
        }
    },

    manualBalanceUpdate: async (req, res) => {
        try {
            const { userId, amount, reason } = req.body;
            const targetUser = await User.findById(userId);
            if (!targetUser) return res.status(404).json({ status: 'fail', message: 'Usuário não encontrado.' });

            targetUser.balance += parseFloat(amount);
            if(targetUser.balance < 0) targetUser.balance = 0;
            await targetUser.save();
            
            res.status(200).json({ status: 'success', message: `Saldo de ${targetUser.username} atualizado.`, data: { newBalance: targetUser.balance }});
        } catch (error) {
            res.status(500).json({ status: 'error', message: 'Erro ao atualizar o saldo.' });
        }
    },
    
    getPlatformStats: async (req, res) => {
        try {
            const totalDeposited = await Transaction.aggregate([
                { $match: { type: 'deposit', status: 'approved' } },
                { $group: { _id: null, total: { $sum: '$amount' } } }
            ]);
            
            const totalWithdrawn = await Transaction.aggregate([
                { $match: { type: 'withdrawal', status: 'approved' } },
                { $group: { _id: null, total: { $sum: '$amount' } } }
            ]);
            
            const games = await Game.find({ status: 'completed', winner: { $ne: null } });
            const settings = await PlatformSettings.findOne();
            const commissionRate = settings ? settings.commissionRate : config.commissionRate;
            const totalCommission = games.reduce((acc, game) => acc + (game.betAmount * 2 * commissionRate), 0);

            res.status(200).json({
                status: 'success',
                data: {
                    totalDeposited: totalDeposited[0]?.total || 0,
                    totalWithdrawn: totalWithdrawn[0]?.total || 0,
                    totalCommission,
                    userCount: await User.countDocuments(),
                    gamesPlayed: games.length,
                }
            });
        } catch (error) {
            res.status(500).json({ status: 'error', message: 'Erro ao calcular estatísticas.' });
        }
    },
    
    getPlatformSettings: async (req, res) => {
        try {
            let settings = await PlatformSettings.findOne();
            if (!settings) {
                settings = await PlatformSettings.create({ singleton: true });
            }
            res.status(200).json({ status: 'success', data: { settings } });
        } catch (error) {
            res.status(500).json({ status: 'error', message: 'Erro ao buscar configurações.' });
        }
    },
    
    updatePlatformSettings: async (req, res) => {
        try {
            let settings = await PlatformSettings.findOneAndUpdate({ singleton: true }, req.body, { new: true, upsert: true });
            res.status(200).json({ status: 'success', data: { settings } });
        } catch (error) {
            res.status(500).json({ status: 'error', message: 'Erro ao atualizar configurações.' });
        }
    }
};

exports.generalController = {
     getLobby: async (req, res) => {
        try {
            const games = await Game.find({ status: 'waiting_for_opponent', isPrivate: false })
                .populate('players', 'userId username avatar')
                .sort({ createdAt: -1 });

            res.status(200).json({ status: 'success', data: { games } });
        } catch (error) {
            res.status(500).json({ status: 'error', message: 'Erro ao buscar o lobby.' });
        }
    },
    getGameDetails: async (req, res) => {
        try {
            const game = await Game.findOne({ gameId: req.params.gameId }).populate('players', 'userId username avatar');
            if (!game) {
                return res.status(404).json({ status: 'fail', message: 'Partida não encontrada.' });
            }
            res.status(200).json({ status: 'success', data: { game } });
        } catch(error) {
            res.status(500).json({ status: 'error', message: 'Erro ao buscar detalhes da partida.' });
        }
    },
    getHelpPage: async (req, res) => {
        try {
            const settings = await PlatformSettings.findOne().select('platformTexts.help');
            res.status(200).json({ status: 'success', data: { helpContent: settings?.platformTexts?.help || "Página de ajuda ainda não configurada." } });
        } catch (error) {
            res.status(500).json({ status: 'error', message: 'Erro ao buscar página de ajuda.' });
        }
    },
     getPaymentMethods: async (req, res) => {
        try {
            const settings = await PlatformSettings.findOne().select('paymentMethods');
            const activeMethods = settings.paymentMethods.filter(pm => pm.isActive);
            res.status(200).json({ status: 'success', data: { paymentMethods: activeMethods } });
        } catch (error) {
            res.status(500).json({ status: 'error', message: 'Erro ao buscar métodos de pagamento.' });
        }
    }
};