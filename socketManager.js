const { Game, User, Setting, Transaction } = require('./models');
const { createInitialBoard, getPossibleMovesForPlayer, applyMoveToBoard, checkWinCondition } = require('./gameLogic');
const mongoose = require('mongoose');
const crypto = require('crypto');

let activeUsers = {}; // userId -> socket.id
let activeLobbies = {}; // gameId -> { data: { ... }, createdAt, createdBy }

// Helper para obter as configurações em tempo real
const getLiveSettings = async () => {
    let settings = await Setting.findOne({ singleton: 'main_settings' });
    if (!settings) {
        settings = await Setting.create({ singleton: 'main_settings' });
    }
    return settings;
};

// Lógica de manipulação do fim do jogo (Refatorada e Aprimorada)
const handleGameOver = async (io, game, winnerId, loserId, surrendered = false) => {
    try {
        // Previne que um jogo já finalizado seja processado novamente
        if (game.status === 'completed' || game.status === 'cancelled') return;

        const winner = await User.findById(winnerId);
        const loser = await User.findById(loserId);
        const settings = await getLiveSettings();

        // Atualiza estatísticas de vitória/derrota
        if (winner) winner.stats.wins += 1;
        if (loser) loser.stats.losses += 1;

        // Processa o prêmio da aposta
        if (game.betAmount > 0) {
            const totalPrize = game.betAmount * 2;
            const platformCommission = totalPrize * settings.platformCommission;
            const winnerGets = totalPrize - platformCommission;
            
            if (winner) {
                if (game.bettingMode === 'real') {
                    winner.balance += winnerGets;
                } else {
                    winner.bonusBalance += winnerGets;
                }
            }
            game.commissionAmount = platformCommission;
        }
        
        game.status = 'completed';
        game.winner = winnerId;
        
        // Salva todas as alterações no banco de dados
        await game.save();
        if (winner) await winner.save();
        if (loser) await loser.save();

        // Remove o jogo do lobby ativo
        if (activeLobbies[game.id]) {
            delete activeLobbies[game.id];
            io.emit('lobby_update', Object.values(activeLobbies).map(l => l.data));
        }

        // Emite o evento de fim de jogo para os clientes
        io.to(game.id).emit('game_over', {
            winner: winner ? winner.toObject() : null,
            loser: loser ? loser.toObject() : null,
            surrendered: surrendered,
            prize: game.betAmount > 0 ? (game.betAmount * 2) - game.commissionAmount : 0,
            moves: game.moveHistory.length,
            piecesCaptured: game.moveHistory.reduce((acc, move) => acc + (move.captured ? move.captured.length : 0), 0)
        });

        // Força todos os sockets a saírem da sala do jogo
        io.socketsLeave(game.id);
    } catch (error) {
        console.error('Erro em handleGameOver:', error);
        io.to(game.id).emit('error_message', { message: 'Erro interno ao finalizar o jogo.' });
    }
};


