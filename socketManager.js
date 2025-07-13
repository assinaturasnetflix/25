const jwt = require('jsonwebtoken');
const { User, Match, Transaction, PlatformSettings } = require('./models');
const gameLogic = require('./gameLogic');
const config =require('./config');

const activeGames = new Map();
const userSockets = new Map();

async function handleGameOver(io, matchId, winnerId, loserId, reason) {
    const session = await User.startSession();
    session.startTransaction();
    try {
        const match = await Match.findById(matchId).session(session);
        if (!match || match.status === 'completed' || match.status === 'cancelled') {
            await session.abortTransaction();
            session.endSession();
            return;
        }

        match.status = 'completed';
        match.winner = winnerId;
        match.loser = loserId;

        const winner = await User.findById(winnerId).session(session);
        const loser = await User.findById(loserId).session(session);
        const settings = await PlatformSettings.findOne({ singleton: true }).session(session);
        const commissionRate = settings.commissionRate;

        const totalPot = match.betAmount * 2;
        const commission = totalPot * commissionRate;
        const winnings = totalPot - commission;

        winner.balance += winnings;
        winner.stats.wins += 1;
        loser.stats.losses += 1;
        
        await winner.save({ session });
        await loser.save({ session });
        await match.save({ session });

        await session.commitTransaction();

        const room = `match-${matchId}`;
        io.to(room).emit('game-over', {
            winner: { username: winner.username, avatar: winner.avatar },
            loser: { username: loser.username, avatar: loser.avatar },
            winnings: winnings.toFixed(2),
            commission: commission.toFixed(2),
            reason
        });

    } catch (error) {
        await session.abortTransaction();
        console.error('Game over transaction failed:', error);
    } finally {
        session.endSession();
        activeGames.delete(matchId);
    }
}

