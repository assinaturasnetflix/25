const jwt = require('jsonwebtoken');
const { User, Game, LobbyGame, PlatformSettings } = require('./models');
const gameLogic = require('./gameLogic');
const { generateGameId } = require('./utils');
const mongoose = require('mongoose');

const connectedUsers = new Map();

const socketManager = (io) => {
    io.use(async (socket, next) => {
        const token = socket.handshake.auth.token;
        if (!token) {
            return next(new Error('Authentication error: Token not provided'));
        }
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            const user = await User.findById(decoded.id).select('-password');
            if (!user || user.isBlocked) {
                return next(new Error('Authentication error: User not found or blocked'));
            }
            socket.user = user;
            next();
        } catch (err) {
            return next(new Error('Authentication error: Invalid token'));
        }
    });

    io.on('connection', (socket) => {
        connectedUsers.set(socket.user._id.toString(), socket.id);

        socket.on('createPrivateGame', async ({ betAmount, timeLimit }) => {
            // Lógica para criar jogo privado e retornar um código
        });

        socket.on('joinPrivateGame', async ({ gameCode }) => {
            // Lógica para entrar em um jogo privado com código
        });

        socket.on('joinLobbyGame', async (lobbyGameId) => {
            const session = await mongoose.startSession();
            session.startTransaction();
            try {
                const lobbyGame = await LobbyGame.findById(lobbyGameId).session(session);
                if (!lobbyGame || lobbyGame.status !== 'open') {
                    throw new Error('Este jogo já não está disponível.');
                }
                if (lobbyGame.creator.equals(socket.user._id)) {
                    throw new Error('Não pode jogar contra si mesmo.');
                }

                const [creator, challenger] = await Promise.all([
                    User.findById(lobbyGame.creator).session(session),
                    User.findById(socket.user._id).session(session)
                ]);

                if (creator.balance < lobbyGame.betAmount || challenger.balance < lobbyGame.betAmount) {
                    throw new Error('Saldo insuficiente para a aposta.');
                }
                
                const hasOngoingGame = await Game.findOne({
                    players: { $in: [creator._id, challenger._id] },
                    status: 'in_progress'
                }).session(session);

                if (hasOngoingGame) {
                    throw new Error('Um dos jogadores já tem uma partida em andamento.');
                }

                creator.balance -= lobbyGame.betAmount;
                challenger.balance -= lobbyGame.betAmount;

                const newGame = new Game({
                    gameId: await generateGameId(),
                    players: [creator._id, challenger._id],
                    playerUsernames: [creator.username, challenger.username],
                    playerAvatars: [creator.avatar, challenger.avatar],
                    boardState: gameLogic.initializeBoard(),
                    betAmount: lobbyGame.betAmount,
                    timeLimit: lobbyGame.timeLimit,
                    status: 'waiting',
                });

                lobbyGame.status = 'matched';
                lobbyGame.gameId = newGame._id;

                await Promise.all([creator.save(), challenger.save(), newGame.save(), lobbyGame.save()]);
                
                await session.commitTransaction();

                const creatorSocketId = connectedUsers.get(creator._id.toString());
                if (creatorSocketId) io.to(creatorSocketId).emit('gameMatched', { gameId: newGame._id, opponent: challenger });
                io.to(socket.id).emit('gameMatched', { gameId: newGame._id, opponent: creator });

            } catch (error) {
                await session.abortTransaction();
                socket.emit('error', { message: error.message || 'Falha ao entrar no jogo.' });
            } finally {
                session.endSession();
            }
        });

        socket.on('joinGameRoom', async ({ gameId }) => {
            try {
                const game = await Game.findById(gameId).populate('players');
                if (!game || !game.players.some(p => p._id.equals(socket.user._id))) {
                    return socket.emit('error', { message: 'Jogo não encontrado ou não autorizado.' });
                }

                const roomName = `game-${gameId}`;
                socket.join(roomName);

                const playerIndex = game.players.findIndex(p => p._id.equals(socket.user._id));
                socket.emit('gameUpdate', { game, playerIndex });

                io.to(roomName).emit('playerConnected', { userId: socket.user._id });

                if (game.status === 'waiting') {
                    const room = io.sockets.adapter.rooms.get(roomName);
                    if (room && room.size === 2) {
                        game.status = 'in_progress';
                        await game.save();
                        io.to(roomName).emit('gameStart', { game });
                    }
                }
            } catch (error) {
                 socket.emit('error', { message: 'Falha ao conectar à sala do jogo.' });
            }
        });

        socket.on('makeMove', async ({ gameId, move }) => {
            const session = await mongoose.startSession();
            session.startTransaction();
            try {
                const game = await Game.findById(gameId).session(session);
                if (!game || game.status !== 'in_progress') throw new Error('O jogo não está em andamento.');

                const playerIndex = game.players.findIndex(p => p._id.equals(socket.user._id));
                if (playerIndex !== game.currentPlayerIndex) throw new Error('Não é a sua vez de jogar.');

                const board = JSON.parse(game.boardState);
                const validation = gameLogic.validateMove(board, playerIndex, move);
                
                if (!validation.valid) throw new Error(validation.reason);

                const newBoard = gameLogic.applyMove(board, move, validation);
                const winCheck = gameLogic.checkWinCondition(newBoard, 1 - playerIndex);
                
                game.boardState = JSON.stringify(newBoard);
                game.moveHistory.push(move);
                game.lastMoveTimestamp = Date.now();
                
                if (winCheck.gameOver) {
                    game.status = 'completed';
                    game.winner = game.players[winCheck.winnerIndex];

                    const settings = await PlatformSettings.findOne({ singleton: true }).session(session);
                    const commission = settings ? settings.commissionRate : 0.15;
                    const totalPot = game.betAmount * 2;
                    const fee = totalPot * commission;
                    const winnings = totalPot - fee;

                    game.platformFee = fee;

                    const winnerUser = await User.findById(game.winner).session(session);
                    winnerUser.balance += winnings;
                    winnerUser.wins += 1;
                    
                    const loserIndex = 1 - winCheck.winnerIndex;
                    const loserUser = await User.findById(game.players[loserIndex]).session(session);
                    loserUser.losses += 1;
                    
                    await winnerUser.save();
                    await loserUser.save();
                    await game.save();
                    
                    io.to(`game-${gameId}`).emit('gameOver', { game, winner: winnerUser, winnings });

                } else {
                    game.currentPlayerIndex = 1 - playerIndex;
                    await game.save();
                    io.to(`game-${gameId}`).emit('gameUpdate', { game, playerIndex: -1 });
                }

                await session.commitTransaction();

            } catch (error) {
                await session.abortTransaction();
                socket.emit('moveError', { message: error.message || 'Movimento inválido.' });
            } finally {
                session.endSession();
            }
        });

        socket.on('surrender', async ({ gameId }) => {
            const session = await mongoose.startSession();
            session.startTransaction();
            try {
                const game = await Game.findById(gameId).session(session);
                if (!game || game.status !== 'in_progress') return;

                const playerIndex = game.players.findIndex(p => p._id.equals(socket.user._id));
                const winnerIndex = 1 - playerIndex;
                
                game.status = 'completed';
                game.winner = game.players[winnerIndex];

                const settings = await PlatformSettings.findOne({ singleton: true }).session(session);
                const commission = settings ? settings.commissionRate : 0.15;
                const totalPot = game.betAmount * 2;
                const fee = totalPot * commission;
                const winnings = totalPot - fee;
                game.platformFee = fee;

                const winnerUser = await User.findById(game.players[winnerIndex]).session(session);
                winnerUser.balance += winnings;
                winnerUser.wins += 1;
                
                const loserUser = await User.findById(game.players[playerIndex]).session(session);
                loserUser.losses += 1;

                await winnerUser.save();
                await loserUser.save();
                await game.save();

                await session.commitTransaction();

                io.to(`game-${gameId}`).emit('gameOver', { game, winner: winnerUser, winnings, surrendered: true });
            } catch (error) {
                await session.abortTransaction();
                socket.emit('error', { message: 'Falha ao processar a desistência.' });
            } finally {
                session.endSession();
            }
        });

        socket.on('disconnect', () => {
            connectedUsers.delete(socket.user._id.toString());
        });
    });
};

module.exports = socketManager;