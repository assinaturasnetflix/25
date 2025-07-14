const { User, Game, PlatformConfig } = require('./models.js');
const gameLogic = require('./gameLogic.js');
const { generateGameInviteCode } = require('./utils.js');
const initialConfig = require('./config.js');

const activeSockets = new Map();

module.exports = function(io) {
    io.on('connection', (socket) => {
        const userId = socket.handshake.query.userId;
        if (userId) {
            activeSockets.set(userId.toString(), socket.id);
            User.findByIdAndUpdate(userId, { isOnline: true }).catch(err => console.error(err));
            socket.join(userId.toString());
        }

        socket.on('disconnect', async () => {
            for (let [key, value] of activeSockets.entries()) {
                if (value === socket.id) {
                    activeSockets.delete(key);
                    try {
                        const user = await User.findById(key);
                        if(user) {
                           user.isOnline = false;
                           user.lastSeen = new Date();
                           await user.save();
                        }
                    } catch (err) {
                        console.error('Error updating user status on disconnect:', err);
                    }
                    break;
                }
            }
        });

        socket.on('create-game', async (data, callback) => {
            const { betAmount, description, timeLimit, isPrivate } = data;
            const user = await User.findById(userId);

            if (user.currentGameId) {
                return callback({ success: false, message: 'Você já tem uma partida em andamento.' });
            }
            const config = (await PlatformConfig.findOne({ configKey: 'main' })) || initialConfig;
            if (betAmount < config.minBetAmount || betAmount > config.maxBetAmount) {
                return callback({ success: false, message: `O valor da aposta deve ser entre ${config.minBetAmount} MT e ${config.maxBetAmount} MT.` });
            }
            if (user.balance < betAmount) {
                return callback({ success: false, message: 'Saldo insuficiente para criar esta aposta.' });
            }

            try {
                user.balance -= betAmount;
                const newGame = new Game({
                    players: [user._id],
                    boardState: gameLogic.createInitialBoard(),
                    currentPlayer: user._id,
                    betAmount,
                    description,
                    timeLimit,
                    status: 'waiting',
                    inviteCode: isPrivate ? generateGameInviteCode() : null,
                });
                user.currentGameId = newGame._id;
                await newGame.save();
                await user.save();
                
                socket.join(newGame._id.toString());
                if (!isPrivate) {
                   io.emit('new-lobby-game', {
                       _id: newGame._id,
                       players: [{_id: user._id, username: user.username, avatar: user.avatar, userId: user.userId }],
                       betAmount: newGame.betAmount,
                       description: newGame.description,
                       createdAt: newGame.createdAt,
                   });
                }
                callback({ success: true, game: newGame });
            } catch (error) {
                user.balance += betAmount;
                await user.save();
                callback({ success: false, message: 'Erro ao criar a partida.' });
            }
        });

        socket.on('join-game', async (data, callback) => {
            const { gameId, inviteCode } = data;
            const user = await User.findById(userId);
            const game = await Game.findById(gameId);

            if (!game) return callback({ success: false, message: 'Partida não encontrada.' });
            if (user.currentGameId) return callback({ success: false, message: 'Você já tem uma partida em andamento.' });
            if (game.status !== 'waiting') return callback({ success: false, message: 'Esta partida já não está disponível.' });
            if (game.players.length >= 2) return callback({ success: false, message: 'Esta partida já está cheia.' });
            if (game.players[0].equals(user._id)) return callback({ success: false, message: 'Você não pode se juntar à sua própria partida.' });
            if (game.inviteCode && game.inviteCode !== inviteCode) return callback({ success: false, message: 'Código de convite inválido.' });
            
            const config = (await PlatformConfig.findOne({ configKey: 'main' })) || initialConfig;
            if (user.balance < game.betAmount) {
                return callback({ success: false, message: 'Saldo insuficiente para entrar nesta aposta.' });
            }

            try {
                user.balance -= game.betAmount;
                user.currentGameId = game._id;

                game.players.push(user._id);
                game.currentPlayer = Math.random() < 0.5 ? game.players[0] : game.players[1];
                game.status = 'active';
                
                await user.save();
                await game.save();

                const populatedGame = await Game.findById(game._id).populate('players', 'username avatar userId balance');
                
                socket.join(game._id.toString());
                const opponentSocketId = activeSockets.get(game.players[0].toString());
                if(opponentSocketId) {
                    io.sockets.sockets.get(opponentSocketId)?.join(game._id.toString());
                }
                
                io.to(game._id.toString()).emit('match-found', populatedGame);
                io.emit('lobby-game-removed', { gameId: game._id });
                callback({ success: true, game: populatedGame });

                setTimeout(() => {
                    io.to(game._id.toString()).emit('game-start', populatedGame);
                }, 5000);

            } catch (error) {
                user.balance += game.betAmount;
                await user.save();
                callback({ success: false, message: 'Erro ao entrar na partida.' });
            }
        });
        
        socket.on('player-move', async (data, callback) => {
            const { gameId, move } = data;
            const game = await Game.findById(gameId);

            if (!game || game.status !== 'active') return;
            if (!game.currentPlayer.equals(userId)) return;

            const playerNumber = game.players[0].equals(userId) ? 1 : 2;
            const possibleMoves = gameLogic.findPossibleMoves(game.boardState, playerNumber);

            const isValidMove = possibleMoves.some(pMove => 
                pMove.from.r === move.from.r && pMove.from.c === move.from.c &&
                pMove.to.r === move.to.r && pMove.to.c === move.to.c
            );

            if (!isValidMove) {
                return callback({ success: false, message: 'Jogada inválida.' });
            }
            
            const fullMoveData = possibleMoves.find(pMove => 
                pMove.from.r === move.from.r && pMove.from.c === move.from.c &&
                pMove.to.r === move.to.r && pMove.to.c === move.to.c
            );

            game.boardState = gameLogic.applyMove(game.boardState, fullMoveData);
            game.moveHistory.push({ player: userId, move: fullMoveData, timestamp: new Date() });
            
            const opponentId = game.players.find(p => !p.equals(userId));
            game.currentPlayer = opponentId;

            const winnerCheck = gameLogic.checkWinner(game.boardState, playerNumber === 1 ? 2 : 1);
            if (winnerCheck) {
                const winnerId = winnerCheck.winner === 1 ? game.players[0] : game.players[1];
                const loserId = winnerCheck.loser === 1 ? game.players[0] : game.players[1];
                await endGame(game, winnerId, loserId);
            } else {
                await game.save();
                io.to(game._id.toString()).emit('game-update', game);
                callback({ success: true });
            }
        });

        socket.on('surrender', async (data) => {
            const { gameId } = data;
            const game = await Game.findById(gameId);
            if (!game || game.status !== 'active') return;

            const loserId = userId;
            const winnerId = game.players.find(p => !p.equals(loserId));
            
            await endGame(game, winnerId, loserId, { surrendered: true });
        });
        
        socket.on('force-end-incomplete-game', async (data, callback) => {
            const { gameId } = data;
            const game = await Game.findById(gameId);
            if (!game || game.status !== 'incomplete') return callback({success: false, message: "A partida não pode ser encerrada."});
            if (!game.players.includes(userId)) return callback({success: false, message: "Não autorizado."});

            const user = await User.findById(userId);
            
            const loserId = user._id;
            const winnerId = game.players.find(p => !p.equals(loserId));
            
            await endGame(game, winnerId, loserId, { incomplete: true });
            callback({success: true, message: "Partida encerrada. Você foi declarado como perdedor."})
        });
    });

    async function endGame(game, winnerId, loserId, flags = {}) {
        if (game.status === 'finished') return;
    
        const config = (await PlatformConfig.findOne({ configKey: 'main' })) || initialConfig;
        const commissionRate = config.commissionRate;
        const totalPot = game.betAmount * 2;
        const commission = totalPot * commissionRate;
        const winnings = totalPot - commission;
    
        try {
            const winner = await User.findById(winnerId);
            const loser = await User.findById(loserId);
    
            if(winner) {
                winner.balance += winnings;
                winner.wins += 1;
                winner.currentGameId = null;
                await winner.save();
            }
    
            if(loser) {
                loser.losses += 1;
                loser.currentGameId = null;
                await loser.save();
            }
    
            game.status = 'finished';
            game.winner = winnerId;
            game.loser = loserId;
            game.finishedAt = new Date();
            await game.save();
    
            const result = {
                gameId: game._id,
                winner: { _id: winner._id, username: winner.username },
                loser: { _id: loser._id, username: loser.username },
                winnings,
                commission,
                flags
            };
    
            io.to(game._id.toString()).emit('game-over', result);
    
            const winnerSocketId = activeSockets.get(winnerId.toString());
            const loserSocketId = activeSockets.get(loserId.toString());
    
            if (winnerSocketId) io.sockets.sockets.get(winnerSocketId)?.leave(game._id.toString());
            if (loserSocketId) io.sockets.sockets.get(loserSocketId)?.leave(game._id.toString());
    
        } catch (error) {
            console.error('Error ending game:', error);
            game.status = 'incomplete';
            await game.save();
            io.to(game._id.toString()).emit('error', { message: 'Ocorreu um erro ao finalizar a partida. O status foi marcado como incompleto. Contacte o suporte.' });
        }
    }
};