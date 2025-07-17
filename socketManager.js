// =================================================================
// FICHEIRO: socketManager.js (VERSÃO FINAL E CORRIGIDA)
// =================================================================

const { User, Game, Setting } = require('./models');
const { getPossibleMovesForPlayer, applyMoveToBoard, checkWinCondition, createInitialBoard } = require('./gameLogic');
const mongoose = require('mongoose');

// Mapeamentos para gestão de utilizadores e conexões
const userSockets = new Map(); // key: userId, value: Set<socket.id>
const disconnectionTimers = new Map(); // key: userId, value: timeoutId

function addUser(userId, socketId) {
    if (!userSockets.has(userId)) {
        userSockets.set(userId, new Set());
    }
    userSockets.get(userId).add(socketId);
    if (disconnectionTimers.has(userId)) {
        clearTimeout(disconnectionTimers.get(userId));
        disconnectionTimers.delete(userId);
        console.log(`[Reconexão] Utilizador ${userId} reconectado. Timer de abandono cancelado.`);
    }
}

function removeUser(io, socket) {
    const userId = socket.handshake.query.userId;
    if (userId && userSockets.has(userId)) {
        const userSocketSet = userSockets.get(userId);
        userSocketSet.delete(socket.id);
        if (userSocketSet.size === 0) {
            console.log(`[Desconexão] Última conexão do utilizador ${userId} fechada.`);
            handleUserDisconnection(io, userId);
        }
    }
}

async function handleUserDisconnection(io, userId) {
    const timer = setTimeout(async () => {
        try {
            console.log(`[Abandono] Período de tolerância terminou para ${userId}. Verificando jogos ativos...`);
            const activeGame = await Game.findOne({ status: 'in_progress', players: userId });
            if (activeGame) {
                const winnerId = activeGame.players.find(p => p.toString() !== userId).toString();
                console.log(`[Abandono] Jogo ${activeGame.gameId} abandonado por ${userId}. Vencedor: ${winnerId}`);
                await endGame(io, activeGame._id, { winnerId, loserId: userId, reason: 'abandonment' });
            }
            disconnectionTimers.delete(userId);
        } catch (error) {
            console.error(`[Erro Abandono] Erro ao processar abandono para ${userId}:`, error);
        }
    }, 15000); // 15 segundos de tolerância

    disconnectionTimers.set(userId, timer);
    console.log(`[Desconexão] Timer de 15s iniciado para utilizador ${userId}.`);
}

async function endGame(io, gameId, result) {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const game = await Game.findById(gameId).session(session);
        if (!game || game.status === 'completed' || game.status === 'abandoned') {
            await session.abortTransaction();
            session.endSession();
            return;
        }

        const { winnerId, loserId, reason, isDraw } = result;
        game.status = reason === 'abandonment' ? 'abandoned' : 'completed';
        
        if (!isDraw) {
            const winner = await User.findById(winnerId).session(session);
            const loser = await User.findById(loserId).session(session);
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
        } else {
            const [player1, player2] = await Promise.all([
                User.findById(game.players[0]).session(session),
                User.findById(game.players[1]).session(session)
            ]);
            if (player1 && player2) {
                if (game.bettingMode === 'real') {
                    player1.balance += game.betAmount;
                    player2.balance += game.betAmount;
                } else {
                    player1.bonusBalance += game.betAmount;
                    player2.bonusBalance += game.betAmount;
                }
                await player1.save({ session });
                await player2.save({ session });
            }
            game.winner = null;
        }
        
        await game.save({ session });
        await session.commitTransaction();

        const finalGame = await Game.findById(game._id).populate('winner', 'username avatar').populate('players', 'username avatar');
        io.to(game.gameId).emit('game_over', { game: finalGame, reason });

    } catch (error) {
        await session.abortTransaction();
        console.error(`[Erro Fim de Jogo] Erro CRÍTICO ao finalizar o jogo ${gameId}:`, error);
        io.to(gameId).emit('error_message', { message: 'Erro crítico ao finalizar a partida. Contacte o suporte.' });
    } finally {
        session.endSession();
    }
}

const emitLobbyUpdate = async (io) => {
    try {
        const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
        const games = await Game.find({ status: 'waiting', isPrivate: false, createdAt: { $gte: twoMinutesAgo } })
            .populate('creator', 'username avatar')
            .sort({ createdAt: -1 });
        io.to('lobby').emit('lobby_update', games);
    } catch (error) {
        console.error("[Erro Lobby]", error);
    }
};

async function emitGameStateUpdate(io, gameId) {
    const game = await Game.findById(gameId).populate('players', 'username avatar');
    if (!game) return;

    for (const player of game.players) {
        const playerColor = game.players[0]._id.equals(player._id) ? 'w' : 'b';
        let validMoves = [];

        if (game.status === 'in_progress' && game.currentPlayer.equals(player._id)) {
            validMoves = getPossibleMovesForPlayer(game.boardState, playerColor);
        }
        
        const gameStateForPlayer = { ...game.toObject(), validMoves };
        
        const playerSocketIds = userSockets.get(player._id.toString());
        if(playerSocketIds) {
            playerSocketIds.forEach(socketId => {
                io.to(socketId).emit('game_state_update', gameStateForPlayer);
            });
        }
    }
}

