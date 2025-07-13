const crypto = require('crypto');

const generateRandomCode = (length) => {
    return crypto.randomBytes(Math.ceil(length / 2))
        .toString('hex')
        .slice(0, length)
        .toUpperCase();
};

const generateNumericId = (length) => {
    let result = '';
    const characters = '0123456789';
    const charactersLength = characters.length;
    for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result;
};

const generateTransactionId = (length) => {
    const timestamp = Date.now().toString(36);
    const randomPart = Math.random().toString(36).substring(2, length - timestamp.length + 2);
    return (timestamp + randomPart).toUpperCase();
};

const formatDate = (date) => {
    if (!date) return 'N/A';
    return new Date(date).toLocaleDateString('pt-MZ', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
};

const calculateCommission = (amount, rate) => {
    return amount * rate;
};

const getWinnerPayout = (amount, rate) => {
    const commission = calculateCommission(amount, rate);
    return amount - commission;
}

module.exports = {
    generateRandomCode,
    generateNumericId,
    generateTransactionId,
    formatDate,
    calculateCommission,
    getWinnerPayout
};