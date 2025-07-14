const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const config = require('./config');

const UserSchema = new mongoose.Schema({
    username: {
        type: String,
        required: true,
        unique: true,
        trim: true
    },
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true
    },
    password: {
        type: String,
        required: true
    },
    avatar: {
        type: String,
        default: config.defaultAvatar
    },
    bio: {
        type: String,
        maxlength: 250,
        default: ''
    },
    balance: {
        type: Number,
        default: 0,
        min: 0
    },
    role: {
        type: String,
        enum: ['user', 'admin'],
        default: 'user'
    },
    stats: {
        wins: {
            type: Number,
            default: 0
        },
        losses: {
            type: Number,
            default: 0
        },
    },
    passwordResetCode: String,
    passwordResetExpires: Date,
    isBlocked: {
        type: Boolean,
        default: false
    }
}, {
    timestamps: true
});

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

const TransactionSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    transactionId: {
        type: String,
        required: true,
        unique: true
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
        required: true,
        min: 0
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
    }
}, {
    timestamps: true
});

const GameSchema = new mongoose.Schema({
    gameId: {
        type: String,
        required: true,
        unique: true
    },
    players: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }],
    creator: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    boardState: {
        type: String,
        required: true
    },
    currentPlayerIndex: {
        type: Number,
        default: 0
    },
    status: {
        type: String,
        enum: ['waiting', 'in_progress', 'completed', 'abandoned'],
        default: 'waiting'
    },
    betAmount: {
        type: Number,
        required: true,
        min: 0
    },
    winner: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    isPrivate: {
        type: Boolean,
        default: false
    },
    lobbyDescription: {
        type: String,
        default: ''
    },
    gameTime: {
        type: String,
        default: 'sem tempo'
    },
    waitingForConfirmation: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }],
    moveHistory: [{
        type: String
    }]
}, {
    timestamps: true
});

const PlatformSettingsSchema = new mongoose.Schema({
    singleton: {
        type: Boolean,
        default: true,
        unique: true
    },
    commissionRate: {
        type: Number,
        default: config.commissionRate
    },
    minDeposit: {
        type: Number,
        default: config.minDeposit
    },
    maxDeposit: {
        type: Number,
        default: config.maxDeposit
    },
    minWithdrawal: {
        type: Number,
        default: config.minWithdrawal
    },
    maxWithdrawal: {
        type: Number,
        default: config.maxWithdrawal
    },
    maxBet: {
        type: Number,
        default: config.maxBet
    },
    paymentMethods: [{
        name: String,
        instructions: String,
        number: String,
        holder: String
    }],
    platformTexts: {
        welcome: String,
        about: String,
        rules: String
    }
});

const User = mongoose.model('User', UserSchema);
const Transaction = mongoose.model('Transaction', TransactionSchema);
const Game = mongoose.model('Game', GameSchema);
const PlatformSettings = mongoose.model('PlatformSettings', PlatformSettingsSchema);

module.exports = {
    User,
    Transaction,
    Game,
    PlatformSettings
};