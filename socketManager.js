// =================================================================
// FICHEIRO: socketManager.js (Versão Corrigida)
// =================================================================

const { User, Game, Setting } = require('./models');
const { getPossibleMovesForPlayer, applyMoveToBoard, checkWinCondition, createInitialBoard } = require('./gameLogic');
const mongoose = require('mongoose');

// Mapeamento para rastrear utilizadores, sockets e timers de desconexão
const connectedUsers = new Map(); // key: socket.id, value: userId
const userSockets = new Map(); // key: userId, value: Set<socket.id>
const disconnectionTimers = new Map(); // key: userId, value: timeoutId

// Função para adicionar um utilizador/socket
function addUser(userId, socketId) {
    connectedUsers.set(socketId, userId);
    if (!userSockets.has(userId)) {
        userSockets.set(userId, new Set());
    }
    userSockets.get(userId).add(socketId);
    
    // Se havia um timer de desconexão para este user, cancela-o
    if (disconnectionTimers.has(userId)) {
        clearTimeout(disconnectionTimers.get(userId));
        disconnectionTimers.delete(userId);
        console.log(`Utilizador ${userId} reconectado. Timer de abandono cancelado.`);
    }
}

// Função para remover um socket e iniciar timer se for a última conexão
function removeUser(io, socketId) {
    const userId = connectedUsers.get(socketId);
    if (userId) {
        connectedUsers.delete(socketId);
        const userSocketSet = userSockets.get(userId);
        if (userSocketSet) {
            userSocketSet.delete(socketId);
            if (userSocketSet.size === 0) {
                userSockets.delete(userId);
                handleUserDisconnection(io, userId);
            }
        }
    }
}

/**
 * Função central para finalizar uma partida.
 */
