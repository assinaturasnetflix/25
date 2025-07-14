const { User, Transaction, Game } = require('./models');
const config = require('./config');
const { 
    generateToken, 
    sendPasswordResetEmail, 
    cloudinary, 
    ErrorHandler, 
    asyncHandler,
    generateNumericId
} = require('./utils');
const crypto = require('crypto');

// @desc    Registrar um novo utilizador
// @route   POST /api/users/register
// @access  Public
const registerUser = asyncHandler(async (req, res, next) => {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
        return next(new ErrorHandler('Por favor, preencha todos os campos', 400));
    }

    const userExists = await User.findOne({ email });
    if (userExists) {
        return next(new ErrorHandler('Utilizador já existe', 400));
    }

    const user = await User.create({ name, email, password });

    if (user) {
        const token = generateToken(user._id);
        res.status(201).json({
            _id: user._id,
            userId: user.userId,
            name: user.name,
            email: user.email,
            avatar: user.avatar,
            bio: user.bio,
            balance: user.balance,
            token,
        });
    } else {
        return next(new ErrorHandler('Dados de utilizador inválidos', 400));
    }
});

// @desc    Autenticar utilizador e obter token
// @route   POST /api/users/login
// @access  Public
const loginUser = asyncHandler(async (req, res, next) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return next(new ErrorHandler('Por favor, forneça email e senha', 400));
    }
    const user = await User.findOne({ email }).select('+password');

    if (user && (await user.matchPassword(password))) {
        if(user.isBlocked) {
            return next(new ErrorHandler('Esta conta foi bloqueada.', 403));
        }
        const token = generateToken(user._id);
        res.json({
            _id: user._id,
            userId: user.userId,
            name: user.name,
            email: user.email,
            avatar: user.avatar,
            bio: user.bio,
            balance: user.balance,
            role: user.role,
            token,
        });
    } else {
        return next(new ErrorHandler('Email ou senha inválidos', 401));
    }
});

// @desc    Pedir recuperação de senha
// @route   POST /api/users/forgotpassword
// @access  Public
const forgotPassword = asyncHandler(async (req, res, next) => {
    const { email } = req.body;
    const user = await User.findOne({ email });

    if (!user) {
        return next(new ErrorHandler('Não existe utilizador com este email', 404));
    }
    
    const resetCode = generateNumericId(config.passwordReset.codeLength);
    user.passwordResetCode = resetCode;
    user.passwordResetExpires = Date.now() + 15 * 60 * 1000; // 15 minutos

    await user.save();

    try {
        await sendPasswordResetEmail(user.email, resetCode);
        res.status(200).json({ success: true, message: 'Email com código de recuperação enviado' });
    } catch (err) {
        user.passwordResetCode = undefined;
        user.passwordResetExpires = undefined;
        await user.save();
        return next(new ErrorHandler('O email não pôde ser enviado', 500));
    }
});

// @desc    Redefinir senha com código
// @route   PUT /api/users/resetpassword
// @access  Public
const resetPassword = asyncHandler(async (req, res, next) => {
    const { code, password } = req.body;
    
    const user = await User.findOne({
        passwordResetCode: code,
        passwordResetExpires: { $gt: Date.now() },
    });

    if (!user) {
        return next(new ErrorHandler('Código inválido ou expirado', 400));
    }

    user.password = password;
    user.passwordResetCode = undefined;
    user.passwordResetExpires = undefined;
    await user.save();

    res.status(200).json({ success: true, message: 'Senha redefinida com sucesso' });
});

// @desc    Obter perfil do utilizador
// @route   GET /api/users/profile
// @access  Private
const getUserProfile = asyncHandler(async (req, res) => {
    const user = await User.findById(req.user._id);
    res.json(user);
});

// @desc    Atualizar perfil do utilizador
// @route   PUT /api/users/profile
// @access  Private
const updateUserProfile = asyncHandler(async (req, res, next) => {
    const user = await User.findById(req.user._id);

    if (user) {
        user.name = req.body.name || user.name;
        user.bio = req.body.bio || user.bio;
        if(req.body.email && req.body.email !== user.email){
             const userExists = await User.findOne({ email: req.body.email });
             if (userExists) {
                return next(new ErrorHandler('Este email já está em uso', 400));
             }
             user.email = req.body.email;
        }

        if (req.body.password) {
            user.password = req.body.password;
        }

        if (req.file) {
             if(user.avatar && user.avatar.public_id){
                await cloudinary.uploader.destroy(user.avatar.public_id);
             }
             const result = await cloudinary.uploader.upload(req.file.path, {
                folder: 'brainskill_avatars',
                width: 200,
                crop: 'scale'
             });
             user.avatar = { public_id: result.public_id, url: result.secure_url };
        }

        const updatedUser = await user.save();
        res.json({
            _id: updatedUser._id,
            userId: updatedUser.userId,
            name: updatedUser.name,
            email: updatedUser.email,
            avatar: updatedUser.avatar,
            bio: updatedUser.bio,
            balance: updatedUser.balance,
            token: generateToken(updatedUser._id),
        });
    } else {
        return next(new ErrorHandler('Utilizador não encontrado', 404));
    }
});


