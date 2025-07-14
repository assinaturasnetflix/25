const platformSettings = {
    defaultCommissionRate: 0.15, // 15%
    minDepositAmount: 50,
    maxDepositAmount: 10000,
    minWithdrawalAmount: 50,
    maxWithdrawalAmount: 10000,
    minBetAmount: 10,
    maxBetAmount: 5000,
    passwordResetTokenExpiresIn: 15, // in minutes
    gameInactiveCancelTime: 1, // in minutes
    defaultPlayerAvatar: 'user', // Nome do ícone da biblioteca (ex: Feather Icons)
    platformName: 'BrainSkill',
    defaultHelpContent: `
        <h2>Como Jogar</h2>
        <p>As regras seguem o padrão da Dama Brasileira. A captura é obrigatória.</p>
        <h2>Depósitos e Levantamentos</h2>
        <p>Use M-Pesa ou e-Mola. Os depósitos são manuais e precisam ser aprovados por um administrador após o envio do comprovativo.</p>
        <h2>Comissão</h2>
        <p>A plataforma cobra uma taxa de 15% sobre os ganhos de cada partida.</p>
    `,
    paymentMethods: [
        {
            name: "M-Pesa",
            number: "841234567",
            holder: "Nome do Titular M-Pesa",
            instructions: "Envie o valor exato para este número e submeta o ID da transação como comprovativo."
        },
        {
            name: "e-Mola",
            number: "861234567",
            holder: "Nome do Titular e-Mola",
            instructions: "Envie o valor exato para este número e submeta o ID da transação como comprovativo."
        }
    ]
};

module.exports = platformSettings;