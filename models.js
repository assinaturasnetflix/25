const mongoose = require('mongoose');
const config = require('./config');

const platformSettingsSchema = new mongoose.Schema({
    singleton: {
        type: Boolean,
        default: true,
        unique: true
    },
    commissionRate: {
        type: Number,
        default: config.general.platformCommissionRate
    },
    minDeposit: {
        type: Number,
        default: config.financial.minDeposit
    },
    maxDeposit: {
        type: Number,
        default: config.financial.maxDeposit
    },
    minWithdrawal: {
        type: Number,
        default: config.financial.minWithdrawal
    },
    maxWithdrawal: {
        type: Number,
        default: config.financial.maxWithdrawal
    },
    minBet: {
        type: Number,
        default: config.financial.minBet
    },
    maxBet: {
        type: Number,
        default: config.financial.maxBet
    },
    paymentDetails: {
        mpesa: {
            name: { type: String, default: config.texts.defaultPaymentDetails.mpesa.name },
            number: { type: String, default: config.texts.defaultPaymentDetails.mpesa.number },
            instructions: { type: String, default: config.texts.defaultPaymentDetails.mpesa.instructions }
        },
        emola: {
            name: { type: String, default: config.texts.defaultPaymentDetails.emola.name },
            number: { type: String, default: config.texts.defaultPaymentDetails.emola.number },
            instructions: { type: String, default: config.texts.defaultPaymentDetails.emola.instructions }
        }
    },
    helpContent: {
        type: String,
        default: config.general.defaultHelpContent
    },
    platformRules: {
        type: String,
        default: config.texts.defaultPlatformRules
    }
});

const userSchema = new mongoose.Schema({
    numericId: {
        type: String,
        required: true,
        unique: true,
    },
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
        trim: true,
        lowercase: true
    },
    password: {
        type: String,
        required: true
    },
    role: {
        type: String,
        enum: config.user.roles,
        default: config.user.defaultRole
    },
    avatar: {
        type: String,
        default: config.user.defaultAvatarUrl
    },
    bio: {
        type: String,
        default: config.user.defaultBio,
        maxlength: 250
    },
    balance: {
        type: Number,
        default: 0.00
    },
    isBlocked: {
        type: Boolean,
        default: false
    },
    stats: {
        wins: { type: Number, default: 0 },
        losses: { type: Number, default: 0 }
    },
    passwordResetCode: String,
    passwordResetExpires: Date,
}, { timestamps: true });

const matchSchema = new mongoose.Schema({
    matchId: {
        type: String,
        required: true,
        unique: true,
    },
    players: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }],
    boardState: {
        type: String,
        required: true
    },
    currentPlayer: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    status: {
        type: String,
        enum: ['waiting', 'in_progress', 'completed', 'cancelled'],
        default: 'waiting'
    },
    betAmount: {
        type: Number,
        required: true
    },
    winner: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    loser: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    timeLimit: {
        type: String,
        default: 'none'
    },
    lobbyInfo: {
        description: { type: String, default: '' },
        createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
    },
    isPrivate: {
        type: Boolean,
        default: false
    },
    privateCode: {
        type: String,
        default: null
    }
}, { timestamps: true });

const transactionSchema = new mongoose.Schema({
    transactionId: {
        type: String,
        required: true,
        unique: true,
    },
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    type: {
        type: String,
        enum: ['deposit', 'withdrawal', 'manual_adjustment'],
        required: true
    },
    amount: {
        type: Number,
        required: true
    },
    method: {
        type: String,
        enum: ['M-Pesa', 'e-Mola', 'Platform'],
        required: true
    },
    status: {
        type: String,
        enum: ['pending', 'approved', 'rejected'],
        default: 'pending'
    },
    proof: {
        type: String
    },
    adminNotes: {
        type: String
    },
    processedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    }
}, { timestamps: true });


const PlatformSettings = mongoose.model('PlatformSettings', platformSettingsSchema);
const User = mongoose.model('User', userSchema);
const Match = mongoose.model('Match', matchSchema);
const Transaction = mongoose.model('Transaction', transactionSchema);

module.exports = {
    PlatformSettings,
    User,
    Match,
    Transaction
};