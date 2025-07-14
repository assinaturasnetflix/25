const PIECES = {
    EMPTY: 0,
    P1_PAWN: 1,
    P2_PAWN: 2,
    P1_KING: 3,
    P2_KING: 4,
};

const createInitialBoard = () => {
    const board = Array(8).fill(null).map(() => Array(8).fill(PIECES.EMPTY));
    for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 8; col++) {
            if ((row + col) % 2 !== 0) {
                board[row][col] = PIECES.P2_PAWN;
            }
        }
    }
    for (let row = 5; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
            if ((row + col) % 2 !== 0) {
                board[row][col] = PIECES.P1_PAWN;
            }
        }
    }
    return board;
};

const isPlayerPiece = (piece, player) => {
    if (player === 1) return piece === PIECES.P1_PAWN || piece === PIECES.P1_KING;
    if (player === 2) return piece === PIECES.P2_PAWN || piece === PIECES.P2_KING;
    return false;
};

const findCaptureSequences = (board, player) => {
    let allSequences = [];

    const findJumps = (currentBoard, r, c, currentPath) => {
        const piece = currentBoard[r][c];
        const isKing = piece === PIECES.P1_KING || piece === PIECES.P2_KING;
        let foundJump = false;

        const directions = isKing ? 
            [[-1, -1], [-1, 1], [1, -1], [1, 1]] :
            [[-1, -1], [-1, 1], [1, -1], [1, 1]];

        for (const [dr, dc] of directions) {
            let path = [];
            let lastR = r, lastC = c;

            if (isKing) {
                 for (let i = 1; i < 8; i++) {
                    const middleR = r + i * dr, middleC = c + i * dc;
                    const landR = r + (i + 1) * dr, landC = c + (i + 1) * dc;

                    if (landR < 0 || landR >= 8 || landC < 0 || landC >= 8) break;
                    
                    const middlePiece = currentBoard[middleR][middleC];
                    const landPiece = currentBoard[landR][landC];

                    if (middlePiece !== PIECES.EMPTY && !isPlayerPiece(middlePiece, player)) {
                        if (landPiece === PIECES.EMPTY) {
                            const newBoard = JSON.parse(JSON.stringify(currentBoard));
                            newBoard[landR][landC] = newBoard[r][c];
                            newBoard[r][c] = PIECES.EMPTY;
                            newBoard[middleR][middleC] = PIECES.EMPTY;
                            foundJump = true;
                            findJumps(newBoard, landR, landC, [...currentPath, [landR, landC]]);
                        }
                        break;
                    }
                     if (middlePiece !== PIECES.EMPTY) break;
                }
            } else {
                const middleR = r + dr, middleC = c + dc;
                const landR = r + 2 * dr, landC = c + 2 * dc;
                
                if (landR >= 0 && landR < 8 && landC >= 0 && landC < 8) {
                    const middlePiece = currentBoard[middleR][middleC];
                    const landPiece = currentBoard[landR][landC];

                    if (landPiece === PIECES.EMPTY && middlePiece !== PIECES.EMPTY && !isPlayerPiece(middlePiece, player)) {
                        const newBoard = JSON.parse(JSON.stringify(currentBoard));
                        newBoard[landR][landC] = newBoard[r][c];
                        newBoard[r][c] = PIECES.EMPTY;
                        newBoard[middleR][middleC] = PIECES.EMPTY;
                        foundJump = true;
                        findJumps(newBoard, landR, landC, [...currentPath, [landR, landC]]);
                    }
                }
            }
        }
        
        if (!foundJump && currentPath.length > 1) {
            allSequences.push(currentPath);
        }
    };

    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            if (isPlayerPiece(board[r][c], player)) {
                findJumps(board, r, c, [[r, c]]);
            }
        }
    }
    
    if (allSequences.length === 0) return [];
    
    let maxLength = 0;
    for (const seq of allSequences) {
        if (seq.length > maxLength) {
            maxLength = seq.length;
        }
    }
    
    return allSequences.filter(seq => seq.length === maxLength);
};