function initializeSocketManager(io) {
    io.on('connection', (socket) => {
        socket.on('authenticate', async (token) => {
            try {
                if (!token) return;
                const decoded = jwt.verify(token, process.env.JWT_SECRET);
                const user = await User.findById(decoded.id).select('-password');
                if (!user || user.isBlocked) {
                    socket.emit('auth-error', 'Autenticação falhou.');
                    return socket.disconnect();
                }
                
                socket.user = user;
                userSockets.set(user._id.toString(), socket.id);
                
                const ongoingMatch = await Match.findOne({
                    players: user._id,
                    status: 'in_progress'
                }).populate('players');
                
                if (ongoingMatch) {
                    const room = `match-${ongoingMatch._id.toString()}`;
                    socket.join(room);

                    const opponent = ongoingMatch.players.find(p => p._id.toString() !== user._id.toString());
                    
                    socket.emit('rejoin-game', {
                        matchId: ongoingMatch._id,
                        boardState: gameLogic.stringToBoard(ongoingMatch.boardState),
                        currentPlayerId: ongoingMatch.currentPlayer,
                        playerOne: { _id: ongoingMatch.players[0]._id, username: ongoingMatch.players[0].username },
                        playerTwo: { _id: ongoingMatch.players[1]._id, username: ongoingMatch.players[1].username },
                        betAmount: ongoingMatch.betAmount,
                        isPlayerOne: ongoingMatch.players[0]._id.toString() === user._id.toString(),
                        opponent: { username: opponent.username, avatar: opponent.avatar }
                    });
                }

            } catch (error) {
                socket.emit('auth-error', 'Token inválido ou expirado.');
                socket.disconnect();
            }
        });

        socket.on('create-lobby-game', async ({ betAmount, description, timeLimit, isPrivate, privateCode }) => {
            if (!socket.user) return socket.emit('error-message', 'Não autenticado.');
            
            const user = await User.findById(socket.user._id);
            const settings = await PlatformSettings.findOne({ singleton: true });
            
            if (betAmount < settings.minBet || betAmount > settings.maxBet) {
                return socket.emit('error-message', `Aposta deve estar entre ${settings.minBet} e ${settings.maxBet} ${config.financial.currency}.`);
            }
            if (user.balance < betAmount) {
                return socket.emit('error-message', 'Saldo insuficiente.');
            }

            user.balance -= betAmount;
            
            const match = new Match({
                matchId: "placeholder",
                players: [user._id],
                boardState: gameLogic.boardToString(gameLogic.createInitialBoard()),
                currentPlayer: user._id,
                status: 'waiting',
                betAmount,
                lobbyInfo: { description, createdBy: user._id },
                timeLimit,
                isPrivate,
                privateCode: isPrivate ? privateCode : null
            });
            match.matchId = await require('./utils').generateUniqueNumericId(Match, 'matchId', config.ids.matchIdLength);
            
            await user.save();
            await match.save();
            
            io.emit('lobby-update');
            socket.emit('game-created', { matchId: match._id });
        });

        socket.on('join-game', async ({ matchId }) => {
            if (!socket.user) return socket.emit('error-message', 'Não autenticado.');
            
            const playerTwo = await User.findById(socket.user._id);
            const match = await Match.findById(matchId).populate('players');
            const settings = await PlatformSettings.findOne({ singleton: true });

            if (!match || match.status !== 'waiting') return socket.emit('error-message', 'Partida não disponível.');
            if (playerTwo._id.toString() === match.players[0]._id.toString()) return socket.emit('error-message', 'Não pode entrar na sua própria partida.');
            if (playerTwo.balance < match.betAmount) return socket.emit('error-message', 'Saldo insuficiente.');

            playerTwo.balance -= match.betAmount;
            
            const playerOne = await User.findById(match.players[0]._id);
            
            match.players.push(playerTwo._id);
            match.status = 'in_progress';
            
            await playerTwo.save();
            await match.save();

            const p1SocketId = userSockets.get(playerOne._id.toString());
            const p2SocketId = userSockets.get(playerTwo._id.toString());

            const room = `match-${match._id.toString()}`;
            if (p1SocketId) io.sockets.sockets.get(p1SocketId)?.join(room);
            if (p2SocketId) io.sockets.sockets.get(p2SocketId)?.join(room);

            const matchDataForPlayers = {
                matchId: match._id.toString(),
                playerOne: { username: playerOne.username, avatar: playerOne.avatar },
                playerTwo: { username: playerTwo.username, avatar: playerTwo.avatar },
            };
            
            if(p1SocketId) io.to(p1SocketId).emit('match-found', matchDataForPlayers);
            if(p2SocketId) io.to(p2SocketId).emit('match-found', matchDataForPlayers);

            const timeoutId = setTimeout(async () => {
                const currentMatch = await Match.findById(match._id);
                if (currentMatch.status === 'in_progress') { 
                    const creatorSocketId = userSockets.get(currentMatch.players[0].toString());
                    const opponentSocketId = userSockets.get(currentMatch.players[1].toString());

                    const p1Connected = io.sockets.sockets.get(creatorSocketId)?.connected;
                    const p2Connected = io.sockets.sockets.get(opponentSocketId)?.connected;

                    if (!p1Connected || !p2Connected) {
                        currentMatch.status = 'cancelled';
                        await currentMatch.save();

                        const p1 = await User.findById(currentMatch.players[0]);
                        const p2 = await User.findById(currentMatch.players[1]);
                        p1.balance += currentMatch.betAmount;
                        p2.balance += currentMatch.betAmount;
                        await p1.save();
                        await p2.save();
                        
                        if(p1Connected) io.to(creatorSocketId).emit('game-cancelled', { message: 'Oponente não conectou. Aposta devolvida.' });
                        if(p2Connected) io.to(opponentSocketId).emit('game-cancelled', { message: 'Oponente não conectou. Aposta devolvida.' });

                        activeGames.delete(match._id.toString());
                    }
                }
            }, config.game.opponentConnectionTimeout);
            
            activeGames.set(match._id.toString(), {
                playerTimeout: timeoutId,
                boardState: match.boardState,
                currentPlayerId: match.currentPlayer.toString()
            });

            io.emit('lobby-update');
        });

        socket.on('player-ready', async ({ matchId }) => {
             const game = activeGames.get(matchId);
             if (game && game.playerTimeout) {
                clearTimeout(game.playerTimeout);
                delete game.playerTimeout;
             }

            const room = `match-${matchId}`;
            const clients = io.sockets.adapter.rooms.get(room);
            if (clients && clients.size === 2) {
                const match = await Match.findById(matchId).populate('players', 'username avatar');
                io.to(room).emit('game-start', {
                    matchId: match._id,
                    boardState: gameLogic.stringToBoard(match.boardState),
                    currentPlayerId: match.currentPlayer,
                    playerOne: match.players[0],
                    playerTwo: match.players[1],
                    betAmount: match.betAmount,
                });
            }
        });

        socket.on('make-move', async ({ matchId, move }) => {
            if (!socket.user) return;

            const match = await Match.findById(matchId);
            if (!match || match.status !== 'in_progress' || socket.user._id.toString() !== match.currentPlayer.toString()) {
                return socket.emit('error-message', 'Não é a sua vez ou a partida é inválida.');
            }

            const board = gameLogic.stringToBoard(match.boardState);
            const playerNumber = match.players[0].equals(socket.user._id) ? 1 : 2;
            const possibleMoves = gameLogic.getAllPossibleMoves(board, playerNumber);

            const isValidMove = possibleMoves.some(m => m.from.r === move.from.r && m.from.c === move.from.c && m.to.r === move.to.r && m.to.c === move.to.c);
            
            if (!isValidMove) return socket.emit('error-message', 'Jogada inválida.');

            const fullMoveData = possibleMoves.find(m => m.from.r === move.from.r && m.from.c === move.from.c && m.to.r === move.to.r && m.to.c === move.to.c);

            const newBoard = gameLogic.performMove(board, fullMoveData);
            const opponentId = match.players.find(p => !p.equals(socket.user._id));
            const opponentPlayerNumber = playerNumber === 1 ? 2 : 1;
            
            match.boardState = gameLogic.boardToString(newBoard);
            match.currentPlayer = opponentId;

            const gameStatus = gameLogic.checkGameEnd(newBoard, opponentPlayerNumber);

            if (gameStatus.gameOver) {
                const winnerId = gameStatus.winner === 1 ? match.players[0] : match.players[1];
                const loserId = winnerId.equals(match.players[0]) ? match.players[1] : match.players[0];
                await handleGameOver(io, matchId, winnerId, loserId, 'checkmate');
            } else {
                await match.save();
                const room = `match-${matchId}`;
                io.to(room).emit('move-made', {
                    newBoardState: newBoard,
                    currentPlayerId: opponentId,
                });
            }
        });

        socket.on('leave-game', async ({ matchId }) => {
            if (!socket.user) return;
            const match = await Match.findById(matchId);
            if (!match || match.status !== 'in_progress') return;

            const isPlayerInMatch = match.players.includes(socket.user._id);
            if (!isPlayerInMatch) return;

            const winnerId = match.players.find(p => !p.equals(socket.user._id));
            const loserId = socket.user._id;

            await handleGameOver(io, matchId, winnerId, loserId, 'abandonment');
        });

        socket.on('admin-spectate', async (matchId) => {
             if (!socket.user || socket.user.role !== 'admin') return;
             const match = await Match.findById(matchId).populate('players');
             if (!match) return;
             const room = `match-${matchId}`;
             socket.join(room);
             socket.emit('spectate-start', {
                match,
                boardState: gameLogic.stringToBoard(match.boardState)
             });
        });

        socket.on('disconnect', async () => {
            if (socket.user) {
                userSockets.delete(socket.user._id.toString());
            }
        });
    });
}

module.exports = { initializeSocketManager };