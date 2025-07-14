const nodemailer = require('nodemailer');
const crypto = require('crypto');
const config = require('./config');

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
});

const generateUniqueId = (length) => {
    return Math.floor(Math.pow(10, length - 1) + Math.random() * (Math.pow(10, length) - Math.pow(10, length - 1) - 1));
};

const generateTransactionId = () => {
    const timestamp = Date.now();
    const randomPart = crypto.randomBytes(4).toString('hex').toUpperCase();
    return `BS-${timestamp}-${randomPart}`;
};

const generatePasswordResetCode = () => {
    return crypto.randomInt(100000, 999999).toString();
};

const sendStyledEmail = async (to, subject, htmlContent) => {
    const mailOptions = {
        from: `"${config.platformName}" <${process.env.EMAIL_USER}>`,
        to,
        subject,
        html: htmlContent,
    };

    try {
        await transporter.sendMail(mailOptions);
        return true;
    } catch (error) {
        console.error('Error sending email:', error);
        return false;
    }
};

const getPasswordResetEmailHTML = (code) => {
    return `
    <!DOCTYPE html>
    <html lang="pt">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <link href="https://fonts.googleapis.com/css2?family=Oswald:wght@400;700&display=swap" rel="stylesheet">
        <title>Recuperação de Senha</title>
        <style>
            body {
                font-family: 'Oswald', sans-serif;
                background-color: #f4f4f4;
                margin: 0;
                padding: 0;
                color: #333;
            }
            .container {
                max-width: 600px;
                margin: 40px auto;
                background-color: #ffffff;
                border: 1px solid #ddd;
                border-radius: 8px;
                overflow: hidden;
            }
            .header {
                background-color: #1a1a1a;
                color: #ffffff;
                padding: 30px;
                text-align: center;
                font-size: 28px;
                font-weight: 700;
            }
            .content {
                padding: 40px;
                line-height: 1.6;
                text-align: center;
            }
            .code {
                font-size: 42px;
                font-weight: 700;
                color: #000000;
                letter-spacing: 8px;
                margin: 25px 0;
                padding: 15px;
                background-color: #f0f0f0;
                border-radius: 5px;
                display: inline-block;
            }
            .footer {
                text-align: center;
                padding: 20px;
                font-size: 12px;
                color: #777;
                background-color: #f9f9f9;
            }
            p {
                margin: 0 0 15px;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                ${config.platformName}
            </div>
            <div class="content">
                <p>Olá,</p>
                <p>Recebemos um pedido de recuperação de senha para a sua conta. Use o código abaixo para redefinir a sua senha.</p>
                <div class="code">${code}</div>
                <p>Este código é válido por <strong>15 minutos</strong>. Se não solicitou esta alteração, pode ignorar este email com segurança.</p>
            </div>
            <div class="footer">
                © ${new Date().getFullYear()} ${config.platformName}. Todos os direitos reservados.
            </div>
        </div>
    </body>
    </html>
    `;
};


module.exports = {
    generateUniqueId,
    generateTransactionId,
    generatePasswordResetCode,
    sendStyledEmail,
    getPasswordResetEmailHTML,
};