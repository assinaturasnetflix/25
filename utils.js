const crypto = require('crypto');

const generateUserId = async (User) => {
    let userId;
    let userExists = true;
    while (userExists) {
        userId = Math.floor(10000 + Math.random() * 90000).toString();
        userExists = await User.findOne({ userId });
    }
    return userId;
};

const generateTransactionId = () => {
    const timestamp = Date.now().toString(36);
    const randomPart = Math.random().toString(36).substr(2, 9);
    return `BS-TRX-${timestamp}${randomPart}`.toUpperCase();
};

const generatePasswordResetToken = () => {
    const resetToken = crypto.randomBytes(32).toString('hex');
    const passwordResetToken = crypto
        .createHash('sha256')
        .update(resetToken)
        .digest('hex');
    const passwordResetExpires = Date.now() + 15 * 60 * 1000; // 15 minutos
    return { resetToken, passwordResetToken, passwordResetExpires };
};

const generateGameInviteCode = () => {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
};

module.exports = {
    generateUserId,
    generateTransactionId,
    generatePasswordResetToken,
    generateGameInviteCode
};