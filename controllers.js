const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cloudinary = require('cloudinary').v2;
const nodemailer = require('nodemailer');
const { User, Transaction, Game, LobbyBet, PlatformConfig } = require('./models');
const config = require('./config');
const { generateRandomCode } = require('./utils');

cloudinary.config(config.CLOUDINARY_CONFIG);

const transporter = nodemailer.createTransport(config.NODEMAILER_CONFIG);

const sendPasswordResetEmail = async (user, code) => {
    const mailOptions = {
        from: `"${config.PLATFORM_NAME}" <${config.NODEMAILER_CONFIG.auth.user}>`,
        to: user.email,
        subject: 'Recuperação de Senha - BrainSkill',
        html: `
            <div style="font-family: 'Oswald', sans-serif; color: #333; line-height: 1.6;">
                <div style="max-width: 600px; margin: 20px auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px; background-color: #f9f9f9;">
                    <h2 style="color: #000000; text-align: center;">Recuperação de Senha</h2>
                    <p>Olá, ${user.username},</p>
                    <p>Recebemos uma solicitação para redefinir a senha da sua conta na plataforma <strong>${config.PLATFORM_NAME}</strong>.</p>
                    <p>Use o código abaixo para criar uma nova senha. Este código é válido por <strong>${config.PASSWORD_RESET.TOKEN_EXPIRATION_MINUTES} minutos</strong>.</p>
                    <div style="text-align: center; margin: 30px 0;">
                        <span style="display: inline-block; padding: 15px 25px; background-color: #000000; color: #FFFFFF; font-size: 24px; letter-spacing: 5px; border-radius: 5px;">
                            ${code}
                        </span>
                    </div>
                    <p>Se você não solicitou esta alteração, pode ignorar este e-mail com segurança.</p>
                    <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
                    <p style="font-size: 12px; color: #777; text-align: center;">© ${new Date().getFullYear()} ${config.PLATFORM_NAME}. Todos os direitos reservados.</p>
                </div>
            </div>
        `
    };
    await transporter.sendMail(mailOptions);
};

exports.register = async (req, res) => {
    try {
        const { username, email, password } = req.body;
        if (!username || !email || !password) {
            return res.status(400).json({ message: 'Todos os campos são obrigatórios.' });
        }
        let user = await User.findOne({ $or: [{ email }, { username }] });
        if (user) {
            return res.status(400).json({ message: 'Email ou nome de usuário já existe.' });
        }
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        user = new User({ username, email, password: hashedPassword });
        await user.save();
        res.status(201).json({ message: 'Usuário registrado com sucesso.' });
    } catch (error) {
        res.status(500).json({ message: 'Erro no servidor.', error: error.message });
    }
};

exports.login = async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(400).json({ message: 'Credenciais inválidas.' });
        }
        if (user.isBlocked) {
            return res.status(403).json({ message: 'Esta conta está bloqueada.' });
        }
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ message: 'Credenciais inválidas.' });
        }
        const payload = { user: { id: user.id, role: user.role } };
        const token = jwt.sign(payload, config.JWT.SECRET, { expiresIn: config.JWT.EXPIRES_IN });
        res.json({ token });
    } catch (error) {
        res.status(500).json({ message: 'Erro no servidor.', error: error.message });
    }
};

exports.forgotPassword = async (req, res) => {
    try {
        const { email } = req.body;
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(404).json({ message: 'Nenhum usuário encontrado com este email.' });
        }
        const resetCode = generateRandomCode(config.PASSWORD_RESET.CODE_LENGTH);
        user.resetPasswordToken = resetCode;
        user.resetPasswordExpires = Date.now() + config.PASSWORD_RESET.TOKEN_EXPIRATION_MINUTES * 60 * 1000;
        await user.save();
        await sendPasswordResetEmail(user, resetCode);
        res.json({ message: 'Email de recuperação enviado. Verifique sua caixa de entrada.' });
    } catch (error) {
        res.status(500).json({ message: 'Erro ao enviar o email.', error: error.message });
    }
};

exports.resetPassword = async (req, res) => {
    try {
        const { email, code, newPassword } = req.body;
        const user = await User.findOne({
            email,
            resetPasswordToken: code,
            resetPasswordExpires: { $gt: Date.now() },
        });
        if (!user) {
            return res.status(400).json({ message: 'Código inválido ou expirado.' });
        }
        const salt = await bcrypt.genSalt(10);
        user.password = await bcrypt.hash(newPassword, salt);
        user.resetPasswordToken = undefined;
        user.resetPasswordExpires = undefined;
        await user.save();
        res.json({ message: 'Senha redefinida com sucesso.' });
    } catch (error) {
        res.status(500).json({ message: 'Erro no servidor.', error: error.message });
    }
};

