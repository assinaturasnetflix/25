const EMPTY = 0;
const P1_MAN = 1;
const P2_MAN = 2;
const P1_KING = 3;
const P2_KING = 4;

const BOARD_SIZE = 8;

const createInitialBoard = () => {
    const board = Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(EMPTY));
    for (let row = 0; row < 3; row++) {
        for (let col = 0; col < BOARD_SIZE; col++) {
            if ((row + col) % 2 !== 0) {
                board[row][col] = P2_MAN;
            }
        }
    }
    for (let row = 5; row < BOARD_SIZE; row++) {
        for (let col = 0; col < BOARD_SIZE; col++) {
            if ((row + col) % 2 !== 0) {
                board[row][col] = P1_MAN;
            }
        }
    }
    return serializeBoard(board);
};

const serializeBoard = (board) => board.map(row => row.join(',')).join(';');
const deserializeBoard = (boardString) => boardString.split(';').map(rowStr => rowStr.split(',').map(Number));

const isPlayerPiece = (piece, player) => {
    return (player === 1 && (piece === P1_MAN || piece === P1_KING)) ||
           (player === 2 && (piece === P2_MAN || piece === P2_KING));
};

const isKing = (piece) => piece === P1_KING || piece === P2_KING;
const isMan = (piece) => piece === P1_MAN || piece === P2_MAN;
const getOpponent = (player) => (player === 1) ? 2 : 1;

const findCaptureSequences = (board, startRow, startCol, player) => {
    const piece = board[startRow][startCol];
    const directions = [
        [-1, -1], [-1, 1], [1, -1], [1, 1]
    ];
    let allSequences = [];

    const findPaths = (currentPath, currentBoard) => {
        const lastPos = currentPath[currentPath.length - 1];
        const [r, c] = lastPos;
        let foundNewCapture = false;

        for (const [dr, dc] of directions) {
            if (isKing(piece)) {
                for (let i = 1; ; i++) {
                    const jumpOverR = r + i * dr;
                    const jumpOverC = c + i * dc;
                    const landR = r + (i + 1) * dr;
                    const landC = c + (i + 1) * dc;

                    if (landR < 0 || landR >= BOARD_SIZE || landC < 0 || landC >= BOARD_SIZE) break;

                    const jumpedPiece = currentBoard[jumpOverR][jumpOverC];
                    if (isPlayerPiece(jumpedPiece, getOpponent(player))) {
                         for (let j = i + 1; ; j++) {
                            const newLandR = r + j * dr;
                            const newLandC = c + j * dc;
                            if (newLandR < 0 || newLandR >= BOARD_SIZE || newLandC < 0 || newLandC >= BOARD_SIZE) break;

                            if (currentBoard[newLandR][newLandC] === EMPTY) {
                                foundNewCapture = true;
                                const nextBoard = currentBoard.map(row => [...row]);
                                nextBoard[newLandR][newLandC] = piece;
                                nextBoard[r][c] = EMPTY;
                                nextBoard[jumpOverR][jumpOverC] = EMPTY;
                                findPaths([...currentPath, [newLandR, newLandC]], nextBoard);
                            } else {
                                break;
                            }
                         }
                         break;
                    }
                     if (currentBoard[jumpOverR][jumpOverC] !== EMPTY) break;
                }
            } else {
                const jumpOverR = r + dr;
                const jumpOverC = c + dc;
                const landR = r + 2 * dr;
                const landC = c + 2 * dc;

                if (landR >= 0 && landR < BOARD_SIZE && landC >= 0 && landC < BOARD_SIZE &&
                    currentBoard[landR][landC] === EMPTY &&
                    isPlayerPiece(currentBoard[jumpOverR][jumpOverC], getOpponent(player))) {
                    
                    foundNewCapture = true;
                    const nextBoard = currentBoard.map(row => [...row]);
                    nextBoard[landR][landC] = piece;
                    nextBoard[r][c] = EMPTY;
                    nextBoard[jumpOverR][jumpOverC] = EMPTY;
                    findPaths([...currentPath, [landR, landC]], nextBoard);
                }
            }
        }

        if (!foundNewCapture) {
            if (currentPath.length > 1) {
                allSequences.push(currentPath);
            }
        }
    };

    findPaths([
        [startRow, startCol]
    ], board);
    return allSequences;
};

const findAllPlayerCaptures = (board, player) => {
    let allCaptures = [];
    for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
            if (isPlayerPiece(board[r][c], player)) {
                const sequences = findCaptureSequences(board, r, c, player);
                if (sequences.length > 0) {
                    allCaptures.push(...sequences);
                }
            }
        }
    }
    return allCaptures;
};

