const { User, Game, Transaction } = require('./models');
const GameLogic = require('./gameLogic');
const config = require('./config');
const { generatePrivateGameCode } = require('./utils');
const jwt = require('jsonwebtoken');

let userSockets = {};
let activeGames = {};
let versusTimers = {};

const initializeSocketManager = (io) => {
    io.on('connection', (socket) => {
        
        socket.on('authenticate', async (token) => {
            if (!token) return;
            try {
                const decoded = jwt.verify(token, process.env.JWT_SECRET);
                const user = await User.findById(decoded.id);
                if (!user || user.isBlocked) {
                    socket.emit('auth_error', { message: 'Autenticação falhou.' });
                    return socket.disconnect();
                }
                
                socket.userId = user._id.toString();
                userSockets[socket.userId] = socket.id;

                socket.emit('authenticated');

                const unfinishedGame = await Game.findOne({
                    players: socket.userId,
                    status: 'in_progress'
                }).populate('players', 'name avatar userId');

                if (unfinishedGame) {
                    socket.join(unfinishedGame._id.toString());
                    socket.emit('reconnect_game', unfinishedGame);
                }

            } catch (error) {
                socket.emit('auth_error', { message: 'Token inválido ou expirado.' });
                socket.disconnect();
            }
        });

        socket.on('create_game', async (data) => {
            try {
                const { betAmount, description, timeLimit, isPrivate } = data;
                const user = await User.findById(socket.userId);
                
                if (!user || user.isBlocked) throw new Error('Utilizador inválido ou bloqueado.');
                if (user.balance < betAmount) throw new Error('Saldo insuficiente.');
                if (betAmount < config.limits.minBet || betAmount > config.limits.maxBet) throw new Error('Valor da aposta fora dos limites permitidos.');

                user.balance -= betAmount;
                await user.save();
                
                let newGameData = {
                    players: [user._id],
                    betAmount,
                    lobbyDescription: description || '',
                    timeLimit: timeLimit || 'unlimited',
                    status: 'waiting_for_opponent',
                    isPrivate,
                    currentPlayer: user._id,
                    boardState: "{}",
                };

                if (isPrivate) {
                    newGameData.privateCode = generatePrivateGameCode(config.game.privateCodeLength);
                }
                
                const game = await Game.create(newGameData);
                activeGames[game._id.toString()] = { game, readyPlayers: [] };

                if (isPrivate) {
                    socket.emit('private_game_created', { code: game.privateCode, gameId: game._id });
                } else {
                    io.emit('lobby_update');
                }
                socket.emit('balance_update', { newBalance: user.balance });

            } catch (error) {
                socket.emit('error_message', { message: error.message });
            }
        });

        socket.on('join_game', async ({ gameId, code }) => {
            try {
                const user = await User.findById(socket.userId);
                if (!user || user.isBlocked) throw new Error('Utilizador inválido ou bloqueado.');

                let game;
                if (gameId) {
                    game = await Game.findById(gameId);
                } else if (code) {
                    game = await Game.findOne({ privateCode: code.toUpperCase() });
                }

                if (!game || game.status !== 'waiting_for_opponent') throw new Error('Partida não encontrada ou já iniciada.');
                if (game.players.includes(user._id)) throw new Error('Você não pode entrar na sua própria partida.');
                if (user.balance < game.betAmount) throw new Error('Saldo insuficiente para entrar nesta aposta.');
                
                user.balance -= game.betAmount;
                await user.save();
                socket.emit('balance_update', { newBalance: user.balance });

                const creatorId = game.players[0].toString();
                game.players.push(user._id);
                game.status = 'in_progress';
                game.boardState = GameLogic.getInitialBoard(creatorId, user._id.toString());
                
                const populatedGame = await game.save();
                await populatedGame.populate('players', 'name avatar userId');

                activeGames[game._id.toString()] = { game: populatedGame, readyPlayers: [] };

                const creatorSocketId = userSockets[creatorId];
                if (creatorSocketId) {
                    io.sockets.sockets.get(creatorSocketId)?.join(game._id.toString());
                }
                socket.join(game._id.toString());
                
                io.emit('lobby_update');
                io.to(game._id.toString()).emit('match_found', populatedGame);

                versusTimers[game._id.toString()] = setTimeout(async () => {
                    const gameToCancel = await Game.findById(game._id);
                    if (gameToCancel && gameToCancel.status === 'in_progress' && activeGames[game._id.toString()] && activeGames[game._id.toString()].readyPlayers.length < 2) {
                        
                        await User.findByIdAndUpdate(creatorId, { $inc: { balance: game.betAmount } });
                        await User.findByIdAndUpdate(user._id, { $inc: { balance: game.betAmount } });

                        gameToCancel.status = 'cancelled';
                        await gameToCancel.save();

                        io.to(game._id.toString()).emit('game_cancelled', { message: 'O oponente não confirmou a tempo. A partida foi cancelada e o saldo devolvido.' });
                        delete activeGames[game._id.toString()];
                    }
                }, config.game.opponentWaitTimeout * 1000);

            } catch (error) {
                socket.emit('error_message', { message: error.message });
            }
        });
        
        socket.on('player_ready', async ({gameId}) => {
             if (activeGames[gameId]) {
                const gameData = activeGames[gameId];
                if (!gameData.readyPlayers.includes(socket.userId)) {
                    gameData.readyPlayers.push(socket.userId);
                }

                if (gameData.readyPlayers.length === 2) {
                    if (versusTimers[gameId]) {
                        clearTimeout(versusTimers[gameId]);
                        delete versusTimers[gameId];
                    }
                    setTimeout(() => {
                        io.to(gameId).emit('game_start', gameData.game);
                    }, config.game.versusScreenCountdown * 1000);
                }
             }
        });

        socket.on('make_move', async ({ gameId, move }) => {
            try {
                const game = await Game.findById(gameId);
                if (!game || game.status !== 'in_progress' || game.currentPlayer.toString() !== socket.userId) {
                    return socket.emit('invalid_move', { message: 'Não é a sua vez ou a partida não está ativa.' });
                }

                const logic = new GameLogic(game.boardState, socket.userId);
                const validation = logic.isValidMove(move.from.row, move.from.col, move.to.row, move.to.col, socket.userId);

                if (!validation.valid) {
                    return socket.emit('invalid_move', { message: validation.reason || 'Movimento inválido.' });
                }
                
                let board = JSON.parse(game.boardState);
                const piece = board[move.from.row][move.from.col];
                board[move.to.row][move.to.col] = piece;
                board[move.from.row][move.from.col] = null;
                
                if (validation.isCapture) {
                    board[validation.capturedPos.row][validation.capturedPos.col] = null;
                }
                
                if ((piece.color === 'white' && move.to.row === 0) || (piece.color === 'black' && move.to.row === 7)) {
                    piece.isKing = true;
                }

                const newBoardState = JSON.stringify(board);
                const logicAfterMove = new GameLogic(newBoardState, socket.userId);
                
                let hasMoreCaptures = false;
                if (validation.isCapture) {
                    const availableCaptures = logicAfterMove.getAvailableCaptures(socket.userId);
                    const movedPieceCaptures = availableCaptures.filter(c => c.from.row === move.to.row && c.from.col === move.to.col);
                    if (movedPieceCaptures.length > 0) {
                        hasMoreCaptures = true;
                    }
                }

                game.boardState = newBoardState;
                game.moveHistory.push({ player: socket.userId, from: `${move.from.row},${move.from.col}`, to: `${move.to.row},${move.to.col}`, isCapture: validation.isCapture });

                const winCheck = logicAfterMove.checkWinCondition(socket.userId);
                if (winCheck.gameOver) {
                    return await handleGameOver(io, game, winCheck.winner);
                }

                if (!hasMoreCaptures) {
                    const opponentId = game.players.find(p => p.toString() !== socket.userId);
                    game.currentPlayer = opponentId;
                }
                
                await game.save();
                io.to(gameId).emit('game_update', { game, move });

            } catch (error) {
                socket.emit('error_message', { message: 'Ocorreu um erro ao processar a jogada.' });
            }
        });

        socket.on('forfeit_game', async ({ gameId }) => {
            try {
                const game = await Game.findById(gameId);
                if (!game || game.status !== 'in_progress') return;
                
                const winnerId = game.players.find(p => p.toString() !== socket.userId).toString();
                await handleGameOver(io, game, winnerId);

            } catch (error) {
                socket.emit('error_message', { message: 'Erro ao desistir da partida.' });
            }
        });

        socket.on('disconnect', () => {
            if (socket.userId) {
                delete userSockets[socket.userId];
            }
        });
    });
};

