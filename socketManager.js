const jwt = require('jsonwebtoken');
const { Game, User, PlatformSettings } = require('./models');
const { validateMove, applyMove, checkWinCondition } = require('./gameLogic');
const { calculateCommission } = require('./utils');
const config = require('./config');

const socketManager = (io) => {
    io.use((socket, next) => {
        if (socket.handshake.auth && socket.handshake.auth.token) {
            jwt.verify(socket.handshake.auth.token, process.env.JWT_SECRET, (err, decoded) => {
                if (err) return next(new Error('Authentication error'));
                socket.decoded = decoded;
                next();
            });
        } else {
            next(new Error('Authentication error'));
        }
    }).on('connection', (socket) => {

        socket.on('joinGame', async (gameId) => {
            try {
                const game = await Game.findOne({ gameId }).populate('players', 'username avatar');
                if (!game) {
                    socket.emit('error', { message: 'Jogo não encontrado.' });
                    return;
                }
                const userId = socket.decoded.id;
                if (!game.players.some(p => p._id.equals(userId))) {
                    socket.emit('error', { message: 'Você não faz parte deste jogo.' });
                    return;
                }

                socket.join(gameId);
                socket.userId = userId;
                
                io.to(gameId).emit('playerJoined', { userId, username: game.players.find(p=>p._id.equals(userId)).username });
                
                if (game.status === 'waiting' && game.players.length === 2 && !game.isPrivate) {
                    game.status = 'in_progress';
                    await game.save();
                    io.to(gameId).emit('gameStart', game);
                } else {
                    socket.emit('gameUpdate', game); 
                }

            } catch (error) {
                socket.emit('error', { message: 'Erro interno ao entrar no jogo.' });
            }
        });

        socket.on('playerReady', async (gameId) => {
            try {
                const game = await Game.findById(gameId).populate('players', 'username avatar');
                if (!game || !game.isPrivate) return;

                const userId = socket.decoded.id;
                if (!game.waitingForConfirmation.some(id => id.equals(userId))) {
                    game.waitingForConfirmation.push(userId);
                    await game.save();
                }
                
                io.to(game.gameId).emit('readyStatus', { waitingFor: game.waitingForConfirmation });

                if (game.waitingForConfirmation.length === 2) {
                    game.status = 'in_progress';
                    await game.save();
                    io.to(game.gameId).emit('gameStart', game);
                }
            } catch (error) {
                socket.emit('error', { message: 'Erro ao confirmar prontidão.' });
            }
        });

        socket.on('makeMove', async ({ gameId, move }) => {
            try {
                const game = await Game.findById(gameId);
                if (!game || game.status !== 'in_progress') {
                    socket.emit('error', { message: 'Não é possível fazer a jogada.' });
                    return;
                }

                const playerIndex = game.players.findIndex(p => p.equals(socket.userId));
                if (playerIndex !== game.currentPlayerIndex) {
                    socket.emit('error', { message: 'Não é a sua vez de jogar.' });
                    return;
                }
                
                const playerNumber = playerIndex + 1;
                const validationResult = validateMove(game.boardState, move, playerNumber);

                if (!validationResult.isValid) {
                    socket.emit('error', { message: validationResult.error });
                    return;
                }
                
                game.boardState = applyMove(game.boardState, move, playerNumber);
                game.moveHistory.push(JSON.stringify(move));
                
                const winCondition = checkWinCondition(game.boardState, playerNumber);
                if (winCondition.isGameOver) {
                    game.status = 'completed';
                    game.winner = game.players[playerIndex];
                    
                    const settings = await PlatformSettings.findOne();
                    const commissionRate = settings ? settings.commissionRate : config.commissionRate;
                    const { netAmount } = calculateCommission(game.betAmount * 2, commissionRate);
                    
                    const winnerUser = await User.findById(game.winner);
                    winnerUser.balance += netAmount;
                    winnerUser.stats.wins += 1;
                    
                    const loserIndex = (playerIndex === 0) ? 1 : 0;
                    const loserUser = await User.findById(game.players[loserIndex]);
                    loserUser.stats.losses += 1;
                    
                    await game.save();
                    await winnerUser.save();
                    await loserUser.save();
                    
                    io.to(game.gameId).emit('gameOver', { game, winner: winnerUser, loser: loserUser });

                } else {
                    game.currentPlayerIndex = (game.currentPlayerIndex === 0) ? 1 : 0;
                    await game.save();
                    io.to(game.gameId).emit('moveMade', game);
                }
            } catch (error) {
                 socket.emit('error', { message: 'Erro ao processar jogada.' });
            }
        });

        socket.on('surrender', async (gameId) => {
            try {
                const game = await Game.findById(gameId);
                if (!game || game.status !== 'in_progress') return;

                const loserIndex = game.players.findIndex(p => p.equals(socket.userId));
                if (loserIndex === -1) return;

                const winnerIndex = (loserIndex === 0) ? 1 : 0;
                game.status = 'completed';
                game.winner = game.players[winnerIndex];
                
                const settings = await PlatformSettings.findOne();
                const commissionRate = settings ? settings.commissionRate : config.commissionRate;
                const { netAmount } = calculateCommission(game.betAmount * 2, commissionRate);

                const winnerUser = await User.findById(game.winner);
                winnerUser.balance += netAmount;
                winnerUser.stats.wins += 1;
                
                const loserUser = await User.findById(game.players[loserIndex]);
                loserUser.stats.losses += 1;
                
                await game.save();
                await winnerUser.save();
                await loserUser.save();

                io.to(game.gameId).emit('gameOver', { game, winner: winnerUser, loser: loserUser, surrendered: true });

            } catch (error) {
                socket.emit('error', { message: 'Erro ao desistir.' });
            }
        });

        socket.on('disconnect', () => {
        });
    });
};

module.exports = socketManager;