// @desc    Fazer um pedido de depósito
// @route   POST /api/transactions/deposit
// @access  Private
const requestDeposit = asyncHandler(async (req, res, next) => {
    const { amount, method, proofText } = req.body;
    
    if (!amount || !method) {
        return next(new ErrorHandler('Faltam o valor e o método.', 400));
    }
    if (amount < config.limits.minDeposit) {
        return next(new ErrorHandler(`O depósito mínimo é de ${config.limits.minDeposit} MT.`, 400));
    }
    
    let proofData = { type: 'none', content: '' };

    if(req.file){
        const result = await cloudinary.uploader.upload(req.file.path, {
            folder: 'brainskill_proofs'
        });
        proofData = { type: 'image', content: result.secure_url };
    } else if (proofText) {
        proofData = { type: 'text', content: proofText };
    } else {
        return next(new ErrorHandler('É necessário um comprovativo (texto ou imagem).', 400));
    }

    await Transaction.create({
        user: req.user._id,
        type: 'deposit',
        amount: Number(amount),
        method,
        status: 'pending',
        proof: proofData
    });

    res.status(201).json({ success: true, message: 'Pedido de depósito enviado com sucesso. Aguarde a aprovação.' });
});

// @desc    Fazer um pedido de levantamento
// @route   POST /api/transactions/withdraw
// @access  Private
const requestWithdrawal = asyncHandler(async (req, res, next) => {
    const { amount, method, phone } = req.body;
    const user = await User.findById(req.user._id);

    if (amount > user.balance) {
        return next(new ErrorHandler('Saldo insuficiente.', 400));
    }
    if (amount < config.limits.minWithdrawal) {
        return next(new ErrorHandler(`O levantamento mínimo é de ${config.limits.minWithdrawal} MT.`, 400));
    }

    user.balance -= Number(amount);
    await user.save();
    
    await Transaction.create({
        user: req.user._id,
        type: 'withdrawal',
        amount: Number(amount),
        method,
        status: 'pending',
        proof: { type: 'text', content: `Nº Telemóvel: ${phone}` }
    });

    res.status(200).json({ success: true, message: 'Pedido de levantamento enviado. Será processado em breve.', newBalance: user.balance });
});


// @desc    Obter histórico de transações do utilizador
// @route   GET /api/transactions/history
// @access  Private
const getTransactionHistory = asyncHandler(async (req, res) => {
    const transactions = await Transaction.find({ user: req.user._id }).sort({ createdAt: -1 });
    res.json(transactions);
});

// @desc    Obter histórico de partidas do utilizador
// @route   GET /api/games/history
// @access  Private
const getGameHistory = asyncHandler(async (req, res) => {
    const games = await Game.find({ players: req.user._id })
        .populate('players', 'name avatar userId')
        .populate('winner', 'name userId')
        .sort({ createdAt: -1 });
    res.json(games);
});


// @desc    Obter ranking de jogadores
// @route   GET /api/users/ranking
// @access  Public
const getRanking = asyncHandler(async (req, res) => {
    const ranking = await User.find({ role: 'user' })
        .sort({ 'stats.wins': -1, 'stats.losses': 1 })
        .select('userId name avatar bio stats createdAt');
    res.json(ranking);
});

// @desc    Obter perfil público de um jogador
// @route   GET /api/users/public/:userId
// @access  Public
const getPublicProfile = asyncHandler(async (req, res, next) => {
    const user = await User.findOne({ userId: req.params.userId }).select('userId name avatar bio stats createdAt');
    if (!user) {
        return next(new ErrorHandler('Utilizador não encontrado', 404));
    }
    res.json(user);
});

// @desc    Obter configurações da plataforma
// @route   GET /api/platform/config
// @access  Public
const getPlatformConfig = (req, res) => {
    res.json({
        platformName: config.platformName,
        limits: config.limits,
        paymentMethods: config.paymentMethods
    });
}

// ------------------- ROTAS DE ADMIN ------------------- //

// @desc    Obter todos os utilizadores
// @route   GET /api/admin/users
// @access  Private/Admin
const getAllUsers = asyncHandler(async (req, res) => {
    const users = await User.find({}).sort({ createdAt: -1 });
    res.json(users);
});

