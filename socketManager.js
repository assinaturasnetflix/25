// ==========================================================
// FICHEIRO: socketManager.js (Versão Completa com Correções)
// ==========================================================

const { User, Game, Setting, Transaction } = require('./models');
const { getPossibleMovesForPlayer, applyMoveToBoard, checkWinCondition, createInitialBoard } = require('./gameLogic');
const mongoose = require('mongoose');

// Mapeamento para rastrear utilizadores conectados e os seus sockets
const connectedUsers = new Map();

/**
 * Função central para finalizar uma partida, agora com lógica de repetição para erros de transação.
 * @param {object} io - Instância do Socket.IO.
 * @param {string} gameId - O ID do jogo a ser finalizado.
 * @param {object} result - Objeto com o resultado. Ex: { winnerId, loserId, reason, isDraw }.
 */
async function endGame(io, gameId, result) {
    const maxRetries = 3; // Tentar no máximo 3 vezes
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const session = await mongoose.startSession();
        session.startTransaction();
        try {
            const game = await Game.findById(gameId).session(session);
            // Se o jogo já foi finalizado numa tentativa anterior, paramos.
            if (!game || game.status === 'completed' || game.status === 'abandoned') {
                await session.abortTransaction();
                session.endSession();
                return;
            }

            const { winnerId, loserId, reason, isDraw } = result;
            game.status = reason === 'abandonment' ? 'abandoned' : 'completed';
            let winner, loser;

            if (isDraw) {
                // Lógica para empate: devolver o dinheiro (sem comissão)
                const player1 = await User.findById(game.players[0]).session(session);
                const player2 = await User.findById(game.players[1]).session(session);
                if (game.bettingMode === 'real') {
                    player1.balance += game.betAmount;
                    player2.balance += game.betAmount;
                } else {
                    player1.bonusBalance += game.betAmount;
                    player2.bonusBalance += game.betAmount;
                }
                await player1.save({ session });
                await player2.save({ session });
                game.winner = null;
            } else {
                // Lógica para vitória/derrota
                winner = await User.findById(winnerId).session(session);
                loser = await User.findById(loserId).session(session);
                if (!winner || !loser) throw new Error('Jogador vencedor ou perdedor não encontrado.');

                game.winner = winner._id;
                winner.stats.wins += 1;
                loser.stats.losses += 1;
                
                const settings = await Setting.findOne({ singleton: 'main_settings' }).session(session);
                const commissionRate = settings.platformCommission || 0.15;
                const totalPot = game.betAmount * 2;
                const commissionAmount = totalPot * commissionRate;
                const winnerPrize = totalPot - commissionAmount;

                game.commissionAmount = commissionAmount;

                if (game.bettingMode === 'real') {
                    winner.balance += winnerPrize;
                } else {
                    winner.bonusBalance += winnerPrize;
                }
                
                await winner.save({ session });
                await loser.save({ session });
            }
            
            await game.save({ session });
            await session.commitTransaction();

            // Se chegamos aqui, a transação foi bem-sucedida, podemos sair do loop.
            const finalGame = await Game.findById(game._id).populate('winner', 'username');
            io.to(game.gameId).emit('game_over', { game: finalGame, reason });
            
            session.endSession();
            return; // Sai da função com sucesso

        } catch (error) {
            await session.abortTransaction();
            
            // Verifica se é um erro que permite repetição (TransientTransactionError)
            if (error.errorLabelSet && error.errorLabelSet.has('TransientTransactionError') && attempt < maxRetries) {
                console.log(`Tentativa ${attempt} falhou devido a um conflito de transação. A tentar novamente...`);
                await new Promise(res => setTimeout(res, 100 * attempt)); // Espera um pouco antes de tentar de novo
                session.endSession();
                continue; // Próxima iteração do loop
            } else {
                // Se não for um erro de repetição ou se esgotaram as tentativas, regista o erro e para.
                console.error(`Erro CRÍTICO ao finalizar o jogo após ${attempt} tentativas:`, error);
                io.to(gameId).emit('error_message', { message: 'Erro crítico ao finalizar a partida. Contacte o suporte.' });
                session.endSession();
                return; // Sai da função com erro
            }
        }
    }
}


/**
 * Emite a lista de jogos públicos disponíveis no lobby.
 */