exports.getProfile = async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('-password -resetPasswordToken -resetPasswordExpires');
        res.json(user);
    } catch (error) {
        res.status(500).json({ message: 'Erro no servidor.', error: error.message });
    }
};

exports.updateProfile = async (req, res) => {
    try {
        const { username, bio } = req.body;
        const updateData = {};
        if (username) updateData.username = username;
        if (bio) updateData.bio = bio;

        if (username && username !== req.user.username) {
            const existingUser = await User.findOne({ username });
            if (existingUser) {
                return res.status(400).json({ message: 'Nome de usuário já em uso.' });
            }
        }
        
        const user = await User.findByIdAndUpdate(req.user.id, { $set: updateData }, { new: true }).select('-password');
        res.json(user);
    } catch (error) {
        res.status(500).json({ message: 'Erro no servidor.', error: error.message });
    }
};

exports.updateAvatar = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: 'Nenhum arquivo enviado.' });
        }
        const result = await cloudinary.uploader.upload(req.file.path, {
            folder: `brainskill/avatars`,
            public_id: req.user.id,
            overwrite: true,
            transformation: [{ width: 200, height: 200, crop: "fill", gravity: "face" }]
        });
        const user = await User.findByIdAndUpdate(req.user.id, { avatar: result.secure_url }, { new: true }).select('-password');
        res.json({ avatar: user.avatar });
    } catch (error) {
        res.status(500).json({ message: 'Erro ao fazer upload do avatar.', error: error.message });
    }
};

exports.changePassword = async (req, res) => {
    try {
        const { oldPassword, newPassword } = req.body;
        const user = await User.findById(req.user.id);
        const isMatch = await bcrypt.compare(oldPassword, user.password);
        if (!isMatch) {
            return res.status(400).json({ message: 'Senha antiga incorreta.' });
        }
        const salt = await bcrypt.genSalt(10);
        user.password = await bcrypt.hash(newPassword, salt);
        await user.save();
        res.json({ message: 'Senha alterada com sucesso.' });
    } catch (error) {
        res.status(500).json({ message: 'Erro no servidor.', error: error.message });
    }
};

exports.getPublicProfile = async (req, res) => {
    try {
        const user = await User.findOne({ userId: req.params.userId }).select('username userId avatar bio stats createdAt');
        if (!user) {
            return res.status(404).json({ message: 'Usuário não encontrado.' });
        }
        res.json(user);
    } catch (error) {
        res.status(500).json({ message: 'Erro no servidor.', error: error.message });
    }
};

exports.getRanking = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const skip = (page - 1) * limit;

        const users = await User.find()
            .select('username userId avatar stats')
            .sort({ 'stats.wins': -1, 'stats.losses': 1 })
            .skip(skip)
            .limit(limit);
        
        const totalUsers = await User.countDocuments();
        
        res.json({
            users,
            currentPage: page,
            totalPages: Math.ceil(totalUsers / limit)
        });
    } catch (error) {
        res.status(500).json({ message: 'Erro no servidor.', error: error.message });
    }
};

exports.requestDeposit = async (req, res) => {
    try {
        const { amount, method, proofText } = req.body;
        const platformConfig = await PlatformConfig.findOne({ key: 'main_config' });

        if (!amount || !method) {
            return res.status(400).json({ message: "Valor e método são obrigatórios." });
        }

        if (amount < platformConfig.limits.minDeposit || amount > platformConfig.limits.maxDeposit) {
            return res.status(400).json({ message: `O valor do depósito deve estar entre ${platformConfig.limits.minDeposit} MT e ${platformConfig.limits.maxDeposit} MT.` });
        }

        let proof = proofText;
        if (req.file) {
            const result = await cloudinary.uploader.upload(req.file.path, { folder: 'brainskill/proofs' });
            proof = result.secure_url;
        }

        if (!proof) {
            return res.status(400).json({ message: 'Comprovativo (texto ou imagem) é obrigatório.' });
        }

        const transaction = new Transaction({
            user: req.user.id,
            type: 'deposit',
            amount,
            method,
            proof,
        });
        await transaction.save();
        res.status(201).json({ message: 'Pedido de depósito enviado para aprovação.', transaction });
    } catch (error) {
        res.status(500).json({ message: 'Erro no servidor.', error: error.message });
    }
};

