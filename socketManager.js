const jwt = require('jsonwebtoken');
const util = require('util');
const { User, Game, PlatformSettings } = require('./models');
const gameLogic = require('./gameLogic');
const config = require('./config');

const onlineUsers = new Map();
const gameTimers = new Map();
const gameReadiness = new Map();

const generatePrivateCode = async () => {
    let code;
    let isUnique = false;
    while (!isUnique) {
        code = Math.random().toString(36).substring(2, 8).toUpperCase();
        const existingGame = await Game.findOne({ privateCode: code, status: { $in: ['waiting_for_opponent', 'in_progress'] } });
        if (!existingGame) {
            isUnique = true;
        }
    }
    return code;
};

const handleEndGame = async (io, game, winnerId, loserId, reason) => {
    if (game.status === 'completed' || game.status === 'abandoned') return;

    const winner = await User.findById(winnerId);
    const loser = await User.findById(loserId);
    let settings = await PlatformSettings.findOne();
    if (!settings) settings = config;
    
    const commissionRate = settings.commissionRate || config.commissionRate;

    const totalPot = game.betAmount * 2;
    const commission = totalPot * commissionRate;
    const prize = totalPot - commission;

    winner.balance += prize;
    winner.stats.wins += 1;
    loser.stats.losses += 1;
    
    game.winner = winnerId;
    game.status = reason === 'surrender' ? 'abandoned' : 'completed';

    await Promise.all([winner.save(), loser.save(), game.save()]);

    const winnerSocketId = onlineUsers.get(winner._id.toString());
    const loserSocketId = onlineUsers.get(loser._id.toString());

    const payload = {
        winner: { username: winner.username, avatar: winner.avatar },
        loser: { username: loser.username, avatar: loser.avatar },
        prize,
        commission,
    };

    io.to(game.gameId).emit('gameOver', payload);

    if (winnerSocketId) io.sockets.sockets.get(winnerSocketId)?.leave(game.gameId);
    if (loserSocketId) io.sockets.sockets.get(loserSocketId)?.leave(game.gameId);
};


