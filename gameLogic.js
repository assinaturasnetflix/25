const EMPTY = 0;
const P1_PAWN = 1;
const P2_PAWN = 2;
const P1_KING = 3;
const P2_KING = 4;

const isPlayerPiece = (piece, player) => {
    return (player === 1 && (piece === P1_PAWN || piece === P1_KING)) ||
           (player === 2 && (piece === P2_PAWN || piece === P2_KING));
};

const isOpponentPiece = (piece, player) => {
    return (player === 1 && (piece === P2_PAWN || piece === P2_KING)) ||
           (player === 2 && (piece === P1_PAWN || piece === P1_KING));
};

const isKing = (piece) => piece === P1_KING || piece === P2_KING;

const createInitialBoard = () => {
    return [
        [0, 2, 0, 2, 0, 2, 0, 2],
        [2, 0, 2, 0, 2, 0, 2, 0],
        [0, 2, 0, 2, 0, 2, 0, 2],
        [0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0],
        [1, 0, 1, 0, 1, 0, 1, 0],
        [0, 1, 0, 1, 0, 1, 0, 1],
        [1, 0, 1, 0, 1, 0, 1, 0]
    ];
};

const findCaptureMovesForPiece = (board, r, c, player, piece, currentPath = []) => {
    const directions = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
    let paths = [];

    const explore = (row, col, path) => {
        let longestSubPathFound = false;
        for (const [dr, dc] of directions) {
            const opponentR = row + dr;
            const opponentC = col + dc;
            const landR = row + 2 * dr;
            const landC = col + 2 * dc;

            if (landR >= 0 && landR < 8 && landC >= 0 && landC < 8 &&
                board[landR][landC] === EMPTY &&
                isOpponentPiece(board[opponentR][opponentC], player) &&
                !path.find(p => p.captured.r === opponentR && p.captured.c === opponentC)) {

                const newBoard = JSON.parse(JSON.stringify(board));
                newBoard[row][col] = EMPTY;
                newBoard[opponentR][opponentC] = EMPTY;
                newBoard[landR][landC] = piece;

                const newPath = [...path, { from: {r: row, c: col}, to: {r: landR, c: landC}, captured: {r: opponentR, c: opponentC} }];
                
                longestSubPathFound = true;
                explore(landR, landC, newPath);
            }
        }
        if (!longestSubPathFound && path.length > 0) {
            paths.push(path);
        }
    };
    
    if (isKing(piece)) {
        let kingPaths = [];
        const exploreKing = (row, col, kBoard, path) => {
            let pathExtended = false;
            for (const [dr, dc] of directions) {
                for (let i = 1; i < 8; i++) {
                    const opponentR = row + i * dr;
                    const opponentC = col + i * dc;
                    const landR = opponentR + dr;
                    const landC = opponentC + dc;

                    if (opponentR >= 0 && opponentR < 8 && opponentC >= 0 && opponentC < 8 && landR >= 0 && landR < 8 && landC >= 0 && landC < 8) {
                        if (isOpponentPiece(kBoard[opponentR][opponentC], player) && kBoard[landR][landC] === EMPTY) {
                            if (!path.find(p => p.captured.r === opponentR && p.captured.c === opponentC)) {
                                const newBoard = JSON.parse(JSON.stringify(kBoard));
                                newBoard[row][col] = EMPTY;
                                newBoard[opponentR][opponentC] = EMPTY;
                                
                                for (let j = 1; landR + (j-1)*dr < 8 && landR + (j-1)*dr >= 0 && landC + (j-1)*dc < 8 && landC + (j-1)*dc >= 0; j++) {
                                    const finalLandR = landR + (j-1)*dr;
                                    const finalLandC = landC + (j-1)*dc;
                                    if(kBoard[finalLandR][finalLandC] !== EMPTY) break;
                                    
                                    const landingBoard = JSON.parse(JSON.stringify(newBoard));
                                    landingBoard[finalLandR][finalLandC] = piece;
                                    
                                    const newPath = [...path, { from: {r: row, c: col}, to: {r: finalLandR, c: finalLandC}, captured: {r: opponentR, c: opponentC} }];
                                    pathExtended = true;
                                    exploreKing(finalLandR, finalLandC, landingBoard, newPath);
                                }
                            }
                            break;
                        } else if (kBoard[opponentR][opponentC] !== EMPTY) {
                            break;
                        }
                    } else {
                        break;
                    }
                }
            }
            if (!pathExtended && path.length > 0) {
                kingPaths.push(path);
            }
        }
        exploreKing(r, c, board, []);
        return kingPaths;
    } else {
        explore(r, c, []);
        return paths;
    }
};