exports.requestWithdrawal = async (req, res) => {
    try {
        const { amount, method, accountNumber, accountName } = req.body;
        const user = await User.findById(req.user.id);
        const platformConfig = await PlatformConfig.findOne({ key: 'main_config' });

        if (amount > user.balance) {
            return res.status(400).json({ message: 'Saldo insuficiente.' });
        }
        
        if (amount < platformConfig.limits.minWithdrawal || amount > platformConfig.limits.maxWithdrawal) {
            return res.status(400).json({ message: `O valor do levantamento deve estar entre ${platformConfig.limits.minWithdrawal} MT e ${platformConfig.limits.maxWithdrawal} MT.` });
        }

        user.balance -= amount;
        await user.save();

        const proof = `Levantamento para: ${accountName} (${accountNumber})`;
        const transaction = new Transaction({
            user: req.user.id,
            type: 'withdrawal',
            amount,
            method,
            proof,
        });
        await transaction.save();
        res.status(201).json({ message: 'Pedido de levantamento enviado para aprovação.', transaction });
    } catch (error) {
        await User.findByIdAndUpdate(req.user.id, { $inc: { balance: parseFloat(req.body.amount) } });
        res.status(500).json({ message: 'Erro no servidor.', error: error.message });
    }
};

exports.getTransactionHistory = async (req, res) => {
    try {
        const transactions = await Transaction.find({ user: req.user.id }).sort({ createdAt: -1 });
        res.json(transactions);
    } catch (error) {
        res.status(500).json({ message: 'Erro no servidor.', error: error.message });
    }
};

exports.createLobbyBet = async (req, res) => {
    try {
        const { betAmount, description, timeLimit } = req.body;
        const user = await User.findById(req.user.id);
        const platformConfig = await PlatformConfig.findOne({ key: 'main_config' });

        if (betAmount > user.balance) {
            return res.status(400).json({ message: 'Saldo insuficiente para criar a aposta.' });
        }
        if (betAmount < platformConfig.limits.minBet || betAmount > platformConfig.limits.maxBet) {
            return res.status(400).json({ message: `O valor da aposta deve estar entre ${platformConfig.limits.minBet} MT e ${platformConfig.limits.maxBet} MT.` });
        }

        user.balance -= betAmount;
        await user.save();

        const lobbyBet = new LobbyBet({
            creator: user.id,
            betAmount,
            description,
            timeLimit
        });
        await lobbyBet.save();
        
        // This should be emitted via WebSocket to all clients in the lobby
        // For now, just confirming via HTTP
        res.status(201).json({ message: 'Aposta criada no lobby com sucesso.', lobbyBet });
    } catch (error) {
        await User.findByIdAndUpdate(req.user.id, { $inc: { balance: parseFloat(req.body.betAmount) } });
        res.status(500).json({ message: 'Erro ao criar aposta.', error: error.message });
    }
};

exports.getLobbyBets = async (req, res) => {
    try {
        const openBets = await LobbyBet.find({ status: 'open' }).populate('creator', 'username avatar').sort({ createdAt: -1 });
        res.json(openBets);
    } catch (error) {
        res.status(500).json({ message: 'Erro ao buscar apostas.', error: error.message });
    }
};

exports.cancelLobbyBet = async (req, res) => {
    try {
        const { betId } = req.params;
        const bet = await LobbyBet.findById(betId);

        if (!bet) {
            return res.status(404).json({ message: 'Aposta não encontrada.' });
        }
        if (bet.creator.toString() !== req.user.id) {
            return res.status(403).json({ message: 'Não autorizado a cancelar esta aposta.' });
        }
        if (bet.status !== 'open') {
            return res.status(400).json({ message: 'Aposta não pode mais ser cancelada.' });
        }

        bet.status = 'cancelled';
        await bet.save();

        await User.findByIdAndUpdate(bet.creator, { $inc: { balance: bet.betAmount } });

        res.json({ message: 'Aposta cancelada com sucesso.' });
    } catch (error) {
        res.status(500).json({ message: 'Erro ao cancelar aposta.', error: error.message });
    }
};


exports.getGameHistory = async (req, res) => {
    try {
        const games = await Game.find({ players: req.user.id })
            .populate('players', 'username avatar')
            .populate('winner', 'username')
            .sort({ createdAt: -1 });
        res.json(games);
    } catch (error) {
        res.status(500).json({ message: 'Erro ao buscar histórico de partidas.', error: error.message });
    }
};

exports.getActiveGame = async (req, res) => {
    try {
        const activeGame = await Game.findOne({
            players: req.user.id,
            status: 'in_progress'
        }).populate('players', 'username avatar');

        if (!activeGame) {
            return res.status(200).json(null);
        }
        res.json(activeGame);
    } catch (error) {
        res.status(500).json({ message: 'Erro ao buscar partida ativa.', error: error.message });
    }
};

