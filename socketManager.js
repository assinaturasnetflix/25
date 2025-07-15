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

        socket.on('create_game', async ({ betAmount, description, isPrivate }) => {
            const creatorId = Object.keys(activeUsers).find(key => activeUsers[key] === socket.id);
            const creator = await User.findById(creatorId);
            const settings = await getLiveSettings();

            if (!creator || creator.balance < betAmount) return io.to(socket.id).emit('error_message', { message: 'Saldo insuficiente.' });
            if (betAmount < settings.minBet) return io.to(socket.id).emit('error_message', { message: `A aposta mínima é ${settings.minBet} MT.` });

            // --- CORREÇÃO APLICADA AQUI ---
            // 1. Prepara os dados base do jogo.
            const gameData = {
                players: [creatorId],
                boardState: createInitialBoard(),
                currentPlayer: creatorId,
                status: 'waiting',
                betAmount,
                lobbyDescription: description,
                isPrivate,
                ready: []
            };

            // 2. Adiciona o gameCode APENAS se o jogo for privado.
            if (isPrivate) {
                gameData.gameCode = `P${Math.random().toString().substring(2, 8)}`;
            }
            
            // 3. Cria o jogo com os dados corretos.
            const game = new Game(gameData);
            await game.save();
            // --- FIM DA CORREÇÃO ---
            
            if (isPrivate) {
                io.to(socket.id).emit('private_game_created_show_code', { privateCode: game.gameCode });
            } else {
                const lobbyData = {
                    gameId: game.id,
                    creator: { _id: creator._id, username: creator.username, avatar: creator.avatar },
                    betAmount: game.betAmount,
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

                activeLobbies[game.id] = {
                    data: lobbyData,
                    expiryTimer: expiryTimer
                };

                io.emit('lobby_update', Object.values(activeLobbies).map(l => l.data));
            }
        });

        socket.on('cancel_game', async ({ gameId }) => {
            const userId = Object.keys(activeUsers).find(key => activeUsers[key] === socket.id);
            if (!userId) return;

            const game = await Game.findById(gameId);
            if (!game) return io.to(socket.id).emit('error_message', { message: 'Partida não encontrada.' });
            if (!game.players[0].equals(userId)) return io.to(socket.id).emit('error_message', { message: 'Apenas o criador pode cancelar a partida.' });

            const lobbyEntry = activeLobbies[gameId];
            if (lobbyEntry && lobbyEntry.expiryTimer) {
                clearTimeout(lobbyEntry.expiryTimer);
            }

            await Game.findByIdAndDelete(gameId);
            delete activeLobbies[gameId];
            
            io.emit('lobby_update', Object.values(activeLobbies).map(l => l.data));
            io.to(socket.id).emit('game_cancelled', { message: 'Partida cancelada com sucesso.' });
        });

        socket.on('join_game', async ({ gameCodeOrId }) => {
            const joinerId = Object.keys(activeUsers).find(key => activeUsers[key] === socket.id);
            const joiner = await User.findById(joinerId);
            const settings = await getLiveSettings();
            
            let gameToJoin;
            if (mongoose.Types.ObjectId.isValid(gameCodeOrId)) {
                gameToJoin = await Game.findById(gameCodeOrId);
            } else {
                gameToJoin = await Game.findOne({ gameCode: gameCodeOrId, status: 'waiting' });
            }

            if (!gameToJoin || gameToJoin.status !== 'waiting') return io.to(socket.id).emit('error_message', { message: 'Partida não encontrada ou já iniciada.' });
            if (gameToJoin.players[0].equals(joinerId)) return io.to(socket.id).emit('error_message', { message: 'Não pode entrar na sua própria partida.' });
            if (joiner.balance < gameToJoin.betAmount) return io.to(socket.id).emit('error_message', { message: 'Saldo insuficiente.' });

            const lobbyEntry = activeLobbies[gameToJoin.id.toString()];
            if (lobbyEntry && lobbyEntry.expiryTimer) {
                clearTimeout(lobbyEntry.expiryTimer);
            }

            const creatorId = gameToJoin.players[0];
            gameToJoin.players.push(joinerId);
            await gameToJoin.save();
            
            const populatedGame = await Game.findById(gameToJoin.id).populate('players', 'username avatar');
            const creatorSocketId = activeUsers[creatorId.toString()];
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
            await game.save();

            io.to(gameId).emit('update_ready_status', { userId });

            if (game.ready.length === 2) {
                const settings = await getLiveSettings();
                const player1 = await User.findById(game.players[0]);
                const player2 = await User.findById(game.players[1]);
                player1.balance -= game.betAmount;
                player2.balance -= game.betAmount;
                await player1.save();
                await player2.save();
                game.status = 'in_progress';
                await game.save();
                io.to(gameId).emit('game_start_countdown');
            }
        });

        socket.on('get_possible_moves', async ({gameId, from}) => {
             const userId = Object.keys(activeUsers).find(key => activeUsers[key] === socket.id);
             const game = await Game.findById(gameId);
             if(!game || !userId || !game.currentPlayer.equals(userId)) return;

             const playerSymbol = game.players[0].toString() === userId.toString() ? 'b' : 'w';
             const moves = getPossibleMovesForPlayer(game.boardState, playerSymbol);
             const filteredMoves = moves.filter(m => m.from[0] === from[0] && m.from[1] === from[1]);
             io.to(socket.id).emit('possible_moves', filteredMoves);
        });

        socket.on('make_move', async ({ gameId, move }) => {
            const game = await Game.findById(gameId).populate('players', 'username avatar');
            const playerId = Object.keys(activeUsers).find(key => activeUsers[key] === socket.id);

            if (!game || !playerId || !game.currentPlayer.equals(playerId)) return;
            
            const playerSymbol = game.players[0]._id.toString() === playerId.toString() ? 'b' : 'w';
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
            game.moveHistory.push({ player: playerId, from: {r: move.from[0], c: move.from[1]}, to: {r: move.to[0], c: move.to[1]}, captured: move.captured });
            
            await game.save();
            
            const winState = checkWinCondition(game.boardState, playerSymbol);

            if (winState.winner) {
                const settings = await getLiveSettings();
                const updatedGame = await Game.findById(gameId).populate('players', 'username avatar');
                updatedGame.status = 'completed';
                updatedGame.winner = playerId;
                
                const winnerUser = await User.findById(playerId);
                const commission = updatedGame.betAmount * 2 * settings.platformCommission;
                const prize = (updatedGame.betAmount * 2) - commission;
                winnerUser.balance += prize;
                winnerUser.stats.wins += 1;
                await winnerUser.save();

                const loserUser = await User.findById(opponent._id);
                loserUser.stats.losses += 1;
                await loserUser.save();
                
                const piecesCaptured = updatedGame.moveHistory
                    .filter(m => m.player.equals(playerId))
                    .reduce((acc, m) => acc + m.captured.length, 0);

                const finalStats = {
                    winner: winnerUser.toObject(),
                    prize,
                    moves: updatedGame.moveHistory.length,
                    piecesCaptured,
                };

                await updatedGame.save();
                io.to(game.id).emit('game_over', finalStats);

            } else {
                io.to(game.id).emit('move_made', { boardState: game.boardState, currentPlayer: game.currentPlayer, move: move });
            }
        });

        socket.on('surrender', async ({ gameId }) => {
            const game = await Game.findById(gameId).populate('players', 'username avatar');
            const surrendererId = Object.keys(activeUsers).find(key => activeUsers[key] === socket.id);
            if (!game || !surrendererId || game.status !== 'in_progress') return;

            const winner = game.players.find(p => !p._id.equals(surrendererId));
            if (!winner) return;

            const settings = await getLiveSettings();
            game.status = 'completed';
            game.winner = winner._id;
            
            const winnerUser = await User.findById(winner._id);
            const commission = game.betAmount * 2 * settings.platformCommission;
            const prize = (game.betAmount * 2) - commission;
            winnerUser.balance += prize;
            winnerUser.stats.wins += 1;
            await winnerUser.save();

            const loserUser = await User.findById(surrendererId);
            loserUser.stats.losses += 1;
            await loserUser.save();
            
            const piecesCaptured = game.moveHistory
                .filter(m => m.player.equals(winner._id))
                .reduce((acc, m) => acc + m.captured.length, 0);

            const finalStats = {
                winner: winnerUser.toObject(),
                prize,
                moves: game.moveHistory.length,
                piecesCaptured,
                surrendered: true
            };
            
            await game.save();
            io.to(game.id).emit('game_over', finalStats);
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