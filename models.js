const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const config = require('./config');

const UserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true },
    userId: { type: String, required: true, unique: true },
    avatar: { type: String, default: 'default_icon' },
    bio: { type: String, default: '', maxLength: 150 },
    balance: { type: Number, default: 0.00 },
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    wins: { type: Number, default: 0 },
    losses: { type: Number, default: 0 },
    isBlocked: { type: Boolean, default: false },
    passwordResetToken: { type: String },
    passwordResetExpires: { type: Date },
}, { timestamps: true });

UserSchema.pre('save', async function(next) {
    if (!this.isModified('password')) {
        return next();
    }
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
});

UserSchema.methods.matchPassword = async function(enteredPassword) {
    return await bcrypt.compare(enteredPassword, this.password);
};

const TransactionSchema = new mongoose.Schema({
    transactionId: { type: String, required: true, unique: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: ['deposit', 'withdrawal'], required: true },
    amount: { type: Number, required: true },
    method: { type: String, enum: ['M-Pesa', 'e-Mola'], required: true },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    proof: { type: String },
    adminNotes: { type: String },
    userPhone: { type: String },
}, { timestamps: true });

const GameSchema = new mongoose.Schema({
    gameId: { type: String, required: true, unique: true },
    players: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    playerUsernames: [String],
    playerAvatars: [String],
    boardState: { type: String, required: true },
    currentPlayerIndex: { type: Number, default: 0 },
    winner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    status: { type: String, enum: ['waiting', 'in_progress', 'completed', 'abandoned'], default: 'waiting' },
    betAmount: { type: Number, required: true },
    platformFee: { type: Number, default: 0 },
    moveHistory: { type: Array, default: [] },
    timeLimit: { type: String, default: 'unlimited' },
    lastMoveTimestamp: { type: Date, default: Date.now }
}, { timestamps: true });

const LobbyGameSchema = new mongoose.Schema({
    creator: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    betAmount: { type: Number, required: true },
    description: { type: String, default: config.texts.defaultLobbyMessage },
    timeLimit: { type: String, required: true },
    status: { type: String, enum: ['open', 'matched'], default: 'open' },
    gameId: { type: mongoose.Schema.Types.ObjectId, ref: 'Game', default: null },
}, { timestamps: true });

const PlatformSettingsSchema = new mongoose.Schema({
    singleton: { type: Boolean, default: true, unique: true },
    commissionRate: { type: Number, default: config.platform.defaultCommissionRate },
    minDeposit: { type: Number, default: config.wallet.minDeposit },
    maxDeposit: { type: Number, default: config.wallet.maxDeposit },
    minWithdrawal: { type: Number, default: config.wallet.minWithdrawal },
    maxWithdrawal: { type: Number, default: config.wallet.maxWithdrawal },
    minBet: { type: Number, default: config.game.bet.min },
    maxBet: { type: Number, default: config.game.bet.max },
    paymentMethods: [{
        name: String,
        number: String,
        holderName: String,
        instructions: String,
        type: { type: String, enum: ['M-Pesa', 'e-Mola'] }
    }],
    mainTexts: {
        helpPage: { type: String, default: config.texts.helpPageContent }
    }
});

const User = mongoose.model('User', UserSchema);
const Transaction = mongoose.model('Transaction', TransactionSchema);
const Game = mongoose.model('Game', GameSchema);
const LobbyGame = mongoose.model('LobbyGame', LobbyGameSchema);
const PlatformSettings = mongoose.model('PlatformSettings', PlatformSettingsSchema);

module.exports = { User, Transaction, Game, LobbyGame, PlatformSettings };