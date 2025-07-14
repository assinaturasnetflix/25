const generateNumericId = (length) => {
    let result = '';
    const characters = '0123456789';
    const charactersLength = characters.length;
    for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result;
};

const generateTransactionId = () => {
    const timestamp = Date.now();
    const randomPart = generateNumericId(6);
    return `TRN-${timestamp}-${randomPart}`;
};

const validateEmail = (email) => {
    const re = /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
    return re.test(String(email).toLowerCase());
};

const calculateCommission = (amount, rate) => {
    const commission = amount * rate;
    return {
        commission,
        netAmount: amount - commission
    };
};

module.exports = {
    generateNumericId,
    generateTransactionId,
    validateEmail,
    calculateCommission,
};