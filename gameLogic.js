const PIECE_TYPES = {
    EMPTY: 0,
    BLACK_MAN: 1,
    WHITE_MAN: 2,
    BLACK_KING: 3,
    WHITE_KING: 4
};

const createInitialBoard = () => {
    const board = Array(8).fill(null).map(() => Array(8).fill(PIECE_TYPES.EMPTY));
    for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 8; col++) {
            if ((row + col) % 2 !== 0) {
                board[row][col] = PIECE_TYPES.WHITE_MAN;
            }
        }
    }
    for (let row = 5; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
            if ((row + col) % 2 !== 0) {
                board[row][col] = PIECE_TYPES.BLACK_MAN;
            }
        }
    }
    return board;
};

const isWithinBounds = (row, col) => row >= 0 && row < 8 && col >= 0 && col < 8;

const getPlayerColor = (piece) => {
    if (piece === PIECE_TYPES.BLACK_MAN || piece === PIECE_TYPES.BLACK_KING) return 'black';
    if (piece === PIECE_TYPES.WHITE_MAN || piece === PIECE_TYPES.WHITE_KING) return 'white';
    return null;
};

const findCaptureMoves = (board, playerColor) => {
    let captureMoves = [];
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            const piece = board[r][c];
            if (getPlayerColor(piece) === playerColor) {
                findPieceCaptures(board, r, c, [], [], captureMoves);
            }
        }
    }
    if (captureMoves.length > 0) {
        const maxLen = Math.max(...captureMoves.map(m => m.captured.length));
        return captureMoves.filter(m => m.captured.length === maxLen);
    }
    return [];
};

const findPieceCaptures = (board, r, c, path, captured, allCaptures) => {
    const piece = board[r][c];
    const directions = [-1, 1];
    const isKing = piece === PIECE_TYPES.BLACK_KING || piece === PIECE_TYPES.WHITE_KING;

    let hadMove = false;
    for (const dr of directions) {
        for (const dc of directions) {
            if (isKing) {
                for (let i = 1; i < 8; i++) {
                    const jumpOverR = r + dr * i;
                    const jumpOverC = c + dc * i;
                    const landR = r + dr * (i + 1);
                    const landC = c + dc * (i + 1);

                    if (!isWithinBounds(landR, landC)) break;
                    const jumpedPiece = board[jumpOverR][jumpOverC];
                    const landPiece = board[landR][landC];

                    if (jumpedPiece !== PIECE_TYPES.EMPTY && getPlayerColor(jumpedPiece) !== getPlayerColor(piece) && landPiece === PIECE_TYPES.EMPTY) {
                         if (!captured.some(cap => cap.r === jumpOverR && cap.c === jumpOverC)) {
                            const newBoard = JSON.parse(JSON.stringify(board));
                            newBoard[r][c] = PIECE_TYPES.EMPTY;
                            newBoard[jumpOverR][jumpOverC] = PIECE_TYPES.EMPTY;
                            newBoard[landR][landC] = piece;
                            const newPath = [...path, {r: landR, c: landC}];
                            const newCaptured = [...captured, {r: jumpOverR, c: jumpOverC}];
                            hadMove = true;
                            findPieceCaptures(newBoard, landR, landC, newPath, newCaptured, allCaptures);
                        }
                    }
                    if(jumpedPiece !== PIECE_TYPES.EMPTY) break; 
                }
            } else {
                const jumpOverR = r + dr;
                const jumpOverC = c + dc;
                const landR = r + dr * 2;
                const landC = c + dc * 2;

                if (isWithinBounds(landR, landC)) {
                    const jumpedPiece = board[jumpOverR][jumpOverC];
                    const landPiece = board[landR][landC];
                    if (jumpedPiece !== PIECE_TYPES.EMPTY && getPlayerColor(jumpedPiece) !== getPlayerColor(piece) && landPiece === PIECE_TYPES.EMPTY) {
                        if (!captured.some(cap => cap.r === jumpOverR && cap.c === jumpOverC)) {
                            const newBoard = JSON.parse(JSON.stringify(board));
                            newBoard[r][c] = PIECE_TYPES.EMPTY;
                            newBoard[jumpOverR][jumpOverC] = PIECE_TYPES.EMPTY;
                            newBoard[landR][landC] = piece;
                            const newPath = [...path, {r: landR, c: landC}];
                            const newCaptured = [...captured, {r: jumpOverR, c: jumpOverC}];
                            hadMove = true;
                            findPieceCaptures(newBoard, landR, landC, newPath, newCaptured, allCaptures);
                        }
                    }
                }
            }
        }
    }
    if (!hadMove && path.length > 0) {
        allCaptures.push({ from: { r, c }, path, captured });
    }
};


