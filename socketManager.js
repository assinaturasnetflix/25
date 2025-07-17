// =========================================================================
// FICHEIRO: socketManager.js (VERSÃO FINAL COM LÓGICA DE "PRONTO")
// =========================================================================

const { User, Game, Setting } = require('./models');
const { getPossibleMovesForPlayer, applyMoveToBoard, checkWinCondition, createInitialBoard } = require('./gameLogic');
const mongoose = require('mongoose');
const { generateNumericId } = require('./utils');

const disconnectionTimers = new Map();

async function handleUserDisconnection(io, userId) {
    // SÓ ABANDONA O JOGO SE ESTIVER 'in_progress'
    const timer = setTimeout(async () => {
        try {
            const activeGame = await Game.findOne({ players: userId, status: 'in_progress' });
            if (activeGame) {
                const winnerId = activeGame.players.find(p => p.toString() !== userId).toString();
                console.log(`[Abandono] Jogo ${activeGame.gameId} abandonado por ${userId}. Vencedor: ${winnerId}`);
                await endGame(io, activeGame.gameId, { winnerId, loserId: userId, reason: 'abandonment' });
            }
            disconnectionTimers.delete(userId);
        } catch (error) {
            console.error(`[Erro Abandono] Falha ao processar abandono para ${userId}:`, error);
        }
    }, 15000); // 15 segundos de tolerância

    disconnectionTimers.set(userId, timer);
    console.log(`[Timer Desconexão] Timer de 15s iniciado para utilizador ${userId}.`);
}

async function endGame(io, gameId, result) {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const game = await Game.findOne({ gameId: gameId }).session(session);
        if (!game || ['completed', 'abandoned'].includes(game.status)) {
            await session.abortTransaction(); session.endSession(); return;
        }
        const { winnerId, loserId, reason, isDraw } = result;
        game.status = reason === 'abandonment' ? 'abandoned' : 'completed';
        if (!isDraw) {
            const winner = await User.findById(winnerId).session(session);
            const loser = await User.findById(loserId).session(session);
            if (winner && loser) {
                game.winner = winner._id;
                winner.stats.wins += 1; loser.stats.losses += 1;
                const settings = await Setting.findOne({ singleton: 'main_settings' }).session(session);
                const totalPot = game.betAmount * 2;
                game.commissionAmount = totalPot * (settings.platformCommission || 0.15);
                const winnerPrize = totalPot - game.commissionAmount;
                if (game.bettingMode === 'real') winner.balance += winnerPrize;
                else winner.bonusBalance += winnerPrize;
                await winner.save({ session }); await loser.save({ session });
            }
        } else {
             const [p1, p2] = await Promise.all([User.findById(game.players[0]).session(session), User.findById(game.players[1]).session(session)]);
             if(p1 && p2) {
                if (game.bettingMode === 'real') { p1.balance += game.betAmount; p2.balance += game.betAmount; }
                else { p1.bonusBalance += game.betAmount; p2.bonusBalance += game.betAmount; }
                await p1.save({ session }); await p2.save({ session });
             }
             game.winner = null;
        }
        await game.save({ session });
        await session.commitTransaction();
        const finalGame = await Game.findOne({ gameId: gameId }).populate('winner', 'username avatar').populate('players', 'username avatar');
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
}

