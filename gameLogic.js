const initialBoard = [
    [0, 1, 0, 1, 0, 1, 0, 1],
    [1, 0, 1, 0, 1, 0, 1, 0],
    [0, 1, 0, 1, 0, 1, 0, 1],
    [0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0],
    [2, 0, 2, 0, 2, 0, 2, 0],
    [0, 2, 0, 2, 0, 2, 0, 2],
    [2, 0, 2, 0, 2, 0, 2, 0]
];

const PLAYER_1_PIECE = 1;
const PLAYER_1_KING = 3;
const PLAYER_2_PIECE = 2;
const PLAYER_2_KING = 4;

const initializeBoard = () => JSON.stringify(initialBoard);

const getPlayerPieces = (playerIndex) => {
    return playerIndex === 0 ? [PLAYER_1_PIECE, PLAYER_1_KING] : [PLAYER_2_PIECE, PLAYER_2_KING];
};

const isKing = (piece) => piece === PLAYER_1_KING || piece === PLAYER_2_KING;

const findPossibleCaptures = (board, playerIndex) => {
    const playerPieces = getPlayerPieces(playerIndex);
    const opponentPieces = getPlayerPieces(1 - playerIndex);
    let allCapturePaths = [];

    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            if (playerPieces.includes(board[r][c])) {
                const piece = board[r][c];
                const paths = findCapturePathsForPiece(board, r, c, piece, opponentPieces, []);
                if (paths.length > 0) {
                    allCapturePaths.push(...paths);
                }
            }
        }
    }
    return allCapturePaths;
};

const findCapturePathsForPiece = (board, r, c, piece, opponentPieces, path) => {
    let longestPaths = [];
    const directions = isKing(piece) ? [
        [-1, -1],
        [-1, 1],
        [1, -1],
        [1, 1]
    ] : (getPlayerPieces(0).includes(piece) ? [
        [1, -1],
        [1, 1]
    ] : [
        [-1, -1],
        [-1, 1]
    ]);

    let foundCapture = false;

    for (const [dr, dc] of directions) {
        if (isKing(piece)) {
            for (let i = 1; i < 8; i++) {
                const jumpOverR = r + i * dr;
                const jumpOverC = c + i * dc;
                const landR = r + (i + 1) * dr;
                const landC = c + (i + 1) * dc;

                if (landR < 0 || landR >= 8 || landC < 0 || landC >= 8) break;
                if (!opponentPieces.includes(board[jumpOverR]?.[jumpOverC])) continue;

                let isEmptyAfter = true;
                for (let j = 1; j < i; j++) {
                    if (board[r + j * dr][c + j * dc] !== 0) {
                        isEmptyAfter = false;
                        break;
                    }
                }
                if (!isEmptyAfter) continue;
                
                if (board[landR][landC] === 0) {
                    const newBoard = JSON.parse(JSON.stringify(board));
                    newBoard[landR][landC] = piece;
                    newBoard[r][c] = 0;
                    newBoard[jumpOverR][jumpOverC] = 0;

                    const newPath = [...path, { from: [r, c], to: [landR, landC], captured: [jumpOverR, jumpOverC] }];
                    const nextPaths = findCapturePathsForPiece(newBoard, landR, landC, piece, opponentPieces, newPath);
                    
                    if (nextPaths.length > 0) {
                        longestPaths.push(...nextPaths);
                    } else {
                        longestPaths.push(newPath);
                    }
                    foundCapture = true;
                }
            }
        } else {
            const jumpOverR = r + dr;
            const jumpOverC = c + dc;
            const landR = r + 2 * dr;
            const landC = c + 2 * dc;

            if (landR >= 0 && landR < 8 && landC >= 0 && landC < 8 &&
                opponentPieces.includes(board[jumpOverR]?.[jumpOverC]) && board[landR][landC] === 0) {
                
                const newBoard = JSON.parse(JSON.stringify(board));
                newBoard[landR][landC] = piece;
                newBoard[r][c] = 0;
                newBoard[jumpOverR][jumpOverC] = 0;

                const newPath = [...path, { from: [r, c], to: [landR, landC], captured: [jumpOverR, jumpOverC] }];
                const nextPaths = findCapturePathsForPiece(newBoard, landR, landC, piece, opponentPieces, newPath);

                if (nextPaths.length > 0) {
                    longestPaths.push(...nextPaths);
                } else {
                    longestPaths.push(newPath);
                }
                foundCapture = true;
            }
        }
    }
    
    if (!foundCapture && path.length > 0) {
        return [path];
    }

    return longestPaths;
};