// ADMIN CONTROLLERS
exports.getAllUsers = async (req, res) => {
    try {
        const users = await User.find().select('-password');
        res.json(users);
    } catch (error) {
        res.status(500).json({ message: 'Erro no servidor.', error: error.message });
    }
};

exports.toggleUserBlock = async (req, res) => {
    try {
        const { userId } = req.params;
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ message: 'Usuário não encontrado.' });
        }
        user.isBlocked = !user.isBlocked;
        await user.save();
        res.json({ message: `Usuário ${user.isBlocked ? 'bloqueado' : 'desbloqueado'} com sucesso.` });
    } catch (error) {
        res.status(500).json({ message: 'Erro no servidor.', error: error.message });
    }
};

exports.getPendingTransactions = async (req, res) => {
    try {
        const transactions = await Transaction.find({ status: 'pending' }).populate('user', 'username email');
        res.json(transactions);
    } catch (error) {
        res.status(500).json({ message: 'Erro no servidor.', error: error.message });
    }
};

exports.processTransaction = async (req, res) => {
    try {
        const { transactionId } = req.params;
        const { status, adminNotes } = req.body; // status: 'approved' or 'rejected'
        const transaction = await Transaction.findById(transactionId);
        if (!transaction || transaction.status !== 'pending') {
            return res.status(400).json({ message: 'Transação não encontrada ou já processada.' });
        }
        
        transaction.status = status;
        transaction.adminNotes = adminNotes || '';

        if (status === 'approved') {
            if (transaction.type === 'deposit') {
                await User.findByIdAndUpdate(transaction.user, { $inc: { balance: transaction.amount } });
            }
        } else if (status === 'rejected') {
            if (transaction.type === 'withdrawal') {
                await User.findByIdAndUpdate(transaction.user, { $inc: { balance: transaction.amount } });
            }
        }
        
        await transaction.save();
        res.json({ message: 'Transação processada com sucesso.', transaction });
    } catch (error) {
        res.status(500).json({ message: 'Erro no servidor.', error: error.message });
    }
};

exports.manualBalanceUpdate = async (req, res) => {
    try {
        const { userId } = req.params;
        const { amount, reason } = req.body;
        if (!amount || !reason) {
            return res.status(400).json({ message: 'Valor e motivo são obrigatórios.' });
        }

        const user = await User.findByIdAndUpdate(userId, { $inc: { balance: amount } }, { new: true });
        if (!user) {
            return res.status(404).json({ message: 'Usuário não encontrado.' });
        }

        res.json({ message: `Saldo de ${user.username} atualizado.`, newBalance: user.balance });
    } catch (error) {
        res.status(500).json({ message: 'Erro no servidor.', error: error.message });
    }
};

exports.getPlatformStats = async (req, res) => {
    try {
        const totalDeposited = await Transaction.aggregate([
            { $match: { type: 'deposit', status: 'approved' } },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]);

        const totalWithdrawn = await Transaction.aggregate([
            { $match: { type: 'withdrawal', status: 'approved' } },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]);

        const totalCommission = await Game.aggregate([
            { $match: { status: 'completed', commission: { $gt: 0 } } },
            { $group: { _id: null, total: { $sum: '$commission' } } }
        ]);
        
        const totalUsers = await User.countDocuments();
        const totalGames = await Game.countDocuments({ status: 'completed' });

        res.json({
            totalDeposited: totalDeposited.length > 0 ? totalDeposited[0].total : 0,
            totalWithdrawn: totalWithdrawn.length > 0 ? totalWithdrawn[0].total : 0,
            totalCommission: totalCommission.length > 0 ? totalCommission[0].total : 0,
            totalUsers,
            totalGames
        });
    } catch (error) {
        res.status(500).json({ message: 'Erro no servidor.', error: error.message });
    }
};

exports.getPlatformConfig = async (req, res) => {
    try {
        let platformConfig = await PlatformConfig.findOne({ key: 'main_config' });
        if (!platformConfig) {
            platformConfig = new PlatformConfig();
            await platformConfig.save();
        }
        res.json(platformConfig);
    } catch (error) {
        res.status(500).json({ message: 'Erro no servidor.', error: error.message });
    }
};

exports.updatePlatformConfig = async (req, res) => {
    try {
        const updateData = req.body;
        const config = await PlatformConfig.findOneAndUpdate({ key: 'main_config' }, { $set: updateData }, { new: true, upsert: true });
        res.json({ message: 'Configurações atualizadas com sucesso.', config });
    } catch (error) {
        res.status(500).json({ message: 'Erro no servidor.', error: error.message });
    }
};