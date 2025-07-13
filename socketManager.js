const socketIo = require('socket.io');
const jwt = require('jsonwebtoken');
const { User, Game, LobbyBet, PlatformConfig } = require('./models');
const config =require('./config');
const { createInitialBoard, getValidMoves, applyMove, checkGameEnd, getPlayerColor, PIECE_TYPES } = require('./gameLogic');
const { generateRandomCode } = require('./utils');

let io;

const connectedUsers = new Map();

const socketAuthMiddleware = async (socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) {
        return next(new Error('Authentication error: Token not provided'));
    }
    try {
        const decoded = jwt.verify(token, config.JWT.SECRET);
        const user = await User.findById(decoded.user.id).select('-password');
        if (!user || user.isBlocked) {
            return next(new Error('Authentication error: Invalid user'));
        }
        socket.user = user;
        next();
    } catch (err) {
        next(new Error('Authentication error: Invalid token'));
    }
};

const initializeSocket = (server) => {
    io = socketIo(server, {
        cors: {
            origin: config.CORS_ORIGIN,
            methods: ["GET", "POST"],
            credentials: true
        },
        transports: ['websocket', 'polling']
    });

    io.use(socketAuthMiddleware);

    io.on('connection', (socket) => {
        console.log(`User connected: ${socket.user.username} (${socket.id})`);
        connectedUsers.set(socket.user.id.toString(), { socketId: socket.id, username: socket.user.username });

        socket.on('joinLobby', () => {
            socket.join('lobby');
        });

        socket.on('leaveLobby', () => {
            socket.leave('lobby');
        });

        socket.on('createPrivateGame', async ({ betAmount, timeLimit }) => {
            try {
                const creator = await User.findById(socket.user.id);
                if (creator.balance < betAmount) {
                    return socket.emit('error', { message: 'Saldo insuficiente.' });
                }
                
                await User.findByIdAndUpdate(creator.id, { $inc: { balance: -betAmount }});
                
                const gameCode = generateRandomCode(config.ID_LENGTHS.GAME);
                const game = new Game({
                    gameId: gameCode,
                    players: [creator.id],
                    boardState: JSON.stringify(createInitialBoard()),
                    currentPlayerId: creator.id,
                    betAmount: betAmount,
                    status: 'waiting_for_opponent',
                    playerColors: { black: creator.id }
                });
                await game.save();

                socket.join(gameCode);
                socket.emit('privateGameCreated', { gameCode, game });
            } catch (error) {
                socket.emit('error', { message: 'Erro ao criar jogo privado.' });
            }
        });
        
        socket.on('joinPrivateGame', async ({ gameCode }) => {
             try {
                const game = await Game.findOne({ gameId: gameCode });
                const opponent = await User.findById(socket.user.id);

                if (!game) return socket.emit('error', { message: 'Jogo não encontrado.' });
                if (game.status !== 'waiting_for_opponent') return socket.emit('error', { message: 'Este jogo já começou ou foi cancelado.' });
                if (game.players.includes(opponent.id)) return socket.emit('error', { message: 'Você já está neste jogo.' });
                if (opponent.balance < game.betAmount) return socket.emit('error', { message: 'Saldo insuficiente para entrar.' });

                await User.findByIdAndUpdate(opponent.id, { $inc: { balance: -game.betAmount } });

                game.players.push(opponent.id);
                game.status = 'in_progress';
                game.playerColors.white = opponent.id;
                await game.save();
                
                const populatedGame = await Game.findById(game.id).populate('players', 'username avatar');

                socket.join(gameCode);
                io.to(gameCode).emit('gameStarted', populatedGame);

            } catch(error) {
                socket.emit('error', { message: 'Erro ao entrar no jogo.' });
            }
        });

        socket.on('acceptLobbyBet', async ({ betId }) => {
            try {
                const bet = await LobbyBet.findById(betId).populate('creator');
                if (!bet || bet.status !== 'open') {
                    return socket.emit('error', { message: 'Aposta não disponível.' });
                }
                
                const opponent = await User.findById(socket.user.id);
                if (bet.creator.equals(opponent.id)) {
                    return socket.emit('error', { message: 'Não pode aceitar a sua própria aposta.' });
                }
                if (opponent.balance < bet.betAmount) {
                    return socket.emit('error', { message: 'Saldo insuficiente.' });
                }

                bet.status = 'matched';
                const gameCode = generateRandomCode(config.ID_LENGTHS.GAME);
                bet.gameId = gameCode;
                await bet.save();

                io.to('lobby').emit('betRemoved', bet._id);

                await User.findByIdAndUpdate(opponent.id, { $inc: { balance: -bet.betAmount } });

                const creator = bet.creator;
                
                const game = new Game({
                    gameId: gameCode,
                    players: [creator.id, opponent.id],
                    boardState: JSON.stringify(createInitialBoard()),
                    currentPlayerId: creator.id,
                    betAmount: bet.betAmount,
                    status: 'waiting_for_opponent',
                    playerColors: { black: creator.id, white: opponent.id }
                });
                await game.save();
                
                const creatorSocket = connectedUsers.get(creator.id.toString());
                if (creatorSocket) {
                    io.to(creatorSocket.socketId).emit('betAccepted', { gameCode });
                }
                socket.emit('betAccepted', { gameCode });

                setTimeout(async () => {
                    const updatedGame = await Game.findById(game.id);
                    const creatorSocketInfo = connectedUsers.get(creator.id.toString());
                    const opponentSocketInfo = connectedUsers.get(opponent.id.toString());
                    
                    if (creatorSocketInfo && opponentSocketInfo) {
                        const populatedGame = await Game.findById(game.id).populate('players', 'username avatar');
                        io.to(creatorSocketInfo.socketId).join(gameCode);
                        io.to(opponentSocketInfo.socketId).join(gameCode);
                        updatedGame.status = 'in_progress';
                        await updatedGame.save();
                        io.to(gameCode).emit('gameStarted', populatedGame);
                    } else {
                        io.to(creatorSocketInfo?.socketId).to(opponentSocketInfo?.socketId).emit('waitingForOpponent', { timeout: 60 });
                        const timeoutId = setTimeout(async () => {
                           const finalCheckGame = await Game.findById(game.id);
                           if (finalCheckGame.status === 'waiting_for_opponent') {
                               finalCheckGame.status = 'cancelled';
                               await finalCheckGame.save();
                               await User.findByIdAndUpdate(creator.id, { $inc: { balance: finalCheckGame.betAmount } });
                               await User.findByIdAndUpdate(opponent.id, { $inc: { balance: finalCheckGame.betAmount } });
                               io.to(creatorSocketInfo?.socketId).to(opponentSocketInfo?.socketId).emit('gameCancelled', { message: 'Oponente não conectou. A aposta foi reembolsada.' });
                           }
                        }, 60 * 1000);
                    }
                }, 5000);

            } catch (error) {
                console.log(error);
                socket.emit('error', { message: 'Erro ao aceitar aposta.' });
            }
        });
        
        socket.on('joinGameRoom', async ({ gameId }) => {
            const game = await Game.findOne({ gameId })
                                   .populate('players', 'username avatar')
                                   .populate('winner', 'username');
            if (game && game.players.some(p => p._id.equals(socket.user.id))) {
                socket.join(game.gameId);
                io.to(socket.id).emit('gameUpdate', game);
            } else {
                socket.emit('error', { message: 'Não foi possível entrar na sala do jogo.' });
            }
        });

        socket.on('makeMove', async ({ gameId, move }) => {
            try {
                const game = await Game.findById(gameId);
                if (!game || game.status !== 'in_progress') return;
                if (socket.user.id.toString() !== game.currentPlayerId.toString()) {
                    return socket.emit('error', { message: 'Não é a sua vez de jogar.' });
                }

                const board = JSON.parse(game.boardState);
                
                const pieceAtFrom = board[move.from.r][move.from.c];
                if (pieceAtFrom === PIECE_TYPES.EMPTY) return socket.emit('error', { message: 'Não há peça na casa de origem.'});

                const playerColor = getPlayerColor(pieceAtFrom);
                
                const validMoves = getValidMoves(board, playerColor);
                const isValidMove = validMoves.some(m => 
                    m.from.r === move.from.r && m.from.c === move.from.c &&
                    m.to.r === move.to.r && m.to.c === move.to.c
                );
                
                if (!isValidMove) {
                    return socket.emit('error', { message: 'Movimento inválido.' });
                }

                const executedMove = validMoves.find(m => 
                    m.from.r === move.from.r && m.from.c === move.from.c &&
                    m.to.r === move.to.r && m.to.c === move.to.c
                );
                
                const newBoard = applyMove(board, executedMove);
                const nextPlayerId = game.players.find(p => p.toString() !== game.currentPlayerId.toString());

                game.boardState = JSON.stringify(newBoard);
                game.currentPlayerId = nextPlayerId;
                game.moveHistory.push({
                    from: `${move.from.r},${move.from.c}`,
                    to: `${move.to.r},${move.to.c}`,
                    piece: playerColor,
                    captured: executedMove.captured ? executedMove.captured.map(c => `${c.r},${c.c}`) : []
                });
                
                const nextPlayerColor = playerColor === 'black' ? 'white' : 'black';
                const gameResult = checkGameEnd(newBoard, nextPlayerColor);
                
                if (gameResult.isFinished) {
                    await handleGameEnd(game, gameResult.winner);
                } else {
                    await game.save();
                    io.to(game.gameId).emit('moveMade', { game });
                }
            } catch (error) {
                console.log(error);
                socket.emit('error', { message: 'Erro ao processar jogada.' });
            }
        });

        socket.on('surrender', async ({ gameId }) => {
            try {
                const game = await Game.findById(gameId);
                if (!game || game.status !== 'in_progress') return;
                
                const winnerColor = game.playerColors.black.equals(socket.user.id) ? 'white' : 'black';
                await handleGameEnd(game, winnerColor, true);

            } catch (error) {
                socket.emit('error', { message: 'Erro ao render-se.' });
            }
        });

        socket.on('disconnect', () => {
            console.log(`User disconnected: ${socket.user.username} (${socket.id})`);
            connectedUsers.delete(socket.user.id.toString());
        });
    });

    return io;
};

