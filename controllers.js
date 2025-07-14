const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const cloudinary = require('cloudinary').v2;
const { User, Game, Transaction, PlatformConfig } = require('./models.js');
const { generateUserId, generateTransactionId, generatePasswordResetToken } = require('./utils.js');
const initialConfig = require('./config.js');

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});

const generateToken = (id) => {
    return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '30d' });
};

const sendPasswordResetEmail = async (user, resetToken) => {
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS,
        },
    });

    const resetUrl = `URL_DO_SEU_FRONTEND/reset-password/${resetToken}`; // Esta URL será a da sua página de redefinição

    const mailOptions = {
        from: `"${initialConfig.platformName}" <${process.env.EMAIL_USER}>`,
        to: user.email,
        subject: `Recuperação de Senha - ${initialConfig.platformName}`,
        html: `
            <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
                <div style="max-width: 600px; margin: 20px auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px; background-color: #f9f9f9;">
                    <h2 style="color: #000; text-align: center; border-bottom: 2px solid #000; padding-bottom: 10px;">Recuperação de Senha</h2>
                    <p>Olá, ${user.username},</p>
                    <p>Recebemos uma solicitação para redefinir a sua senha na plataforma <strong>${initialConfig.platformName}</strong>. Use o código abaixo para criar uma nova senha:</p>
                    <div style="text-align: center; margin: 20px 0;">
                        <span style="display: inline-block; font-size: 24px; font-weight: bold; padding: 15px 25px; background-color: #000; color: #fff; border-radius: 5px; letter-spacing: 5px;">${resetToken}</span>
                    </div>
                    <p>Este código é válido por <strong>${initialConfig.passwordResetTokenExpiresIn} minutos</strong>.</p>
                    <p>Se você não solicitou esta alteração, por favor, ignore este e-mail.</p>
                    <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
                    <p style="font-size: 12px; color: #777; text-align: center;">Atenciosamente,<br/>Equipa ${initialConfig.platformName}</p>
                </div>
            </div>
        `,
    };

    await transporter.sendMail(mailOptions);
};

// Auth Controllers
exports.register = async (req, res) => {
    const { username, email, password } = req.body;
    if (!username || !email || !password) {
        return res.status(400).json({ message: 'Por favor, preencha todos os campos.' });
    }
    try {
        const userExists = await User.findOne({ $or: [{ email }, { username }] });
        if (userExists) {
            return res.status(400).json({ message: 'Email ou nome de usuário já existe.' });
        }
        const userId = await generateUserId(User);
        const user = await User.create({ userId, username, email, password });
        res.status(201).json({
            _id: user._id,
            userId: user.userId,
            username: user.username,
            email: user.email,
            token: generateToken(user._id),
        });
    } catch (error) {
        res.status(500).json({ message: 'Erro no servidor. Tente novamente.', error: error.message });
    }
};

exports.login = async (req, res) => {
    const { email, password } = req.body;
    try {
        const user = await User.findOne({ email }).select('+password');
        if (!user) {
            return res.status(401).json({ message: 'Credenciais inválidas.' });
        }
        if (user.isBlocked) {
            return res.status(403).json({ message: 'Esta conta está bloqueada.' });
        }
        const isMatch = await user.comparePassword(password);
        if (!isMatch) {
            return res.status(401).json({ message: 'Credenciais inválidas.' });
        }
        user.isOnline = true;
        await user.save();
        const userResponse = await User.findById(user._id);
        res.status(200).json({
            user: userResponse,
            token: generateToken(user._id),
        });
    } catch (error) {
        res.status(500).json({ message: 'Erro no servidor.', error: error.message });
    }
};

