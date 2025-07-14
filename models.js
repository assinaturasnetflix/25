const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const UserSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true, index: true },
    username: { type: String, required: true, unique: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true, select: false },
    balance: { type: Number, default: 0.00 },
    avatar: { 
        url: { type: String, default: 'default' },
        public_id: { type: String, default: 'default' }
    },
    bio: { type: String, default: '', maxLength: 150 },
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    wins: { type: Number, default: 0 },
    losses: { type: Number, default: 0 },
    draws: { type: Number, default: 0 },
    isBlocked: { type: Boolean, default: false },
    isOnline: { type: Boolean, default: false },
    currentGameId: { type: mongoose.Schema.Types.ObjectId, ref: 'Game', default: null },
    passwordResetToken: String,
    passwordResetExpires: Date,
}, { timestamps: true });

UserSchema.pre('save', async function(next) {
    if (!this.isModified('password')) {
        return next();
    }
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
});

UserSchema.methods.comparePassword = async function(candidatePassword) {
    return await bcrypt.compare(candidatePassword, this.password);
};

const GameSchema = new mongoose.Schema({
    players: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    readyPlayers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    boardState: { type: [[Number]], required: true },
    currentPlayer: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    // ATUALIZAÇÃO APLICADA AQUI
    status: { type: String, enum: ['waiting', 'readying', 'active', 'finished', 'cancelled', 'incomplete'], default: 'waiting' },
    betAmount: { type: Number, required: true },
    winner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    loser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    isDraw: { type: Boolean, default: false },
    description: { type: String, maxLength: 100 },
    timeLimit: { type: Number, default: null },
    inviteCode: { type: String, unique: true, sparse: true },
    moveHistory: { type: [Object], default: [] },
    finishedAt: { type: Date }
}, { timestamps: true });

const TransactionSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    transactionId: { type: String, required: true, unique: true },
    type: { type: String, enum: ['deposit', 'withdrawal'], required: true },
    method: { type: String, enum: ['M-Pesa', 'e-Mola'], required: true },
    amount: { type: Number, required: true },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    proof: { type: String, required: true },
    adminNotes: { type: String }
}, { timestamps: true });

const PlatformConfigSchema = new mongoose.Schema({
    configKey: { type: String, default: "main", unique: true },
    commissionRate: { type: Number, default: 0.15 },
    minDepositAmount: { type: Number, default: 50 },
    maxDepositAmount: { type: Number, default: 10000 },
    minWithdrawalAmount: { type: Number, default: 50 },
    maxWithdrawalAmount: { type: Number, default: 10000 },
    minBetAmount: { type: Number, default: 10 },
    maxBetAmount: { type: Number, default: 5000 },
    helpContent: { type: String },
    paymentMethods: [{
        name: String,
        number: String,
        holder: String,
        instructions: String
    }]
});

const User = mongoose.model('User', UserSchema);
const Game = mongoose.model('Game', GameSchema);
const Transaction = mongoose.model('Transaction', TransactionSchema);
const PlatformConfig = mongoose.model('PlatformConfig', PlatformConfigSchema);

module.exports = { User, Game, Transaction, PlatformConfig };