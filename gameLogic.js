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

const isOpponent = (playerPiece, targetPiece) => {
    if (!playerPiece || !targetPiece) return false;
    const playerInitial = playerPiece.charAt(0);
    const targetInitial = targetPiece.charAt(0);
    return playerInitial !== targetInitial;
};

const findCaptureMovesForKing = (board, r, c) => {
    const piece = board[r][c];
    if (!piece || piece.length === 1) return [];
    const moves = [];
    const directions = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

    for (const [dr, dc] of directions) {
        let opponentFound = null;
        let opponentPos = null;

        for (let i = 1; i < 8; i++) {
            const nr = r + dr * i;
            const nc = c + dc * i;

            if (!(nr >= 0 && nr < 8 && nc >= 0 && nc < 8)) break;

            const targetCell = board[nr][nc];

            if (targetCell) {
                if (isOpponent(piece, targetCell)) {
                    if (opponentFound) break;
                    opponentFound = targetCell;
                    opponentPos = [nr, nc];
                } else {
                    break;
                }
            } else {
                if (opponentFound) {
                    moves.push({
                        from: [r, c],
                        to: [nr, nc],
                        captured: [opponentPos]
                    });
                }
            }
        }
    }
    return moves;
};

const findCaptureMovesForPawn = (board, r, c) => {
    const piece = board[r][c];
    if (!piece || piece.length > 1) return [];
    const moves = [];
    const directions = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

    for (const [dr, dc] of directions) {
        const nr = r + dr;
        const nc = c + dc;
        const nnr = r + dr * 2;
        const nnc = c + dc * 2;

        if (nnr >= 0 && nnr < 8 && nc >= 0 && nc < 8 && nnc >= 0 && nnc < 8 && board[nnr][nnc] === E) {
            const jumpedPiece = board[nr][nc];
            if (jumpedPiece && isOpponent(piece, jumpedPiece)) {
                moves.push({ from: [r, c], to: [nnr, nnc], captured: [[nr, nc]] });
            }
        }
    }
    return moves;
};

const findSimpleMoves = (board, r, c) => {
    const piece = board[r][c];
    if (!piece) return [];
    const moves = [];
    
    if (piece === W || piece === B) {
        const forward = piece === W ? -1 : 1;
        const directions = [[forward, -1], [forward, 1]];
        for (const [dr, dc] of directions) {
            const nr = r + dr;
            const nc = c + dc;
            if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8 && board[nr][nc] === E) {
                moves.push({ from: [r, c], to: [nr, nc], captured: [] });
            }
        }
    } else {
        const directions = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
        for (const [dr, dc] of directions) {
            for (let i = 1; i < 8; i++) {
                const nr = r + dr * i;
                const nc = c + dc * i;
                if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8 && board[nr][nc] === E) {
                    moves.push({ from: [r, c], to: [nr, nc], captured: [] });
                } else {
                    break;
                }
            }
        }
    }
    return moves;
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
        newBoard[endR][endC] = piece === W ? WK : BK;
    }
    
    return newBoard;
};

const getPossibleMovesForPlayer = (board, playerColor) => {
    let allPlayerPieces = [];
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            if (board[r][c] && board[r][c].startsWith(playerColor)) {
                allPlayerPieces.push([r, c]);
            }
        }
    }
    
    let allCaptureSequences = [];
    for(const [r,c] of allPlayerPieces) {
        const sequences = findCaptureSequencesFrom(board, r, c);
        allCaptureSequences.push(...sequences);
    }

    if (allCaptureSequences.length > 0) {
        let maxCaptures = 0;
        for(const seq of allCaptureSequences){
            if(seq.captured.length > maxCaptures){
                maxCaptures = seq.captured.length;
            }
        }
        return allCaptureSequences.filter(seq => seq.captured.length === maxCaptures);
    }
    
    let allSimpleMoves = [];
    for (const [r, c] of allPlayerPieces) {
        allSimpleMoves.push(...findSimpleMoves(board, r, c));
    }
    return allSimpleMoves;
};

const findCaptureSequencesFrom = (currentBoard, r, c, sequence = { from: [r, c], to: null, captured: [] }) => {
    let finalSequences = [];
    const piece = currentBoard[r][c];
    const isKing = piece.length > 1;

    const captureMoves = isKing ? findCaptureMovesForKing(currentBoard, r, c) : findCaptureMovesForPawn(currentBoard, r, c);
    
    if (captureMoves.length === 0) {
        if (sequence.captured.length > 0) {
            sequence.to = [r, c];
            finalSequences.push(sequence);
        }
        return finalSequences;
    }

    for (const move of captureMoves) {
        const nextBoard = applyMoveToBoard(currentBoard, move);
        const [nextR, nextC] = move.to;
        
        const wasPromoted = !isKing && (nextBoard[nextR][nextC].length > 1);

        const newSequence = {
            from: sequence.from,
            to: null,
            captured: [...sequence.captured, ...move.captured]
        };
        
        if (isKing || wasPromoted) {
            const nextSequences = findCaptureSequencesFrom(nextBoard, nextR, nextC, newSequence);
            if(nextSequences.length > 0) {
                finalSequences.push(...nextSequences);
            } else {
                newSequence.to = [nextR, nextC];
                finalSequences.push(newSequence);
            }
        } else {
            newSequence.to = [nextR, nextC];
            finalSequences.push(newSequence);
        }
    }
    
    return finalSequences;
};

const checkWinCondition = (board, playerWhoJustMovedColor) => {
    const opponentColor = playerWhoJustMovedColor === 'w' ? 'b' : 'w';
    
    let opponentPiecesCount = 0;
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            if (board[r][c] && board[r][c].startsWith(opponentColor)) {
                opponentPiecesCount++;
            }
        }
    }
    
    if (opponentPiecesCount === 0) {
        return { winner: playerWhoJustMovedColor };
    }
    
    const opponentMoves = getPossibleMovesForPlayer(board, opponentColor);
    if (opponentMoves.length === 0) {
        return { winner: playerWhoJustMovedColor };
    }
    
    return { winner: null };
};

module.exports = {
    createInitialBoard,
    getPossibleMovesForPlayer,
    applyMoveToBoard,
    checkWinCondition,
    pieceTypes: { B, W, BK, WK, E }
};