exports.forgotPassword = async (req, res) => {
    const { email } = req.body;
    try {
        const user = await User.findOne({ email });
        if (user) {
            const { resetToken, passwordResetToken, passwordResetExpires } = generatePasswordResetToken();
            user.passwordResetToken = passwordResetToken;
            user.passwordResetExpires = passwordResetExpires;
            await user.save();
            await sendPasswordResetEmail(user, resetToken);
        }
        res.status(200).json({ message: 'Se o email estiver registado, um código de recuperação foi enviado.' });
    } catch (error) {
        res.status(500).json({ message: 'Erro ao enviar o email.', error: error.message });
    }
};

exports.resetPassword = async (req, res) => {
    const { token } = req.params;
    const { password } = req.body;
    const crypto = require('crypto');
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    try {
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

        res.status(200).json({ message: 'Senha redefinida com sucesso.' });
    } catch (error) {
        res.status(500).json({ message: 'Erro ao redefinir a senha.', error: error.message });
    }
};

// User Controllers
exports.getProfile = async (req, res) => {
    res.status(200).json(req.user);
};

exports.updateProfile = async (req, res) => {
    const { username, bio } = req.body;
    try {
        const user = await User.findById(req.user._id);

        if (username && username !== user.username) {
            const existingUser = await User.findOne({ username });
            if (existingUser) {
                return res.status(400).json({ message: 'Nome de usuário já em uso.' });
            }
            user.username = username;
        }

        if (bio) {
            user.bio = bio;
        }

        if (req.file) {
            if (user.avatar && user.avatar.public_id && user.avatar.public_id !== 'default') {
                await cloudinary.uploader.destroy(user.avatar.public_id);
            }
            const result = await cloudinary.uploader.upload(req.file.path);
            user.avatar = {
                url: result.secure_url,
                public_id: result.public_id,
            };
        }

        const updatedUser = await user.save();
        res.status(200).json(updatedUser);
    } catch (error) {
        res.status(500).json({ message: 'Erro ao atualizar o perfil.', error: error.message });
    }
};

exports.updatePassword = async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    try {
        const user = await User.findById(req.user._id).select('+password');
        const isMatch = await user.comparePassword(currentPassword);
        if (!isMatch) {
            return res.status(401).json({ message: 'Senha atual incorreta.' });
        }
        user.password = newPassword;
        await user.save();
        res.status(200).json({ message: 'Senha alterada com sucesso.' });
    } catch (error) {
        res.status(500).json({ message: 'Erro ao alterar a senha.', error: error.message });
    }
};

exports.getUserPublicProfile = async (req, res) => {
    try {
        const user = await User.findOne({ userId: req.params.userId }).select('userId username avatar bio wins losses draws createdAt');
        if (!user) {
            return res.status(404).json({ message: 'Usuário não encontrado.' });
        }
        res.status(200).json(user);
    } catch (error) {
        res.status(500).json({ message: 'Erro no servidor.', error: error.message });
    }
};

exports.getWallet = async (req, res) => {
    try {
        const transactions = await Transaction.find({ user: req.user._id }).sort({ createdAt: -1 });
        res.status(200).json({
            balance: req.user.balance,
            history: transactions,
        });
    } catch (error) {
        res.status(500).json({ message: 'Erro ao buscar dados da carteira.', error: error.message });
    }
};

exports.requestDeposit = async (req, res) => {
    const { amount, method, proof } = req.body;
    const config = (await PlatformConfig.findOne({ configKey: 'main' })) || initialConfig;
    if (amount < config.minDepositAmount || amount > config.maxDepositAmount) {
        return res.status(400).json({ message: `O valor do depósito deve estar entre ${config.minDepositAmount} MT e ${config.maxDepositAmount} MT.` });
    }
    try {
        await Transaction.create({
            user: req.user._id,
            transactionId: generateTransactionId(),
            type: 'deposit',
            method,
            amount,
            proof,
            status: 'pending',
        });
        res.status(201).json({ message: 'Pedido de depósito enviado. Aguarde a aprovação.' });
    } catch (error) {
        res.status(500).json({ message: 'Erro ao processar pedido.', error: error.message });
    }
};

