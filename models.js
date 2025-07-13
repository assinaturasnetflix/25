const mongoose = require('mongoose');
const { generateNumericId, generateTransactionId } = require('./utils');
const config = require('./config');

const userSchema = new mongoose.Schema({
    userId: {
        type: String,
        unique: true,
        required: true,
        default: () => generateNumericId(config.ID_LENGTHS.USER)
    },
    username: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        minlength: 3,
        maxlength: 20
    },
    email: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        lowercase: true
    },
    password: {
        type: String,
        required: true
    },
    avatar: {
        type: String,
        default: config.DEFAULT_AVATAR_URL
    },
    bio: {
        type: String,
        maxlength: 200,
        default: ''
    },
    balance: {
        type: Number,
        default: 0.00
    },
    role: {
        type: String,
        enum: ['user', 'admin'],
        default: 'user'
    },
    isBlocked: {
        type: Boolean,
        default: false
    },
    stats: {
        wins: { type: Number, default: 0 },
        losses: { type: Number, default: 0 },
        draws: { type: Number, default: 0 }
    },
    resetPasswordToken: String,
    resetPasswordExpires: Date,
}, { timestamps: true });


const transactionSchema = new mongoose.Schema({
    transactionId: {
        type: String,
        unique: true,
        required: true,
        default: () => generateTransactionId(config.ID_LENGTHS.TRANSACTION)
    },
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    type: {
        type: String,
        enum: ['deposit', 'withdrawal'],
        required: true
    },
    method: {
        type: String,
        enum: ['M-Pesa', 'e-Mola'],
        required: true
    },
    amount: {
        type: Number,
        required: true
    },
    status: {
        type: String,
        enum: ['pending', 'approved', 'rejected'],
        default: 'pending'
    },
    proof: {
        type: String,
        required: true
    },
    adminNotes: {
        type: String,
        default: ''
    },
}, { timestamps: true });


const gameSchema = new mongoose.Schema({
    gameId: {
        type: String,
        unique: true,
        required: true,
    },
    players: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }],
    boardState: {
        type: String, 
        required: true
    },
    currentPlayerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    status: {
        type: String,
        enum: ['waiting_for_opponent', 'in_progress', 'completed', 'cancelled', 'abandoned'],
        default: 'waiting_for_opponent'
    },
    winner: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    betAmount: {
        type: Number,
        default: 0
    },
    commission: {
        type: Number,
        default: 0
    },
    moveHistory: [{
        from: String,
        to: String,
        piece: String,
        captured: [String],
        timestamp: { type: Date, default: Date.now }
    }],
    playerColors: {
        black: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        white: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
    },
}, { timestamps: true });


const lobbyBetSchema = new mongoose.Schema({
    creator: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    betAmount: {
        type: Number,
        required: true
    },
    description: {
        type: String,
        maxlength: 100,
        default: "Vamos jogar!"
    },
    timeLimit: { 
        type: Number,
        default: 0 
    },
    status: {
        type: String,
        enum: ['open', 'matched', 'cancelled'],
        default: 'open'
    },
    gameId: {
        type: String,
        default: null
    }
}, { timestamps: true });


const platformConfigSchema = new mongoose.Schema({
    key: {
        type: String,
        default: 'main_config',
        unique: true
    },
    commissionRate: {
        type: Number,
        default: config.COMMISSION_RATE
    },
    limits: {
        minDeposit: { type: Number, default: config.LIMITS.MIN_DEPOSIT },
        maxDeposit: { type: Number, default: config.LIMITS.MAX_DEPOSIT },
        minWithdrawal: { type: Number, default: config.LIMITS.MIN_WITHDRAWAL },
        maxWithdrawal: { type: Number, default: config.LIMITS.MAX_WITHDRAWAL },
        maxBet: { type: Number, default: config.LIMITS.MAX_BET },
        minBet: { type: Number, default: config.LIMITS.MIN_BET }
    },
    paymentMethods: [{
        name: String,
        accountName: String,
        accountNumber: String,
        instructions: String,
        isActive: { type: Boolean, default: true }
    }],
    platformTexts: {
        helpPage: { type: String, default: 'Bem-vindo à página de ajuda. Contacte o suporte para mais informações.' },
        rulesPage: { type: String, default: 'Regras padrão da Dama Brasileira aplicam-se.' }
    }
});


const User = mongoose.model('User', userSchema);
const Transaction = mongoose.model('Transaction', transactionSchema);
const Game = mongoose.model('Game', gameSchema);
const LobbyBet = mongoose.model('LobbyBet', lobbyBetSchema);
const PlatformConfig = mongoose.model('PlatformConfig', platformConfigSchema);

module.exports = {
    User,
    Transaction,
    Game,
    LobbyBet,
    PlatformConfig
};