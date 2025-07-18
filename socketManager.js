const { User, Game, Setting } = require('./models');
const { getPossibleMovesForPlayer, applyMoveToBoard, checkWinCondition, createInitialBoard } = require('./gameLogic');
const mongoose = require('mongoose');
const { generateNumericId } = require('./utils');

const disconnectionTimers = new Map();

async function handleUserDisconnection(io, userId) {
    const ABANDONMENT_TIMEOUT = 20000;

    const timer = setTimeout(async () => {
        try {
            const activeGame = await Game.findOne({ players: userId, status: 'in_progress' });

            if (activeGame) {
                const winnerId = activeGame.players.find(p => p.toString() !== userId).toString();
                console.log(`[Abandono] Jogo ${activeGame.gameId} processado como abandonado por ${userId} após ${ABANDONMENT_TIMEOUT / 1000}s. Vencedor: ${winnerId}`);
                await endGame(io, activeGame.gameId, { winnerId, loserId: userId, reason: 'abandonment' });
            } else {
                console.log(`[Timer Desconexão] Utilizador ${userId} desconectou, mas não tinha jogo ativo. Nenhuma ação tomada.`);
            }
            disconnectionTimers.delete(userId);
        } catch (error) {
            console.error(`[Erro Abandono] Falha ao processar abandono para ${userId}:`, error);
        }
    }, ABANDONMENT_TIMEOUT);

    disconnectionTimers.set(userId, timer);
    console.log(`[Timer Desconexão] Timer de ${ABANDONMENT_TIMEOUT / 1000}s iniciado para utilizador ${userId}.`);
}

async function endGame(io, gameId, result) {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const { winnerId, loserId, reason, isDraw } = result;
        const game = await Game.findOneAndUpdate(
            { gameId: gameId, status: { $in: ['in_progress', 'waiting'] } },
            {
                $set: {
                    status: reason === 'abandonment' ? 'abandoned' : 'completed',
                    winner: isDraw ? null : winnerId
                }
            },
            { new: true, session: session }
        );

        if (!game) {
            await session.abortTransaction();
            session.endSession();
            return;
        }

        if (game.status === 'completed' || game.status === 'abandoned') {
             if (!isDraw && winnerId && loserId) {
                const winner = await User.findById(winnerId).session(session);
                const loser = await User.findById(loserId).session(session);
                if (winner && loser) {
                    winner.stats.wins += 1;
                    loser.stats.losses += 1;
                    const settings = await Setting.findOne({ singleton: 'main_settings' }).lean().session(session);
                    const totalPot = game.betAmount * 2;
                    const commission = totalPot * (settings?.platformCommission || 0.15);
                    const winnerPrize = totalPot - commission;
                    game.commissionAmount = commission;
                    if (game.bettingMode === 'real') {
                        winner.balance += winnerPrize;
                    } else {
                        winner.bonusBalance += winnerPrize;
                    }
                    await winner.save({ session });
                    await loser.save({ session });
                }
            } else if (isDraw) {
                const [p1, p2] = await Promise.all([
                    User.findById(game.players[0]).session(session),
                    User.findById(game.players[1]).session(session)
                ]);
                if (p1 && p2) {
                    if (game.bettingMode === 'real') {
                        p1.balance += game.betAmount;
                        p2.balance += game.betAmount;
                    } else {
                        p1.bonusBalance += game.betAmount;
                        p2.bonusBalance += game.betAmount;
                    }
                    await p1.save({ session });
                    await p2.save({ session });
                }
            }
        }

        await game.save({ session });
        await session.commitTransaction();
        const finalGame = await Game.findById(game._id).populate('winner', 'username avatar').populate('players', 'username avatar');
        io.to(game.gameId).emit('game_over', { game: finalGame, reason });
    } catch (error) {
        await session.abortTransaction();
        console.error(`[Erro Fim de Jogo] Erro CRÍTICO ao finalizar o jogo ${gameId}:`, error);
        io.to(gameId).emit('error_message', { message: 'Erro crítico ao finalizar a partida.' });
    } finally {
        session.endSession();
    }
}

const emitLobbyUpdate = async (io) => {
    try {
        const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
        const games = await Game.find({ status: 'waiting', isPrivate: false, createdAt: { $gte: twoMinutesAgo } }).populate('creator', 'username avatar').sort({ createdAt: -1 });
        io.to('lobby').emit('lobby_update', games);
    } catch (error) { console.error("[Erro Lobby]", error); }
};

async function emitGameStateUpdate(io, gameId) {
    try {
        const game = await Game.findOne({ gameId: gameId }).populate('players', 'username avatar');
        if (!game) return;
        for (const player of game.players) {
            const playerColor = game.players[0]._id.equals(player._id) ? 'w' : 'b';
            let validMoves = [];
            if (game.status === 'in_progress' && game.currentPlayer && game.currentPlayer.equals(player._id)) {
                validMoves = getPossibleMovesForPlayer(game.boardState, playerColor);
            }
            const gameStateForPlayer = { ...game.toObject(), validMoves };
            io.to(player._id.toString()).emit('game_state_update', gameStateForPlayer);
        }
    } catch(err) {
        console.error("Erro ao emitir GameStateUpdate", err);
    }
}