exports.requestWithdrawal = async (req, res) => {
    const { amount, method, proof } = req.body; // proof aqui seria o número de telefone do user
    const user = req.user;
    const config = (await PlatformConfig.findOne({ configKey: 'main' })) || initialConfig;

    if (amount > user.balance) {
        return res.status(400).json({ message: 'Saldo insuficiente.' });
    }
    if (amount < config.minWithdrawalAmount || amount > config.maxWithdrawalAmount) {
        return res.status(400).json({ message: `O valor do levantamento deve estar entre ${config.minWithdrawalAmount} MT e ${config.maxWithdrawalAmount} MT.` });
    }

    try {
        user.balance -= amount;
        await user.save();
        await Transaction.create({
            user: user._id,
            transactionId: generateTransactionId(),
            type: 'withdrawal',
            method,
            amount,
            proof, // salva o número de telefone do usuário para o admin ver
            status: 'pending',
        });
        res.status(201).json({ message: 'Pedido de levantamento enviado. Aguarde a aprovação.' });
    } catch (error) {
        // Rollback
        user.balance += amount;
        await user.save();
        res.status(500).json({ message: 'Erro ao processar pedido.', error: error.message });
    }
};

// Game Controllers
exports.getGameLobbies = async (req, res) => {
    try {
        const lobbies = await Game.find({ status: 'waiting' })
            .populate('players', 'username avatar userId')
            .sort({ createdAt: -1 });
        res.status(200).json(lobbies);
    } catch (error) {
        res.status(500).json({ message: 'Erro ao buscar lobbies.', error: error.message });
    }
};

exports.getMatchHistory = async (req, res) => {
    try {
        const history = await Game.find({ players: req.user._id })
            .populate('players', 'username avatar userId')
            .populate('winner', 'username')
            .sort({ createdAt: -1 });
        res.status(200).json(history);
    } catch (error) {
        res.status(500).json({ message: 'Erro ao buscar histórico.', error: error.message });
    }
};

exports.getUnfinishedGame = async(req, res) => {
    try {
        if (!req.user.currentGameId) {
            return res.status(200).json({ game: null });
        }
        const game = await Game.findOne({ _id: req.user.currentGameId, status: { $in: ['active', 'incomplete'] }})
            .populate('players', 'username avatar userId balance');
            
        if (!game) {
            const user = await User.findById(req.user._id);
            user.currentGameId = null;
            await user.save();
            return res.status(200).json({ game: null });
        }
        
        res.status(200).json({ game });

    } catch(error) {
        res.status(500).json({ message: 'Erro ao buscar partida pendente.', error: error.message });
    }
}

// Public Platform Controllers
exports.getPublicPlatformConfig = async (req, res) => {
    try {
        let config = await PlatformConfig.findOne({ configKey: 'main' }).select('paymentMethods helpContent');
        if (!config) {
            config = {
                paymentMethods: initialConfig.paymentMethods,
                helpContent: initialConfig.defaultHelpContent
            };
        }
        res.status(200).json(config);
    } catch (error) {
        res.status(500).json({ message: 'Erro no servidor.', error: error.message });
    }
};

exports.getRanking = async (req, res) => {
    try {
        const users = await User.find({ role: 'user' })
            .sort({ wins: -1, losses: 1 })
            .limit(100)
            .select('userId username avatar wins losses draws');
        res.status(200).json(users);
    } catch (error) {
        res.status(500).json({ message: 'Erro ao buscar ranking.', error: error.message });
    }
};

// Admin Controllers
exports.adminGetAllUsers = async (req, res) => {
    try {
        const users = await User.find({}).sort({ createdAt: -1 });
        res.status(200).json(users);
    } catch (error) {
        res.status(500).json({ message: 'Erro no servidor.', error: error.message });
    }
};

exports.adminUpdateUserStatus = async (req, res) => {
    const { userId } = req.params;
    const { isBlocked } = req.body;
    try {
        const user = await User.findOneAndUpdate({ userId }, { isBlocked }, { new: true });
        res.status(200).json(user);
    } catch (error) {
        res.status(500).json({ message: 'Erro no servidor.', error: error.message });
    }
};