// @desc    Bloquear/Desbloquear utilizador
// @route   PUT /api/admin/users/:id/block
// @access  Private/Admin
const toggleBlockUser = asyncHandler(async (req, res, next) => {
    const user = await User.findById(req.params.id);
    if (!user) {
        return next(new ErrorHandler('Utilizador não encontrado', 404));
    }
    user.isBlocked = !user.isBlocked;
    await user.save();
    res.json({ message: `Utilizador ${user.isBlocked ? 'bloqueado' : 'desbloqueado'} com sucesso.` });
});

// @desc    Ver transações pendentes
// @route   GET /api/admin/transactions/pending
// @access  Private/Admin
const getPendingTransactions = asyncHandler(async (req, res) => {
    const transactions = await Transaction.find({ status: 'pending' }).populate('user', 'name email userId').sort({ createdAt: 1 });
    res.json(transactions);
});

// @desc    Aprovar ou recusar transação
// @route   PUT /api/admin/transactions/:id/review
// @access  Private/Admin
const reviewTransaction = asyncHandler(async (req, res, next) => {
    const { status, adminNotes } = req.body; // status: 'approved' or 'rejected'
    const transaction = await Transaction.findById(req.params.id);

    if (!transaction || transaction.status !== 'pending') {
        return next(new ErrorHandler('Transação não encontrada ou já processada.', 404));
    }

    const user = await User.findById(transaction.user);
    if (!user) {
        return next(new ErrorHandler('Utilizador associado não encontrado.', 404));
    }

    if (status === 'approved') {
        if (transaction.type === 'deposit') {
            user.balance += transaction.amount;
        }
        // Para levantamento, o saldo já foi debitado no pedido.
        transaction.status = 'approved';
    } else if (status === 'rejected') {
        if (transaction.type === 'withdrawal') {
            // Devolver o saldo ao utilizador
            user.balance += transaction.amount;
        }
        transaction.status = 'rejected';
    } else {
        return next(new ErrorHandler('Status inválido.', 400));
    }
    
    transaction.adminNotes = adminNotes || '';
    
    await user.save();
    await transaction.save();

    res.json({ message: `Transação ${status} com sucesso.`, newBalance: user.balance });
});


// @desc    Ajustar saldo de um utilizador
// @route   PUT /api/admin/users/:id/balance
// @access  Private/Admin
const adjustUserBalance = asyncHandler(async (req, res, next) => {
    const { amount, reason } = req.body;
    const user = await User.findById(req.params.id);

    if (!user) return next(new ErrorHandler('Utilizador não encontrado.', 404));
    if(!amount || !reason) return next(new ErrorHandler('Valor e motivo são obrigatórios.', 400));
    
    const numericAmount = Number(amount);
    user.balance += numericAmount;
    if (user.balance < 0) user.balance = 0;
    
    await Transaction.create({
        user: user._id,
        type: numericAmount > 0 ? 'admin_credit' : 'admin_debit',
        amount: Math.abs(numericAmount),
        status: 'completed',
        adminNotes: reason,
    });
    
    await user.save();
    res.json({ message: 'Saldo ajustado com sucesso.', newBalance: user.balance });
});


// @desc    Obter estatísticas da plataforma
// @route   GET /api/admin/stats
// @access  Private/Admin
const getPlatformStats = asyncHandler(async (req, res) => {
    const totalDeposited = await Transaction.aggregate([
        { $match: { type: 'deposit', status: 'approved' } },
        { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    const totalWithdrawn = await Transaction.aggregate([
        { $match: { type: 'withdrawal', status: 'approved' } },
        { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    const totalCommission = await Transaction.aggregate([
        { $match: { type: 'commission', status: 'completed' } },
        { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    const totalUsers = await User.countDocuments({});
    const totalGames = await Game.countDocuments({ status: 'completed' });

    res.json({
        totalDeposited: totalDeposited.length > 0 ? totalDeposited[0].total : 0,
        totalWithdrawn: totalWithdrawn.length > 0 ? totalWithdrawn[0].total : 0,
        totalCommission: totalCommission.length > 0 ? totalCommission[0].total : 0,
        totalUsers,
        totalGames,
    });
});

module.exports = {
    registerUser,
    loginUser,
    forgotPassword,
    resetPassword,
    getUserProfile,
    updateUserProfile,
    requestDeposit,
    requestWithdrawal,
    getTransactionHistory,
    getGameHistory,
    getRanking,
    getPublicProfile,
    getPlatformConfig,
    getAllUsers,
    toggleBlockUser,
    getPendingTransactions,
    reviewTransaction,
    adjustUserBalance,
    getPlatformStats
};