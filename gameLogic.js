class GameLogic {
    constructor(boardState, currentPlayerId) {
        this.board = this.parseBoardState(boardState);
        this.currentPlayerColor = this.getPlayerColor(currentPlayerId);
    }

    parseBoardState(boardState) {
        return JSON.parse(boardState);
    }

    getPlayerColor(playerId) {
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const piece = this.board[r][c];
                if (piece && piece.playerId === playerId) {
                    return piece.color;
                }
            }
        }
        return null;
    }

    isValidMove(fromRow, fromCol, toRow, toCol, playerId) {
        const piece = this.board[fromRow][fromCol];
        if (!piece || piece.playerId !== playerId) {
            return { valid: false, reason: 'Peça inválida ou não pertence ao jogador.' };
        }

        const availableCaptures = this.getAvailableCaptures(playerId);

        if (availableCaptures.length > 0) {
            const isMoveACapture = availableCaptures.some(move =>
                move.from.row === fromRow && move.from.col === fromCol &&
                move.to.row === toRow && move.to.col === toCol
            );
            if (!isMoveACapture) {
                return { valid: false, reason: 'Captura obrigatória disponível.' };
            }
            const bestCaptureSequence = this.findBestCaptureSequence(fromRow, fromCol);
            const moveCaptures = Math.abs(toRow - fromRow) / 2;
            if (moveCaptures < bestCaptureSequence.captures) {
                 return { valid: false, reason: 'Deve escolher a jogada com o maior número de capturas.' };
            }
        }

        const dx = toCol - fromCol;
        const dy = toRow - fromRow;
        const absDx = Math.abs(dx);
        const absDy = Math.abs(dy);

        if (piece.isKing) {
            return this.isValidKingMove(fromRow, fromCol, toRow, toCol, dx, dy, absDx, absDy, availableCaptures.length > 0);
        } else {
            return this.isValidPawnMove(fromRow, fromCol, toRow, toCol, dy, absDx, absDy, piece.color, availableCaptures.length > 0);
        }
    }

    isValidPawnMove(fromRow, fromCol, toRow, toCol, dy, absDx, absDy, color, isCaptureMandatory) {
        const forward = color === 'black' ? 1 : -1;

        if (isCaptureMandatory) {
            if (absDx !== 2 || absDy !== 2) return { valid: false };
            const midRow = fromRow + (toRow - fromRow) / 2;
            const midCol = fromCol + (toCol - fromCol) / 2;
            const capturedPiece = this.board[midRow][midCol];
            if (!capturedPiece || capturedPiece.color === color) return { valid: false };
            return { valid: true, isCapture: true, capturedPos: { row: midRow, col: midCol } };
        } else {
            if (absDx !== 1 || dy !== forward) return { valid: false };
            if (this.board[toRow][toCol]) return { valid: false };
            return { valid: true, isCapture: false };
        }
    }

    isValidKingMove(fromRow, fromCol, toRow, toCol, dx, dy, absDx, absDy, isCaptureMandatory) {
        if (absDx !== absDy) return { valid: false };

        const stepX = dx / absDx;
        const stepY = dy / absDy;
        let capturedPieces = [];
        let pathIsClear = true;
        let opponentPieceEncountered = null;

        for (let i = 1; i < absDx; i++) {
            const currRow = fromRow + i * stepY;
            const currCol = fromCol + i * stepX;
            const pieceOnPath = this.board[currRow][currCol];

            if (pieceOnPath) {
                if (pieceOnPath.color !== this.currentPlayerColor) {
                    if (opponentPieceEncountered) {
                        pathIsClear = false;
                        break;
                    }
                    opponentPieceEncountered = { piece: pieceOnPath, row: currRow, col: currCol };
                    capturedPieces.push(opponentPieceEncountered);
                } else {
                    pathIsClear = false;
                    break;
                }
            } else {
                if (opponentPieceEncountered) { // Path must be clear after a captured piece
                     pathIsClear = false;
                     break;
                }
            }
        }

        if (!pathIsClear || (isCaptureMandatory && !opponentPieceEncountered)) {
            return { valid: false };
        }
        
        if (isCaptureMandatory && capturedPieces.length > 1) {
            return { valid: false, reason: 'Dama só pode capturar uma peça por movimento.' };
        }

        return { valid: true, isCapture: !!opponentPieceEncountered, capturedPos: opponentPieceEncountered ? { row: opponentPieceEncountered.row, col: opponentPieceEncountered.col } : null };
    }
    
    findBestCaptureSequence(startRow, startCol) {
        let maxCaptures = 0;
        const sequences = this.findAllCaptureSequences(startRow, startCol, this.board);
        for (const seq of sequences) {
            if (seq.length > maxCaptures) {
                maxCaptures = seq.length;
            }
        }
        return { captures: maxCaptures };
    }

    findAllCaptureSequences(row, col, board, sequence = []) {
        const piece = board[row][col];
        if (!piece) return [sequence];

        const directions = piece.isKing
            ? [[-1,-1], [-1,1], [1,-1], [1,1]]
            : [[-1,-1], [-1,1], [1,-1], [1,1]];

        let allSequences = [];
        let hasMoreCaptures = false;

        for (const [dr, dc] of directions) {
            if (!piece.isKing && (piece.color === 'black' ? dr < 0 : dr > 0)) {
                 // Pawns only capture forward
            }

            const opponentRow = row + dr;
            const opponentCol = col + dc;
            const landRow = row + 2 * dr;
            const landCol = col + 2 * dc;

            if (this.isWithinBounds(landRow, landCol) && board[landRow][landCol] === null) {
                const opponentPiece = this.isWithinBounds(opponentRow, opponentCol) ? board[opponentRow][opponentCol] : null;
                if (opponentPiece && opponentPiece.color !== piece.color) {
                     const newBoard = JSON.parse(JSON.stringify(board));
                     newBoard[landRow][landCol] = newBoard[row][col];
                     newBoard[row][col] = null;
                     newBoard[opponentRow][opponentCol] = null;
                     
                     const newSequence = [...sequence, { from: {row, col}, to: {row: landRow, col: landCol} }];
                     allSequences.push(...this.findAllCaptureSequences(landRow, landCol, newBoard, newSequence));
                     hasMoreCaptures = true;
                }
            }
        }
        
        if (!hasMoreCaptures) {
            allSequences.push(sequence);
        }
        
        return allSequences;
    }


    getAvailableCaptures(playerId) {
        const playerColor = this.getPlayerColor(playerId);
        let captures = [];
        let maxCaptures = 0;

        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const piece = this.board[r][c];
                if (piece && piece.playerId === playerId) {
                    const sequences = this.findAllCaptureSequences(r, c, this.board);
                    for (const seq of sequences) {
                        if (seq.length > maxCaptures) {
                            maxCaptures = seq.length;
                            captures = []; // Reset captures with a new max length
                        }
                        if (seq.length > 0 && seq.length === maxCaptures) {
                            captures.push(seq[0]); // Only the first move of the sequence matters
                        }
                    }
                }
            }
        }
        return captures;
    }

    isWithinBounds(row, col) {
        return row >= 0 && row < 8 && col >= 0 && col < 8;
    }

    checkWinCondition(playerId) {
        const opponentId = this.getOpponentId(playerId);
        let opponentPieceCount = 0;
        let opponentHasMoves = false;

        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const piece = this.board[r][c];
                if (piece && piece.playerId === opponentId) {
                    opponentPieceCount++;
                    if (this.hasValidMoves(r, c)) {
                        opponentHasMoves = true;
                        break;
                    }
                }
            }
            if (opponentHasMoves) break;
        }

        if (opponentPieceCount === 0 || !opponentHasMoves) {
            return { gameOver: true, winner: playerId };
        }
        return { gameOver: false };
    }
    
    getOpponentId(playerId) {
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const piece = this.board[r][c];
                if (piece && piece.playerId !== playerId) {
                    return piece.playerId;
                }
            }
        }
        return null;
    }

    hasValidMoves(row, col) {
        const piece = this.board[row][col];
        if (!piece) return false;

        const directions = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
        for (const [dr, dc] of directions) {
            // Check simple move
            const toRow = row + dr;
            const toCol = col + dc;
            if (this.isWithinBounds(toRow, toCol) && !this.board[toRow][toCol]) {
                if (piece.isKing) return true;
                if (!piece.isKing && (piece.color === 'black' ? dr > 0 : dr < 0)) return true;
            }
            // Check capture move
            const landRow = row + 2 * dr;
            const landCol = col + 2 * dc;
            if (this.isWithinBounds(landRow, landCol) && !this.board[landRow][landCol]) {
                const opponentPiece = this.board[toRow][toCol];
                if (opponentPiece && opponentPiece.color !== piece.color) return true;
            }
        }
        return false;
    }
    
    static getInitialBoard(player1Id, player2Id) {
        const board = Array(8).fill(null).map(() => Array(8).fill(null));
        for (let row = 0; row < 3; row++) {
            for (let col = 0; col < 8; col++) {
                if ((row + col) % 2 !== 0) {
                    board[row][col] = { playerId: player2Id, color: 'black', isKing: false };
                }
            }
        }
        for (let row = 5; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                if ((row + col) % 2 !== 0) {
                    board[row][col] = { playerId: player1Id, color: 'white', isKing: false };
                }
            }
        }
        return JSON.stringify(board);
    }
}

module.exports = GameLogic;