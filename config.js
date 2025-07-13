const dotenv = require('dotenv');
dotenv.config();

const config = {
    PLATFORM_NAME: 'BrainSkill',

    COLORS: {
        primary: '#000000',
        secondary: '#FFFFFF',
        accent: '#333333',
        lightWood: '#D2B48C',
        darkWood: '#8B4513'
    },

    FONTS: {
        main: 'Oswald, sans-serif'
    },
    
    SERVER_PORT: process.env.PORT || 3000,
    
    CORS_ORIGIN: process.env.FRONTEND_URL || '*',

    COMMISSION_RATE: 0.15, 

    LIMITS: {
        MIN_DEPOSIT: 50.00,
        MAX_DEPOSIT: 10000.00,
        MIN_WITHDRAWAL: 50.00,
        MAX_WITHDRAWAL: 10000.00,
        MAX_BET: 5000.00,
        MIN_BET: 10.00
    },

    JWT: {
        SECRET: process.env.JWT_SECRET,
        EXPIRES_IN: '7d'
    },

    PASSWORD_RESET: {
        TOKEN_EXPIRATION_MINUTES: 15,
        CODE_LENGTH: 6
    },

    ID_LENGTHS: {
        USER: 5,
        TRANSACTION: 12,
        GAME: 8
    },
    
    CLOUDINARY_CONFIG: {
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key: process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET
    },

    NODEMAILER_CONFIG: {
        service: 'gmail',
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS
        }
    },

    DEFAULT_AVATAR_URL: 'https://res.cloudinary.com/dje6f5k5u/image/upload/v1716307374/brainskill/default_avatar.png',
};

module.exports = config;