const { Game, User } = require('./models');
const { createInitialBoard, getPossibleMovesForPlayer, applyMoveToBoard, checkWinCondition } = require('./gameLogic');
const config = require('./config');
const mongoose = require('mongoose');

let activeLobbies = {}; 
let activeUsers = {}; 

const socketManager = (io) => {
    io.on('connection', (socket) => {
        const userId = socket.handshake.query.userId;
        if (userId) {
            activeUsers[userId] = socket.id;
            socket.join(userId);
            
            Game.findOne({ players: userId, status: 'in_progress' })
                .populate('players', 'username avatar')
                .then(game => {
                    if (game) {
                        socket.join(game.id);
                        io.to(socket.id).emit('reconnect_game', game);
                    }
                });
        }

        socket.on('get_lobby', () => {
             io.to(socket.id).emit('lobby_update', Object.values(activeLobbies));
        });

        socket.on('create_lobby_game', async ({ betAmount, description, timeLimit }) => {
            const creatorId = Object.keys(activeUsers).find(key => activeUsers[key] === socket.id);
            const creator = await User.findById(creatorId);

            if (!creator || creator.balance < betAmount) {
                return io.to(socket.id).emit('error_message', { message: 'Saldo insuficiente para criar esta aposta.' });
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
                timeLimit
            });
            await game.save();
            
            activeLobbies[game.id] = {
                gameId: game.id,
                creator: { _id: creator._id, username: creator.username, avatar: creator.avatar },
                betAmount: game.betAmount,
                description: game.lobbyDescription,
                timeLimit: game.timeLimit
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

            const privateCode = `P${Math.random().toString().substring(2, 8)}`;
            const game = new Game({
                players: [creatorId],
                boardState: createInitialBoard(),
                currentPlayer: creatorId,
                status: 'waiting',
                betAmount,
                isPrivate: true,
                privateGameCode: privateCode,
            });
            await game.save();
            
            socket.join(game.id);
            io.to(socket.id).emit('private_game_created', { gameId: game.id, privateCode: game.privateGameCode });
        });

        socket.on('join_game', async ({ gameId, privateCode }) => {
            const joinerId = Object.keys(activeUsers).find(key => activeUsers[key] === socket.id);
            const joiner = await User.findById(joinerId);
            
            let game;
            if (gameId) {
                game = await Game.findById(gameId);
            } else if (privateCode) {
                game = await Game.findOne({ privateGameCode, status: 'waiting' });
            }

            if (!game) {
                return io.to(socket.id).emit('error_message', { message: 'Partida não encontrada.' });
            }
            if (game.players.length > 1) {
                return io.to(socket.id).emit('error_message', { message: 'Esta partida já está cheia.' });
            }
            if (game.players[0].equals(joinerId)) {
                return io.to(socket.id).emit('error_message', { message: 'Você não pode entrar na sua própria partida.' });
            }
            if (joiner.balance < game.betAmount) {
                return io.to(socket.id).emit('error_message', { message: 'Saldo insuficiente para entrar nesta aposta.' });
            }

            joiner.balance -= game.betAmount;
            await joiner.save();
            
            const creator = await User.findById(game.players[0]);
            creator.balance -= game.betAmount;
            await creator.save();

            game.players.push(joinerId);
            game.status = 'in_progress';
            await game.save();

            const populatedGame = await Game.findById(game.id).populate('players', 'username avatar');
            
            socket.join(game.id);
            io.to(game.id).emit('game_start', populatedGame);
            
            delete activeLobbies[game.id];
            io.emit('lobby_update', Object.values(activeLobbies));
        });

        socket.on('make_move', async ({ gameId, move }) => {
            const game = await Game.findById(gameId);
            const playerId = Object.keys(activeUsers).find(key => activeUsers[key] === socket.id);

            if (!game || !playerId || !game.currentPlayer.equals(playerId)) {
                return io.to(socket.id).emit('error_message', { message: 'Jogada inválida ou não é a sua vez.' });
            }

            const playerSymbol = game.players[0].equals(playerId) ? 'b' : 'w';
            const possibleMoves = getPossibleMovesForPlayer(game.boardState, playerSymbol);
            
            const isValidMove = possibleMoves.some(pMove => 
                JSON.stringify(pMove.from) === JSON.stringify(move.from) &&
                JSON.stringify(pMove.to) === JSON.stringify(move.to)
            );

            if (!isValidMove) {
                return io.to(socket.id).emit('error_message', { message: 'Movimento ilegal.' });
            }
            
            const fullMove = possibleMoves.find(pMove => 
                JSON.stringify(pMove.from) === JSON.stringify(move.from) &&
                JSON.stringify(pMove.to) === JSON.stringify(move.to)
            );

            game.boardState = applyMoveToBoard(game.boardState, fullMove);
            const opponentId = game.players.find(p => !p.equals(playerId));
            game.currentPlayer = opponentId;
            game.moveHistory.push({ player: playerId, from: {r: move.from[0], c: move.from[1]}, to: {r: move.to[0], c: move.to[1]}, captured: fullMove.captured });
            
            const winState = checkWinCondition(game.boardState, playerSymbol === 'b' ? 'w' : 'b');

            if (winState.winner) {
                const winnerId = playerId;
                const loserId = opponentId;
                game.status = 'completed';
                game.winner = winnerId;
                await game.save();
                
                const winner = await User.findById(winnerId);
                const commission = game.betAmount * config.platformCommission;
                const prize = (game.betAmount * 2) - commission;
                winner.balance += prize;
                winner.stats.wins += 1;
                await winner.save();

                const loser = await User.findById(loserId);
                loser.stats.losses += 1;
                await loser.save();

                io.to(game.id).emit('game_over', { winner: winnerId, boardState: game.boardState });
            } else {
                await game.save();
                io.to(game.id).emit('move_made', { boardState: game.boardState, currentPlayer: game.currentPlayer });
            }
        });

        socket.on('surrender', async ({ gameId }) => {
            const game = await Game.findById(gameId);
            const surrendererId = Object.keys(activeUsers).find(key => activeUsers[key] === socket.id);
            if (!game || !surrendererId || game.status !== 'in_progress') return;

            const winnerId = game.players.find(p => !p.equals(surrendererId));
            if (!winnerId) return;

            game.status = 'completed';
            game.winner = winnerId;
            await game.save();
            
            const winner = await User.findById(winnerId);
            const commission = game.betAmount * config.platformCommission;
            const prize = (game.betAmount * 2) - commission;
            winner.balance += prize;
            winner.stats.wins += 1;
            await winner.save();

            const loser = await User.findById(surrendererId);
            loser.stats.losses += 1;
            await loser.save();
            
            io.to(game.id).emit('game_over', { winner: winnerId, boardState: game.boardState, surrendered: true });
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