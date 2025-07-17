const config = {
    platformCommission: 0.15,
    minDeposit: 50.00,
    maxDeposit: 10000.00,
    minWithdrawal: 50.00,
    maxWithdrawal: 10000.00,
    maxBet: 5000.00,
    minBet: 50.00,
    passwordResetTokenExpiresIn: 15, // in minutes
    platformName: "BrainSkill",
    colors: {
        primary: '#000000',
        secondary: '#FFFFFF',
        accent: '#333333'
    },
    font: 'Oswald',
    defaultAvatarIcon: 'user', 
    gameRules: {
        boardSize: 8,
        piecesPerPlayer: 12,
    },
    paymentMethods: [
        {
            name: "M-Pesa",
            instructions: "Envie o valor para o número 84XXXXXXX e insira o ID da transação.",
            accountNumber: "84XXXXXXX",
            accountName: "Nome do Titular M-Pesa"
        },
        {
            name: "e-Mola",
            instructions: "Envie o valor para o número 86XXXXXXX e insira o ID da transação.",
            accountNumber: "86XXXXXXX",
            accountName: "Nome do Titular e-Mola"
        }
    ]
};

module.exports = config;