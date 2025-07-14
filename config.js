const config = {
    platformName: "BrainSkill",
    commission: {
        rate: 0.15, // 15%
    },
    limits: {
        minDeposit: 50,
        maxDeposit: 25000,
        minWithdrawal: 50,
        maxWithdrawal: 25000,
        minBet: 10,
        maxBet: 10000,
    },
    passwordReset: {
        tokenExpiresIn: '15m',
        codeLength: 6,
    },
    game: {
        versusScreenCountdown: 5, // segundos
        opponentWaitTimeout: 60, // segundos
        privateCodeLength: 6,
    },
    defaults: {
        user: {
            bio: "Novo jogador no BrainSkill!",
            avatarIcon: "user", // Nome do ícone da biblioteca Remix Icons ou Feather Icons
        },
    },
    ids: {
        user: {
            length: 5,
        },
        transaction: {
            length: 12,
        }
    },
    colors: {
        primary: "#000000",
        secondary: "#FFFFFF",
        accent: "#3a3a3a",
        emailBackground: "#f4f4f4",
        emailText: "#333333",
    },
    paymentMethods: [
        {
            name: "M-Pesa",
            instructions: "Envie o valor para o número X e cole a mensagem de confirmação."
        },
        {
            name: "e-Mola",
            instructions: "Envie o valor para o número Y e envie o screenshot."
        }
    ]
};

module.exports = config;