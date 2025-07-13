const EMPTY = 0;
const P1_MAN = 1;
const P2_MAN = 2;
const P1_KING = 3;
const P2_KING = 4;
const BOARD_SIZE = 8;

function createInitialBoard() {
    const board = Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(EMPTY));
    for (let r = 0; r < 3; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
            if ((r + c) % 2 !== 0) {
                board[r][c] = P2_MAN;
            }
        }
    }
    for (let r = 5; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
            if ((r + c) % 2 !== 0) {
                board[r][c] = P1_MAN;
            }
        }
    }
    return board;
}

function boardToString(board) {
    return board.map(row => row.join('')).join('');
}

function stringToBoard(boardString) {
    const board = [];
    for (let i = 0; i < BOARD_SIZE; i++) {
        const rowString = boardString.substring(i * BOARD_SIZE, (i + 1) * BOARD_SIZE);
        board.push(rowString.split('').map(char => parseInt(char, 10)));
    }
    return board;
}

function isWithinBoard(r, c) {
    return r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE;
}

function isPlayerPiece(piece, player) {
    return (player === 1 && (piece === P1_MAN || piece === P1_KING)) ||
           (player === 2 && (piece === P2_MAN || piece === P2_KING));
}

function isOpponentPiece(piece, player) {
    return (player === 1 && (piece === P2_MAN || piece === P2_KING)) ||
           (player === 2 && (piece === P1_MAN || piece === P1_KING));
}

function findCapturePaths(board, r, c, player, isKing, currentPath) {
    const directions = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
    let paths = [];
    let madeCapture = false;

    for (const [dr, dc] of directions) {
        if (isKing) {
            for (let i = 1; i < BOARD_SIZE; i++) {
                const jumpOverR = r + i * dr;
                const jumpOverC = c + i * dc;
                const landR = r + (i + 1) * dr;
                const landC = c + (i + 1) * dc;

                if (!isWithinBoard(jumpOverR, jumpOverC) || !isWithinBoard(landR, landC)) break;
                
                const jumpOverPiece = board[jumpOverR][jumpOverC];
                const landPiece = board[landR][landC];

                if (isOpponentPiece(jumpOverPiece, player) && landPiece === EMPTY) {
                    let landingSpotFound = false;
                    for (let j = i + 1; j < BOARD_SIZE; j++) {
                        const nextLandR = r + j * dr;
                        const nextLandC = c + j * dc;
                        if (!isWithinBoard(nextLandR, nextLandC) || board[nextLandR][nextLandC] !== EMPTY) break;

                        landingSpotFound = true;
                        const newBoard = JSON.parse(JSON.stringify(board));
                        newBoard[nextLandR][nextLandC] = newBoard[r][c];
                        newBoard[r][c] = EMPTY;
                        newBoard[jumpOverR][jumpOverC] = EMPTY;
                        
                        const newPath = [...currentPath, { r: nextLandR, c: nextLandC }];
                        const deeperPaths = findCapturePaths(newBoard, nextLandR, nextLandC, player, true, newPath);
                        paths.push(...deeperPaths);
                        madeCapture = true;
                    }
                }
                if (jumpOverPiece !== EMPTY) break;
            }
        } else {
            const jumpOverR = r + dr;
            const jumpOverC = c + dc;
            const landR = r + 2 * dr;
            const landC = c + 2 * dc;

            if (isWithinBoard(landR, landC) && isOpponentPiece(board[jumpOverR][jumpOverC], player) && board[landR][landC] === EMPTY) {
                const newBoard = JSON.parse(JSON.stringify(board));
                newBoard[landR][landC] = newBoard[r][c];
                newBoard[r][c] = EMPTY;
                newBoard[jumpOverR][jumpOverC] = EMPTY;
                
                const newPath = [...currentPath, { r: landR, c: landC }];
                const becomesKing = (player === 1 && landR === 0) || (player === 2 && landR === BOARD_SIZE - 1);
                const deeperPaths = findCapturePaths(newBoard, landR, landC, player, becomesKing, newPath);
                paths.push(...deeperPaths);
                madeCapture = true;
            }
        }
    }
    if (!madeCapture && currentPath.length > 1) {
        paths.push(currentPath);
    }
    return paths;
}

