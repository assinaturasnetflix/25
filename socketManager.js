const { Game, User, Setting, Transaction } = require('./models');
const { createInitialBoard, getPossibleMovesForPlayer, applyMoveToBoard, checkWinCondition } = require('./gameLogic');
const mongoose = require('mongoose');

let activeUsers = {}; // userId -> socket.id
let activeGames = {}; // gameId -> { player1Id, player2Id, boardState, turn, etc. } - O estado principal do jogo deve ser no DB, esta é uma cache para otimização de tempo real
let activeLobbies = {}; // gameId -> { data: { betAmount, isBonusGame, ... }, createdAt, createdBy }

// Helper para obter as configurações em tempo real
const getLiveSettings = async () => {
    let settings = await Setting.findOne({ singleton: 'main_settings' });
    if (!settings) {
        settings = await Setting.create({ singleton: 'main_settings' });
    }
    return settings;
};

// Lógica de manipulação do fim do jogo
const handleGameOver = async (game, winnerId, loserId, surrendered = false) => {
    try {
        game.status = 'completed';
        game.winner = winnerId;
        await game.save();

        const winner = await User.findById(winnerId);
        const loser = await User.findById(loserId);
        const settings = await getLiveSettings();

        if (!winner || !loser) {
            console.error('Erro: Vencedor ou Perdedor não encontrado ao finalizar jogo.');
            io.to(game.id).emit('game_over', { message: 'Erro interno ao processar o fim do jogo.' });
            return;
        }

        const totalPrize = game.betAmount * 2; // Ambos apostaram
        const platformCommission = totalPrize * settings.platformCommission;
        const winnerGets = totalPrize - platformCommission;

        game.commissionAmount = platformCommission; // Salva a comissão no jogo
        await game.save(); // Salva novamente para incluir a comissão

        // Creditando o vencedor
        if (game.bettingMode === 'real') {
            winner.balance += winnerGets;
            // Registrar transação de vitória
            const winTransaction = new Transaction({
                user: winner._id,
                type: 'game_win',
                amount: winnerGets,
                status: 'approved',
                game: game._id
            });
            await winTransaction.save();
        } else { // bettingMode === 'bonus'
            winner.bonusBalance += winnerGets;
        }
        await winner.save();

        // Registrar transação de comissão (se quiser detalhar as transações de comissão)
        const commissionTransaction = new Transaction({
            user: winner._id, // Ou um ID de sistema, dependendo de como você quer rastrear
            type: 'commission',
            amount: platformCommission,
            status: 'approved',
            game: game._id,
            relatedUser: winner._id // Relaciona à transação do vencedor
        });
        await commissionTransaction.save();


        // Remover o jogo do lobby ativo se for um jogo de lobby
        if (activeLobbies[game.id]) {
            delete activeLobbies[game.id];
            io.emit('lobby_update', Object.values(activeLobbies).map(l => l.data));
        }

        io.to(game.id).emit('game_over', {
            winner: winner.toObject(),
            loser: loser.toObject(),
            surrendered: surrendered,
            finalBalanceWinner: game.bettingMode === 'real' ? winner.balance : winner.bonusBalance,
            finalBalanceLoser: game.bettingMode === 'real' ? loser.balance : loser.bonusBalance,
            bettingMode: game.bettingMode
        });
        io.socketsLeave(game.id); // Faz com que todos os sockets saiam da sala do jogo
    } catch (error) {
        console.error('Erro em handleGameOver:', error);
        io.to(game.id).emit('gameError', { message: 'Erro interno ao finalizar o jogo.' });
    }
};


