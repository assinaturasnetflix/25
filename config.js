const config = {
    platformName: "BrainSkill",
    commissionRate: 0.15,
    passwordReset: {
        tokenLife: 15 * 60 * 1000,
        codeLength: 6,
    },
    limits: {
        minDeposit: 50,
        maxDeposit: 50000,
        minWithdrawal: 50,
        maxWithdrawal: 50000,
        minBet: 10,
        maxBet: 10000,
    },
    gameSettings: {
        versusScreenDuration: 5000,
        afkTimeout: 60000,
    },
    defaultAvatar: 'PH9zdmcgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIiB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSJibGFjayIgc3Ryb2tlLXdpZHRoPSIyIiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiIGNsYXNzPSJmZWF0aGVyIGZlYXRoZXItdXNlciI+PHBhdGggZD0iTTIwIDIxdi0yYTQgNCAwIDAgMC00LTRIOGE0IDQgMCAwIDAtNCA0djIiPjwvcGF0aD48Y2lyY2xlIGN4PSIxMiIgY3k9IjciIHI9IjQiPjwvY2lyY2xlPjwvc3ZnPg==', // Base64 de um SVG de ícone de usuário
    platformColors: {
        dark: '#1a1a1a',
        light: '#ffffff',
        accent: '#000000',
    },
    font: 'Oswald, sans-serif'
};

module.exports = config;