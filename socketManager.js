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

        // --- CORREÇÃO: Notificar todos os clientes (lobby, histórico) que precisam de atualizar os seus dados ---
        io.emit('lobby-update');

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

                // --- CORREÇÃO: Lógica de "Retomar Jogo" ---
                // REMOVEMOS a lógica proativa de 'rejoin-prompt' que causava o loop.
                // Agora, a única forma de retomar uma partida é clicando no botão "Retomar" na página de histórico,
                // que redireciona diretamente para `game.html?matchId=...`.
                // Isto segue o seu pedido para um fluxo mais simples e reativo.
                
            } catch (error) {
                socket.emit('auth-error', 'Token inválido ou expirado.');
                socket.disconnect();
            }
        });

        socket.on('create-lobby-game', async ({ betAmount, description, timeLimit }) => {
            if (!socket.user) return socket.emit('error-message', 'Não autenticado.');
            
            // Previne a criação de múltiplas apostas/jogos.
            const ongoingMatch = await Match.findOne({ players: socket.user._id, status: { $in: ['in_progress', 'waiting'] } });
            if (ongoingMatch) {
                return socket.emit('error-message', 'Você já tem uma aposta ou partida em andamento. Termine-a antes de criar outra.');
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

        // --- CORREÇÃO: Sincronização de "Join Game" ---
        socket.on('join-game', async ({ matchId }) => {
            if (!socket.user) return socket.emit('error-message', 'Não autenticado.');

            const ongoingMatchCheck = await Match.findOne({ players: socket.user._id, status: 'in_progress' });
            if (ongoingMatchCheck) {
                return socket.emit('error-message', 'Você já tem uma partida em andamento. Termine-a antes de entrar em outra.');
            }
            
            const match = await Match.findById(matchId);

            if (!match || match.status !== 'waiting') return socket.emit('error-message', 'Partida não disponível ou já iniciada.');
            
            const playerOneId = match.players[0].toString();
            if (socket.user._id.toString() === playerOneId) return socket.emit('error-message', 'Não pode entrar na sua própria partida.');
            
            // Verifica se o criador do jogo está online. Esta é a chave para a sincronização.
            const p1SocketId = userSockets.get(playerOneId);
            if (!p1SocketId || !io.sockets.sockets.get(p1SocketId)) {
                return socket.emit('error-message', 'O criador da partida não está online. Tente outra partida.');
            }

            const playerTwo = await User.findById(socket.user._id);
            if (playerTwo.balance < match.betAmount) return socket.emit('error-message', 'Saldo insuficiente.');

            const session = await User.startSession();
            session.startTransaction();
            try {
                playerTwo.balance -= match.betAmount;
                match.players.push(playerTwo._id);
                match.status = 'in_progress';
                
                await playerTwo.save({ session });
                await match.save({ session });
                await session.commitTransaction();

                const p2SocketId = socket.id;
                const room = `match-${match._id.toString()}`;

                // Adiciona ambos os jogadores à sala da partida
                io.sockets.sockets.get(p1SocketId)?.join(room);
                io.sockets.sockets.get(p2SocketId)?.join(room);
                
                // Emite para a sala, garantindo que AMBOS recebem o evento para redirecionar para `versus.html`.
                io.to(room).emit('match-found', { matchId: match._id.toString() });
                
                // Atualiza o lobby para todos os outros clientes.
                io.emit('lobby-update');
                
            } catch (error) {
                await session.abortTransaction();
                console.error("Join game transaction failed: ", error);
                socket.emit('error-message', 'Ocorreu um erro ao entrar na partida. Tente novamente.');
            } finally {
                session.endSession();
            }
        });

        socket.on('player-ready', async ({ matchId }) => {
            const room = `match-${matchId}`;
            const match = await Match.findById(matchId);
            if (!match) return;

            // Espera um tempo para a tela "Versus" ser exibida antes de redirecionar para o jogo.
            setTimeout(() => {
                io.to(room).emit('game-start');
            }, config.game.versusScreenDuration);
        });

        socket.on('get-game-state', async (matchId) => {
            if (!socket.user) return;
            
            // Garante que o usuário entra na sala da partida ao recarregar a página
            const room = `match-${matchId}`;
            socket.join(room);

            const match = await Match.findById(matchId).populate('players', 'username avatar stats bio');
            if (!match || !match.players.map(p => p._id.toString()).includes(socket.user._id.toString())) {
                return socket.emit('error-message', 'Partida não encontrada.');
            }

            // O `playerNumber` é necessário para a lógica do jogo de damas.
            const playerNumber = match.players[0]._id.equals(socket.user._id) ? 1 : 2;
            const board = gameLogic.stringToBoard(match.boardState);
            
            // Apenas calcula os movimentos para o jogador da vez para otimizar.
            const moves = match.currentPlayer.equals(socket.user._id) 
                ? gameLogic.getAllPossibleMoves(board, playerNumber)
                : [];
            
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
            
            if (!isValidMove) {
                 return socket.emit('error-message', 'Movimento inválido.');
            }

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
                io.to(`match-${matchId}`).emit('move-made', { newBoardState: newBoard, currentPlayerId: opponentId.toString(), possibleMoves: opponentMoves });
            }
        });

        // --- CORREÇÃO: Lógica de "Sair do Jogo" ---
        socket.on('leave-game', async ({ matchId }) => {
            if (!socket.user) return socket.emit('error-message', 'Não autenticado.');
            
            const match = await Match.findById(matchId);
            
            if (!match) {
                return socket.emit('error-message', 'Partida não encontrada.');
            }
            if (match.status !== 'in_progress') {
                // Previne que se abandone um jogo já terminado.
                return socket.emit('error-message', 'Só pode sair de partidas em andamento.');
            }
            if (!match.players.map(p => p.toString()).includes(socket.user._id.toString())) {
                return socket.emit('error-message', 'Você não é um jogador nesta partida.');
            }

            const winnerId = match.players.find(p => !p.equals(socket.user._id));
            const loserId = socket.user._id;
            
            // A função `handleGameOver` já notifica os clientes e atualiza o estado.
            await handleGameOver(io, matchId, winnerId, loserId, 'abandonment');
        });
        
        socket.on('disconnect', async () => {
            if (socket.user) {
                userSockets.delete(socket.user._id.toString());
            }
        });
    });
}

module.exports = { initializeSocketManager };