async function endGame(io, gameId, result) {
    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const session = await mongoose.startSession();
        session.startTransaction();
        try {
            const game = await Game.findById(gameId).session(session);
            if (!game || game.status === 'completed' || game.status === 'abandoned') {
                await session.abortTransaction();
                session.endSession();
                return;
            }

            if (!game.bettingMode) {
                console.warn(`AVISO: Jogo ${game.gameId || game._id} está a ser finalizado sem 'bettingMode'. Marcando como abandonado para limpeza.`);
                game.status = 'abandoned';
                await game.save({ session, validateBeforeSave: false });
                await session.commitTransaction();
                session.endSession();
                return;
            }

            const { winnerId, loserId, reason, isDraw } = result;
            game.status = reason === 'abandonment' ? 'abandoned' : 'completed';
            
            let winner, loser;
            if (isDraw) {
                const player1 = await User.findById(game.players[0]).session(session);
                const player2 = await User.findById(game.players[1]).session(session);
                if (player1 && player2) {
                    if (game.bettingMode === 'real') {
                        player1.balance += game.betAmount;
                        player2.balance += game.betAmount;
                    } else {
                        player1.bonusBalance += game.betAmount;
                        player2.bonusBalance += game.betAmount; // Ambos recebem de volta em caso de empate
                    }
                    await player1.save({ session });
                    await player2.save({ session });
                }
                game.winner = null;
            } else {
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
            const finalGame = await Game.findById(game._id).populate('winner', 'username').populate('players', 'username avatar');
            io.to(game.gameId).emit('game_over', { game: finalGame, reason });
            session.endSession();
            return;

        } catch (error) {
            await session.abortTransaction();
            if (error.errorLabelSet && error.errorLabelSet.has('TransientTransactionError') && attempt < maxRetries) {
                console.log(`Tentativa ${attempt} falhou devido a um conflito de transação. A tentar novamente...`);
                await new Promise(res => setTimeout(res, 100 * attempt));
                session.endSession();
                continue;
            } else {
                console.error(`Erro CRÍTICO ao finalizar o jogo após ${attempt} tentativas:`, error);
                io.to(gameId).emit('error_message', { message: 'Erro crítico ao finalizar a partida. Contacte o suporte.' });
                session.endSession();
                return;
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

/**
 * Lida com a desconexão final de um utilizador, após a grace period.
 */
async function handleUserDisconnection(io, userId) {
    const timer = setTimeout(async () => {
        try {
            console.log(`Período de tolerância de 15s terminou para o utilizador ${userId}. Verificando jogos ativos...`);
            const activeGame = await Game.findOne({
                status: 'in_progress',
                players: userId
            });

            if (activeGame) {
                const winnerId = activeGame.players.find(p => p.toString() !== userId).toString();
                console.log(`Jogo ${activeGame.gameId} abandonado por ${userId}. Vencedor: ${winnerId}`);
                await endGame(io, activeGame._id, { winnerId, loserId: userId, reason: 'abandonment' });
            }
            disconnectionTimers.delete(userId);
        } catch (error) {
            console.error(`Erro ao processar abandono para o utilizador ${userId}:`, error);
        }
    }, 15000); // Período de tolerância de 15 segundos

    disconnectionTimers.set(userId, timer);
    console.log(`Utilizador ${userId} desconectado. Iniciando timer de 15s para abandono de jogo.`);
}


module.exports = function(io) {

    io.on('connection', (socket) => {
        const userId = socket.handshake.query.userId;
        if (userId) {
            addUser(userId, socket.id);
            console.log(`Utilizador ${userId} conectado com socket ${socket.id}. Total de conexões: ${userSockets.get(userId)?.size}`);
            socket.join(userId); // Sala pessoal para notificações
        }
        
        socket.join('lobby'); // Todos entram no lobby

        socket.on('get_lobby', () => emitLobbyUpdate(io));

        socket.on('create_game', async ({ betAmount, description, isPrivate }) => {
            let amountToReturn = 0;
            const session = await mongoose.startSession();
            session.startTransaction();
            try {
                const user = await User.findById(userId).session(session);
                if (!user) {
                    throw new Error('Utilizador inválido.');
                }
                
                const settings = await Setting.findOne({ singleton: 'main_settings' }).session(session);
                if (!settings || betAmount < settings.minBet || betAmount > settings.maxBet) {
                    throw new Error(`Valor da aposta deve estar entre ${settings.minBet} e ${settings.maxBet} MT.`);
                }

                const balanceField = user.activeBettingMode === 'bonus' ? 'bonusBalance' : 'balance';
                if (user[balanceField] < betAmount) {
                    throw new Error('Saldo insuficiente na carteira ativa.');
                }
                
                amountToReturn = betAmount;
                user[balanceField] -= betAmount;
                
                const gameData = {
                    players: [user._id],
                    creator: user._id,
                    betAmount,
                    bettingMode: user.activeBettingMode,
                    boardState: createInitialBoard(),
                    isPrivate,
                    lobbyDescription: isPrivate ? '' : description,
                };
                
                const game = new Game(gameData);
                
                await user.save({ session });
                await game.save({ session });
                await session.commitTransaction();

                // **CORREÇÃO CRÍTICA**: O criador entra na sala do seu próprio jogo imediatamente.
                socket.join(game.gameId);

                if (isPrivate) {
                    socket.emit('private_game_created_show_code', { privateCode: game.gameCode });
                }
                emitLobbyUpdate(io);

            } catch (error) {
                await session.abortTransaction();
                console.error("Erro em 'create_game':", error);
                
                if (amountToReturn > 0) {
                    const user = await User.findById(userId);
                    if (user) {
                        const balanceField = user.activeBettingMode === 'bonus' ? 'bonusBalance' : 'balance';
                        user[balanceField] += amountToReturn;
                        await user.save();
                        console.log(`Saldo de ${amountToReturn} MT devolvido a ${userId} após falha na criação do jogo.`);
                        socket.emit('error_message', { message: 'Erro ao criar a partida. O seu saldo foi restaurado.' });
                        return;
                    }
                }
                socket.emit('error_message', { message: error.message || 'Ocorreu um erro fatal ao criar a partida.' });
            } finally {
                session.endSession();
            }
        });

        socket.on('cancel_game', async ({ gameId }) => {
            const session = await mongoose.startSession();
            session.startTransaction();
            try {
                const game = await Game.findOne({ gameId, creator: userId, status: 'waiting' }).session(session);
                if (!game) throw new Error('Partida não encontrada ou já iniciada.');
                
                const user = await User.findById(userId).session(session);
                const balanceField = game.bettingMode === 'bonus' ? 'bonusBalance' : 'balance';
                user[balanceField] += game.betAmount;
                
                await user.save({ session });
                await Game.findByIdAndDelete(game._id).session(session);
                await session.commitTransaction();

                socket.emit('game_cancelled', { message: 'A sua partida foi cancelada e o valor devolvido.' });
                emitLobbyUpdate(io);
            } catch (error) {
                await session.abortTransaction();
                console.error("Erro em 'cancel_game':", error);
                socket.emit('error_message', { message: error.message || 'Erro ao cancelar a partida.' });
            } finally {
                session.endSession();
            }
        });

        socket.on('join_game', async ({ gameCodeOrId }) => {
            const session = await mongoose.startSession();
            session.startTransaction();
            try {
                const game = await Game.findOne({
                    $or: [{ gameId: gameCodeOrId }, { gameCode: gameCodeOrId.toUpperCase() }],
                    status: 'waiting'
                }).session(session);

                if (!game) throw new Error('Partida não encontrada, expirada ou já iniciada.');
                if (game.players.includes(userId)) throw new Error('Você não pode entrar na sua própria partida.');

                const joiner = await User.findById(userId).session(session);
                const balanceField = game.bettingMode === 'bonus' ? 'bonusBalance' : 'balance';
                if (joiner[balanceField] < game.betAmount) {
                    throw new Error('Saldo insuficiente para entrar nesta partida.');
                }
                
                joiner[balanceField] -= game.betAmount;
                
                game.players.push(joiner._id);
                game.status = 'in_progress';
                game.currentPlayer = game.players[0];

                await joiner.save({ session });
                await game.save({ session });
                await session.commitTransaction();

                const populatedGame = await Game.findById(game._id).populate('players', 'username avatar');
                
                // **CORREÇÃO**: O joiner entra na sala. O criador já está lá desde a criação.
                socket.join(game.gameId);

                // **CORREÇÃO CRÍTICA**: Emite o evento 'game_start' para TODOS na sala do jogo.
                io.to(game.gameId).emit('game_start', populatedGame);
                
                emitLobbyUpdate(io);

            } catch (error) {
                await session.abortTransaction();
                console.error("Erro em 'join_game':", error);
                socket.emit('error_message', { message: error.message || 'Erro ao tentar entrar na partida.' });
            } finally {
                session.endSession();
            }
        });
        
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
        
        // **CORREÇÃO**: Mudado de 'resign' para 'surrender' para corresponder ao cliente
        socket.on('surrender', async ({ gameId }) => {
            try {
                const game = await Game.findOne({ _id: gameId, status: 'in_progress', players: userId });
                if (!game) return;

                const winnerId = game.players.find(p => p.toString() !== userId).toString();
                await endGame(io, game._id, { winnerId, loserId: userId, reason: 'resignation' });

            } catch (error) {
                console.error("Erro em 'surrender':", error);
            }
        });
        
        socket.on('disconnect', () => {
            const disconnectedUserId = connectedUsers.get(socket.id);
            if(disconnectedUserId) {
                console.log(`Socket ${socket.id} do utilizador ${disconnectedUserId} desconectado.`);
                removeUser(io, socket.id);
            }
        });
    });

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
    }, 5 * 60 * 1000);
};