const findSimpleMoves = (board, playerColor) => {
    const moves = [];
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            const piece = board[r][c];
            if (getPlayerColor(piece) === playerColor) {
                const isKing = piece === PIECE_TYPES.BLACK_KING || piece === PIECE_TYPES.WHITE_KING;
                const forwardDir = playerColor === 'black' ? -1 : 1;
                const dirs = isKing ? [-1, 1] : [forwardDir];

                for (const dr of dirs) {
                    for (const dc of [-1, 1]) {
                        if (isKing) {
                            for (let i = 1; i < 8; i++) {
                                const newR = r + dr * i;
                                const newC = c + dc * i;
                                if (!isWithinBounds(newR, newC) || board[newR][newC] !== PIECE_TYPES.EMPTY) break;
                                moves.push({ from: { r, c }, to: { r: newR, c: newC } });
                            }
                        } else {
                            const newR = r + dr;
                            const newC = c + dc;
                            if (isWithinBounds(newR, newC) && board[newR][newC] === PIECE_TYPES.EMPTY) {
                                moves.push({ from: { r, c }, to: { r: newR, c: newC } });
                            }
                        }
                    }
                }
            }
        }
    }
    return moves;
};

const getValidMoves = (board, playerColor) => {
    const captureMoves = findCaptureMoves(board, playerColor);
    if (captureMoves.length > 0) {
        return captureMoves.map(move => ({
            from: move.from,
            to: move.path[move.path.length - 1],
            isCapture: true,
            path: move.path,
            captured: move.captured
        }));
    }
    return findSimpleMoves(board, playerColor).map(move => ({...move, isCapture: false }));
};

const applyMove = (board, move) => {
    const newBoard = JSON.parse(JSON.stringify(board));
    const { from, to, isCapture, captured } = move;
    
    const piece = newBoard[from.r][from.c];
    newBoard[from.r][from.c] = PIECE_TYPES.EMPTY;
    newBoard[to.r][to.c] = piece;

    if (isCapture) {
        captured.forEach(cap => {
            newBoard[cap.r][cap.c] = PIECE_TYPES.EMPTY;
        });
    }

    const playerColor = getPlayerColor(piece);
    const promotionRow = playerColor === 'black' ? 0 : 7;
    if (to.r === promotionRow && (piece === PIECE_TYPES.BLACK_MAN || piece === PIECE_TYPES.WHITE_MAN)) {
        newBoard[to.r][to.c] = playerColor === 'black' ? PIECE_TYPES.BLACK_KING : PIECE_TYPES.WHITE_KING;
    }
    
    return newBoard;
};

const checkGameEnd = (board, currentPlayerColor) => {
    let blackPieces = 0;
    let whitePieces = 0;
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            const piece = board[r][c];
            if (getPlayerColor(piece) === 'black') blackPieces++;
            if (getPlayerColor(piece) === 'white') whitePieces++;
        }
    }

    if (blackPieces === 0) return { isFinished: true, winner: 'white' };
    if (whitePieces === 0) return { isFinished: true, winner: 'black' };

    const validMoves = getValidMoves(board, currentPlayerColor);
    if (validMoves.length === 0) {
        return { isFinished: true, winner: currentPlayerColor === 'black' ? 'white' : 'black' };
    }

    return { isFinished: false, winner: null };
};


module.exports = {
    PIECE_TYPES,
    createInitialBoard,
    getValidMoves,
    applyMove,
    checkGameEnd,
    getPlayerColor
};