const socketManager = (io) => {
    io.on('connection', (socket) => {
        const userId = socket.handshake.query.userId;
        if (userId) {
            activeUsers[userId] = socket.id;
            socket.join(userId);
            console.log(`Usuário ${userId} conectado.`);
        }

        // --- NOVOS EVENTOS DE SOCKET ADICIONADOS ---

        socket.on('set_betting_mode', async ({ mode }) => {
            const currentUserId = Object.keys(activeUsers).find(key => activeUsers[key] === socket.id);
            if (!currentUserId || !['real', 'bonus'].includes(mode)) return;
            try {
                await User.findByIdAndUpdate(currentUserId, { activeBettingMode: mode });
                socket.emit('mode_changed_success', { newMode: mode });
            } catch (error) {
                socket.emit('error_message', { message: 'Erro ao alterar a carteira.' });
            }
        });

        socket.on('cancel_game', async ({ gameId }) => {
            const currentUserId = Object.keys(activeUsers).find(key => activeUsers[key] === socket.id);
            if (!currentUserId) return;
            try {
                const game = await Game.findById(gameId);
                if (game && game.status === 'pending' && game.player1.equals(currentUserId)) {
                    const user = await User.findById(currentUserId);
                    if (user) {
                        if (game.bettingMode === 'real') user.balance += game.betAmount;
                        else user.bonusBalance += game.betAmount;
                        await user.save();
                    }
                    game.status = 'cancelled';
                    await game.save();
                    delete activeLobbies[gameId];
                    io.emit('lobby_update', Object.values(activeLobbies).map(l => l.data));
                    socket.emit('game_cancelled', { message: 'Sua partida foi cancelada.' });
                }
            } catch (error) {
                socket.emit('error_message', { message: 'Erro ao cancelar a partida.' });
            }
        });

        // --- EVENTOS EXISTENTES (COM MELHORIAS) ---

        socket.on('get_lobby', async () => {
            const gamesInDb = await Game.find({ status: 'pending' }).sort({ createdAt: -1 }).populate('creator', 'username avatar');
            activeLobbies = {};
            gamesInDb.forEach(game => {
                activeLobbies[game._id.toString()] = { data: game, createdAt: game.createdAt };
            });
            io.to(socket.id).emit('lobby_update', Object.values(activeLobbies).map(l => l.data));
        });

        socket.on('create_game', async ({ betAmount, description, isPrivate }) => {
            const player1Id = Object.keys(activeUsers).find(key => activeUsers[key] === socket.id);
            if (!player1Id) return socket.emit('error_message', { message: 'Usuário não autenticado.' });

            try {
                const user = await User.findById(player1Id);
                const settings = await getLiveSettings();

                if (betAmount < settings.minBet || betAmount > settings.maxBet) {
                    return socket.emit('error_message', { message: `A aposta deve ser entre ${settings.minBet} e ${settings.maxBet} MT.` });
                }

                // Usa a carteira ativa do usuário como fonte da verdade
                const bettingMode = user.activeBettingMode;
                const balanceToCheck = bettingMode === 'real' ? user.balance : user.bonusBalance;
                
                if (balanceToCheck < betAmount) {
                    return socket.emit('error_message', { message: `Saldo ${bettingMode} insuficiente.` });
                }

                if (bettingMode === 'real') user.balance -= betAmount;
                else user.bonusBalance -= betAmount;
                await user.save();

                const gameCode = isPrivate ? crypto.randomBytes(3).toString('hex').toUpperCase() : undefined;

                const game = new Game({
                    players: [player1Id],
                    player1: player1Id,
                    boardState: createInitialBoard(),
                    status: 'pending',
                    betAmount,
                    bettingMode,
                    isPrivate,
                    gameCode,
                    lobbyDescription: description || ''
                });
                await game.save();

                activeLobbies[game._id.toString()] = { data: game.toObject(), createdAt: new Date(), createdBy: player1Id };
                io.emit('lobby_update', Object.values(activeLobbies).map(l => l.data));
                
                if (isPrivate) {
                    socket.emit('private_game_created_show_code', { privateCode: game.gameCode });
                }

            } catch (error) {
                socket.emit('error_message', { message: 'Erro ao criar jogo.' });
            }
        });

        socket.on('join_game', async ({ gameCodeOrId }) => {
            const player2Id = Object.keys(activeUsers).find(key => activeUsers[key] === socket.id);
            if (!player2Id) return socket.emit('error_message', { message: 'Oponente inválido.' });
            
            try {
                // Procura por código (privado) ou por ID (público)
                const game = await Game.findOne({
                    $or: [{ _id: mongoose.Types.ObjectId.isValid(gameCodeOrId) ? gameCodeOrId : null }, { gameCode: gameCodeOrId.toUpperCase() }],
                    status: 'pending'
                });

                if (!game) return socket.emit('error_message', { message: 'Jogo não encontrado ou já iniciado.' });
                if (game.player1.equals(player2Id)) return socket.emit('error_message', { message: 'Não pode entrar no seu próprio jogo.' });

                const user2 = await User.findById(player2Id);
                const balanceToCheck = game.bettingMode === 'real' ? user2.balance : user2.bonusBalance;

                if (balanceToCheck < game.betAmount) return socket.emit('error_message', { message: `Saldo ${game.bettingMode} insuficiente.` });
                
                if (game.bettingMode === 'real') user2.balance -= game.betAmount;
                else user2.bonusBalance -= game.betAmount;
                await user2.save();

                game.player2 = player2Id;
                game.players.push(player2Id);
                game.status = 'in_progress';
                game.turn = game.player1;
                await game.save();

                delete activeLobbies[game.id];
                io.emit('lobby_update', Object.values(activeLobbies).map(l => l.data));

                const player1SocketId = activeUsers[game.player1.toString()];
                if (player1SocketId) io.sockets.sockets.get(player1SocketId)?.join(game.id);
                socket.join(game.id);

                const fullGameData = await Game.findById(game._id).populate('players', 'username avatar');
                io.to(game.id).emit('game_session_ready', fullGameData);

            } catch (error) {
                socket.emit('error_message', { message: 'Erro interno ao entrar no jogo.' });
            }
        });

        socket.on('makeMove', async ({ gameId, move }) => {
            // ... (A lógica de makeMove continua a mesma, mas agora chama handleGameOver)
            // ...
            const winState = checkWinCondition(game.boardState, playerColor);
            if (winState.winner) {
                await handleGameOver(io, game, playerId, opponent._id);
            } else {
                await game.save();
                io.to(game.id).emit('move_made', { boardState: game.boardState, currentPlayer: game.turn, move });
            }
        });

        socket.on('surrender', async ({ gameId }) => {
            const userId = Object.keys(activeUsers).find(key => activeUsers[key] === socket.id);
            if (!userId) return;
            try {
                const game = await Game.findById(gameId);
                if (!game || !game.players.includes(userId)) return;

                // Se o jogo está em andamento, o outro jogador ganha
                if (game.status === 'in_progress') {
                    const winnerId = game.players.find(p => !p.equals(userId));
                    await handleGameOver(io, game, winnerId, userId, true);
                }
            } catch (error) {
                socket.emit('error_message', { message: 'Erro ao render-se.' });
            }
        });

        socket.on('disconnect', async () => {
            const userIdDisconnected = Object.keys(activeUsers).find(key => activeUsers[key] === socket.id);
            if (userIdDisconnected) {
                console.log(`Usuário ${userIdDisconnected} desconectado.`);
                delete activeUsers[userIdDisconnected];

                // Lógica de abandono para jogos em andamento
                try {
                    const gameInProgress = await Game.findOne({
                        status: 'in_progress',
                        players: userIdDisconnected
                    });

                    if (gameInProgress) {
                        const winnerId = gameInProgress.players.find(p => !p.equals(userIdDisconnected));
                        console.log(`Jogo ${gameInProgress._id} abandonado. Vencedor: ${winnerId}`);
                        await handleGameOver(io, gameInProgress, winnerId, userIdDisconnected, true);
                    }
                } catch(error) {
                    console.error("Erro no handler de disconnect: ", error);
                }
            }
        });
    });
};

module.exports = socketManager;