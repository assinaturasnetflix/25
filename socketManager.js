const { Game, User } = require('./models');
const { createInitialBoard, getPossibleMovesForPlayer, applyMoveToBoard, checkWinCondition } = require('./gameLogic');
const config = require('./config');
const mongoose = require('mongoose');

let activeUsers = {};
let activeLobbies = {};

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
            if (!game) {
                return io.to(socket.id).emit('error_message', { message: 'Partida não encontrada.' });
            }
            
            socket.join(gameId);
            io.to(socket.id).emit('game_state', game);
        });

        socket.on('get_lobby', () => {
             io.to(socket.id).emit('lobby_update', Object.values(activeLobbies));
        });

        socket.on('create_lobby_game', async ({ betAmount, description }) => {
            const creatorId = Object.keys(activeUsers).find(key => activeUsers[key] === socket.id);
            const creator = await User.findById(creatorId);

            if (!creator || creator.balance < betAmount) {
                return io.to(socket.id).emit('error_message', { message: 'Saldo insuficiente.' });
            }
            if (betAmount < config.minBet) {
                return io.to(socket.id).emit('error_message', { message: `A aposta mínima é ${config.minBet} MT.` });
            }

            const game = new Game({
                players: [creatorId],
                boardState: createInitialBoard(),
                currentPlayer: creatorId,
                status: 'waiting',
                betAmount,
                lobbyDescription: description,
                ready: []
            });
            await game.save();
            
            activeLobbies[game.id] = {
                gameId: game.id,
                creator: { _id: creator._id, username: creator.username, avatar: creator.avatar },
                betAmount: game.betAmount,
                description: game.lobbyDescription
            };
            io.emit('lobby_update', Object.values(activeLobbies));
        });
        
        socket.on('create_private_game', async ({ betAmount }) => {
            const creatorId = Object.keys(activeUsers).find(key => activeUsers[key] === socket.id);
            const creator = await User.findById(creatorId);
            if (!creator || creator.balance < betAmount) {
                return io.to(socket.id).emit('error_message', { message: 'Saldo insuficiente.' });
            }
            if (betAmount < config.minBet) {
                return io.to(socket.id).emit('error_message', { message: `A aposta mínima é ${config.minBet} MT.` });
            }
            const game = new Game({
                players: [creatorId],
                boardState: createInitialBoard(),
                currentPlayer: creatorId,
                status: 'waiting',
                betAmount,
                isPrivate: true,
                privateGameCode: `P${Math.random().toString().substring(2, 8)}`,
                ready: []
            });
            await game.save();
            io.to(socket.id).emit('private_game_created_show_code', { privateCode: game.privateGameCode });
        });

        socket.on('join_game', async ({ gameId, privateCode }) => {
            const joinerId = Object.keys(activeUsers).find(key => activeUsers[key] === socket.id);
            const joiner = await User.findById(joinerId);
            let gameToJoin;
            if (gameId) {
                gameToJoin = await Game.findById(gameId);
            } else if (privateCode) {
                gameToJoin = await Game.findOne({ privateGameCode, status: 'waiting' });
            }

            if (!gameToJoin || gameToJoin.status !== 'waiting') return io.to(socket.id).emit('error_message', { message: 'Partida não encontrada ou já iniciada.' });
            if (gameToJoin.players[0].equals(joinerId)) return io.to(socket.id).emit('error_message', { message: 'Não pode entrar na sua própria partida.' });
            if (joiner.balance < gameToJoin.betAmount) return io.to(socket.id).emit('error_message', { message: 'Saldo insuficiente.' });

            gameToJoin.players.push(joinerId);
            await gameToJoin.save();
            
            const populatedGame = await Game.findById(gameToJoin.id).populate('players', 'username avatar');
            const creatorId = populatedGame.players[0]._id.toString();
            const creatorSocketId = activeUsers[creatorId];
            if (creatorSocketId) {
                const creatorSocket = io.sockets.sockets.get(creatorSocketId);
                if (creatorSocket) creatorSocket.join(populatedGame.id.toString());
            }
            socket.join(populatedGame.id.toString());

            if (activeLobbies[populatedGame.id.toString()]) {
                delete activeLobbies[populatedGame.id.toString()];
                io.emit('lobby_update', Object.values(activeLobbies));
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
                const updatedGame = await Game.findById(gameId).populate('players', 'username avatar');
                updatedGame.status = 'completed';
                updatedGame.winner = playerId;
                
                const winnerUser = await User.findById(playerId);
                const commission = updatedGame.betAmount * config.platformCommission;
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

            game.status = 'completed';
            game.winner = winner._id;
            
            const winnerUser = await User.findById(winner._id);
            const commission = game.betAmount * config.platformCommission;
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