async function handleGameEnd(game, winnerColor, wasSurrender = false) {
    game.status = wasSurrender ? 'abandoned' : 'completed';
    game.winner = winnerColor === 'black' ? game.playerColors.black : game.playerColors.white;
    const loserId = winnerColor === 'black' ? game.playerColors.white : game.playerColors.black;
    
    const platformConfig = await PlatformConfig.findOne({ key: 'main_config' });
    const commissionRate = platformConfig.commissionRate || config.COMMISSION_RATE;

    const totalBet = game.betAmount * 2;
    const commission = totalBet * commissionRate;
    const winnerPayout = totalBet - commission;
    
    game.commission = commission;
    await game.save();

    await User.findByIdAndUpdate(game.winner, {
        $inc: { 'stats.wins': 1, balance: winnerPayout }
    });
    await User.findByIdAndUpdate(loserId, {
        $inc: { 'stats.losses': 1 }
    });

    const populatedGame = await Game.findById(game.id).populate('players', 'username avatar stats').populate('winner', 'username');
    io.to(game.gameId).emit('gameOver', populatedGame);
}

const getIoInstance = () => {
    if (!io) {
        throw new Error("Socket.io not initialized!");
    }
    return io;
};

// Adicionando uma função para ser chamada de fora quando uma aposta for criada
const notifyNewLobbyBet = async (bet) => {
    const populatedBet = await LobbyBet.findById(bet._id).populate('creator', 'username avatar');
    getIoInstance().to('lobby').emit('newBet', populatedBet);
};

module.exports = {
    initializeSocket,
    getIoInstance,
    notifyNewLobbyBet
};