const findSimpleMoves = (board, player) => {
    const moves = [];
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            if (!isPlayerPiece(board[r][c], player)) continue;

            const piece = board[r][c];
            const isKing = piece === PIECES.P1_KING || piece === PIECES.P2_KING;
            const pawnDir = (player === 1) ? -1 : 1;
            const directions = isKing ? [[-1, -1], [-1, 1], [1, -1], [1, 1]] : [[pawnDir, -1], [pawnDir, 1]];

            for (const [dr, dc] of directions) {
                if(isKing){
                    for(let i=1; i < 8; i++){
                        const newR = r + i * dr, newC = c + i * dc;
                        if (newR >= 0 && newR < 8 && newC >= 0 && newC < 8 && board[newR][newC] === PIECES.EMPTY) {
                            moves.push([[r, c], [newR, newC]]);
                        } else {
                            break;
                        }
                    }
                } else {
                    const newR = r + dr, newC = c + dc;
                    if (newR >= 0 && newR < 8 && newC >= 0 && newC < 8 && board[newR][newC] === PIECES.EMPTY) {
                        moves.push([[r, c], [newR, newC]]);
                    }
                }
            }
        }
    }
    return moves;
};

const getValidMoves = (board, player) => {
    const captures = findCaptureSequences(board, player);
    if (captures.length > 0) {
        return captures;
    }
    return findSimpleMoves(board, player);
};

const applyMove = (board, moveSequence) => {
    const newBoard = JSON.parse(JSON.stringify(board));
    const startPos = moveSequence[0];
    const endPos = moveSequence[moveSequence.length - 1];
    const piece = newBoard[startPos[0]][startPos[1]];

    newBoard[startPos[0]][startPos[1]] = PIECES.EMPTY;

    if (moveSequence.length > 2) { 
        for (let i = 0; i < moveSequence.length - 1; i++) {
            const current = moveSequence[i];
            const next = moveSequence[i+1];
            const dr = Math.sign(next[0] - current[0]);
            const dc = Math.sign(next[1] - current[1]);
            
            let r = current[0] + dr;
            let c = current[1] + dc;

            while (r !== next[0] || c !== next[1]) {
                if(newBoard[r][c] !== PIECES.EMPTY){
                    newBoard[r][c] = PIECES.EMPTY;
                    break;
                }
                r += dr;
                c += dc;
            }
        }
    }

    newBoard[endPos[0]][endPos[1]] = piece;

    const player = (piece === PIECES.P1_PAWN || piece === PIECES.P1_KING) ? 1 : 2;
    if ((player === 1 && endPos[0] === 0 && piece === PIECES.P1_PAWN)) {
        newBoard[endPos[0]][endPos[1]] = PIECES.P1_KING;
    }
    if ((player === 2 && endPos[0] === 7 && piece === PIECES.P2_PAWN)) {
        newBoard[endPos[0]][endPos[1]] = PIECES.P2_KING;
    }
    
    return newBoard;
};

const checkGameState = (board, nextPlayer) => {
    let p1Pieces = 0;
    let p2Pieces = 0;

    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            if (isPlayerPiece(board[r][c], 1)) p1Pieces++;
            if (isPlayerPiece(board[r][c], 2)) p2Pieces++;
        }
    }

    if (p1Pieces === 0) return { isGameOver: true, winner: 2 };
    if (p2Pieces === 0) return { isGameOver: true, winner: 1 };
    
    const nextPlayerMoves = getValidMoves(board, nextPlayer);
    if (nextPlayerMoves.length === 0) {
        return { isGameOver: true, winner: nextPlayer === 1 ? 2 : 1 };
    }

    return { isGameOver: false, winner: null };
};

module.exports = {
    PIECES,
    createInitialBoard,
    getValidMoves,
    applyMove,
    checkGameState,
    isPlayerPiece
};