module.exports = function(io) {
    io.on('connection', (socket) => {
        const userId = socket.handshake.query.userId;
        if (!userId) return socket.disconnect(true);

        socket.join(userId);
        socket.join('lobby');

        if (disconnectionTimers.has(userId)) {
            clearTimeout(disconnectionTimers.get(userId));
            disconnectionTimers.delete(userId);
            console.log(`[Reconexão] Utilizador ${userId} reconectado. Timer de abandono cancelado.`);
        }

        socket.on('disconnect', () => {
            console.log(`[Desconexão] Socket ${socket.id} (user: ${userId}) desconectado.`);
            setTimeout(() => {
                const room = io.sockets.adapter.rooms.get(userId);
                if (!room || room.size === 0) {
                    handleUserDisconnection(io, userId);
                }
            }, 1000);
        });

        socket.on('subscribe_to_game', async ({ gameId }) => {
            try {
                const game = await Game.findOne({ gameId: gameId });
                if (game && game.players.map(p => p.toString()).includes(userId)) {
                    socket.join(gameId);
                    await emitGameStateUpdate(io, gameId);
                }
            } catch (error) {
                socket.emit('error_message', { message: 'Erro ao entrar na sala do jogo.' });
            }
        });

        socket.on('player_ready', async ({ gameId }) => {
            try {
                const game = await Game.findOne({ gameId });
                if (!game || !game.players.map(p => p.toString()).includes(userId) || game.status !== 'waiting') return;
                if (!game.ready.includes(userId)) {
                    game.ready.push(userId);
                }
                if (game.players.length === 2 && game.ready.length === 2) {
                    game.status = 'in_progress';
                    const startingPlayerColor = 'w';
                    const startingPlayerId = game.players[0];
                    const opponentPlayerId = game.players[1];
                    const initialMoves = getPossibleMovesForPlayer(game.boardState, startingPlayerColor);
                    if (initialMoves.length === 0) {
                        await game.save();
                        await endGame(io, game.gameId, { winnerId: opponentPlayerId, loserId: startingPlayerId, reason: 'checkmate' });
                        return;
                    }
                }
                await game.save();
                await emitGameStateUpdate(io, gameId);
            } catch (error) {
                console.error(`[ERRO] Falha em player_ready para gameId ${gameId}:`, error);
                socket.emit('error_message', { message: 'Erro ao confirmar prontidão.' });
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
                const minBet = settings?.minBet || 50;
                const maxBet = settings?.maxBet || 5000;
                if (betAmount < minBet || betAmount > maxBet) throw new Error(`A aposta deve estar entre ${minBet} e ${maxBet} MT.`);
                const balanceField = user.activeBettingMode === 'bonus' ? 'bonusBalance' : 'balance';
                if (user[balanceField] < betAmount) throw new Error('Saldo insuficiente na carteira ativa.');
                user[balanceField] -= betAmount;
                const gameData = { players: [user._id], creator: user._id, betAmount, bettingMode: user.activeBettingMode, boardState: createInitialBoard(), currentPlayer: user._id, isPrivate, lobbyDescription: description || '' };
                if (isPrivate) gameData.gameCode = `P${generateNumericId(5)}`;
                const game = new Game(gameData);
                await user.save({ session });
                await game.save({ session });
                await session.commitTransaction();
                if (isPrivate) socket.emit('private_game_created_show_code', { privateCode: game.gameCode });
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
                const game = await Game.findOne({ $or: [{ gameId: gameCodeOrId }, { gameCode: gameCodeOrId.toUpperCase() }], status: 'waiting' }).session(session);
                if (!game) throw new Error('Partida não encontrada, expirada ou já iniciada.');
                if (game.players.includes(userId)) throw new Error('Não pode entrar na sua própria partida.');
                const joiner = await User.findById(userId).session(session);
                const balanceField = game.bettingMode === 'bonus' ? 'bonusBalance' : 'balance';
                if (joiner[balanceField] < game.betAmount) throw new Error('Saldo insuficiente para entrar nesta partida.');
                joiner[balanceField] -= game.betAmount;
                game.players.push(joiner._id);
                await joiner.save({ session });
                await game.save({ session });
                await session.commitTransaction();
                const populatedGame = await Game.findById(game._id).populate('players', 'username avatar');
                io.to(populatedGame.players[0]._id.toString()).emit('game_start', populatedGame);
                io.to(populatedGame.players[1]._id.toString()).emit('game_start', populatedGame);
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
                const game = await Game.findOne({ gameId: gameId });
                if (!game || game.status !== 'in_progress' || !game.currentPlayer.equals(userId)) return;
                const playerColor = game.players[0]._id.equals(userId) ? 'w' : 'b';
                const validMoves = getPossibleMovesForPlayer(game.boardState, playerColor);
                const isValidMove = validMoves.some(m => JSON.stringify(m.from) === JSON.stringify(move.from) && JSON.stringify(m.to) === JSON.stringify(move.to));
                if (!isValidMove) return;
                game.boardState = applyMoveToBoard(game.boardState, move);
                game.moveHistory.push({ player: userId, from: move.from, to: move.to, captured: move.captured });
                const winCondition = checkWinCondition(game.boardState, playerColor);
                if (winCondition.winner) {
                    const loserId = game.players.find(p => !p.equals(userId));
                    await endGame(io, game.gameId, { winnerId: userId, loserId, reason: 'checkmate' });
                    return;
                }
                game.currentPlayer = game.players.find(p => !p.equals(userId));
                await game.save();
                await emitGameStateUpdate(io, gameId);
            } catch (error) { console.error("Erro em 'make_move':", error); }
        });

        socket.on('surrender', async ({ gameId }) => {
            try {
                const game = await Game.findOne({ gameId: gameId, status: 'in_progress', players: userId });
                if (!game) return;
                const winnerId = game.players.find(p => !p.equals(userId));
                await endGame(io, game.gameId, { winnerId, loserId: userId, reason: 'resignation' });
            } catch (error) { console.error("Erro em 'surrender':", error); }
        });
    });
};