const B = 'b'; 
const W = 'w'; 
const BK = 'bk'; 
const WK = 'wk';
const E = null;

const createInitialBoard = () => {
    return [
        [E, B, E, B, E, B, E, B],
        [B, E, B, E, B, E, B, E],
        [E, B, E, B, E, B, E, B],
        [E, E, E, E, E, E, E, E],
        [E, E, E, E, E, E, E, E],
        [W, E, W, E, W, E, W, E],
        [E, W, E, W, E, W, E, W],
        [W, E, W, E, W, E, W, E]
    ];
};

const isOpponent = (piece, opponentPiece) => {
    return piece.toLowerCase().charAt(0) !== opponentPiece.toLowerCase().charAt(0);
};

const findCaptureMoves = (board, r, c) => {
    const piece = board[r][c];
    if (!piece) return [];
    const player = piece.startsWith(W) ? W : B;
    const moves = [];
    const directions = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

    if (piece === B || piece === W) {
        for (const [dr, dc] of directions) {
            const nr = r + dr;
            const nc = c + dc;
            const nnr = r + dr * 2;
            const nnc = c + dc * 2;

            if (nnr >= 0 && nnr < 8 && nnc >= 0 && nnc < 8 && board[nnr][nnc] === E) {
                const jumpedPiece = board[nr][nc];
                if (jumpedPiece && isOpponent(player, jumpedPiece)) {
                    moves.push({ from: [r, c], to: [nnr, nnc], captured: [[nr, nc]] });
                }
            }
        }
    } else { // King logic
        for (const [dr, dc] of directions) {
            let path = [];
            for (let i = 1; i < 8; i++) {
                const cr = r + dr * i;
                const cc = c + dc * i;
                if (!(cr >= 0 && cr < 8 && cc >= 0 && cc < 8)) break;

                const currentCell = board[cr][cc];
                if (currentCell) {
                    if (isOpponent(player, currentCell)) {
                        const nextR = cr + dr;
                        const nextC = cc + dc;
                        if (nextR >= 0 && nextR < 8 && nextC >= 0 && nextC < 8 && board[nextR][nextC] === E) {
                            for (let j = 1; j < 8; j++) {
                                const landR = nextR + dr * (j-1);
                                const landC = nextC + dc * (j-1);
                                if (!(landR >= 0 && landR < 8 && landC >= 0 && landC < 8)) break;
                                if (board[landR][landC] !== E) break;
                                moves.push({ from: [r, c], to: [landR, landC], captured: [[cr, cc]] });
                            }
                        }
                    }
                    break;
                }
            }
        }
    }
    return moves;
};

const findSimpleMoves = (board, r, c) => {
    const piece = board[r][c];
    if (!piece) return [];
    const moves = [];
    const forward = piece.startsWith(W) ? -1 : 1;
    const directions = piece.startsWith(W) || piece.startsWith(B) ? [[forward, -1], [forward, 1]] : [[-1, -1], [-1, 1], [1, -1], [1, 1]];
    
    if(piece === W || piece === B) {
        for (const [dr, dc] of directions) {
            const nr = r + dr;
            const nc = c + dc;
            if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8 && board[nr][nc] === E) {
                moves.push({ from: [r, c], to: [nr, nc], captured: [] });
            }
        }
    } else { // King
        for (const [dr, dc] of directions) {
            for (let i = 1; i < 8; i++) {
                const nr = r + dr * i;
                const nc = c + dc * i;
                if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
                    if (board[nr][nc] === E) {
                        moves.push({ from: [r, c], to: [nr, nc], captured: [] });
                    } else {
                        break;
                    }
                } else {
                    break;
                }
            }
        }
    }
    return moves;
};

const getPossibleMovesForPlayer = (board, player) => {
    let allCaptures = [];
    let allSimpleMoves = [];
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            const piece = board[r][c];
            if (piece && piece.startsWith(player)) {
                allCaptures.push(...findCaptureMoves(board, r, c));
                allSimpleMoves.push(...findSimpleMoves(board, r, c));
            }
        }
    }

    if (allCaptures.length > 0) {
        const tempBoard = JSON.parse(JSON.stringify(board));
        return findLongestCapturePath(tempBoard, player);
    }
    return allSimpleMoves;
};

const findLongestCapturePath = (board, player) => {
    let longestPath = [];
    let maxCaptures = 0;

    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            if (board[r][c] && board[r][c].startsWith(player)) {
                let paths = findPathsFrom(JSON.parse(JSON.stringify(board)), r, c);
                for(const path of paths) {
                    if (path.captured.length > maxCaptures) {
                        maxCaptures = path.captured.length;
                        longestPath = [path];
                    } else if (path.captured.length === maxCaptures && maxCaptures > 0) {
                        longestPath.push(path);
                    }
                }
            }
        }
    }
    
    return longestPath;
};

const findPathsFrom = (board, r, c) => {
    let initialMoves = findCaptureMoves(board, r, c);
    let allPaths = [];

    for (const move of initialMoves) {
        let newBoard = applyMoveToBoard(JSON.parse(JSON.stringify(board)), move);
        let newPaths = findPathsFrom(newBoard, move.to[0], move.to[1]);
        
        if (newPaths.length === 0) {
            allPaths.push(move);
        } else {
            for (const path of newPaths) {
                allPaths.push({
                    from: move.from,
                    to: path.to,
                    captured: move.captured.concat(path.captured)
                });
            }
        }
    }
    return allPaths;
};


const applyMoveToBoard = (board, move) => {
    const newBoard = JSON.parse(JSON.stringify(board));
    const [startR, startC] = move.from;
    const [endR, endC] = move.to;
    const piece = newBoard[startR][startC];

    newBoard[endR][endC] = piece;
    newBoard[startR][startC] = E;

    for (const [capR, capC] of move.captured) {
        newBoard[capR][capC] = E;
    }

    if ((piece === W && endR === 0) || (piece === B && endR === 7)) {
        newBoard[endR][endC] = piece.toUpperCase() + 'k';
    }
    
    return newBoard;
};

const checkWinCondition = (board, currentPlayer) => {
    let opponent = currentPlayer === W ? B : W;
    let myPieces = 0;
    let opponentPieces = 0;

    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            if (board[r][c]) {
                if (board[r][c].startsWith(currentPlayer)) myPieces++;
                if (board[r][c].startsWith(opponent)) opponentPieces++;
            }
        }
    }

    if (opponentPieces === 0) return { winner: currentPlayer };
    
    const opponentMoves = getPossibleMovesForPlayer(board, opponent);
    if (opponentMoves.length === 0) return { winner: currentPlayer };
    
    return { winner: null };
};

module.exports = {
    createInitialBoard,
    getPossibleMovesForPlayer,
    applyMoveToBoard,
    checkWinCondition,
    pieceTypes: { B, W, BK, WK, E }
};