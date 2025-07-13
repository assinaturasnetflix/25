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
                
                // LÓGICA DE REJOIN SIMPLIFICADA E CORRETA
                const ongoingMatch = await Match.findOne({
                    players: user._id,
                    status: 'in_progress'
                });
                
                if (ongoingMatch) {
                    // Apenas informa o frontend. O frontend decide o que fazer.
                    socket.emit('rejoin-prompt', { matchId: ongoingMatch._id.toString() });
                }

            } catch (error) {
                socket.emit('auth-error', 'Token inválido ou expirado.');
                socket.disconnect();
            }
        });

        socket.on('create-lobby-game', async ({ betAmount, description, timeLimit }) => {
            if (!socket.user) return socket.emit('error-message', 'Não autenticado.');
            
            const ongoingMatch = await Match.findOne({ players: socket.user._id, status: 'in_progress' });
            if (ongoingMatch) {
                return socket.emit('error-message', 'Você já tem uma partida em andamento. Termine-a antes de criar outra.');
            }
            
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
                isPrivate: false
            });
            match.matchId = await require('./utils').generateUniqueNumericId(Match, 'matchId', config.ids.matchIdLength);
            
            await user.save();
            await match.save();
            
            io.emit('lobby-update');
        });

        socket.on('join-game', async ({ matchId }) => {
            if (!socket.user) return socket.emit('error-message', 'Não autenticado.');

            const ongoingMatch = await Match.findOne({ players: socket.user._id, status: 'in_progress' });
            if (ongoingMatch) {
                return socket.emit('error-message', 'Você já tem uma partida em andamento. Termine-a antes de entrar em outra.');
            }
            
            const playerTwo = await User.findById(socket.user._id);
            const match = await Match.findById(matchId);

            if (!match || match.status !== 'waiting') return socket.emit('error-message', 'Partida não disponível.');
            if (playerTwo._id.toString() === match.players[0].toString()) return socket.emit('error-message', 'Não pode entrar na sua própria partida.');
            if (playerTwo.balance < match.betAmount) return socket.emit('error-message', 'Saldo insuficiente.');

            playerTwo.balance -= match.betAmount;
            
            match.players.push(playerTwo._id);
            match.status = 'in_progress';
            
            await playerTwo.save();
            await match.save();

            const p1SocketId = userSockets.get(match.players[0].toString());
            const p2SocketId = userSockets.get(match.players[1].toString());

            const room = `match-${match._id.toString()}`;
            if (p1SocketId) io.sockets.sockets.get(p1SocketId)?.join(room);
            if (p2SocketId) io.sockets.sockets.get(p2SocketId)?.join(room);
            
            io.to(room).emit('match-found', { matchId: match._id.toString() });
            io.emit('lobby-update');
        });

        socket.on('player-ready', async ({ matchId }) => {
            const room = `match-${matchId}`;
            const clients = io.sockets.adapter.rooms.get(room);
            
            // Uma verificação para evitar que o timeout cancele o jogo se os jogadores já estiverem prontos.
            const game = activeGames.get(matchId);
            if (game && clients && clients.size === 2) {
                 clearTimeout(game.playerTimeout);
                 delete game.playerTimeout;
            }
            
            if (clients && clients.size === 2) {
                io.to(room).emit('game-start');
            }
        });

        socket.on('get-game-state', async (matchId) => {
            if (!socket.user) return;
            const match = await Match.findById(matchId).populate('players', 'username avatar stats bio');
            if (!match || !match.players.map(p => p._id.toString()).includes(socket.user._id.toString())) {
                return socket.emit('error-message', 'Partida não encontrada.');
            }

            const playerNumber = match.players[0]._id.equals(socket.user._id) ? 1 : 2;
            const board = gameLogic.stringToBoard(match.boardState);
            const moves = gameLogic.getAllPossibleMoves(board, playerNumber);
            
            socket.emit('game-state', {
                matchId: match._id.toString(),
                boardState: board,
                currentPlayerId: match.currentPlayer.toString(),
                playerOne: match.players[0].toObject(),
                playerTwo: match.players[1].toObject(),
                betAmount: match.betAmount,
                timeLimit: match.timeLimit,
                possibleMoves: moves
            });
        });

        socket.on('make-move', async ({ matchId, move }) => {
            if (!socket.user) return;
            const match = await Match.findById(matchId);
            if (!match || match.status !== 'in_progress' || socket.user._id.toString() !== match.currentPlayer.toString()) return;

            const board = gameLogic.stringToBoard(match.boardState);
            const playerNumber = match.players[0].equals(socket.user._id) ? 1 : 2;
            const possibleMoves = gameLogic.getAllPossibleMoves(board, playerNumber);
            const isValidMove = possibleMoves.some(m => m.from.r === move.from.r && m.from.c === move.from.c && m.to.r === move.to.r && m.to.c === move.to.c);
            
            if (!isValidMove) return;

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
                const opponentMoves = gameLogic.getAllPossibleMoves(newBoard, opponentPlayerNumber);
                io.to(`match-${matchId}`).emit('move-made', { newBoardState: newBoard, currentPlayerId: opponentId, possibleMoves: opponentMoves });
            }
        });

        socket.on('leave-game', async ({ matchId }) => {
            if (!socket.user) return;
            const match = await Match.findById(matchId);
            if (!match || match.status !== 'in_progress') return;
            if (!match.players.includes(socket.user._id)) return;

            const winnerId = match.players.find(p => !p.equals(socket.user._id));
            const loserId = socket.user._id;
            await handleGameOver(io, matchId, winnerId, loserId, 'abandonment');
        });
        
        socket.on('disconnect', async () => {
            if (socket.user) userSockets.delete(socket.user._id.toString());
        });
    });
}

module.exports = { initializeSocketManager };