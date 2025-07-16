const { Game, User, Setting } = require('./models');
const { createInitialBoard, getPossibleMovesForPlayer, applyMoveToBoard, checkWinCondition } = require('./gameLogic');
const mongoose = require('mongoose');

let activeUsers = {};
let activeLobbies = {};

const getLiveSettings = async () => {
    let settings = await Setting.findOne({ singleton: 'main_settings' });
    if (!settings) {
        settings = await Setting.create({ singleton: 'main_settings' });
    }
    return settings;
};

const socketManager = (io) => {
    io.on('connection', (socket) => {
        const userId = socket.handshake.query.userId;
        if (userId) {
            activeUsers[userId] = socket.id;
            socket.join(userId);
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
            const creatorId = Object.keys(activeUsers).find(key => activeUsers[key] === socket.id);
            const creator = await User.findById(creatorId);
            const settings = await getLiveSettings();

            const activeBalance = creator.activeBettingMode === 'real' ? creator.balance : creator.bonusBalance;
            if (!creator || activeBalance < betAmount) {
                return io.to(socket.id).emit('error_message', { message: `Saldo insuficiente na sua carteira de ${creator.activeBettingMode}.` });
            }
            if (betAmount < settings.minBet) {
                return io.to(socket.id).emit('error_message', { message: `A aposta mínima é ${settings.minBet} MT.` });
            }

            const gameData = {
                players: [creatorId],
                boardState: createInitialBoard(),
                currentPlayer: creatorId,
                status: 'waiting',
                betAmount,
                bettingMode: creator.activeBettingMode,
                lobbyDescription: description,
                isPrivate,
                ready: []
            };

            if (isPrivate) {
                gameData.gameCode = `P${Math.random().toString().substring(2, 8)}`;
            }
            
            const game = new Game(gameData);
            await game.save();
            
            if (isPrivate) {
                io.to(socket.id).emit('private_game_created_show_code', { privateCode: game.gameCode });
            } else {
                const lobbyData = {
                    gameId: game.id,
                    creator: { _id: creator._id, username: creator.username, avatar: creator.avatar },
                    betAmount: game.betAmount,
                    bettingMode: game.bettingMode,
                    description: game.lobbyDescription,
                    createdAt: game.createdAt
                };

                const expiryTimer = setTimeout(async () => {
                    const gameToExpire = await Game.findById(game.id);
                    if (gameToExpire && gameToExpire.players.length === 1) {
                        await Game.findByIdAndDelete(game.id);
                        delete activeLobbies[game.id.toString()];
                        io.emit('lobby_update', Object.values(activeLobbies).map(l => l.data));
                        io.to(socket.id).emit('game_expired', { message: 'A sua partida expirou por falta de oponentes.' });
                    }
                }, 120000); 

                activeLobbies[game.id] = { data: lobbyData, expiryTimer };
                io.emit('lobby_update', Object.values(activeLobbies).map(l => l.data));
            }
        });
        
        socket.on('cancel_game', async ({ gameId }) => {
            const userId = Object.keys(activeUsers).find(key => activeUsers[key] === socket.id);
            if (!userId) return;
            const game = await Game.findById(gameId);
            if (!game || !game.players[0].equals(userId)) return;
            const lobbyEntry = activeLobbies[gameId];
            if (lobbyEntry) clearTimeout(lobbyEntry.expiryTimer);
            await Game.findByIdAndDelete(gameId);
            delete activeLobbies[gameId];
            io.emit('lobby_update', Object.values(activeLobbies).map(l => l.data));
            io.to(socket.id).emit('game_cancelled', { message: 'Partida cancelada com sucesso.' });
        });

        socket.on('join_game', async ({ gameCodeOrId }) => {
            const joinerId = Object.keys(activeUsers).find(key => activeUsers[key] === socket.id);
            const joiner = await User.findById(joinerId);
            
            let gameToJoin;
            if (mongoose.Types.ObjectId.isValid(gameCodeOrId)) {
                gameToJoin = await Game.findById(gameCodeOrId);
            } else {
                gameToJoin = await Game.findOne({ gameCode: gameCodeOrId, status: 'waiting' });
            }

            if (!gameToJoin || gameToJoin.status !== 'waiting') return io.to(socket.id).emit('error_message', { message: 'Partida não encontrada ou já iniciada.' });
            if (gameToJoin.players[0].equals(joinerId)) return io.to(socket.id).emit('error_message', { message: 'Não pode entrar na sua própria partida.' });
            
            if (joiner.activeBettingMode !== gameToJoin.bettingMode) {
                return io.to(socket.id).emit('error_message', { message: `Esta partida requer a carteira de ${gameToJoin.bettingMode}. Por favor, altere a sua carteira ativa.` });
            }

            const activeBalance = joiner.activeBettingMode === 'real' ? joiner.balance : joiner.bonusBalance;
            if (activeBalance < gameToJoin.betAmount) {
                return io.to(socket.id).emit('error_message', { message: 'Saldo insuficiente na sua carteira ativa.' });
            }

            const lobbyEntry = activeLobbies[gameToJoin.id.toString()];
            if (lobbyEntry) clearTimeout(lobbyEntry.expiryTimer);

            gameToJoin.players.push(joinerId);
            await gameToJoin.save();
            
            const populatedGame = await Game.findById(gameToJoin.id).populate('players', 'username avatar');
            const creatorSocketId = activeUsers[gameToJoin.players[0].toString()];
            if (creatorSocketId) {
                const creatorSocket = io.sockets.sockets.get(creatorSocketId);
                if (creatorSocket) creatorSocket.join(populatedGame.id.toString());
            }
            socket.join(populatedGame.id.toString());

            if (activeLobbies[populatedGame.id.toString()]) {
                delete activeLobbies[populatedGame.id.toString()];
                io.emit('lobby_update', Object.values(activeLobbies).map(l => l.data));
            }
            
            io.to(populatedGame.id.toString()).emit('game_session_ready', populatedGame);
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
                         io.to(gameId).emit('error_message', { message: 'Um dos jogadores não tem saldo real suficiente. A partida foi cancelada.' });
                         await Game.findByIdAndDelete(gameId);
                         return;
                    }
                    player1.balance -= game.betAmount;
                    player2.balance -= game.betAmount;
                } else {
                    if (player1.bonusBalance < game.betAmount || player2.bonusBalance < game.betAmount) {
                         io.to(gameId).emit('error_message', { message: 'Um dos jogadores não tem saldo de bónus suficiente. A partida foi cancelada.' });
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
            } else {
                await game.save();
                io.to(gameId).emit('update_ready_status', { userId });
            }
        });
        
        const handleGameOver = async (game, winnerId, loserId, surrendered = false) => {
            const settings = await getLiveSettings();
            
            const totalPot = game.betAmount * 2;
            const commission = totalPot * settings.platformCommission;
            const prizePool = totalPot - commission;
            
            const winnerUser = await User.findById(winnerId);
            const loserUser = await User.findById(loserId);

            if (game.bettingMode === 'real') {
                winnerUser.balance += prizePool;
            } else {
                winnerUser.bonusBalance += prizePool;
            }
            
            winnerUser.stats.wins += 1;
            loserUser.stats.losses += 1;

            await winnerUser.save();
            await loserUser.save();

            game.status = 'completed';
            game.winner = winnerId;
            game.commissionAmount = commission;
            
            const piecesCaptured = game.moveHistory
                .filter(m => m.player.equals(winnerId))
                .reduce((acc, m) => acc + (m.captured ? m.captured.length : 0), 0);

            const finalStats = {
                winner: winnerUser.toObject(),
                prize: prizePool,
                moves: game.moveHistory.length,
                piecesCaptured,
                surrendered,
            };

            await game.save();
            io.to(game.id).emit('game_over', finalStats);
        };

        socket.on('make_move', async ({ gameId, move }) => {
            const game = await Game.findById(gameId).populate('players');
            const playerId = Object.keys(activeUsers).find(key => activeUsers[key] === socket.id);

            if (!game || !playerId || !game.currentPlayer.equals(playerId)) return;
            
            const playerSymbol = game.players[0]._id.toString() === playerId ? 'b' : 'w';
            const possibleMoves = getPossibleMovesForPlayer(game.boardState, playerSymbol);
            
            const isValidMove = possibleMoves.some(pMove => 
                JSON.stringify(pMove.from) === JSON.stringify(move.from) &&
                JSON.stringify(pMove.to) === JSON.stringify(move.to)
            );

            if (!isValidMove) return;
            
            const fullMove = possibleMoves.find(pMove => 
                JSON.stringify(pMove.from) === JSON.stringify(move.from) &&
                JSON.stringify(pMove.to) === JSON.stringify(move.to)
            );
            move.captured = fullMove.captured;

            game.boardState = applyMoveToBoard(game.boardState, move);
            
            const opponent = game.players.find(p => !p._id.equals(playerId));
            game.currentPlayer = opponent._id;
            game.moveHistory.push({ player: new mongoose.Types.ObjectId(playerId), from: {r: move.from[0], c: move.from[1]}, to: {r: move.to[0], c: move.to[1]}, captured: move.captured });
            
            const winState = checkWinCondition(game.boardState, playerSymbol);
            if (winState.winner) {
                await handleGameOver(game, playerId, opponent._id);
            } else {
                await game.save();
                io.to(game.id).emit('move_made', { boardState: game.boardState, currentPlayer: game.currentPlayer, move: move });
            }
        });

        socket.on('surrender', async ({ gameId }) => {
            const game = await Game.findById(gameId).populate('players');
            const surrendererId = Object.keys(activeUsers).find(key => activeUsers[key] === socket.id);
            if (!game || !surrendererId || !['in_progress', 'waiting'].includes(game.status)) return;

            const winner = game.players.find(p => !p._id.equals(surrendererId));
            if (!winner) return;
            
            if (game.status === 'in_progress') {
                await handleGameOver(game, winner._id, surrendererId, true);
            } else {
                game.status = 'abandoned';
                game.winner = winner._id;
                await game.save();
                io.to(game.id).emit('game_over', { surrendered: true, winner: winner.toObject() });
            }
        });
        
        socket.on('disconnect', () => {
            const userId = Object.keys(activeUsers).find(key => activeUsers[key] === socket.id);
            if (userId) {
                delete activeUsers[userId];
            }
        });
    });
};

module.exports = socketManager;