module.exports = function(io) {
    io.on('connection', (socket) => {
        const userId = socket.handshake.query.userId;
        if (!userId) {
            return socket.disconnect(true);
        }
        addUser(userId, socket.id);
        console.log(`[Conexão] Utilizador ${userId} conectado com socket ${socket.id}.`);
        socket.join('lobby');

        socket.on('subscribe_to_game', async ({ gameId }) => {
            try {
                const game = await Game.findById(gameId);
                if (game && game.players.map(p => p.toString()).includes(userId)) {
                    socket.join(gameId);
                    console.log(`[Jogo] Utilizador ${userId} subscreveu ao jogo ${gameId}`);
                    await emitGameStateUpdate(io, gameId);
                } else {
                    socket.emit('error_message', { message: 'Jogo não encontrado ou você não é um jogador.' });
                }
            } catch (error) {
                socket.emit('error_message', { message: 'Erro ao entrar na sala do jogo.' });
            }
        });

        socket.on('get_lobby', () => emitLobbyUpdate(io));

        socket.on('create_game', async ({ betAmount, description, isPrivate }) => {
            const session = await mongoose.startSession();
            session.startTransaction();
            try {
                const user = await User.findById(userId).session(session);
                if (!user) throw new Error('Utilizador inválido.');
                const settings = await Setting.findOne({ singleton: 'main_settings' }).session(session);
                if (!settings || betAmount < settings.minBet || betAmount > settings.maxBet) {
                    throw new Error(`A aposta deve estar entre ${settings.minBet} e ${settings.maxBet} MT.`);
                }
                const balanceField = user.activeBettingMode === 'bonus' ? 'bonusBalance' : 'balance';
                if (user[balanceField] < betAmount) {
                    throw new Error('Saldo insuficiente na carteira ativa.');
                }
                user[balanceField] -= betAmount;
                const game = new Game({
                    players: [user._id],
                    creator: user._id,
                    betAmount,
                    bettingMode: user.activeBettingMode,
                    boardState: createInitialBoard(),
                    isPrivate,
                    lobbyDescription: isPrivate ? '' : description,
                    gameCode: isPrivate ? `P${Math.random().toString(36).substr(2, 5).toUpperCase()}` : null
                });
                await user.save({ session });
                await game.save({ session });
                await session.commitTransaction();
                io.to(userId).emit('private_game_created_show_code', { privateCode: game.gameCode });
                emitLobbyUpdate(io);
            } catch (error) {
                await session.abortTransaction();
                socket.emit('error_message', { message: error.message || 'Erro ao criar a partida.' });
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
                if (game.players.includes(userId)) throw new Error('Não pode entrar na sua própria partida.');
                
                const joiner = await User.findById(userId).session(session);
                const balanceField = game.bettingMode === 'bonus' ? 'bonusBalance' : 'balance';
                if (joiner[balanceField] < game.betAmount) {
                    throw new Error('Saldo insuficiente para entrar nesta partida.');
                }
                
                joiner[balanceField] -= game.betAmount;
                game.players.push(joiner._id);
                game.status = 'in_progress';
                game.currentPlayer = game.players[0]; // O criador (branco) começa
                
                await joiner.save({ session });
                await game.save({ session });
                await session.commitTransaction();

                const populatedGame = await Game.findById(game._id);
                const creatorId = populatedGame.players[0]._id.toString();
                const joinerId = populatedGame.players[1]._id.toString();
                
                // Envia evento para os sockets específicos dos jogadores no lobby
                const creatorSockets = userSockets.get(creatorId);
                if (creatorSockets) creatorSockets.forEach(sid => io.to(sid).emit('game_start', populatedGame));

                const joinerSockets = userSockets.get(joinerId);
                if (joinerSockets) joinerSockets.forEach(sid => io.to(sid).emit('game_start', populatedGame));
                
                emitLobbyUpdate(io);
            } catch (error) {
                await session.abortTransaction();
                socket.emit('error_message', { message: error.message || 'Erro ao tentar entrar na partida.' });
            } finally {
                session.endSession();
            }
        });

        socket.on('make_move', async ({ gameId, move }) => {
            try {
                const game = await Game.findById(gameId);
                if (!game || game.status !== 'in_progress' || !game.currentPlayer.equals(userId)) return;

                const playerColor = game.players[0]._id.equals(userId) ? 'w' : 'b';
                const validMoves = getPossibleMovesForPlayer(game.boardState, playerColor);
                
                const isValidMove = validMoves.some(m =>
                    JSON.stringify(m.from) === JSON.stringify(move.from) &&
                    JSON.stringify(m.to) === JSON.stringify(move.to)
                );
                if (!isValidMove) return;
                
                game.boardState = applyMoveToBoard(game.boardState, move);
                game.moveHistory.push({ player: userId, from: move.from, to: move.to, captured: move.captured });

                const winCondition = checkWinCondition(game.boardState, playerColor);
                if (winCondition.winner) {
                    const loserId = game.players.find(p => !p.equals(userId));
                    await endGame(io, game._id, { winnerId: userId, loserId, reason: 'checkmate' });
                    return;
                }

                game.currentPlayer = game.players.find(p => !p.equals(userId));
                await game.save();
                
                await emitGameStateUpdate(io, gameId);
            } catch(error) {
                console.error("Erro em 'make_move':", error);
            }
        });

        socket.on('surrender', async ({ gameId }) => {
            try {
                const game = await Game.findOne({ _id: gameId, status: 'in_progress', players: userId });
                if (!game) return;
                const winnerId = game.players.find(p => !p.equals(userId));
                await endGame(io, game._id, { winnerId, loserId: userId, reason: 'resignation' });
            } catch (error) {
                console.error("Erro em 'surrender':", error);
            }
        });
        
        socket.on('disconnect', () => {
            console.log(`[Desconexão] Socket ${socket.id} do utilizador ${userId} desconectado.`);
            removeUser(io, socket);
        });
    });
};