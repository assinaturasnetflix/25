const config = {
    platform: {
        name: "BrainSkill",
        defaultCommissionRate: 0.15,
        defaultCurrency: "MT",
    },
    user: {
        idLength: 5,
        passwordResetTokenExpiresIn: 15 * 60 * 1000,
    },
    wallet: {
        minDeposit: 50.00,
        maxDeposit: 50000.00,
        minWithdrawal: 50.00,
        maxWithdrawal: 25000.00,
    },
    game: {
        bet: {
            min: 10.00,
            max: 10000.00,
        },
        timeouts: {
            opponentConnection: 60,
        },
    },
    style: {
        colors: {
            primary: "#000000",
            secondary: "#FFFFFF",
            accent: "#4a4a4a",
        },
        emailTheme: {
            backgroundColor: "#f4f4f4",
            headerColor: "#000000",
            textColor: "#333333",
            buttonColor: "#000000",
            buttonTextColor: "#FFFFFF",
        }
    },
    texts: {
        defaultLobbyMessage: "Vamos testar a minha sorte!",
        helpPageContent: `
            <h1>Bem-vindo à Central de Ajuda da BrainSkill</h1>
            <p>Aqui você encontra respostas para as perguntas mais frequentes.</p>
            <h2>Como depositar?</h2>
            <p>1. Vá para a sua carteira.</p>
            <p>2. Selecione o método de depósito (M-Pesa ou e-Mola).</p>
            <p>3. Siga as instruções para transferir o valor desejado.</p>
            <p>4. Submeta o comprovativo e aguarde a aprovação do administrador.</p>
            <h2>Como funcionam as apostas?</h2>
            <p>Você pode criar um jogo com um valor de aposta no lobby ou aceitar um desafio existente. O vencedor da partida recebe o valor total da aposta dos dois jogadores, menos uma comissão de 15% para a plataforma.</p>
            <h2>Esqueci a minha senha, e agora?</h2>
            <p>Na página de login, clique em "Esqueceu a senha?". Insira o seu email e enviaremos um código de recuperação com validade de 15 minutos.</p>
        `
    }
};

module.exports = config;