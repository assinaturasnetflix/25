const express = require('express');
const { body } = require('express-validator');

// Middlewares
const { verifyUserToken, verifyAdminToken } = require('./auth');
const { upload } = require('./utils');

// Controladores
const systemController = require('./systemControllers');
const userController = require('./userControllers');
const adminController = require('./adminControllers');


const router = express.Router();

// --- Rotas de Autenticação e Públicas ---
const authRouter = express.Router();
authRouter.post('/register', [
    body('storeName').notEmpty().trim().escape(),
    body('phone').isMobilePhone('any').withMessage('Número de telefone inválido.'),
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 6 })
], systemController.register);

authRouter.post('/login', systemController.login);
authRouter.post('/verify-email', systemController.verifyEmail);
authRouter.post('/forgot-password', systemController.forgotPassword);
authRouter.post('/reset-password', systemController.resetPassword);

// --- Rotas do Catálogo Público (CORRIGIDO) ---
const catalogRouter = express.Router();
// A MUDANÇA ESTÁ AQUI: o nome do parâmetro é agora :storeNameSlug
catalogRouter.get('/:storeNameSlug', systemController.getStoreBySlug);


// --- Rotas do Usuário (Protegidas) ---
const userRouter = express.Router();
userRouter.use(verifyUserToken);
userRouter.get('/dashboard', userController.getDashboardData);
userRouter.get('/profile', userController.getUserProfile);
userRouter.post('/copy-link-event', userController.trackLinkCopy);
userRouter.post('/products', upload.array('images', 10), userController.createProduct);
userRouter.get('/products', userController.getProducts);
userRouter.get('/products/:id', userController.getProductById);
userRouter.put('/products/:id', upload.array('images', 10), userController.updateProduct);
userRouter.delete('/products/:id', userController.deleteProduct);
userRouter.post('/categories', userController.createCategory);
userRouter.get('/categories', userController.getCategories);
userRouter.put('/categories/:id', userController.updateCategory);
userRouter.delete('/categories/:id', userController.deleteCategory);
userRouter.post('/catalog-settings/profile-picture', upload.single('profilePicture'), userController.updateProfilePicture);
userRouter.post('/catalog-settings/cover-banner', upload.single('coverBanner'), userController.updateCoverBanner);
userRouter.put('/catalog-settings/customization', userController.updateStoreCustomization);
userRouter.put('/catalog-settings/socials', userController.updateSocialLinks);
userRouter.get('/plans', userController.getAvailablePlans);
userRouter.post('/plans/subscribe', upload.single('paymentProof'), userController.submitPaymentProof);
userRouter.get('/payment-history', userController.getPaymentHistory);
userRouter.get('/storage', userController.getStorageInfo);
userRouter.post('/storage/buy', upload.single('paymentProof'), userController.buyExtraStorage);
userRouter.get('/storage/options', userController.getStorageOptions);

// --- Rotas do Administrador ---
const adminRouter = express.Router();
adminRouter.post('/login', adminController.adminLogin);
adminRouter.use(verifyAdminToken);
adminRouter.get('/users', adminController.getAllUsers);
adminRouter.post('/users/:userId/plan', adminController.changeUserPlan);
adminRouter.post('/users/:userId/status', adminController.updateUserStatus);
adminRouter.delete('/users/:userId', adminController.deleteUserAccount);
adminRouter.post('/users/:userId/custom-plan', adminController.createAndAssignCustomPlan);
adminRouter.get('/users/:userId/payment-history', adminController.getUserPaymentHistory);
adminRouter.get('/payments', adminController.getPendingPayments);
adminRouter.post('/payments/:paymentId/approve', adminController.approvePayment);
adminRouter.post('/payments/:paymentId/reject', adminController.rejectPayment);
adminRouter.get('/payments/storage', adminController.getPendingStoragePayments);
adminRouter.post('/payments/storage/:paymentId/approve', adminController.approveStoragePayment);
adminRouter.post('/payments/storage/:paymentId/reject', adminController.rejectStoragePayment);
adminRouter.post('/settings/payment-methods', adminController.addPaymentMethod);
adminRouter.get('/settings/payment-methods', adminController.getPaymentMethods);
adminRouter.delete('/settings/payment-methods/:methodId', adminController.deletePaymentMethod);
adminRouter.post('/settings/storage-options', adminController.addStorageOption);
adminRouter.get('/settings/storage-options', adminController.getStorageOptions);
adminRouter.put('/settings/storage-options/:optionId', adminController.updateStorageOption);
adminRouter.delete('/settings/storage-options/:optionId', adminController.deleteStorageOption);
adminRouter.get('/reports', adminController.getSystemReports);
adminRouter.get('/logs/errors', adminController.getErrorLogs);
adminRouter.get('/logs/emails', adminController.getEmailLogs);
adminRouter.post('/notifications/send', adminController.sendGlobalNotification);


// --- Montagem dos Roteadores ---
// Montar a rota de API dentro deste ficheiro
const apiRouter = express.Router();
apiRouter.use('/auth', authRouter);
apiRouter.use('/user', userRouter);
apiRouter.use('/admin', adminRouter);

router.use('/api', apiRouter);
router.use('/', catalogRouter); // Rota pública do catálogo, tratada na raiz

module.exports = router;