module.exports = function(io) {
    io.on('connection', (socket) => {
        const userId = socket.handshake.query.userId;
        if (!userId) return socket.disconnect(true);
        
        console.log(`[Conexão] Utilizador ${userId} conectado com socket ${socket.id}.`);
        socket.join('lobby');
        socket.join(userId);

        if (disconnectionTimers.has(userId)) {
            clearTimeout(disconnectionTimers.get(userId));
            disconnectionTimers.delete(userId);
            console.log(`[Reconexão] Utilizador ${userId} reconectado. Timer de abandono cancelado.`);
        }

        socket.on('subscribe_to_game', async ({ gameId }) => {
            try {
                const game = await Game.findOne({ gameId: gameId });
                if (game && game.players.map(p => p.toString()).includes(userId)) {
                    socket.join(gameId);
                    console.log(`[Jogo] Socket ${socket.id} (user: ${userId}) subscreveu ao jogo ${gameId}`);
                    await emitGameStateUpdate(io, gameId);
                } else {
                    socket.emit('error_message', { message: 'Jogo não encontrado ou você não é um jogador.' });
                }
            } catch (error) {
                console.error(`[ERRO] Falha em subscribe_to_game para gameId ${gameId}:`, error);
                socket.emit('error_message', { message: 'Erro ao entrar na sala do jogo.' });
            }
        });

        socket.on('player_ready', async ({ gameId }) => {
            try {
                const game = await Game.findOne({ gameId });
                // Garante que o jogador pertence ao jogo e o jogo ainda está à espera
                if (!game || !game.players.map(p => p.toString()).includes(userId) || game.status !== 'waiting') return;
                
                // Adiciona o jogador à lista de prontos se ainda não estiver lá
                if (!game.ready.includes(userId)) {
                    game.ready.push(userId);
                }
                
                // Se ambos os jogadores estiverem na sala e ambos estiverem prontos, inicia o jogo
                if (game.players.length === 2 && game.ready.length === 2) {
                    game.status = 'in_progress';
                    console.log(`[Início Confirmado] Jogo ${game.gameId} iniciado após ambos os jogadores confirmarem.`);
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
                if (!settings || betAmount < settings.minBet || betAmount > settings.maxBet) throw new Error(`A aposta deve estar entre ${settings.minBet} e ${settings.maxBet} MT.`);
                const balanceField = user.activeBettingMode === 'bonus' ? 'bonusBalance' : 'balance';
                if (user[balanceField] < betAmount) throw new Error('Saldo insuficiente na carteira ativa.');
                user[balanceField] -= betAmount;
                const gameData = { players: [user._id], creator: user._id, betAmount, bettingMode: user.activeBettingMode, boardState: createInitialBoard(), isPrivate, lobbyDescription: isPrivate ? '' : description };
                if (isPrivate) gameData.gameCode = `P${generateNumericId(5)}`;
                const game = new Game(gameData);
                await user.save({ session });
                await game.save({ session });
                await session.commitTransaction();
                if (isPrivate) socket.emit('private_game_created_show_code', { privateCode: game.gameCode });
                emitLobbyUpdate(io);
            } catch (error) {
                await session.abortTransaction();
                const userToRefund = await User.findById(userId);
                if (userToRefund) {
                     const balanceField = userToRefund.activeBettingMode === 'bonus' ? 'bonusBalance' : 'balance';
                     userToRefund[balanceField] += betAmount;
                     await userToRefund.save();
                }
                socket.emit('error_message', { message: error.message || 'Erro ao criar a partida.' });
            } finally {
                session.endSession();
            }
        });

        socket.on('join_game', async ({ gameCodeOrId }) => {
            const session = await mongoose.startSession();
            session.startTransaction();
            try {
                // NÃO muda o status para 'in_progress' aqui. Só adiciona o jogador.
                const game = await Game.findOne({ $or: [{ gameId: gameCodeOrId }, { gameCode: gameCodeOrId.toUpperCase() }], status: 'waiting' }).session(session);
                if (!game) throw new Error('Partida não encontrada, expirada ou já iniciada.');
                if (game.players.includes(userId)) throw new Error('Não pode entrar na sua própria partida.');
                const joiner = await User.findById(userId).session(session);
                const balanceField = game.bettingMode === 'bonus' ? 'bonusBalance' : 'balance';
                if (joiner[balanceField] < game.betAmount) throw new Error('Saldo insuficiente para entrar nesta partida.');
                joiner[balanceField] -= game.betAmount;
                game.players.push(joiner._id);
                game.currentPlayer = game.players[0]; // Define o primeiro jogador
                await joiner.save({ session });
                await game.save({ session });
                await session.commitTransaction();
                const populatedGame = await Game.findById(game._id);
                const creatorId = populatedGame.players[0]._id.toString();
                const joinerId = populatedGame.players[1]._id.toString();
                console.log(`[Join] Jogador ${joinerId} entrou no jogo ${game.gameId}. Notificando ambos para irem para a sala de espera.`);
                io.to(creatorId).emit('game_start', populatedGame);
                io.to(joinerId).emit('game_start', populatedGame);
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
            } catch(error) { console.error("Erro em 'make_move':", error); }
        });

        socket.on('surrender', async ({ gameId }) => {
            try {
                const game = await Game.findOne({ gameId: gameId, status: 'in_progress', players: userId });
                if (!game) return;
                const winnerId = game.players.find(p => !p.equals(userId));
                await endGame(io, game.gameId, { winnerId, loserId: userId, reason: 'resignation' });
            } catch (error) { console.error("Erro em 'surrender':", error); }
        });
        
        socket.on('disconnect', () => {
            console.log(`[Desconexão] Socket ${socket.id} (user: ${userId}) desconectado.`);
            setTimeout(() => {
                const room = io.sockets.adapter.rooms.get(userId);
                if (!room || room.size === 0) {
                    handleUserDisconnection(io, userId);
                }
            }, 500);
        });
    });
};