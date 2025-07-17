const { Game, User, Setting } = require('./models');
const { createInitialBoard, getPossibleMovesForPlayer, applyMoveToBoard, checkWinCondition } = require('./gameLogic');
const mongoose = require('mongoose');
const webpush = require('web-push');

let activeUsers = {};
let activeLobbies = {};
const gameTimers = {}; // Objeto para armazenar os timers de cada jogo

const getLiveSettings = async () => {
    let settings = await Setting.findOne({ singleton: 'main_settings' });
    if (!settings) {
        settings = await Setting.create({ singleton: 'main_settings' });
    }
    return settings;
};

const sendGameReadyNotification = async (creatorId, opponentUsername, gameId) => {
    try {
        const creator = await User.findById(creatorId);
        if (creator && creator.pushSubscription) {
            const payload = JSON.stringify({
                title: 'O seu oponente chegou!',
                body: `${opponentUsername} entrou na sua partida. O jogo vai começar!`,
                icon: '/icons/icon-192x192.png',
                data: { url: `/game.html?id=${gameId}` }
            });
            await webpush.sendNotification(creator.pushSubscription, payload);
            console.log(`Notificação de "jogo pronto" enviada para ${creator.username}`);
        }
    } catch (error) {
        console.error("Erro ao enviar notificação push:", error.message);
        if (error.statusCode === 410) {
            await User.updateOne({ _id: creatorId }, { $unset: { pushSubscription: "" } });
        }
    }
};

