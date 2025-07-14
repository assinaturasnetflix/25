const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const config = require('./config');
const { generateUniqueId, generateTransactionId } = require('./utils');

const userSchema = new mongoose.Schema({
    userId: {
        type: Number,
        unique: true,
        required: true,
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
        lowercase: true,
    },
    password: {
        type: String,
        required: true,
        minlength: 6,
    },
    avatar: {
        type: String,
        default: `data:image/svg+xml;base64,${config.defaultAvatar}`
    },
    bio: {
        type: String,
        maxlength: 250,
        default: ""
    },
    balance: {
        type: Number,
        default: 0,
        min: 0,
    },
    role: {
        type: String,
        enum: ['user', 'admin'],
        default: 'user',
    },
    stats: {
        wins: { type: Number, default: 0 },
        losses: { type: Number, default: 0 },
    },
    status: {
        type: String,
        enum: ['active', 'blocked'],
        default: 'active',
    },
    passwordResetCode: String,
    passwordResetExpires: Date,
}, { timestamps: true });

userSchema.pre('save', async function(next) {
    if (!this.isModified('password')) return next();
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
});

userSchema.methods.comparePassword = async function(candidatePassword) {
    return await bcrypt.compare(candidatePassword, this.password);
};

const gameSchema = new mongoose.Schema({
    gameId: { type: String, unique: true },
    players: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }],
    boardState: { type: [[Number]], required: true },
    currentPlayer: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    status: {
        type: String,
        enum: ['waiting_for_opponent', 'in_progress', 'completed', 'abandoned', 'cancelled'],
        default: 'waiting_for_opponent',
    },
    winner: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    betAmount: { type: Number, required: true, min: 0 },
    isPrivate: { type: Boolean, default: false },
    privateCode: { type: String, unique: true, sparse: true },
    lobbyDescription: { type: String, maxlength: 100 },
    timeLimit: { type: String },
    moveHistory: [{ type: String }],
    lastMoveTime: { type: Date, default: Date.now }
}, { timestamps: true });

gameSchema.pre('save', function(next) {
    if (this.isNew) {
        this.gameId = generateUniqueId(8).toString();
    }
    next();
});

const transactionSchema = new mongoose.Schema({
    transactionId: {
        type: String,
        unique: true,
        required: true,
        default: () => generateTransactionId()
    },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
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
    amount: { type: Number, required: true },
    status: {
        type: String,
        enum: ['pending', 'approved', 'rejected'],
        default: 'pending'
    },
    proof: { type: String, required: true },
    adminNotes: { type: String },
    paymentInfo: {
        phoneNumber: String,
        fullName: String
    },
    processedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

const platformSettingsSchema = new mongoose.Schema({
    singleton: { type: Boolean, default: true, unique: true },
    commissionRate: { type: Number, default: 0.15 },
    limits: {
        minDeposit: { type: Number, default: 50 },
        maxDeposit: { type: Number, default: 50000 },
        minWithdrawal: { type: Number, default: 50 },
        maxWithdrawal: { type: Number, default: 50000 },
        minBet: { type: Number, default: 10 },
        maxBet: { type: Number, default: 10000 },
    },
    paymentMethods: [{
        name: String,
        number: String,
        holderName: String,
        instructions: String,
        isActive: { type: Boolean, default: true }
    }],
    platformTexts: {
        rules: String,
        help: String,
    }
});

const User = mongoose.model('User', userSchema);
const Game = mongoose.model('Game', gameSchema);
const Transaction = mongoose.model('Transaction', transactionSchema);
const PlatformSettings = mongoose.model('PlatformSettings', platformSettingsSchema);

module.exports = { User, Game, Transaction, PlatformSettings };