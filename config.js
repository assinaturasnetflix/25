const config = {
    appName: "BrainSkill",
    commissionRate: 0.15,
    minDeposit: 50,
    maxDeposit: 10000,
    minWithdrawal: 50,
    maxWithdrawal: 10000,
    maxBet: 5000,
    passwordResetCodeValidity: 15,
    defaultAvatar: "user",
    gameRules: {
        boardSize: 8,
        piecesPerPlayer: 12,
    },
    paymentMethods: [
        {
            name: "M-Pesa",
            instructions: "Envie o valor para o número 84XXXXXXX e insira o ID da transação.",
            number: "84XXXXXXX",
            holder: "Nome do Titular"
        },
        {
            name: "e-Mola",
            instructions: "Envie o valor para o número 86XXXXXXX e insira o ID da transação.",
            number: "86XXXXXXX",
            holder: "Nome do Titular"
        }
    ],
    platformTexts: {
        welcome: "Bem-vindo ao BrainSkill!",
        about: "Desafie jogadores de todo Moçambique em partidas emocionantes de damas e mostre sua habilidade.",
    },
    colors: {
        primary: "#000000",
        secondary: "#FFFFFF",
        accent: "#333333",
    },
    font: "Oswald"
};

module.exports = config;