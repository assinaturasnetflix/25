const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { generateNumericId } = require('./utils');
const config = require('./config');

const userSchema = new mongoose.Schema({
    userId: {
        type: String,
        unique: true,
        required: true,
        default: () => generateNumericId(config.ids.user.length)
    },
    name: {
        type: String,
        required: [true, 'Por favor, insira um nome'],
    },
    email: {
        type: String,
        required: [true, 'Por favor, insira um email'],
        unique: true,
        match: [
            /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/,
            'Por favor, insira um email válido',
        ],
    },
    password: {
        type: String,
        required: [true, 'Por favor, insira uma senha'],
        minlength: 6,
        select: false,
    },
    avatar: {
        public_id: {
            type: String,
            default: null,
        },
        url: {
            type: String,
            default: null,
        },
    },
    bio: {
        type: String,
        maxlength: 200,
        default: config.defaults.user.bio,
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
    isBlocked: {
        type: Boolean,
        default: false,
    },
    stats: {
        wins: { type: Number, default: 0 },
        losses: { type: Number, default: 0 },
        draws: { type: Number, default: 0 },
    },
    passwordResetCode: String,
    passwordResetExpires: Date,
}, {
    timestamps: true,
});

userSchema.pre('save', async function (next) {
    if (!this.isModified('password')) {
        next();
    }
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
});

userSchema.methods.matchPassword = async function (enteredPassword) {
    return await bcrypt.compare(enteredPassword, this.password);
};

const transactionSchema = new mongoose.Schema({
    transactionId: {
        type: String,
        unique: true,
        required: true,
        default: () => `txn_${generateNumericId(config.ids.transaction.length)}`
    },
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    type: {
        type: String,
        enum: ['deposit', 'withdrawal', 'bet', 'win', 'refund', 'commission', 'admin_credit', 'admin_debit'],
        required: true,
    },
    method: {
        type: String,
        enum: ['M-Pesa', 'e-Mola', 'platform', null],
        default: null,
    },
    amount: {
        type: Number,
        required: true,
    },
    status: {
        type: String,
        enum: ['pending', 'approved', 'rejected', 'completed'],
        required: true,
    },
    proof: {
        type: {
            type: String,
            enum: ['text', 'image', 'none'],
            default: 'none',
        },
        content: {
            type: String,
            default: '',
        },
    },
    adminNotes: {
        type: String,
        default: '',
    },
    relatedGame: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Game',
        default: null
    },
}, {
    timestamps: true
});

const gameSchema = new mongoose.Schema({
    players: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    }],
    boardState: {
        type: String,
        required: true,
    },
    currentPlayer: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    status: {
        type: String,
        enum: ['waiting_for_opponent', 'in_progress', 'completed', 'cancelled', 'pending_rematch'],
        default: 'waiting_for_opponent',
    },
    winner: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null,
    },
    betAmount: {
        type: Number,
        required: true,
    },
    isPrivate: {
        type: Boolean,
        default: false,
    },
    privateCode: {
        type: String,
        unique: true,
        sparse: true,
    },
    timeLimit: {
        type: String,
        default: 'unlimited', // e.g., "15_minutes", "1_hour"
    },
    moveHistory: [{
        player: mongoose.Schema.Types.ObjectId,
        from: String,
        to: String,
        isCapture: Boolean,
        timestamp: { type: Date, default: Date.now },
    }],
    lobbyDescription: {
        type: String,
        maxlength: 100,
        default: '',
    }
}, {
    timestamps: true
});

const User = mongoose.model('User', userSchema);
const Transaction = mongoose.model('Transaction', transactionSchema);
const Game = mongoose.model('Game', gameSchema);

module.exports = { User, Transaction, Game };