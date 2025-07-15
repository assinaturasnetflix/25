const mongoose = require('mongoose');
const { generateNumericId } = require('./utils');
const config = require('./config');

const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true },
    avatar: {
        public_id: { type: String, default: 'default_avatar_id' },
        url: { type: String, default: 'icon' } 
    },
    bio: { type: String, maxlength: 150, default: '' },
    balance: { type: Number, default: 0 },
    stats: { wins: { type: Number, default: 0 }, losses: { type: Number, default: 0 } },
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    isBlocked: { type: Boolean, default: false },
    passwordResetToken: String,
    passwordResetExpires: Date,
}, { timestamps: true });

const transactionSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    transactionId: { type: String, unique: true, default: () => `T${generateNumericId(8)}` },
    type: { type: String, enum: ['deposit', 'withdrawal'], required: true },
    method: { type: String, enum: ['M-Pesa', 'e-Mola'], required: true },
    amount: { type: Number, required: true, min: config.minDeposit },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    proof: { type: String },
    holderName: { type: String },
    phoneNumber: { type: String },
    adminNotes: { type: String }
}, { timestamps: true });

const gameSchema = new mongoose.Schema({
    gameId: { type: String, unique: true, default: () => `G${generateNumericId(5)}` },
    players: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    boardState: { type: [[String]], required: true },
    currentPlayer: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    status: { type: String, enum: ['waiting', 'in_progress', 'completed', 'abandoned', 'cancelled'], default: 'waiting' },
    winner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    betAmount: { type: Number, required: true, min: config.minBet },
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
    hiddenBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }] // <- NOVO CAMPO ADICIONADO
}, { timestamps: true });

const User = mongoose.model('User', userSchema);
const Transaction = mongoose.model('Transaction', transactionSchema);
const Game = mongoose.model('Game', gameSchema);

module.exports = { User, Transaction, Game };