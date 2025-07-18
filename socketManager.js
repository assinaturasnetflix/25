// ==========================================================
// FICHEIRO: socketManager.js
// RESPONSABILIDADE: Gestão de toda a lógica de tempo real
// com WebSockets (Socket.IO).
// ==========================================================

const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const { User, Game, Setting } = require('./models');
const gameLogic = require('./gameLogic');
const { generateNumericId } = require('./utils');

const userSockets = new Map();

async function getLiveSettings() {
    let settings = await Setting.findOne({ singleton: 'main_settings' });
    if (!settings) {
        const defaultConfig = require('./config');
        settings = await Setting.create({ singleton: 'main_settings', ...defaultConfig });
    }
    return settings;
}

module.exports = function(io) {
    io.use(async (socket, next) => {
        const token = socket.handshake.auth.token;
        if (!token) {
            return next(new Error('Autenticação falhou: Token não fornecido.'));
        }
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            const user = await User.findById(decoded.id);
            if (!user || user.isBlocked) {
                return next(new Error('Autenticação falhou: Utilizador inválido ou bloqueado.'));
            }
            socket.user = user;
            next();
        } catch (err) {
            next(new Error('Autenticação falhou: Token inválido.'));
        }
    });

    io.on('connection', async (socket) => {
        console.log(`Utilizador conectado: ${socket.user.username} (ID: ${socket.id})`);
        userSockets.set(socket.user._id.toString(), socket.id);

        try {
            const runningGame = await Game.findOne({
                players: socket.user._id,
                status: { $in: ['in_progress', 'waiting_ready'] }
            }).populate('players', 'username avatar');

            if (runningGame) {
                const gameRoom = `game_${runningGame._id}`;
                socket.join(gameRoom);
                socket.emit('reconnectSuccess', { game: runningGame });
            }
        } catch (error) {
            socket.emit('error', { message: 'Erro ao tentar reconectar a uma partida anterior.' });
        }


        socket.on('getLobby', async () => {
            try {
                const openGames = await Game.find({ status: 'waiting', isPrivate: false })
                    .populate('creator', 'username avatar')
                    .sort({ createdAt: -1 });
                socket.emit('lobbyUpdate', openGames);
            } catch (error) {
                socket.emit('error', { message: 'Erro ao carregar o lobby de apostas.' });
            }
        });

        socket.on('createGame', async (data) => {
            const session = await mongoose.startSession();
            session.startTransaction();
            try {
                const { betAmount, description, isPrivate, bettingMode } = data;
                const settings = await getLiveSettings();
                const user = await User.findById(socket.user._id).session(session);

                if (betAmount < settings.minBet || betAmount > settings.maxBet) {
                    throw new Error(`O valor da aposta deve estar entre ${settings.minBet} MT e ${settings.maxBet} MT.`);
                }
                
                const balanceField = bettingMode === 'bonus' ? 'bonusBalance' : 'balance';
                if (user[balanceField] < betAmount) {
                    throw new Error(`Saldo ${bettingMode === 'bonus' ? 'de bónus' : 'real'} insuficiente.`);
                }
                
                user[balanceField] -= betAmount;
                await user.save({ session });

                let gameCode = null;
                if(isPrivate) {
                    let unique = false;
                    while(!unique) {
                        const code = generateNumericId(5);
                        const existingGame = await Game.findOne({ gameCode: code }).session(session);
                        if(!existingGame) {
                            gameCode = code;
                            unique = true;
                        }
                    }
                }
                
                const newGame = new Game({
                    players: [user._id],
                    creator: user._id,
                    boardState: gameLogic.createInitialBoard(),
                    currentPlayer: user._id,
                    betAmount,
                    lobbyDescription: description || '',
                    isPrivate,
                    gameCode,
                    bettingMode
                });

                await newGame.save({ session });
                await session.commitTransaction();

                if (isPrivate) {
                    socket.emit('privateGameCreated', { gameId: newGame._id, gameCode: newGame.gameCode });
                } else {
                    const openGames = await Game.find({ status: 'waiting', isPrivate: false }).populate('creator', 'username avatar').sort({ createdAt: -1 });
                    io.emit('lobbyUpdate', openGames);
                }

            } catch (error) {
                await session.abortTransaction();
                socket.emit('error', { message: error.message || 'Erro ao criar a partida.' });
            } finally {
                session.endSession();
            }
        });

        socket.on('joinGame', async (data) => {
            const { gameId } = data;
            const session = await mongoose.startSession();
            session.startTransaction();
            try {
                const game = await Game.findById(gameId).session(session);
                if (!game || game.status !== 'waiting') {
                    throw new Error('Esta partida não está mais disponível.');
                }

                const user = await User.findById(socket.user._id).session(session);
                if(game.players[0].equals(user._id)) {
                    throw new Error('Não pode entrar na sua própria partida.');
                }
                
                const balanceField = game.bettingMode === 'bonus' ? 'bonusBalance' : 'balance';
                if (user[balanceField] < game.betAmount) {
                     throw new Error(`Saldo ${game.bettingMode === 'bonus' ? 'de bónus' : 'real'} insuficiente.`);
                }

                user[balanceField] -= game.betAmount;
                game.players.push(user._id);
                game.status = 'waiting_ready';

                await user.save({ session });
                await game.save({ session });

                await session.commitTransaction();
                
                const populatedGame = await Game.findById(gameId).populate('players', 'username avatar');
                const gameRoom = `game_${gameId}`;
                socket.join(gameRoom);
                
                const opponentId = populatedGame.players.find(p => !p._id.equals(socket.user._id))._id.toString();
                const opponentSocketId = userSockets.get(opponentId);
                if(opponentSocketId) {
                    const opponentSocket = io.sockets.sockets.get(opponentSocketId);
                    if(opponentSocket) opponentSocket.join(gameRoom);
                }
                
                io.to(gameRoom).emit('navigateToWaitScreen', { game: populatedGame });
                io.emit('lobbyUpdate', await Game.find({ status: 'waiting', isPrivate: false }).populate('creator', 'username avatar').sort({ createdAt: -1 }));

            } catch (error) {
                await session.abortTransaction();
                socket.emit('error', { message: error.message || 'Erro ao entrar na partida.' });
            } finally {
                session.endSession();
            }
        });
        
         socket.on('joinWithCode', async (data) => {
            const { gameCode } = data;
            if(!gameCode) return socket.emit('error', { message: 'Código da partida é obrigatório.'});
            
            const session = await mongoose.startSession();
            session.startTransaction();
            try {
                const game = await Game.findOne({ gameCode, status: 'waiting' }).session(session);
                if (!game) throw new Error('Partida privada não encontrada ou já iniciada.');
                
                const user = await User.findById(socket.user._id).session(session);
                if (game.players[0].equals(user._id)) throw new Error('Não pode juntar-se à sua própria partida privada.');
                
                const balanceField = game.bettingMode === 'bonus' ? 'bonusBalance' : 'balance';
                if (user[balanceField] < game.betAmount) throw new Error(`Saldo ${balanceField === 'bonus' ? 'de bónus' : 'real'} insuficiente.`);

                user[balanceField] -= game.betAmount;
                game.players.push(user._id);
                game.status = 'waiting_ready';

                await user.save({ session });
                await game.save({ session });
                await session.commitTransaction();

                const populatedGame = await Game.findById(game._id).populate('players', 'username avatar');
                const gameRoom = `game_${game._id}`;
                socket.join(gameRoom);

                const creatorSocketId = userSockets.get(game.creator.toString());
                if(creatorSocketId) io.sockets.sockets.get(creatorSocketId)?.join(gameRoom);

                io.to(gameRoom).emit('navigateToWaitScreen', { game: populatedGame });

            } catch(error) {
                 await session.abortTransaction();
                 socket.emit('error', { message: error.message || 'Erro ao entrar na partida com código.' });
            } finally {
                session.endSession();
            }
        });
        
        socket.on('playerReady', async (data) => {
            const { gameId } = data;
            const game = await Game.findById(gameId);
            if (!game || (game.status !== 'waiting_ready')) return;

            if(!game.ready.includes(socket.user._id)) {
                game.ready.push(socket.user._id);
                await game.save();
            }

            const gameRoom = `game_${gameId}`;
            io.to(gameRoom).emit('readyUpdate', { readyPlayers: game.ready });

            if(game.ready.length === 2) {
                game.status = 'in_progress';
                await game.save();
                const populatedGame = await Game.findById(gameId).populate('players', 'username avatar');
                io.to(gameRoom).emit('gameStart', { game: populatedGame });
            }
        });

        socket.on('makeMove', async (data) => {
            const { gameId, move } = data;
            try {
                const game = await Game.findById(gameId);
                if (!game || game.status !== 'in_progress' || !game.currentPlayer.equals(socket.user._id)) {
                    throw new Error("Não é a sua vez de jogar ou a partida não está em andamento.");
                }

                const validMoves = gameLogic.getPossibleMovesForPlayer(game.boardState, socket.user.username === 'Player1' ? 'w' : 'b');
                
                const isMoveValid = validMoves.some(validMove => 
                    JSON.stringify(validMove.from) === JSON.stringify(move.from) &&
                    JSON.stringify(validMove.to) === JSON.stringify(move.to)
                );

                if (!isMoveValid) {
                   throw new Error("Jogada inválida.");
                }

                const executedMove = validMoves.find(validMove => 
                    JSON.stringify(validMove.from) === JSON.stringify(move.from) &&
                    JSON.stringify(validMove.to) === JSON.stringify(move.to)
                );
                
                game.boardState = gameLogic.applyMoveToBoard(game.boardState, executedMove);
                game.moveHistory.push({ player: socket.user._id, ...executedMove });
                game.currentPlayer = game.players.find(p => !p.equals(socket.user._id));

                await game.save();

                const gameRoom = `game_${gameId}`;
                io.to(gameRoom).emit('moveMade', { move: executedMove, newBoard: game.boardState, nextPlayer: game.currentPlayer });

                const winCheck = gameLogic.checkWinCondition(game.boardState, socket.user.username === 'Player1' ? 'w' : 'b');
                if (winCheck.winner) {
                    await endGame(game, socket.user._id);
                }

            } catch (error) {
                socket.emit('error', { message: error.message || 'Ocorreu um erro ao processar a sua jogada.' });
            }
        });

        socket.on('resignGame', async (data) => {
            const { gameId } = data;
            const game = await Game.findOne({ _id: gameId, status: 'in_progress', players: socket.user._id });
            if (game) {
                const winnerId = game.players.find(p => !p.equals(socket.user._id));
                await endGame(game, winnerId, true);
            }
        });
        
        socket.on('abortGame', async (data) => {
            const { gameId } = data;
            const game = await Game.findById(gameId);
            
            if(game && ['waiting', 'in_progress', 'waiting_ready'].includes(game.status)) {
                 const session = await mongoose.startSession();
                 session.startTransaction();
                 try {
                     game.status = 'cancelled';
                     
                     const balanceField = game.bettingMode === 'bonus' ? 'bonusBalance' : 'balance';
                     
                     for(const playerId of game.players) {
                         await User.findByIdAndUpdate(playerId, { $inc: { [balanceField]: game.betAmount } }, { session });
                     }
                     
                     await game.save({ session });
                     await session.commitTransaction();

                     const gameRoom = `game_${game._id}`;
                     io.to(gameRoom).emit('gameCancelled', { message: "A partida foi cancelada e a aposta devolvida." });
                     
                     io.sockets.in(gameRoom).socketsLeave(gameRoom);
                     
                 } catch(error) {
                      await session.abortTransaction();
                      socket.emit('error', { message: 'Erro ao cancelar a partida.'});
                 } finally {
                      session.endSession();
                 }
            }
        });
        
        socket.on('disconnect', () => {
            console.log(`Utilizador desconectado: ${socket.user.username} (ID: ${socket.id})`);
            for (let [key, value] of userSockets.entries()) {
                if (value === socket.id) {
                    userSockets.delete(key);
                    break;
                }
            }
        });
    });

    async function endGame(game, winnerId, wasResignation = false) {
        if(game.status === 'completed') return;

        const session = await mongoose.startSession();
        session.startTransaction();
        try {
            const settings = await getLiveSettings();
            const winner = await User.findById(winnerId).session(session);
            const loserId = game.players.find(p => !p.equals(winnerId));
            const loser = await User.findById(loserId).session(session);

            const totalPot = game.betAmount * 2;
            const commission = totalPot * settings.platformCommission;
            const prize = totalPot - commission;
            
            const balanceField = game.bettingMode === 'bonus' ? 'bonusBalance' : 'balance';

            winner[balanceField] += prize;
            winner.stats.wins += 1;
            loser.stats.losses += 1;

            game.status = 'completed';
            if (wasResignation) game.status = 'abandoned';
            game.winner = winnerId;
            game.commissionAmount = commission;

            await winner.save({ session });
            await loser.save({ session });
            await game.save({ session });

            await session.commitTransaction();

            const gameRoom = `game_${game._id}`;
            io.to(gameRoom).emit('gameOver', {
                winner: { username: winner.username, avatar: winner.avatar },
                prize,
                commission,
                wasResignation
            });

            const winnerSocketId = userSockets.get(winner._id.toString());
            const loserSocketId = userSockets.get(loser._id.toString());

            if(winnerSocketId) io.sockets.sockets.get(winnerSocketId)?.leave(gameRoom);
            if(loserSocketId) io.sockets.sockets.get(loserSocketId)?.leave(gameRoom);

        } catch (error) {
            await session.abortTransaction();
            console.error('Erro crítico ao finalizar a partida e distribuir prémios:', error);
            const gameRoom = `game_${game._id}`;
            io.to(gameRoom).emit('error', { message: "Ocorreu um erro crítico ao finalizar a partida. Contacte o suporte."});
        } finally {
            session.endSession();
        }
    }
};