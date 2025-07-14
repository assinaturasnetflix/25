const nodemailer = require('nodemailer');
const config = require('./config');

const generateNumericId = (length = 5) => {
    let result = '';
    const characters = '0123456789';
    const charactersLength = characters.length;
    for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result;
};

const sendPasswordResetEmail = async (email, token) => {
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS,
        },
    });

    const emailHtml = `
    <!DOCTYPE html>
    <html lang="pt">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <link href="https://fonts.googleapis.com/css2?family=Oswald:wght@400;700&display=swap" rel="stylesheet">
        <style>
            body {
                font-family: 'Oswald', sans-serif;
                background-color: #f4f4f4;
                color: #333;
                margin: 0;
                padding: 0;
            }
            .container {
                max-width: 600px;
                margin: 20px auto;
                background-color: #ffffff;
                border: 1px solid #ddd;
                padding: 40px;
            }
            .header {
                background-color: #000000;
                color: #ffffff;
                padding: 20px;
                text-align: center;
                font-size: 28px;
                font-weight: 700;
            }
            .content {
                padding: 30px 0;
                line-height: 1.6;
                text-align: center;
            }
            .code {
                font-size: 36px;
                font-weight: 700;
                letter-spacing: 5px;
                color: #000000;
                background-color: #f0f0f0;
                padding: 15px 25px;
                margin: 20px 0;
                display: inline-block;
                border: 1px dashed #ccc;
            }
            .footer {
                margin-top: 30px;
                font-size: 12px;
                color: #777;
                text-align: center;
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
                <p>Recebemos uma solicitação para redefinir a sua senha. Use o código abaixo para continuar.</p>
                <div class="code">${token}</div>
                <p>Este código é válido por <strong>${config.passwordResetTokenExpiresIn} minutos</strong>.</p>
                <p>Se você não solicitou esta alteração, por favor, ignore este email.</p>
            </div>
            <div class="footer">
                © ${new Date().getFullYear()} ${config.platformName}. Todos os direitos reservados.
            </div>
        </div>
    </body>
    </html>
    `;

    const mailOptions = {
        from: `"${config.platformName}" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: `Código de Recuperação de Senha - ${config.platformName}`,
        html: emailHtml,
    };

    await transporter.sendMail(mailOptions);
};


module.exports = {
    generateNumericId,
    sendPasswordResetEmail
};