const handleGameOver = async (io, game, winnerId) => {
    if (game.status === 'completed') return;

    const loserId = game.players.find(p => p.toString() !== winnerId.toString()).toString();
    const winner = await User.findById(winnerId);
    const loser = await User.findById(loserId);

    const totalPot = game.betAmount * 2;
    const commission = totalPot * config.commission.rate;
    const prize = totalPot - commission;

    winner.balance += prize;
    winner.stats.wins += 1;
    loser.stats.losses += 1;

    game.status = 'completed';
    game.winner = winnerId;
    
    await Promise.all([winner.save(), loser.save(), game.save()]);

    await Transaction.create([
        { user: winner._id, type: 'win', amount: prize, status: 'completed', relatedGame: game._id },
        { user: loser._id, type: 'bet', amount: -game.betAmount, status: 'completed', relatedGame: game._id },
        { user: winner._id, type: 'bet', amount: -game.betAmount, status: 'completed', relatedGame: game._id },
        { type: 'commission', amount: commission, status: 'completed', relatedGame: game._id }
    ]);

    const populatedGame = await Game.findById(game._id).populate('players', 'name avatar userId').populate('winner', 'name userId');
    io.to(game._id.toString()).emit('game_over', { game: populatedGame });
    
    const winnerSocketId = userSockets[winnerId];
    if (winnerSocketId) {
        io.sockets.sockets.get(winnerSocketId)?.emit('balance_update', { newBalance: winner.balance });
    }
    const loserSocketId = userSockets[loserId];
    if (loserSocketId) {
        io.sockets.sockets.get(loserSocketId)?.emit('balance_update', { newBalance: loser.balance });
    }

    delete activeGames[game._id.toString()];
    delete versusTimers[game._id.toString()];
};

module.exports = { initializeSocketManager };