const socketManager = (io) => {
    io.on('connection', (socket) => {
        const userId = socket.handshake.query.userId;
        if (userId) {
            activeUsers[userId] = socket.id;
            socket.join(userId); // Junta o usuário a uma sala com seu próprio ID
            console.log(`Usuário ${userId} conectado. Socket ID: ${socket.id}`);
        }

        socket.on('join_game_room', async ({ gameId }) => {
            const currentUserId = Object.keys(activeUsers).find(key => activeUsers[key] === socket.id);
            if (!currentUserId) return;
            const game = await Game.findById(gameId).populate('player1', 'username avatar').populate('player2', 'username avatar');
            if (!game) return io.to(socket.id).emit('error_message', { message: 'Partida não encontrada.' });

            // Certifique-se de que apenas os jogadores da partida podem entrar na sala
            if (!game.player1.equals(currentUserId) && (!game.player2 || !game.player2.equals(currentUserId))) {
                return io.to(socket.id).emit('error_message', { message: 'Você não faz parte desta partida.' });
            }

            socket.join(gameId);
            console.log(`Usuário ${currentUserId} entrou na sala do jogo ${gameId}.`);
            io.to(socket.id).emit('game_state', game);
        });

        socket.on('get_lobby', async () => {
            // Atualizar o lobby, removendo jogos antigos ou completos
            const gamesInDb = await Game.find({ status: 'pending', player2: null }).sort({ createdAt: -1 }).populate('player1', 'username');
            activeLobbies = {}; // Limpa o lobby antes de reconstruir
            gamesInDb.forEach(game => {
                activeLobbies[game._id.toString()] = { data: game, createdAt: game.createdAt };
            });
            io.to(socket.id).emit('lobby_update', Object.values(activeLobbies).map(l => l.data));
        });

        socket.on('createGame', async ({ betAmount, isBonusGame, isPrivate, gameCode, lobbyDescription }) => {
            const player1Id = Object.keys(activeUsers).find(key => activeUsers[key] === socket.id);
            if (!player1Id) return socket.emit('gameError', { message: 'Usuário não autenticado.' });

            try {
                const user = await User.findById(player1Id);
                const settings = await getLiveSettings();

                if (betAmount < settings.minBet || betAmount > settings.maxBet) {
                    return socket.emit('gameError', { message: `O valor da aposta deve estar entre ${settings.minBet} MT e ${settings.maxBet} MT.` });
                }

                if (isBonusGame) {
                    if (user.bonusBalance < betAmount) {
                        return socket.emit('gameError', { message: 'Saldo de bônus insuficiente para criar este jogo.' });
                    }
                    user.bonusBalance -= betAmount;
                } else {
                    if (user.balance < betAmount) {
                        return socket.emit('gameError', { message: 'Saldo real insuficiente para criar este jogo.' });
                    }
                    user.balance -= betAmount;
                }
                await user.save();

                const newBoard = createInitialBoard();
                const game = new Game({
                    players: [player1Id],
                    player1: player1Id,
                    boardState: newBoard,
                    status: 'pending',
                    betAmount: betAmount,
                    bettingMode: isBonusGame ? 'bonus' : 'real',
                    isPrivate: isPrivate || false,
                    gameCode: isPrivate ? gameCode : undefined,
                    lobbyDescription: lobbyDescription || ''
                });
                await game.save();

                activeLobbies[game._id.toString()] = { data: game.toObject(), createdAt: new Date(), createdBy: player1Id };
                io.emit('lobby_update', Object.values(activeLobbies).map(l => l.data)); // Atualiza o lobby para todos
                socket.emit('gameCreated', { gameId: game._id, message: 'Jogo criado com sucesso. Aguardando oponente.' });

            } catch (error) {
                console.error('Erro ao criar jogo:', error);
                socket.emit('gameError', { message: 'Erro interno do servidor ao criar jogo.' });
            }
        });

        socket.on('joinGame', async ({ gameId, gameCode }) => {
            const player2Id = Object.keys(activeUsers).find(key => activeUsers[key] === socket.id);
            if (!player2Id || player2Id === activeLobbies[gameId]?.createdBy) {
                return socket.emit('gameError', { message: 'Não é possível entrar no seu próprio jogo ou oponente inválido.' });
            }

            try {
                let game = await Game.findById(gameId);

                if (!game || game.status !== 'pending' || game.player2) {
                    return socket.emit('gameError', { message: 'Não foi possível entrar no jogo ou jogo já iniciado.' });
                }

                if (game.isPrivate && game.gameCode !== gameCode) {
                    return socket.emit('gameError', { message: 'Código do jogo privado incorreto.' });
                }

                const user2 = await User.findById(player2Id);
                if (!user2) {
                    return socket.emit('gameError', { message: 'Usuário não encontrado.' });
                }

                // Verificar saldo antes de debitar
                if (game.bettingMode === 'real') {
                    if (user2.balance < game.betAmount) {
                        return socket.emit('gameError', { message: 'Saldo real insuficiente para entrar neste jogo.' });
                    }
                    user2.balance -= game.betAmount;
                } else { // bettingMode === 'bonus'
                    if (user2.bonusBalance < game.betAmount) {
                        return socket.emit('gameError', { message: 'Saldo de bônus insuficiente para entrar neste jogo.' });
                    }
                    user2.bonusBalance -= game.betAmount;
                }
                await user2.save();

                game.player2 = player2Id;
                game.players.push(player2Id);
                game.status = 'in_progress';
                game.turn = game.player1; // Player1 sempre começa
                await game.save();

                // Atualizar o lobby para remover o jogo
                if (activeLobbies[gameId]) {
                    delete activeLobbies[gameId];
                    io.emit('lobby_update', Object.values(activeLobbies).map(l => l.data));
                }

                // Fazer com que ambos os jogadores entrem na sala do jogo
                const player1SocketId = activeUsers[game.player1.toString()];
                if (player1SocketId) {
                    io.sockets.sockets.get(player1SocketId)?.join(gameId);
                }
                socket.join(gameId);

                // NOVO: Emitir evento para ambos os jogadores que o jogo começou e eles devem ser redirecionados
                // Para o usuário que criou o jogo (player1)
                if (player1SocketId) {
                    io.to(player1SocketId).emit('gameStarted', { gameId: game._id });
                }
                // Para o usuário que acabou de entrar no jogo (player2)
                io.to(socket.id).emit('gameStarted', { gameId: game._id });

                // Emitir o estado inicial do jogo para a sala
                const fullGame = await Game.findById(game._id)
                                    .populate('player1', 'username avatar')
                                    .populate('player2', 'username avatar');
                io.to(game.id).emit('game_state_init', fullGame);


            } catch (error) {
                console.error('Erro ao entrar no jogo:', error);
                socket.emit('gameError', { message: 'Erro interno do servidor ao entrar no jogo.' });
            }
        });


        socket.on('makeMove', async ({ gameId, move }) => {
            const playerId = Object.keys(activeUsers).find(key => activeUsers[key] === socket.id);
            if (!playerId) return;

            try {
                const game = await Game.findById(gameId).populate('player1').populate('player2');
                if (!game || game.status !== 'in_progress' || !game.turn.equals(playerId)) {
                    return socket.emit('gameError', { message: 'Não é a sua vez ou jogo não está em andamento.' });
                }

                const playerColor = game.player1.equals(playerId) ? 'w' : 'b'; // Assume player1 é branco
                const opponent = game.player1.equals(playerId) ? game.player2 : game.player1;

                const possibleMoves = getPossibleMovesForPlayer(game.boardState, playerColor);
                const isValidMove = possibleMoves.some(m =>
                    m.from[0] === move.from.r && m.from[1] === move.from.c &&
                    m.to[0] === move.to.r && m.to[1] === move.to.c &&
                    JSON.stringify(m.captured) === JSON.stringify(move.captured)
                );

                if (!isValidMove) {
                    return socket.emit('gameError', { message: 'Movimento inválido.' });
                }

                const newBoardState = applyMoveToBoard(game.boardState, move);
                game.boardState = newBoardState;
                game.turn = opponent._id; // Passa a vez para o oponente
                game.moveHistory.push({
                    player: playerId,
                    from: move.from,
                    to: move.to,
                    captured: move.captured || []
                });


                const playerSymbol = playerColor === 'w' ? 'w' : 'b';
                const winState = checkWinCondition(game.boardState, playerSymbol);
                if (winState.winner) {
                    await handleGameOver(game, playerId, opponent._id); // O jogador que fez o último movimento é o vencedor
                } else {
                    await game.save();
                    io.to(game.id).emit('move_made', { boardState: game.boardState, currentPlayer: game.turn, move: move });
                }

            } catch (error) {
                console.error('Erro ao fazer movimento:', error);
                socket.emit('gameError', { message: 'Erro interno do servidor ao fazer movimento.' });
            }
        });

        socket.on('surrender', async ({ gameId }) => {
            const userId = Object.keys(activeUsers).find(key => activeUsers[key] === socket.id);
            if (!userId) return;

            try {
                const game = await Game.findById(gameId).populate('player1').populate('player2');
                if (!game || !['in_progress', 'pending'].includes(game.status) || (!game.player1.equals(userId) && !game.player2.equals(userId))) {
                    return socket.emit('gameError', { message: 'Não é possível render-se neste jogo.' });
                }

                const winnerId = game.player1.equals(userId) ? game.player2 : game.player1;
                const loserId = userId;

                if (!winnerId) { // Se o jogo ainda estiver pendente e um jogador se rende antes de haver 2º jogador
                    if (game.status === 'pending') {
                        // Devolver a aposta ao jogador que criou e se rendeu
                        const user = await User.findById(loserId);
                        if (user) {
                            if (game.bettingMode === 'real') {
                                user.balance += game.betAmount;
                            } else {
                                user.bonusBalance += game.betAmount;
                            }
                            await user.save();
                            // Criar transação de reembolso, se desejar
                            const refundTx = new Transaction({
                                user: loserId,
                                type: 'game_bet_refund',
                                amount: game.betAmount,
                                status: 'approved',
                                game: game._id
                            });
                            await refundTx.save();
                        }
                    }
                    game.status = 'cancelled';
                    await game.save();
                    io.to(game.id).emit('game_over', { cancelled: true, message: 'Jogo cancelado por rendição antes do início.' });
                    io.socketsLeave(game.id);
                    // Remover do lobby
                    if (activeLobbies[gameId]) {
                        delete activeLobbies[gameId];
                        io.emit('lobby_update', Object.values(activeLobbies).map(l => l.data));
                    }
                    return;
                }

                await handleGameOver(game, winnerId, loserId, true); // O surrendered = true indica rendição
            } catch (error) {
                console.error('Erro ao render-se:', error);
                socket.emit('gameError', { message: 'Erro interno do servidor ao render-se.' });
            }
        });

        socket.on('disconnect', () => {
            const userIdDisconnected = Object.keys(activeUsers).find(key => activeUsers[key] === socket.id);
            if (userIdDisconnected) {
                console.log(`Usuário ${userIdDisconnected} desconectado.`);
                delete activeUsers[userIdDisconnected];

                // Lógica para lidar com jogos em andamento do usuário desconectado
                // Seria ideal ter um mecanismo de tempo limite para jogos ou marcar como 'abandoned'
                // Aqui é um exemplo simples: procurar jogos pendentes criados por ele e cancelar
                Object.keys(activeLobbies).forEach(gameId => {
                    if (activeLobbies[gameId].createdBy === userIdDisconnected) {
                        // O jogo ainda está no lobby e o criador desconectou
                        Game.findById(gameId).then(game => {
                            if (game && game.status === 'pending') {
                                game.status = 'cancelled';
                                game.save();
                                io.emit('lobby_update', Object.values(activeLobbies).map(l => l.data));
                                io.to(gameId).emit('game_cancelled', { message: 'Jogo cancelado, criador desconectado.' });
                            }
                        });
                        delete activeLobbies[gameId];
                    }
                });
            }
        });
    });
};

module.exports = socketManager;