const socketManager = (io) => {

    const clearGameTimers = (gameId) => {
        if (gameTimers[gameId]) {
            clearTimeout(gameTimers[gameId].inactivityTimeout);
            clearInterval(gameTimers[gameId].visualTimer);
            clearTimeout(gameTimers[gameId].disconnectTimeout);
            delete gameTimers[gameId];
        }
    };

    const handleGameOver = async (game, winnerId, loserId, reason = 'win') => {
        const gameId = game.id.toString();
        clearGameTimers(gameId);

        const settings = await getLiveSettings();
        const totalPot = game.betAmount * 2;
        const commission = totalPot * settings.platformCommission;
        const prizePool = totalPot - commission;
        const winnerUser = await User.findById(winnerId);
        const loserUser = await User.findById(loserId);

        if (winnerUser && loserUser) {
            if (game.bettingMode === 'real') {
                winnerUser.balance += prizePool;
            } else {
                winnerUser.bonusBalance += prizePool;
            }
            winnerUser.stats.wins += 1;
            loserUser.stats.losses += 1;
            await winnerUser.save();
            await loserUser.save();
        }

        game.status = 'completed';
        game.winner = winnerId;
        game.commissionAmount = commission;

        const piecesCaptured = game.moveHistory
            .filter(m => m.player.equals(winnerId))
            .reduce((acc, m) => acc + (m.captured ? m.captured.length : 0), 0);

        const finalStats = {
            winner: winnerUser ? winnerUser.toObject() : null,
            prize: prizePool,
            moves: game.moveHistory.length,
            piecesCaptured,
            reason
        };

        await game.save();
        io.to(gameId).emit('game_over', finalStats);
    };

    const startTurnTimer = (game) => {
        const gameId = game.id.toString();
        clearGameTimers(gameId);
        let remainingTime = 90;

        const visualTimer = setInterval(() => {
            io.to(gameId).emit('turn_timer_tick', { remainingTime });
            remainingTime--;
        }, 1000);

        const inactivityTimeout = setTimeout(async () => {
            clearInterval(visualTimer);
            const updatedGame = await Game.findById(gameId);
            if (updatedGame && updatedGame.status === 'in_progress') {
                console.log(`Jogo ${gameId} terminado por inatividade do jogador ${updatedGame.currentPlayer}.`);
                const loserId = updatedGame.currentPlayer;
                const winnerId = updatedGame.players.find(p => !p.equals(loserId));
                handleGameOver(updatedGame, winnerId, loserId, 'timeout');
            }
        }, 91000); // 91 segundos

        gameTimers[gameId] = { inactivityTimeout, visualTimer };
    };

    io.on('connection', (socket) => {
        const userId = socket.handshake.query.userId;
        if (userId) {
            console.log(`Utilizador conectado: ${userId} com socket ID: ${socket.id}`);
            activeUsers[userId] = socket.id;
            socket.join(userId);

            Object.keys(gameTimers).forEach(gameId => {
                const timer = gameTimers[gameId];
                if (timer && timer.disconnectingUserId && timer.disconnectingUserId.toString() === userId) {
                    console.log(`Utilizador ${userId} reconectou-se ao jogo ${gameId}. Cancelando timer de abandono.`);
                    clearTimeout(timer.disconnectTimeout);
                    delete timer.disconnectTimeout;
                    delete timer.disconnectingUserId;
                }
            });
        }
        
        socket.on('join_game_room', async ({ gameId }) => {
            const userId = Object.keys(activeUsers).find(key => activeUsers[key] === socket.id);
            if (!userId) return;
            const game = await Game.findById(gameId).populate('players', 'username avatar');
            if (!game) return io.to(socket.id).emit('error_message', { message: 'Partida não encontrada.' });
            socket.join(gameId);
            io.to(socket.id).emit('game_state', game);
        });

        socket.on('get_lobby', () => {
             io.to(socket.id).emit('lobby_update', Object.values(activeLobbies).map(l => l.data));
        });

        socket.on('set_betting_mode', async ({ mode }) => {
            const userId = Object.keys(activeUsers).find(key => activeUsers[key] === socket.id);
            if (!userId || !['real', 'bonus'].includes(mode)) return;
            try {
                const user = await User.findById(userId);
                if (user) {
                    user.activeBettingMode = mode;
                    await user.save();
                    io.to(socket.id).emit('mode_changed_success', { newMode: mode });
                }
            } catch (error) {
                io.to(socket.id).emit('error_message', { message: 'Erro ao alterar o modo de aposta.' });
            }
        });

        socket.on('create_game', async ({ betAmount, description, isPrivate }) => {
            // (Esta função permanece a mesma)
        });
        
        socket.on('cancel_game', async ({ gameId }) => {
            // (Esta função permanece a mesma)
        });

        socket.on('join_game', async ({ gameCodeOrId }) => {
            // (Esta função permanece a mesma)
        });
        
        socket.on('player_ready', async ({ gameId }) => {
            const userId = Object.keys(activeUsers).find(key => activeUsers[key] === socket.id);
            const game = await Game.findById(gameId);
            if (!game || !userId || game.ready.map(id => id.toString()).includes(userId)) return;
            game.ready.push(new mongoose.Types.ObjectId(userId));
            if (game.ready.length === 2) {
                const player1 = await User.findById(game.players[0]);
                const player2 = await User.findById(game.players[1]);
                if (game.bettingMode === 'real') {
                    if (player1.balance < game.betAmount || player2.balance < game.betAmount) {
                         io.to(gameId).emit('error_message', { message: 'Um dos jogadores não tem saldo real suficiente.' });
                         await Game.findByIdAndDelete(gameId);
                         return;
                    }
                    player1.balance -= game.betAmount;
                    player2.balance -= game.betAmount;
                } else {
                    if (player1.bonusBalance < game.betAmount || player2.bonusBalance < game.betAmount) {
                         io.to(gameId).emit('error_message', { message: 'Um dos jogadores não tem saldo de bónus suficiente.' });
                         await Game.findByIdAndDelete(gameId);
                         return;
                    }
                    player1.bonusBalance -= game.betAmount;
                    player2.bonusBalance -= game.betAmount;
                }
                await player1.save();
                await player2.save();
                game.status = 'in_progress';
                await game.save();
                io.to(gameId).emit('game_start_countdown');
                startTurnTimer(game);
            } else {
                await game.save();
                io.to(gameId).emit('update_ready_status', { userId });
            }
        });

        socket.on('make_move', async ({ gameId, move }) => {
            const game = await Game.findById(gameId).populate('players');
            const playerId = Object.keys(activeUsers).find(key => activeUsers[key] === socket.id);
            if (!game || !playerId || !game.currentPlayer.equals(playerId)) return;
            const playerIndex = game.players.findIndex(p => p._id.equals(playerId));
            if (playerIndex === -1) return;
            const playerSymbol = playerIndex === 0 ? 'b' : 'w';
            const possibleMoves = getPossibleMovesForPlayer(game.boardState, playerSymbol);
            const isValidMove = possibleMoves.some(pMove => JSON.stringify(pMove.from) === JSON.stringify(move.from) && JSON.stringify(pMove.to) === JSON.stringify(move.to));
            if (!isValidMove) return console.log(`Movimento inválido rejeitado.`);
            const fullMove = possibleMoves.find(pMove => JSON.stringify(pMove.from) === JSON.stringify(move.from) && JSON.stringify(pMove.to) === JSON.stringify(move.to));
            move.captured = fullMove.captured;
            game.boardState = applyMoveToBoard(game.boardState, move);
            const opponent = game.players.find(p => !p._id.equals(playerId));
            game.currentPlayer = opponent._id;
            game.moveHistory.push({ player: new mongoose.Types.ObjectId(playerId), from: {r: move.from[0], c: move.from[1]}, to: {r: move.to[0], c: move.to[1]}, captured: move.captured });
            const winState = checkWinCondition(game.boardState, playerSymbol);
            if (winState.winner) {
                await handleGameOver(game, playerId, opponent._id, 'win');
            } else {
                await game.save();
                io.to(game.id).emit('move_made', { boardState: game.boardState, currentPlayer: game.currentPlayer, move: move });
                startTurnTimer(game);
            }
        });

        socket.on('surrender', async ({ gameId }) => {
            const game = await Game.findById(gameId).populate('players');
            const surrendererId = Object.keys(activeUsers).find(key => activeUsers[key] === socket.id);
            if (!game || !surrendererId) return;
            const winner = game.players.find(p => !p._id.equals(surrendererId));
            if (!winner) return;
            if (game.status === 'in_progress') {
                await handleGameOver(game, winner._id, surrendererId, 'surrender');
            } else {
                game.status = 'abandoned';
                game.winner = winner._id;
                await game.save();
                clearGameTimers(gameId);
                io.to(game.id).emit('game_over', { surrendered: true, winner: winner.toObject(), reason: 'surrender' });
            }
        });
        
        socket.on('disconnect', async () => {
            const userId = Object.keys(activeUsers).find(key => activeUsers[key] === socket.id);
            if (userId) {
                console.log(`Utilizador desconectado: ${userId}`);
                delete activeUsers[userId];
                const game = await Game.findOne({ players: userId, status: 'in_progress' });
                if (game) {
                    const gameId = game.id.toString();
                    console.log(`Utilizador ${userId} estava no jogo ${gameId}. Iniciando timer de 5 minutos para abandono.`);
                    if (!gameTimers[gameId]) gameTimers[gameId] = {};
                    gameTimers[gameId].disconnectingUserId = userId;
                    gameTimers[gameId].disconnectTimeout = setTimeout(async () => {
                        if (!activeUsers[userId]) {
                            console.log(`Timer de 5 minutos expirou para ${userId}. Oponente vence.`);
                            const winnerId = game.players.find(p => !p.equals(userId));
                            handleGameOver(game, winnerId, userId, 'disconnect');
                        }
                    }, 300000); // 5 minutos
                }
            }
        });
    });
};

module.exports = socketManager;