const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const cloudinary = require('cloudinary').v2;
const crypto = 'crypto';
const config = require('./config');
const { User } = require('./models');

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
});

const generateToken = (id) => {
    return jwt.sign({ id }, process.env.JWT_SECRET, {
        expiresIn: '30d',
    });
};

const generateNumericId = (length) => {
    let result = '';
    const characters = '0123456789';
    const charactersLength = characters.length;
    for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result;
};

const generatePrivateGameCode = (length) => {
    let result = '';
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const charactersLength = characters.length;
    for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result;
};

const sendPasswordResetEmail = async (email, code) => {
    const mailOptions = {
        from: `"${config.platformName}" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: `Código de Recuperação de Senha - ${config.platformName}`,
        html: `
            <div style="font-family: Arial, sans-serif; line-height: 1.6; color: ${config.colors.emailText}; background-color: ${config.colors.emailBackground}; padding: 20px;">
                <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; padding: 20px; border-radius: 8px; border: 1px solid #ddd;">
                    <h2 style="color: ${config.colors.primary}; text-align: center;">${config.platformName}</h2>
                    <p>Olá,</p>
                    <p>Você solicitou a recuperação de sua senha. Use o código abaixo para redefinir sua senha. Este código é válido por 15 minutos.</p>
                    <div style="text-align: center; margin: 20px 0;">
                        <span style="display: inline-block; font-size: 24px; font-weight: bold; letter-spacing: 5px; padding: 10px 20px; background-color: ${config.colors.emailBackground}; border-radius: 5px;">${code}</span>
                    </div>
                    <p>Se você não solicitou esta alteração, por favor, ignore este e-mail.</p>
                    <p>Atenciosamente,<br>Equipa ${config.platformName}</p>
                </div>
            </div>
        `,
    };

    await transporter.sendMail(mailOptions);
};

class ErrorHandler extends Error {
    constructor(message, statusCode) {
        super(message);
        this.statusCode = statusCode;
    }
}

const asyncHandler = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};

const protect = asyncHandler(async (req, res, next) => {
    let token;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        try {
            token = req.headers.authorization.split(' ')[1];
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            req.user = await User.findById(decoded.id).select('-password');
            if (!req.user) {
                return next(new ErrorHandler('Utilizador não encontrado', 401));
            }
            next();
        } catch (error) {
            return next(new ErrorHandler('Não autorizado, token falhou', 401));
        }
    }
    if (!token) {
        return next(new ErrorHandler('Não autorizado, sem token', 401));
    }
});

const admin = (req, res, next) => {
    if (req.user && req.user.role === 'admin') {
        next();
    } else {
        res.status(401);
        throw new Error('Não autorizado como administrador');
    }
};

const errorHandlerMiddleware = (err, req, res, next) => {
    const statusCode = err.statusCode || 500;
    res.status(statusCode).json({
        message: err.message || 'Erro Interno do Servidor',
        stack: process.env.NODE_ENV === 'production' ? null : err.stack,
    });
};

module.exports = {
    generateToken,
    generateNumericId,
    generatePrivateGameCode,
    sendPasswordResetEmail,
    cloudinary,
    ErrorHandler,
    asyncHandler,
    protect,
    admin,
    errorHandlerMiddleware
};