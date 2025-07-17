const mongoose = require('mongoose');
const { generateNumericId } = require('./utils');
const config = require('./config');

const settingSchema = new mongoose.Schema({
    singleton: { type: String, default: 'main_settings', unique: true },
    platformCommission: { type: Number, default: 0.15, min: 0, max: 1 },
    minDeposit: { type: Number, default: 50.00 },
    maxDeposit: { type: Number, default: 10000.00 },
    minWithdrawal: { type: Number, default: 50.00 },
    maxWithdrawal: { type: Number, default: 10000.00 },
    maxBet: { type: Number, default: 5000.00 },
    minBet: { type: Number, default: 10.00 },
    passwordResetTokenExpiresIn: { type: Number, default: 15 },
    platformName: { type: String, default: "BrainSkill" },
    isBonusEnabled: { type: Boolean, default: true },
    welcomeBonusAmount: { type: Number, default: 1000.00 },
    paymentMethods: [{
        name: { type: String, required: true },
        instructions: { type: String, required: true },
        accountNumber: { type: String, required: true },
        accountName: { type: String, required: true }
    }]
});

// --- ATUALIZAÇÃO APLICADA AQUI ---
const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true, trim: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    balance: { type: Number, default: 0 },
    bonusBalance: { type: Number, default: 0 },
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    isBlocked: { type: Boolean, default: false },
    avatar: { type: String, default: '' },
    passwordResetToken: String,
    passwordResetExpires: Date,
    // --- NOVOS CAMPOS ADICIONADOS ---
    bio: { type: String, maxlength: 150, default: '' },
    stats: {
        wins: { type: Number, default: 0 },
        losses: { type: Number, default: 0 },
    },
    activeBettingMode: { type: String, enum: ['real', 'bonus'], default: 'real' }
}, { timestamps: true });

const transactionSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: ['deposit', 'withdrawal', 'game_bet', 'game_win', 'commission', 'game_bet_refund'], required: true },
    amount: { type: Number, required: true },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    paymentMethod: { type: String },
    transactionId: { type: String },
    proofOfPayment: { type: String },
    recipientAccount: { type: String },
    recipientName: { type: String },
    game: { type: mongoose.Schema.Types.ObjectId, ref: 'Game' },
    relatedUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

const gameSchema = new mongoose.Schema({
    players: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    player1: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    player2: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    turn: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    boardState: { type: [[String]], required: true },
    status: { type: String, enum: ['pending', 'in_progress', 'completed', 'abandoned', 'cancelled'], default: 'pending' },
    winner: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    betAmount: { type: Number, required: true },
    commissionAmount: { type: Number, default: 0 },
    bettingMode: { type: String, enum: ['real', 'bonus'], required: true },
    isPrivate: { type: Boolean, default: false },
    gameCode: { type: String, unique: true, sparse: true },
    lobbyDescription: { type: String, maxlength: 100 },
    timeLimit: { type: Number, default: null },
    moveHistory: [{
        player: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        from: { r: Number, c: Number },
        to: { r: Number, c: Number },
        captured: [{ r: Number, c: Number }],
        timestamp: { type: Date, default: Date.now }
    }],
    ready: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    hiddenBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
}, { timestamps: true });


const Setting = mongoose.model('Setting', settingSchema);
const User = mongoose.model('User', userSchema);
const Transaction = mongoose.model('Transaction', transactionSchema);
const Game = mongoose.model('Game', gameSchema);


module.exports = {
    Setting,
    User,
    Transaction,
    Game
};