const findPossibleSimpleMoves = (board, playerIndex) => {
    const playerPieces = getPlayerPieces(playerIndex);
    const moves = [];
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            if (playerPieces.includes(board[r][c])) {
                const piece = board[r][c];
                const directions = isKing(piece) ? [
                    [-1, -1],
                    [-1, 1],
                    [1, -1],
                    [1, 1]
                ] : (playerIndex === 0 ? [
                    [1, -1],
                    [1, 1]
                ] : [
                    [-1, -1],
                    [-1, 1]
                ]);

                for (const [dr, dc] of directions) {
                    if (isKing(piece)) {
                        for(let i = 1; i < 8; i++) {
                            const newR = r + i * dr;
                            const newC = c + i * dc;
                            if (newR >= 0 && newR < 8 && newC >= 0 && newC < 8 && board[newR][newC] === 0) {
                                moves.push({ from: [r, c], to: [newR, newC] });
                            } else {
                                break;
                            }
                        }
                    } else {
                        const newR = r + dr;
                        const newC = c + dc;
                        if (newR >= 0 && newR < 8 && newC >= 0 && newC < 8 && board[newR][newC] === 0) {
                            moves.push({ from: [r, c], to: [newR, newC] });
                        }
                    }
                }
            }
        }
    }
    return moves;
};

const validateMove = (board, playerIndex, move) => {
    const { from, to } = move;
    const piece = board[from[0]][from[1]];
    const playerPieces = getPlayerPieces(playerIndex);

    if (!playerPieces.includes(piece)) return { valid: false, reason: "Não é a sua peça." };
    if (board[to[0]][to[1]] !== 0) return { valid: false, reason: "A casa de destino não está vazia." };

    const allCaptures = findPossibleCaptures(board, playerIndex);

    if (allCaptures.length > 0) {
        const maxCaptureLength = Math.max(...allCaptures.map(path => path.length));
        const bestCaptures = allCaptures.filter(path => path.length === maxCaptureLength);
        
        const isMoveInBestCaptures = bestCaptures.some(path => {
            const firstStep = path[0];
            return firstStep.from[0] === from[0] && firstStep.from[1] === from[1] && firstStep.to[0] === to[0] && firstStep.to[1] === to[1];
        });

        if (!isMoveInBestCaptures) {
            return { valid: false, reason: "Captura obrigatória. Deve realizar a captura que remove o maior número de peças." };
        }
        
        const pathTaken = bestCaptures.find(path => {
            const firstStep = path[0];
            return firstStep.from[0] === from[0] && firstStep.from[1] === from[1] && firstStep.to[0] === to[0] && firstStep.to[1] === to[1];
        });

        return { valid: true, moveType: 'capture', path: pathTaken };
    }

    const simpleMoves = findPossibleSimpleMoves(board, playerIndex);
    const isSimpleMoveValid = simpleMoves.some(m => m.from[0] === from[0] && m.from[1] === from[1] && m.to[0] === to[0] && m.to[1] === to[1]);
    if (!isSimpleMoveValid) return { valid: false, reason: "Movimento inválido." };

    return { valid: true, moveType: 'simple' };
};

const applyMove = (board, move, validationResult) => {
    const newBoard = JSON.parse(JSON.stringify(board));
    
    if (validationResult.moveType === 'capture') {
        let lastPos = null;
        validationResult.path.forEach(step => {
            const piece = newBoard[step.from[0]][step.from[1]];
            newBoard[step.to[0]][step.to[1]] = piece;
            newBoard[step.from[0]][step.from[1]] = 0;
            newBoard[step.captured[0]][step.captured[1]] = 0;
            lastPos = step.to;
        });
         promotePawns(newBoard, lastPos);
    } else {
        const { from, to } = move;
        const piece = newBoard[from[0]][from[1]];
        newBoard[to[0]][to[1]] = piece;
        newBoard[from[0]][from[1]] = 0;
        promotePawns(newBoard, to);
    }
    
    return newBoard;
};

const promotePawns = (board, lastMoveTo) => {
    const [r, c] = lastMoveTo;
    const piece = board[r][c];
    if (piece === PLAYER_1_PIECE && r === 7) {
        board[r][c] = PLAYER_1_KING;
    }
    if (piece === PLAYER_2_PIECE && r === 0) {
        board[r][c] = PLAYER_2_KING;
    }
};

const checkWinCondition = (board, playerIndexToMove) => {
    const opponentIndex = 1 - playerIndexToMove;
    const playerPieces = getPlayerPieces(playerIndexToMove);
    const opponentPieces = getPlayerPieces(opponentIndex);

    let playerPieceCount = 0;
    let opponentPieceCount = 0;
    
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            if (playerPieces.includes(board[r][c])) playerPieceCount++;
            if (opponentPieces.includes(board[r][c])) opponentPieceCount++;
        }
    }

    if (opponentPieceCount === 0) {
        return { gameOver: true, winnerIndex: playerIndexToMove };
    }
    if (playerPieceCount === 0) {
        return { gameOver: true, winnerIndex: opponentIndex };
    }

    const possibleCaptures = findPossibleCaptures(board, playerIndexToMove);
    const possibleSimpleMoves = findPossibleSimpleMoves(board, playerIndexToMove);

    if (possibleCaptures.length === 0 && possibleSimpleMoves.length === 0) {
        return { gameOver: true, winnerIndex: opponentIndex };
    }

    return { gameOver: false, winnerIndex: null };
};


module.exports = {
    initializeBoard,
    validateMove,
    applyMove,
    checkWinCondition,
    findPossibleCaptures
};