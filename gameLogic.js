const PIECES = {
    EMPTY: 0,
    P1_PAWN: 1,
    P2_PAWN: 2,
    P1_KING: 3,
    P2_KING: 4,
};

const isP1 = (p) => p === PIECES.P1_PAWN || p === PIECES.P1_KING;
const isP2 = (p) => p === PIECES.P2_PAWN || p === PIECES.P2_KING;
const isKing = (p) => p === PIECES.P1_KING || p === PIECES.P2_KING;
const isValid = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;
const isSamePlayer = (p1, p2) => (isP1(p1) === isP1(p2)) && p1 !== PIECES.EMPTY && p2 !== PIECES.EMPTY;

const createInitialBoard = () => {
    return [
        [0,2,0,2,0,2,0,2],[2,0,2,0,2,0,2,0],[0,2,0,2,0,2,0,2],
        [0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0],
        [1,0,1,0,1,0,1,0],[0,1,0,1,0,1,0,1],[1,0,1,0,1,0,1,0]
    ];
};

const getPieceMoves = (board, r, c) => {
    const type = board[r][c];
    if (type === PIECES.EMPTY) return { captures: [], simple: [] };

    let moves = { captures: [], simple: [] };
    const fwd = isP1(type) ? -1 : 1;
    const dirs = [[-1,-1], [-1,1], [1,-1], [1,1]];

    for (const [dr, dc] of dirs) {
        let path = [];
        let foundOpponent = null;
        for (let i = 1; i < 8; i++) {
            const cr = r + i * dr, cc = c + i * dc;
            if (!isValid(cr, cc)) break;
            
            const cellType = board[cr][cc];

            if (foundOpponent) {
                if (cellType === PIECES.EMPTY) {
                    moves.captures.push([[r,c], [cr,cc]]);
                } else break;
            } else {
                if (cellType === PIECES.EMPTY) {
                    path.push([[r,c], [cr,cc]]);
                } else {
                    if (!isSamePlayer(type, cellType)) {
                        const lr = cr + dr, lc = cc + dc;
                        if (isValid(lr, lc) && board[lr][lc] === PIECES.EMPTY) {
                            foundOpponent = {r: cr, c: cc};
                            i++; // Skip opponent's square on next iteration
                            moves.captures.push([[r,c], [lr,lc]]);
                        } else break;
                    } else break;
                }
            }
            if (!isKing(type) && !foundOpponent) break;
        }
        if (!foundOpponent) {
            if (isKing(type)) {
                moves.simple.push(...path);
            } else if (path.length > 0 && (path[0][1][0] - r) === fwd) {
                moves.simple.push(path[0]);
            }
        }
    }
    return moves;
};

const getValidMoves = (board, player) => {
    let allCaptures = [];
    let allSimpleMoves = [];
    let maxCaptureLength = 0;

    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            const type = board[r][c];
            if (type === PIECES.EMPTY || (player === 1 && !isP1(type)) || (player === 2 && !isP2(type))) continue;

            const findSequences = (currentBoard, startPos, currentPath) => {
                const moves = getPieceMoves(currentBoard, startPos[0], startPos[1]).captures;
                if (moves.length === 0) {
                    if(currentPath.length > 1) {
                         allCaptures.push(currentPath);
                         maxCaptureLength = Math.max(maxCaptureLength, currentPath.length - 1);
                    }
                    return;
                }
                moves.forEach(move => {
                    const newBoard = applyMove(currentBoard, move);
                    findSequences(newBoard, move[1], [...currentPath, move[1]]);
                });
            };
            
            findSequences(JSON.parse(JSON.stringify(board)), [r, c], [[r, c]]);
            
            if(allCaptures.length === 0){
                allSimpleMoves.push(...getPieceMoves(board, r, c).simple);
            }
        }
    }

    if (allCaptures.length > 0) {
        return allCaptures.filter(seq => (seq.length - 1) === maxCaptureLength);
    }
    return allSimpleMoves;
};

const applyMove = (board, moveSequence) => {
    const newBoard = JSON.parse(JSON.stringify(board));
    const startPos = moveSequence[0];
    const endPos = moveSequence[moveSequence.length - 1];
    let piece = newBoard[startPos[0]][startPos[1]];

    newBoard[startPos[0]][startPos[1]] = PIECES.EMPTY;

    for (let i = 0; i < moveSequence.length - 1; i++) {
        const from = moveSequence[i];
        const to = moveSequence[i + 1];
        if (Math.abs(from[0] - to[0]) > 1) {
            const dr = Math.sign(to[0] - from[0]);
            const dc = Math.sign(to[1] - from[1]);
            let cr = from[0], cc = from[1];
            while(cr !== to[0] || cc !== to[1]) {
                 if (newBoard[cr][cc] !== PIECES.EMPTY && !(cr === from[0] && cc === from[1])) {
                    newBoard[cr][cc] = PIECES.EMPTY;
                    break;
                }
                cr += dr; cc += dc;
            }
        }
    }

    if ((isP1(piece) && endPos[0] === 0) || (isP2(piece) && endPos[0] === 7)) {
        piece = isP1(piece) ? PIECES.P1_KING : PIECES.P2_KING;
    }
    
    newBoard[endPos[0]][endPos[1]] = piece;
    
    return newBoard;
};

const checkGameState = (board, nextPlayer) => {
    let p1Pieces = 0;
    let p2Pieces = 0;

    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            if (isP1(board[r][c])) p1Pieces++;
            if (isP2(board[r][c])) p2Pieces++;
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
    checkGameState
};