module.exports = function(io) {
    io.on('connection', (socket) => {

        socket.on('authenticate', async (token) => {
            try {
                if (!token) return;
                const decoded = await util.promisify(jwt.verify)(token, process.env.JWT_SECRET);
                const user = await User.findById(decoded.id);
                if (!user) return;

                socket.user = user;
                onlineUsers.set(user._id.toString(), socket.id);
                
                const unfinishedGame = await Game.findOne({
                    players: user._id,
                    status: { $in: ['in_progress', 'waiting_for_opponent'] }
                }).populate('players', 'userId username avatar');

                if (unfinishedGame) {
                    socket.join(unfinishedGame.gameId);
                    socket.emit('reconnect', unfinishedGame);
                }

            } catch (err) {
                socket.emit('error', { message: "Autenticação falhou." });
            }
        });

        socket.on('createGame', async (data) => {
            try {
                if (!socket.user) return socket.emit('error', { message: 'Usuário não autenticado.' });
                
                const existingGame = await Game.findOne({ players: socket.user._id, status: { $in: ['waiting_for_opponent', 'in_progress'] } });
                if (existingGame) return socket.emit('error', { message: 'Já tem uma partida ativa.' });

                const { betAmount, isPrivate, description, timeLimit } = data;
                
                let settings = await PlatformSettings.findOne();
                 if(!settings) settings = { limits: config.limits };
                
                if (betAmount < settings.limits.minBet || betAmount > settings.limits.maxBet) {
                    return socket.emit('error', { message: `Aposta deve ser entre ${settings.limits.minBet} e ${settings.limits.maxBet} MT.`});
                }

                if (socket.user.balance < betAmount) {
                    return socket.emit('error', { message: 'Saldo insuficiente.' });
                }

                socket.user.balance -= betAmount;
                await socket.user.save();

                const newGameData = {
                    players: [socket.user._id],
                    boardState: gameLogic.createInitialBoard(),
                    betAmount,
                    isPrivate,
                    lobbyDescription: isPrivate ? 'Partida Privada' : description,
                    timeLimit: timeLimit || 'untimed',
                };
                
                if (isPrivate) {
                    newGameData.privateCode = await generatePrivateCode();
                }

                const game = new Game(newGameData);
                await game.save();

                socket.join(game.gameId);
                
                const populatedGame = await Game.findById(game._id).populate('players', 'userId username avatar');
                
                socket.emit('gameCreated', populatedGame);

                if (!isPrivate) {
                    io.emit('newGameInLobby', populatedGame);
                }

            } catch (err) {
                socket.emit('error', { message: 'Erro ao criar partida.' });
            }
        });
        
        socket.on('joinGame', async ({ gameId, privateCode }) => {
            try {
                if (!socket.user) return socket.emit('error', { message: 'Usuário não autenticado.' });
                
                const existingGame = await Game.findOne({ players: socket.user._id, status: { $in: ['waiting_for_opponent', 'in_progress'] } });
                if (existingGame) return socket.emit('error', { message: 'Já tem uma partida ativa.' });
                
                const query = privateCode ? { privateCode } : { gameId };
                const game = await Game.findOne(query);

                if (!game || game.status !== 'waiting_for_opponent') {
                    return socket.emit('error', { message: 'Partida não disponível ou código inválido.' });
                }
                
                if (game.players[0].toString() === socket.user._id.toString()) {
                    return socket.emit('error', { message: 'Não pode entrar na sua própria partida.' });
                }

                if (socket.user.balance < game.betAmount) {
                    return socket.emit('error', { message: 'Saldo insuficiente.' });
                }

                socket.user.balance -= game.betAmount;
                await socket.user.save();

                game.players.push(socket.user._id);
                game.status = 'in_progress';
                game.currentPlayer = game.players[Math.floor(Math.random() * 2)];
                await game.save();

                socket.join(game.gameId);

                const populatedGame = await Game.findById(game._id).populate('players', 'userId username avatar');
                
                if (!game.isPrivate) {
                    io.emit('gameRemovedFromLobby', { gameId: game.gameId });
                }

                io.to(game.gameId).emit('gameJoined', populatedGame);
                
                gameReadiness.set(game.gameId, new Set());

                const afkTimer = setTimeout(() => {
                    const readyPlayers = gameReadiness.get(game.gameId);
                    if (readyPlayers.size < 2) {
                        game.status = 'cancelled';
                        game.save().then(async () => {
                            const player1 = await User.findById(game.players[0]);
                            const player2 = await User.findById(game.players[1]);
                            player1.balance += game.betAmount;
                            player2.balance += game.betAmount;
                            await Promise.all([player1.save(), player2.save()]);

                            io.to(game.gameId).emit('gameCancelled', { message: 'Um dos jogadores não confirmou a presença a tempo. A partida foi cancelada e o saldo devolvido.' });
                            gameReadiness.delete(game.gameId);
                        });
                    }
                    gameTimers.delete(game.gameId);
                }, config.gameSettings.afkTimeout);
                
                gameTimers.set(game.gameId, afkTimer);

            } catch (err) {
                socket.emit('error', { message: 'Erro ao entrar na partida.' });
            }
        });
        
        socket.on('playerReady', async ({ gameId }) => {
             if (!socket.user || !gameId) return;

            const readySet = gameReadiness.get(gameId);
            if (!readySet) return;

            readySet.add(socket.user._id.toString());
            
            if (readySet.size === 2) {
                const timer = gameTimers.get(gameId);
                if (timer) {
                    clearTimeout(timer);
                    gameTimers.delete(gameId);
                }
                gameReadiness.delete(gameId);
                const game = await Game.findOne({gameId}).populate('players', 'userId username avatar');
                io.to(gameId).emit('startGameplay', game);
            }
        });

        socket.on('makeMove', async ({ gameId, move }) => {
            try {
                if (!socket.user) return socket.emit('error', { message: 'Usuário não autenticado.' });
                const game = await Game.findById(gameId);
                
                if (!game || game.status !== 'in_progress' || game.currentPlayer.toString() !== socket.user._id.toString()) {
                    return socket.emit('error', { message: 'Não é sua vez ou a partida não está ativa.' });
                }

                const playerNumber = game.players[0].equals(socket.user._id) ? 1 : 2;
                const validMoves = gameLogic.getValidMoves(game.boardState, playerNumber);
                
                const isMoveValid = validMoves.some(validMove => JSON.stringify(validMove) === JSON.stringify(move));

                if (!isMoveValid) {
                    return socket.emit('error', { message: 'Jogada inválida.' });
                }
                
                game.boardState = gameLogic.applyMove(game.boardState, move);
                game.moveHistory.push(JSON.stringify(move));

                const nextPlayerNumber = playerNumber === 1 ? 2 : 1;
                const gameState = gameLogic.checkGameState(game.boardState, nextPlayerNumber);

                if (gameState.isGameOver) {
                    const winnerId = game.players[gameState.winner - 1];
                    const loserId = game.players[gameState.winner === 1 ? 1 : 0];
                    await handleEndGame(io, game, winnerId, loserId, 'win');
                } else {
                    game.currentPlayer = game.players[nextPlayerNumber - 1];
                    game.lastMoveTime = Date.now();
                    await game.save();
                    io.to(game.gameId).emit('moveMade', { game });
                }
            } catch (err) {
                 socket.emit('error', { message: 'Erro ao processar jogada.' });
            }
        });
        
        socket.on('surrender', async ({ gameId }) => {
            if (!socket.user) return socket.emit('error', { message: 'Usuário não autenticado.' });
            
            const game = await Game.findById(gameId);
            if (!game || game.status !== 'in_progress') return;

            const loserId = socket.user._id;
            const winnerId = game.players.find(p => !p.equals(loserId));
            
            if(!winnerId) return;

            await handleEndGame(io, game, winnerId, loserId, 'surrender');
        });
        
        socket.on('abandonMatch', async ({gameId}) => {
             if (!socket.user) return socket.emit('error', { message: 'Usuário não autenticado.' });
             
             const game = await Game.findById(gameId);
             if (!game || game.status === 'completed' || game.status === 'abandoned') return;
             
             const isPlayerInGame = game.players.some(p => p.equals(socket.user._id));
             if (!isPlayerInGame) return;
             
             const loserId = socket.user._id;
             const winnerId = game.players.find(p => !p.equals(loserId));

             if (winnerId) {
                 await handleEndGame(io, game, winnerId, loserId, 'surrender');
             } else {
                 game.status = 'cancelled';
                 socket.user.balance += game.betAmount;
                 await Promise.all([game.save(), socket.user.save()]);
                 socket.emit('gameCancelled', { message: "Partida cancelada pois o oponente não existia." });
             }
        });

        socket.on('disconnect', () => {
            if (socket.user) {
                onlineUsers.delete(socket.user._id.toString());
            }
        });
    });
};