function getAllPossibleMoves(board, player) {
    let captureMoves = [];
    let simpleMoves = [];
    
    for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
            const piece = board[r][c];
            if (!isPlayerPiece(piece, player)) continue;

            const isKing = piece === P1_KING || piece === P2_KING;
            const moveDir = (player === 1) ? -1 : 1;
            const directions = isKing ? [[-1, -1], [-1, 1], [1, -1], [1, 1]] : [[moveDir, -1], [moveDir, 1]];

            const paths = findCapturePaths(board, r, c, player, isKing, [{ r, c }]);
            if (paths.length > 0) {
                 captureMoves.push(...paths);
            }

            for (const [dr, dc] of directions) {
                if (isKing) {
                    for (let i = 1; i < BOARD_SIZE; i++) {
                        const nextR = r + i * dr;
                        const nextC = c + i * dc;
                        if (!isWithinBoard(nextR, nextC) || board[nextR][nextC] !== EMPTY) break;
                        simpleMoves.push({ from: { r, c }, to: { r: nextR, c: nextC }, captured: [] });
                    }
                } else {
                    const nextR = r + dr;
                    const nextC = c + dc;
                    if (isWithinBoard(nextR, nextC) && board[nextR][nextC] === EMPTY) {
                        simpleMoves.push({ from: { r, c }, to: { r: nextR, c: nextC }, captured: [] });
                    }
                }
            }
        }
    }

    if (captureMoves.length > 0) {
        let maxCaptures = 0;
        for (const path of captureMoves) {
            if (path.length - 1 > maxCaptures) {
                maxCaptures = path.length - 1;
            }
        }

        const longestCaptureMoves = captureMoves
            .filter(path => path.length - 1 === maxCaptures)
            .map(path => {
                const from = path[0];
                const to = path[path.length - 1];
                return { from, to, path };
            });

        return longestCaptureMoves;
    }
    
    return simpleMoves;
}

function performMove(board, move) {
    const newBoard = JSON.parse(JSON.stringify(board));
    const { from, to } = move;
    const piece = newBoard[from.r][from.c];

    if (move.path && move.path.length > 1) {
        for (let i = 0; i < move.path.length - 1; i++) {
            const start = move.path[i];
            const end = move.path[i+1];
            const dr = Math.sign(end.r - start.r);
            const dc = Math.sign(end.c - start.c);
            
            let currR = start.r + dr;
            let currC = start.c + dc;
            while (currR !== end.r || currC !== end.c) {
                 if(newBoard[currR][currC] !== EMPTY) {
                     newBoard[currR][currC] = EMPTY;
                     break;
                 }
                 currR += dr;
                 currC += dc;
            }
        }
    }

    newBoard[from.r][from.c] = EMPTY;
    let finalPiece = piece;
    const player = (piece === P1_MAN || piece === P1_KING) ? 1 : 2;
    if ((player === 1 && to.r === 0 && piece === P1_MAN)) {
        finalPiece = P1_KING;
    } else if ((player === 2 && to.r === BOARD_SIZE - 1 && piece === P2_MAN)) {
        finalPiece = P2_KING;
    }
    newBoard[to.r][to.c] = finalPiece;

    return newBoard;
}

function checkGameEnd(board, currentPlayer) {
    const moves = getAllPossibleMoves(board, currentPlayer);
    if (moves.length === 0) {
        return { gameOver: true, winner: currentPlayer === 1 ? 2 : 1 };
    }

    let p1Pieces = 0;
    let p2Pieces = 0;
    for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
            if (isPlayerPiece(board[r][c], 1)) p1Pieces++;
            if (isPlayerPiece(board[r][c], 2)) p2Pieces++;
        }
    }

    if (p1Pieces === 0) return { gameOver: true, winner: 2 };
    if (p2Pieces === 0) return { gameOver: true, winner: 1 };

    return { gameOver: false, winner: null };
}

module.exports = {
    createInitialBoard,
    boardToString,
    stringToBoard,
    getAllPossibleMoves,
    performMove,
    checkGameEnd
};