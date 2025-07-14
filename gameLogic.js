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

// ** LÓGICA REFINADA PARA CAPTURAS DA DAMA **
const findCaptureMovesForKing = (board, r, c) => {
    const piece = board[r][c];
    if (!piece || piece.length === 1) return []; // Apenas Damas
    const moves = [];
    const directions = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

    for (const [dr, dc] of directions) {
        let opponentFound = null;
        let opponentPos = null;

        for (let i = 1; i < 8; i++) {
            const nr = r + dr * i;
            const nc = c + dc * i;

            if (!(nr >= 0 && nr < 8 && nc >= 0 && nc < 8)) break; // Fora do tabuleiro

            const targetCell = board[nr][nc];

            if (targetCell) {
                if (isOpponent(piece, targetCell)) {
                    if (opponentFound) break; // Já encontrou um oponente nesta linha, não pode saltar dois
                    opponentFound = targetCell;
                    opponentPos = [nr, nc];
                } else {
                    break; // Bloqueado pela própria peça
                }
            } else { // Casa vazia
                if (opponentFound) {
                    // Se encontrou um oponente, pode aterrar em qualquer casa vazia depois dele
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
    if (!piece || piece.length > 1) return []; // Apenas Peões
    const moves = [];
    const directions = [[-1, -1], [-1, 1], [1, -1], [1, 1]]; // Peões podem capturar para trás

    for (const [dr, dc] of directions) {
        const nr = r + dr;
        const nc = c + dc;
        const nnr = r + dr * 2;
        const nnc = c + dc * 2;

        if (nnr >= 0 && nnr < 8 && nnc >= 0 && nnc < 8 && board[nnr][nnc] === E) {
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
    
    if (piece === W || piece === B) { // Movimento do Peão
        const forward = piece === W ? -1 : 1;
        const directions = [[forward, -1], [forward, 1]];
        for (const [dr, dc] of directions) {
            const nr = r + dr;
            const nc = c + dc;
            if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8 && board[nr][nc] === E) {
                moves.push({ from: [r, c], to: [nr, nc], captured: [] });
            }
        }
    } else { // Movimento da Dama
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

    // Promove a Dama
    if ((piece === W && endR === 0) || (piece === B && endR === 7)) {
        newBoard[endR][endC] = piece === W ? WK : BK;
    }
    
    return newBoard;
};

// ** LÓGICA PRINCIPAL REFINADA PARA CAPTURAS MÚLTIPLAS **
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
    
    // Se não houver capturas, retorna movimentos simples
    let allSimpleMoves = [];
    for (const [r, c] of allPlayerPieces) {
        allSimpleMoves.push(...findSimpleMoves(board, r, c));
    }
    return allSimpleMoves;
};

const findCaptureSequencesFrom = (currentBoard, r, c, sequence = { from: [r, c], to: null, captured: [] }) => {
    let finalSequences = [];
    const piece = currentBoard[r][c];
    const captureMoves = piece.length > 1 ? findCaptureMovesForKing(currentBoard, r, c) : findCaptureMovesForPawn(currentBoard, r, c);
    
    if (captureMoves.length === 0) {
        if (sequence.captured.length > 0) {
            sequence.to = [r, c]; // Onde a peça parou
            finalSequences.push(sequence);
        }
        return finalSequences;
    }

    for (const move of captureMoves) {
        const nextBoard = applyMoveToBoard(currentBoard, move);
        const [nextR, nextC] = move.to;
        
        // ** VERIFICA SE A PEÇA SE TORNOU DAMA DURANTE A CAPTURA **
        const newPieceOnBoard = nextBoard[nextR][nextC];
        let continuingPiece = piece;
        if(newPieceOnBoard.length > 1) {
            continuingPiece = newPieceOnBoard;
        }

        const newSequence = {
            from: sequence.from,
            to: null,
            captured: [...sequence.captured, ...move.captured]
        };
        
        // Se a peça foi promovida, ela pode continuar a capturar como Dama no mesmo turno
        const nextSequences = findCaptureSequencesFrom(nextBoard, nextR, nextC, newSequence);
        finalSequences.push(...nextSequences);
    }

    // Se nenhuma continuação for possível, esta sequência termina aqui.
    if (finalSequences.length === 0 && sequence.captured.length > 0) {
        sequence.to = [r, c];
        return [sequence];
    }
    
    return finalSequences;
};

const checkWinCondition = (board, currentPlayerColor) => {
    const opponentColor = currentPlayerColor === 'w' ? 'b' : 'w';
    
    let opponentPiecesCount = 0;
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            if (board[r][c] && board[r][c].startsWith(opponentColor)) {
                opponentPiecesCount++;
            }
        }
    }
    
    if (opponentPiecesCount === 0) return { winner: currentPlayerColor };
    
    const opponentMoves = getPossibleMovesForPlayer(board, opponentColor);
    if (opponentMoves.length === 0) return { winner: currentPlayerColor };
    
    return { winner: null };
};

module.exports = {
    createInitialBoard,
    getPossibleMovesForPlayer,
    applyMoveToBoard,
    checkWinCondition,
    pieceTypes: { B, W, BK, WK, E }
};