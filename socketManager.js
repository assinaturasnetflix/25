const { Game, User } = require('./models');
const { createInitialBoard, getPossibleMovesForPlayer, applyMoveToBoard, checkWinCondition } = require('./gameLogic');
const config =require('./config');
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
                        socket.emit('reconnect_game', game);
                    }
                });
        }
        
        socket.on('join_game_room', async ({ gameId }) => {
            const userId = Object.keys(activeUsers).find(key => activeUsers[key] === socket.id);
            if (!userId) return;

            const game = await Game.findById(gameId).populate('players', 'username avatar');
            if (!game) {
                return io.to(socket.id).emit('error_message', { message: 'Partida não encontrada.' });
            }
            
            socket.join(gameId);

            // Transmite o estado atual do jogo para o jogador que acabou de entrar/reconectar
            io.to(socket.id).emit('game_state', game);
        });


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
                timeLimit,
                ready: [] // Adiciona o campo ready
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
                ready: [] // Adiciona o campo ready
            });
            await game.save();
            
            socket.join(game.id);
            io.to(socket.id).emit('private_game_created', { gameId: game.id, privateCode: game.privateGameCode });
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

            if (!gameToJoin) return io.to(socket.id).emit('error_message', { message: 'Partida não encontrada.' });
            if (gameToJoin.players.length > 1) return io.to(socket.id).emit('error_message', { message: 'Esta partida já está cheia.' });
            if (gameToJoin.players[0].equals(joinerId)) return io.to(socket.id).emit('error_message', { message: 'Você não pode entrar na sua própria partida.' });
            if (joiner.balance < gameToJoin.betAmount) return io.to(socket.id).emit('error_message', { message: 'Saldo insuficiente.' });

            // NÃO debita o saldo ainda, faremos isso quando o jogo começar
            
            gameToJoin.players.push(joinerId);
            await gameToJoin.save();

            const populatedGame = await Game.findById(gameToJoin.id).populate('players', 'username avatar');
            
            socket.join(populatedGame.id);
            // Emite o evento para AMBOS os jogadores com a partida completa
            io.to(populatedGame.id).emit('game_state', populatedGame);
            
            delete activeLobbies[gameToJoin.id];
            io.emit('lobby_update', Object.values(activeLobbies));
            
            // Redireciona o jogador que entrou
            io.to(socket.id).emit('navigate_to_game', { gameId: populatedGame.id });
        });
        
        socket.on('player_ready', async ({ gameId }) => {
            const userId = Object.keys(activeUsers).find(key => activeUsers[key] === socket.id);
            const game = await Game.findById(gameId);
            if (!game || !userId || game.ready.includes(userId)) return;

            game.ready.push(userId);
            
            // Notifica todos na sala que um jogador ficou pronto
            io.to(gameId).emit('update_ready_status', { userId });

            if (game.ready.length === 2) {
                // Debitar saldos
                const player1 = await User.findById(game.players[0]);
                const player2 = await User.findById(game.players[1]);
                player1.balance -= game.betAmount;
                player2.balance -= game.betAmount;
                await player1.save();
                await player2.save();

                game.status = 'in_progress';
                io.to(gameId).emit('game_start_countdown');
            }
            await game.save();
        });

        socket.on('get_possible_moves', async ({gameId, from}) => {
             const userId = Object.keys(activeUsers).find(key => activeUsers[key] === socket.id);
             const game = await Game.findById(gameId);
             if(!game || !userId || !game.currentPlayer.equals(userId)) return;

             const playerSymbol = game.players[0].equals(userId) ? 'b' : 'w';
             const moves = getPossibleMovesForPlayer(game.boardState, playerSymbol);
             const filteredMoves = moves.filter(m => m.from[0] === from[0] && m.from[1] === from[1]);
             io.to(socket.id).emit('possible_moves', filteredMoves);
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
                io.to(game.id).emit('move_made', { boardState: game.boardState, currentPlayer: game.currentPlayer });
            }
            await game.save();
        });

        socket.on('surrender', async ({ gameId }) => {
            const game = await Game.findById(gameId);
            const surrendererId = Object.keys(activeUsers).find(key => activeUsers[key] === socket.id);
            if (!game || !surrendererId || game.status !== 'in_progress') return;

            const winnerId = game.players.find(p => !p.equals(surrendererId));
            if (!winnerId) return;

            game.status = 'completed';
            game.winner = winnerId;
            
            const winner = await User.findById(winnerId);
            const commission = game.betAmount * config.platformCommission;
            const prize = (game.betAmount * 2) - commission;
            winner.balance += prize;
            winner.stats.wins += 1;
            await winner.save();

            const loser = await User.findById(surrendererId);
            loser.stats.losses += 1;
            await loser.save();
            
            io.to(game.id).emit('game_over', { winner: winnerId, surrendered: true });
            await game.save();
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