exports.adminAdjustUserBalance = async (req, res) => {
    const { userId } = req.params;
    const { amount } = req.body;
    try {
        const user = await User.findOneAndUpdate({ userId }, { $inc: { balance: amount } }, { new: true });
        res.status(200).json(user);
    } catch (error) {
        res.status(500).json({ message: 'Erro no servidor.', error: error.message });
    }
};

exports.adminGetTransactions = async (req, res) => {
    try {
        const transactions = await Transaction.find({}).populate('user', 'username userId').sort({ createdAt: -1 });
        res.status(200).json(transactions);
    } catch (error) {
        res.status(500).json({ message: 'Erro no servidor.', error: error.message });
    }
};

exports.adminProcessTransaction = async (req, res) => {
    const { transactionId } = req.params;
    const { status, adminNotes } = req.body; // 'approved' ou 'rejected'
    try {
        const transaction = await Transaction.findOne({ transactionId });
        if (!transaction || transaction.status !== 'pending') {
            return res.status(400).json({ message: 'Transação não encontrada ou já processada.' });
        }

        const user = await User.findById(transaction.user);

        if (status === 'approved') {
            if (transaction.type === 'deposit') {
                user.balance += transaction.amount;
            }
            // para 'withdrawal' o saldo já foi debitado
        } else if (status === 'rejected') {
            if (transaction.type === 'withdrawal') {
                user.balance += transaction.amount; // devolve o saldo
            }
        } else {
             return res.status(400).json({ message: 'Status inválido.' });
        }

        transaction.status = status;
        transaction.adminNotes = adminNotes;

        await user.save();
        await transaction.save();

        res.status(200).json(transaction);
    } catch (error) {
        res.status(500).json({ message: 'Erro no servidor.', error: error.message });
    }
};

exports.adminGetPlatformStats = async (req, res) => {
    try {
        const totalDeposited = await Transaction.aggregate([
            { $match: { type: 'deposit', status: 'approved' } },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]);

        const totalWithdrawn = await Transaction.aggregate([
            { $match: { type: 'withdrawal', status: 'approved' } },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]);

        const totalInBets = await Game.aggregate([
            { $match: { status: 'active' } },
            { $group: { _id: null, total: { $sum: { $multiply: ['$betAmount', 2] } } } }
        ]);
        
        const config = (await PlatformConfig.findOne({ configKey: 'main' })) || initialConfig;
        const totalEarned = await Game.aggregate([
             { $match: { status: 'finished', winner: { $ne: null } } },
             { $group: { _id: null, total: { $sum: { $multiply: ['$betAmount', 2 * config.commissionRate] } } } }
        ]);

        res.status(200).json({
            totalDeposited: totalDeposited[0]?.total || 0,
            totalWithdrawn: totalWithdrawn[0]?.total || 0,
            totalInActiveBets: totalInBets[0]?.total || 0,
            platformEarnings: totalEarned[0]?.total || 0,
        });
    } catch (error) {
        res.status(500).json({ message: 'Erro no servidor.', error: error.message });
    }
};

exports.adminGetPlatformConfig = async (req, res) => {
    try {
        let config = await PlatformConfig.findOne({ configKey: 'main' });
        if (!config) {
            config = await PlatformConfig.create(initialConfig);
        }
        res.status(200).json(config);
    } catch (error) {
        res.status(500).json({ message: 'Erro no servidor.', error: error.message });
    }
};

exports.adminUpdatePlatformConfig = async (req, res) => {
    try {
        const updatedConfig = await PlatformConfig.findOneAndUpdate(
            { configKey: 'main' },
            req.body,
            { new: true, upsert: true }
        );
        res.status(200).json(updatedConfig);
    } catch (error) {
        res.status(500).json({ message: 'Erro no servidor.', error: error.message });
    }
};