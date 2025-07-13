module.exports = {
    general: {
        platformName: 'BrainSkill',
        platformCommissionRate: 0.15,
        defaultHelpContent: `
            <h2>Bem-vindo à Ajuda do BrainSkill!</h2>
            <p>Aqui você encontra respostas para as dúvidas mais comuns.</p>
            
            <h4>Como funcionam os depósitos?</h4>
            <p>Vá para a sua carteira, clique em "Depositar", escolha o método (M-Pesa ou e-Mola), e siga as instruções. Envie o valor para o número indicado e depois submeta o comprovativo (ID da transação ou captura de ecrã) na nossa plataforma. Um administrador irá verificar e creditar o seu saldo.</p>

            <h4>Como funcionam os levantamentos?</h4>
            <p>Na sua carteira, clique em "Levantar", insira o valor desejado e o seu número de telefone. Um administrador irá processar o seu pedido e enviar o valor para a sua conta M-Pesa ou e-Mola.</p>

            <h4>O que acontece se a minha internet cair durante uma partida?</h4>
            <p>Não se preocupe! A partida fica salva. Assim que se reconectar, você será direcionado para continuar o jogo de onde parou. Pode encontrar a partida em andamento no seu "Histórico de Partidas".</p>

            <h4>Como funcionam as apostas no Lobby?</h4>
            <p>Você pode criar uma aposta pública definindo um valor. Outros jogadores verão a sua aposta no Lobby e poderão aceitá-la. Assim que alguém aceitar, a partida começa!</p>

            <h4>Qual é a comissão da plataforma?</h4>
            <p>A plataforma cobra uma comissão de 15% sobre o valor ganho em cada partida. Esta taxa ajuda a manter o serviço a funcionar.</p>

            <h4>Esqueci-me da minha senha, e agora?</h4>
            <p>Na página de login, clique em "Esqueceu a senha?". Insira o seu email e enviaremos um código de 6 dígitos para que possa definir uma nova senha. O código é válido por 15 minutos.</p>
        `
    },

    security: {
        jwtExpiresIn: '24h',
        passwordResetTokenExpiresIn: 15 * 60 * 1000, 
    },

    financial: {
        currency: 'MT',
        minDeposit: 100.00,
        maxDeposit: 10000.00,
        minWithdrawal: 200.00,
        maxWithdrawal: 5000.00,
        minBet: 10.00,
        maxBet: 5000.00,
    },

    game: {
        boardSize: 8,
        piecesPerPlayer: 12,
        versusScreenDuration: 5000,
        opponentConnectionTimeout: 60 * 1000,
        lobby: {
            maxDescriptionLength: 120,
        }
    },

    user: {
        roles: ['user', 'admin'],
        defaultRole: 'user',
        defaultAvatarUrl: 'https://res.cloudinary.com/dje6f5k5u/image/upload/v1717013328/brainskill_assets/default_avatar.png',
        defaultBio: 'Novo jogador no BrainSkill!'
    },

    ids: {
        userNumericIdLength: 5,
        transactionIdLength: 5,
        matchIdLength: 5,
    },

    texts: {
        defaultPaymentDetails: {
            mpesa: {
                name: "Não Configurado",
                number: "Não Configurado",
                instructions: "As instruções de depósito para M-Pesa ainda não foram configuradas pelo administrador."
            },
            emola: {
                name: "Não Configurado",
                number: "Não Configurado",
                instructions: "As instruções de depósito para e-Mola ainda não foram configuradas pelo administrador."
            }
        },
        defaultPlatformRules: "As regras da plataforma ainda não foram definidas pelo administrador. Regra geral: jogue de forma justa e respeite os outros jogadores."
    }
};