const findAllPlayerMoves = (board, player) => {
    const moves = [];
    for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
            const piece = board[r][c];
            if (!isPlayerPiece(piece, player)) continue;

            const moveDirs = isKing(piece) ? [
                [-1, -1], [-1, 1], [1, -1], [1, 1]
            ] : (player === 1 ? [
                [-1, -1], [-1, 1]
            ] : [
                [1, -1], [1, 1]
            ]);

            for (const [dr, dc] of moveDirs) {
                if (isKing(piece)) {
                    for (let i = 1; ; i++) {
                        const newR = r + i * dr;
                        const newC = c + i * dc;
                        if (newR < 0 || newR >= BOARD_SIZE || newC < 0 || newC >= BOARD_SIZE || board[newR][newC] !== EMPTY) {
                            break;
                        }
                        moves.push([[r, c], [newR, newC]]);
                    }
                } else {
                    const newR = r + dr;
                    const newC = c + dc;
                    if (newR >= 0 && newR < BOARD_SIZE && newC >= 0 && newC < BOARD_SIZE && board[newR][newC] === EMPTY) {
                        moves.push([[r, c], [newR, newC]]);
                    }
                }
            }
        }
    }
    return moves;
};


const validateMove = (boardString, move, player) => {
    const board = deserializeBoard(boardString);
    const [startPos, ...restPath] = move;
    const [startRow, startCol] = startPos;
    const endPos = restPath[restPath.length - 1];

    if (!isPlayerPiece(board[startRow][startCol], player)) {
        return { isValid: false, error: "Not your piece." };
    }

    const allCaptures = findAllPlayerCaptures(board, player);

    if (allCaptures.length > 0) {
        const isMoveACapture = move.length > 2 || (move.length === 2 && Math.abs(move[0][0] - move[1][0]) > 1);
        if(!isMoveACapture) return { isValid: false, error: "Capture is mandatory." };
        
        const maxCaptureLength = Math.max(...allCaptures.map(seq => seq.length));

        if (move.length < maxCaptureLength) {
            return { isValid: false, error: "You must choose the longest capture sequence." };
        }

        const isValidCaptureSequence = allCaptures.some(seq => 
            seq.length === move.length && seq.every((pos, i) => pos[0] === move[i][0] && pos[1] === move[i][1])
        );

        if (!isValidCaptureSequence) {
             return { isValid: false, error: "Invalid capture sequence." };
        }

    } else {
        if (move.length !== 2) return { isValid: false, error: "Invalid move format." };
        const allMoves = findAllPlayerMoves(board, player);
        const isValidSimpleMove = allMoves.some(m => 
            m[0][0] === startRow && m[0][1] === startCol && m[1][0] === endPos[0] && m[1][1] === endPos[1]
        );
        if (!isValidSimpleMove) return { isValid: false, error: "Invalid move." };
    }

    return { isValid: true };
};


const applyMove = (boardString, move, player) => {
    const board = deserializeBoard(boardString);
    const [startPos, ...path] = move;
    const [startRow, startCol] = startPos;
    const endPos = path[path.length - 1];
    const [endRow, endCol] = endPos;
    
    let piece = board[startRow][startCol];
    board[startRow][startCol] = EMPTY;

    if ((player === 1 && endRow === 0) || (player === 2 && endRow === BOARD_SIZE - 1)) {
        piece = (player === 1) ? P1_KING : P2_KING;
    }

    board[endRow][endCol] = piece;

    if (move.length > 2 || Math.abs(startRow - endRow) > 1) {
        for(let i = 0; i < path.length; i++) {
            const prevPos = i === 0 ? startPos : path[i-1];
            const currentPos = path[i];
            const dr = Math.sign(currentPos[0] - prevPos[0]);
            const dc = Math.sign(currentPos[1] - prevPos[1]);
            
            let r = prevPos[0] + dr;
            let c = prevPos[1] + dc;

            while(r !== currentPos[0] || c !== currentPos[1]) {
                if(board[r][c] !== EMPTY) {
                    board[r][c] = EMPTY;
                    break;
                }
                r += dr;
                c += dc;
            }
        }
    }
    return serializeBoard(board);
};

const checkWinCondition = (boardString, player) => {
    const board = deserializeBoard(boardString);
    const opponent = getOpponent(player);

    const opponentCaptures = findAllPlayerCaptures(board, opponent);
    const opponentMoves = findAllPlayerMoves(board, opponent);

    if (opponentCaptures.length === 0 && opponentMoves.length === 0) {
        return { isGameOver: true, winner: player };
    }

    let opponentPieceCount = 0;
    for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
            if (isPlayerPiece(board[r][c], opponent)) {
                opponentPieceCount++;
            }
        }
    }

    if (opponentPieceCount === 0) {
        return { isGameOver: true, winner: player };
    }
    
    return { isGameOver: false };
};


module.exports = {
    createInitialBoard,
    validateMove,
    applyMove,
    checkWinCondition,
    serializeBoard,
    deserializeBoard
};