const emitLobbyUpdate = async (io) => {
    try {
        const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
        const games = await Game.find({
            status: 'waiting',
            isPrivate: false,
            createdAt: { $gte: twoMinutesAgo }
        })
        .populate('creator', 'username avatar')
        .sort({ createdAt: -1 });
        io.to('lobby').emit('lobby_update', games);
    } catch (error) {
        console.error("Erro ao emitir atualização do lobby:", error);
    }
};


module.exports = function(io) {

    io.on('connection', (socket) => {
        const userId = socket.handshake.query.userId;
        if (userId) {
            console.log(`Utilizador ${userId} conectado com socket ${socket.id}`);
            connectedUsers.set(socket.id, userId);
            socket.join(userId); // Sala privada para notificações diretas
        }
        
        socket.join('lobby');

        // --- GESTÃO DO LOBBY ---

        socket.on('get_lobby', () => emitLobbyUpdate(io));

        socket.on('create_game', async ({ betAmount, description, isPrivate }) => {
            try {
                const user = await User.findById(userId);
                if (!user) return socket.emit('error_message', { message: 'Utilizador inválido.' });
                
                const settings = await Setting.findOne({ singleton: 'main_settings' });
                if (!settings || betAmount < settings.minBet || betAmount > settings.maxBet) {
                    return socket.emit('error_message', { message: `Valor da aposta deve estar entre ${settings.minBet} e ${settings.maxBet} MT.` });
                }

                const balanceField = user.activeBettingMode === 'bonus' ? 'bonusBalance' : 'balance';
                if (user[balanceField] < betAmount) {
                    return socket.emit('error_message', { message: 'Saldo insuficiente na carteira ativa.' });
                }
                
                user[balanceField] -= betAmount;
                
                const game = new Game({
                    players: [user._id],
                    creator: user._id,
                    betAmount,
                    bettingMode: user.activeBettingMode,
                    boardState: createInitialBoard(),
                    currentPlayer: user._id,
                    isPrivate,
                    lobbyDescription: isPrivate ? '' : description,
                    gameCode: isPrivate ? `P${generateNumericId(5)}` : null,
                });

                await user.save();
                await game.save();

                if (isPrivate) {
                    socket.emit('private_game_created_show_code', { privateCode: game.gameCode });
                }
                emitLobbyUpdate(io);
            } catch (error) {
                console.error("Erro em 'create_game':", error);
                socket.emit('error_message', { message: 'Erro ao criar a partida.' });
            }
        });

        socket.on('cancel_game', async ({ gameId }) => {
            try {
                const game = await Game.findOne({ gameId, creator: userId, status: 'waiting' });
                if (!game) return socket.emit('error_message', { message: 'Partida não encontrada ou já iniciada.' });
                
                const user = await User.findById(userId);
                const balanceField = game.bettingMode === 'bonus' ? 'bonusBalance' : 'balance';
                user[balanceField] += game.betAmount;
                
                await user.save();
                await Game.findByIdAndDelete(game._id);

                socket.emit('game_cancelled', { message: 'A sua partida foi cancelada e o valor devolvido.' });
                emitLobbyUpdate(io);
            } catch (error) {
                console.error("Erro em 'cancel_game':", error);
                socket.emit('error_message', { message: 'Erro ao cancelar a partida.' });
            }
        });

        socket.on('join_game', async ({ gameCodeOrId }) => {
            try {
                const game = await Game.findOne({
                    $or: [{ gameId: gameCodeOrId }, { gameCode: gameCodeOrId }],
                    status: 'waiting'
                });

                if (!game) return socket.emit('error_message', { message: 'Partida não encontrada, expirada ou já iniciada.' });
                if (game.players.includes(userId)) return socket.emit('error_message', { message: 'Você não pode entrar na sua própria partida.' });

                const joiner = await User.findById(userId);
                const balanceField = game.bettingMode === 'bonus' ? 'bonusBalance' : 'balance';
                if (joiner[balanceField] < game.betAmount) {
                    return socket.emit('error_message', { message: 'Saldo insuficiente para entrar nesta partida.' });
                }
                
                joiner[balanceField] -= game.betAmount;
                
                game.players.push(joiner._id);
                game.status = 'in_progress';
                game.currentPlayer = game.players[0];

                await joiner.save();
                await game.save();

                const populatedGame = await Game.findById(game._id).populate('players', 'username avatar');
                
                const creatorId = populatedGame.players[0]._id.toString();
                const creatorSocket = Array.from(connectedUsers.entries()).find(([_, uId]) => uId === creatorId)?.[0];
                if (creatorSocket && io.sockets.sockets.get(creatorSocket)) {
                    io.sockets.sockets.get(creatorSocket).join(game.gameId);
                }
                socket.join(game.gameId);

                io.to(game.gameId).emit('game_start', populatedGame);
                emitLobbyUpdate(io);

            } catch (error) {
                console.error("Erro em 'join_game':", error);
                socket.emit('error_message', { message: 'Erro ao tentar entrar na partida.' });
            }
        });

        // --- GESTÃO DO JOGO EM ANDAMENTO ---
        
        socket.on('make_move', async ({ gameId, move }) => {
            try {
                const game = await Game.findById(gameId);
                if (!game || game.status !== 'in_progress') return;
                if (game.currentPlayer.toString() !== userId) return socket.emit('error_message', { message: 'Não é a sua vez de jogar.' });

                const playerColor = game.players[0].toString() === userId ? 'w' : 'b';
                const validMoves = getPossibleMovesForPlayer(game.boardState, playerColor);
                
                const isValidMove = validMoves.some(m =>
                    JSON.stringify(m.from) === JSON.stringify(move.from) &&
                    JSON.stringify(m.to) === JSON.stringify(move.to)
                );
                
                if (!isValidMove) return socket.emit('error_message', { message: 'Movimento inválido.' });

                game.boardState = applyMoveToBoard(game.boardState, move);
                game.moveHistory.push({ player: userId, ...move });

                const winCondition = checkWinCondition(game.boardState, playerColor);
                if (winCondition.winner) {
                    const loserId = game.players.find(p => p.toString() !== userId).toString();
                    await endGame(io, game._id, { winnerId: userId, loserId, reason: 'checkmate' });
                    return;
                }

                game.currentPlayer = game.players.find(p => p.toString() !== userId);
                await game.save();
                
                const populatedGame = await Game.findById(gameId).populate('players', 'username avatar').populate('currentPlayer', 'username');
                io.to(game.gameId).emit('game_state_update', populatedGame);

            } catch(error) {
                console.error("Erro em 'make_move':", error);
                socket.emit('error_message', { message: 'Ocorreu um erro ao processar a sua jogada.' });
            }
        });

        socket.on('resign', async ({ gameId }) => {
            try {
                const game = await Game.findOne({ _id: gameId, status: 'in_progress', players: userId });
                if (!game) return;

                const winnerId = game.players.find(p => p.toString() !== userId).toString();
                await endGame(io, game._id, { winnerId, loserId: userId, reason: 'resignation' });

            } catch (error) {
                console.error("Erro em 'resign':", error);
            }
        });
        
        socket.on('disconnect', async () => {
            const disconnectedUserId = connectedUsers.get(socket.id);
            if (disconnectedUserId) {
                console.log(`Utilizador ${disconnectedUserId} desconectado do socket ${socket.id}`);
                connectedUsers.delete(socket.id);

                const activeGame = await Game.findOne({
                    status: 'in_progress',
                    players: disconnectedUserId
                });

                if (activeGame) {
                    const winnerId = activeGame.players.find(p => p.toString() !== disconnectedUserId).toString();
                    console.log(`Jogo ${activeGame.gameId} abandonado por ${disconnectedUserId}. Vencedor: ${winnerId}`);
                    await endGame(io, activeGame._id, { winnerId, loserId: disconnectedUserId, reason: 'abandonment' });
                }
            }
        });
    });

    // Função auxiliar para gerar IDs numéricos
    function generateNumericId(length = 5) {
        let result = '';
        const characters = '0123456789';
        for (let i = 0; i < length; i++) {
            result += characters.charAt(Math.floor(Math.random() * characters.length));
        }
        return result;
    }

    // Limpeza periódica de jogos "waiting" que expiraram
    setInterval(async () => {
        try {
            const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
            const expiredGames = await Game.find({
                status: 'waiting',
                createdAt: { $lt: fiveMinutesAgo }
            });

            if (expiredGames.length > 0) {
                console.log(`Limpando ${expiredGames.length} partidas expiradas...`);
                for (const game of expiredGames) {
                    const user = await User.findById(game.creator);
                    if (user) {
                        const balanceField = game.bettingMode === 'bonus' ? 'bonusBalance' : 'balance';
                        user[balanceField] += game.betAmount;
                        await user.save();
                    }
                    await Game.findByIdAndDelete(game._id);
                }
                emitLobbyUpdate(io);
            }
        } catch (error) {
            console.error("Erro no processo de limpeza de jogos expirados:", error);
        }
    }, 5 * 60 * 1000); // Executa a cada 5 minutos
};