const findPossibleMoves = (board, player) => {
    let allCapturePaths = [];
    let simpleMoves = [];

    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            const piece = board[r][c];
            if (isPlayerPiece(piece, player)) {
                const capturePaths = findCaptureMovesForPiece(board, r, c, player, piece);
                if (capturePaths.length > 0) {
                    allCapturePaths.push(...capturePaths);
                }

                const dr = (player === 1) ? -1 : 1;
                const directions = isKing(piece) ? [[-1, -1], [-1, 1], [1, -1], [1, 1]] : [[dr, -1], [dr, 1]];

                for (const [dr_move, dc_move] of directions) {
                    if (isKing(piece)) {
                         for (let i = 1; i < 8; i++) {
                            const newR = r + i * dr_move;
                            const newC = c + i * dc_move;
                            if (newR >= 0 && newR < 8 && newC >= 0 && newC < 8 && board[newR][newC] === EMPTY) {
                                simpleMoves.push({ from: { r, c }, to: { r: newR, c: newC }, captures: [] });
                            } else {
                                break;
                            }
                        }
                    } else {
                        const newR = r + dr_move;
                        const newC = c + dc_move;
                        if (newR >= 0 && newR < 8 && newC >= 0 && newC < 8 && board[newR][newC] === EMPTY) {
                            simpleMoves.push({ from: { r, c }, to: { r: newR, c: newC }, captures: [] });
                        }
                    }
                }
            }
        }
    }

    if (allCapturePaths.length > 0) {
        const maxCaptures = Math.max(...allCapturePaths.map(path => path.length));
        return allCapturePaths.filter(path => path.length === maxCaptures).map(path => ({
            from: path[0].from,
            to: path[path.length - 1].to,
            captures: path.map(p => p.captured)
        }));
    }

    return simpleMoves;
};

const applyMove = (board, move) => {
    const newBoard = JSON.parse(JSON.stringify(board));
    const { from, to, captures } = move;
    const piece = newBoard[from.r][from.c];
    
    newBoard[to.r][to.c] = newBoard[from.r][from.c];
    newBoard[from.r][from.c] = EMPTY;

    if (captures) {
        captures.forEach(cap => {
            newBoard[cap.r][cap.c] = EMPTY;
        });
    }

    const player = (piece === P1_PAWN || piece === P1_KING) ? 1 : 2;
    if (player === 1 && to.r === 0 && piece === P1_PAWN) {
        newBoard[to.r][to.c] = P1_KING;
    } else if (player === 2 && to.r === 7 && piece === P2_PAWN) {
        newBoard[to.r][to.c] = P2_KING;
    }

    return newBoard;
};

const checkWinner = (board, nextPlayer) => {
    let p1Pieces = 0;
    let p2Pieces = 0;
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            if (isPlayerPiece(board[r][c], 1)) p1Pieces++;
            if (isPlayerPiece(board[r][c], 2)) p2Pieces++;
        }
    }
    if (p1Pieces === 0) return { winner: 2, loser: 1 };
    if (p2Pieces === 0) return { winner: 1, loser: 2 };

    const possibleMoves = findPossibleMoves(board, nextPlayer);
    if (possibleMoves.length === 0) {
        const winner = nextPlayer === 1 ? 2 : 1;
        const loser = nextPlayer;
        return { winner, loser };
    }
    
    return null;
};


module.exports = {
    createInitialBoard,
    findPossibleMoves,
    applyMove,
    checkWinner,
    P1_PAWN, P2_PAWN, P1_KING, P2_KING, EMPTY
};