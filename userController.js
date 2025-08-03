const { User, Product, Plan, PaymentProof, Category } = require('./models');
const cloudinary = require('cloudinary').v2;

const deleteFromCloudinary = async (publicId, resourceType = 'image') => {
    if (!publicId) return;
    try {
        await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
    } catch (error) {
        console.error(`Erro ao deletar ${publicId} do Cloudinary:`, error);
    }
};

exports.getDashboardData = async (req, res) => {
    try {
        const user = await User.findById(req.userId).populate('plan');
        if (!user) {
            return res.status(404).json({ message: "Usuário não encontrado." });
        }
        const productCount = await Product.countDocuments({ user: req.userId });
        const storageUsedMB = (user.storageUsed / (1024 * 1024)).toFixed(2);

        res.status(200).json({
            user: {
                fullName: user.fullName,
                storeName: user.storeName,
                isEmailVerified: user.isEmailVerified,
                email: user.email
            },
            plan: {
                name: user.plan.name,
                expiresAt: user.planExpiryDate,
                storageUsedMB: parseFloat(storageUsedMB),
                storageLimitMB: user.plan.storageLimit,
            },
            productStats: {
                count: productCount,
                limit: user.plan.productLimit,
            },
            catalogLink: `bizno.store/${user.storeName}`,
            stats: {
                views: user.catalogViews || 0,
                clicksByCountry: user.clicksByCountry || {},
            }
        });
    } catch (error) {
        res.status(500).json({ message: "Erro ao buscar dados do dashboard." });
    }
};

exports.getUserProfile = async (req, res) => {
    try {
        const user = await User.findById(req.userId).select('-password');
        if (!user) return res.status(404).json({ message: "Usuário não encontrado." });
        res.status(200).json(user);
    } catch (error) { res.status(500).json({ message: "Erro interno do servidor." }); }
};

exports.updateUserProfile = async (req, res) => {
    try {
        const { fullName, phone } = req.body;
        const user = await User.findById(req.userId);
        if (!user) return res.status(404).json({ message: "Usuário não encontrado." });
        
        const updateData = { fullName, phone };
        let storageChange = 0;

        if (req.files) {
            if (req.files.profilePicture) {
                if (user.profilePicture && user.profilePicture.public_id) {
                    await deleteFromCloudinary(user.profilePicture.public_id);
                    storageChange -= user.profilePicture.size || 0;
                }
                const file = req.files.profilePicture[0];
                updateData.profilePicture = { url: file.path, public_id: file.filename, size: file.size };
                storageChange += file.size;
            }
            if (req.files.coverBanner) {
                if (user.coverBanner && user.coverBanner.public_id) {
                    await deleteFromCloudinary(user.coverBanner.public_id);
                    storageChange -= user.coverBanner.size || 0;
                }
                const file = req.files.coverBanner[0];
                updateData.coverBanner = { url: file.path, public_id: file.filename, size: file.size };
                storageChange += file.size;
            }
        }

        const updatedUser = await User.findByIdAndUpdate(req.userId, { $set: updateData, $inc: { storageUsed: storageChange } }, { new: true }).select('-password');
        res.status(200).json({ message: "Perfil atualizado com sucesso.", user: updatedUser });
    } catch (error) { res.status(500).json({ message: "Erro ao atualizar o perfil." }); }
};

exports.createCategory = async (req, res) => {
    try {
        const { name } = req.body;
        if (!name || name.trim() === '') {
            return res.status(400).json({ message: "O nome da categoria é obrigatório." });
        }
        if (await Category.findOne({ name, user: req.userId })) {
            return res.status(400).json({ message: "Categoria já existe." });
        }
        
        const newCategory = await Category.create({ name, user: req.userId });
        res.status(201).json({ message: "Categoria criada com sucesso.", category: newCategory });
    } catch (error) { res.status(500).json({ message: "Erro ao criar categoria." }); }
};

exports.getCategories = async (req, res) => {
    try {
        const categories = await Category.find({ user: req.userId });
        res.status(200).json(categories);
    } catch (error) { res.status(500).json({ message: "Erro ao buscar categorias." }); }
};

// =================================================================
// FUNÇÃO createProduct CORRIGIDA E MAIS ROBUSTA
// =================================================================
exports.createProduct = async (req, res) => {
    try {
        const user = await User.findById(req.userId).populate('plan');
        const { plan } = user;

        // Validações de Limite
        if (await Product.countDocuments({ user: req.userId }) >= plan.productLimit) {
            return res.status(403).json({ message: `Limite de ${plan.productLimit} produtos atingido.` });
        }
        if (req.files.images && req.files.images.length > plan.imageLimitPerProduct) {
            return res.status(403).json({ message: `Seu plano permite no máximo ${plan.imageLimitPerProduct} imagem(ns) por produto.` });
        }
        if (req.files.video && plan.videoLimitPerProduct <= 0) {
            return res.status(403).json({ message: "Seu plano não permite o upload de vídeos." });
        }

        let totalUploadSize = (req.files.images?.reduce((acc, f) => acc + f.size, 0) || 0) + (req.files.video?.[0].size || 0);
        if ((user.storageUsed + totalUploadSize) > (plan.storageLimit * 1024 * 1024)) {
            return res.status(403).json({ message: "Espaço de armazenamento insuficiente." });
        }
        
        const { name, description, price, categoryId, stock } = req.body;

        // Validação extra para campos obrigatórios
        if (!name || !price) {
            return res.status(400).json({ message: 'Nome e Preço são campos obrigatórios.' });
        }

        const newProduct = new Product({
            user: req.userId,
            name,
            description,
            price: parseFloat(price), // Garante que o preço é um número
            category: categoryId || null, // Garante que a categoria pode ser nula
            stock: parseInt(stock, 10) || 0 // Garante que o estoque é um número
        });

        if (req.files.images) newProduct.images = req.files.images.map(f => ({ url: f.path, public_id: f.filename, size: f.size }));
        if (req.files.video) newProduct.video = { url: req.files.video[0].path, public_id: req.files.video[0].filename, size: req.files.video[0].size };

        await newProduct.save();
        await User.updateOne({ _id: req.userId }, { $inc: { storageUsed: totalUploadSize } });
        
        res.status(201).json({ message: "Produto criado com sucesso.", product: newProduct });

    } catch (error) {
        console.error("🔥 Erro ao criar produto:", error);

        if (req.files) {
            if (req.files.images) req.files.images.forEach(f => deleteFromCloudinary(f.filename));
            if (req.files.video) deleteFromCloudinary(req.files.video[0].filename, 'video');
        }

        if (error.name === 'ValidationError') {
            const messages = Object.values(error.errors).map(val => val.message);
            return res.status(400).json({ message: messages.join('. ') });
        }

        res.status(500).json({ message: "Ocorreu um erro inesperado no servidor ao criar o produto." });
    }
};

exports.getProducts = async (req, res) => {
    try {
        const products = await Product.find({ user: req.userId }).populate('category', 'name');
        res.status(200).json(products);
    } catch (error) { res.status(500).json({ message: "Erro ao buscar produtos." }); }
};

exports.getProductById = async (req, res) => {
    try {
        const product = await Product.findOne({ _id: req.params.id, user: req.userId }).populate('category', 'name');
        if (!product) return res.status(404).json({ message: "Produto não encontrado ou não pertence a você." });
        res.status(200).json(product);
    } catch (error) { res.status(500).json({ message: "Erro ao buscar o produto." }); }
};

exports.updateProduct = async (req, res) => {
    try {
        const { name, description, price, categoryId, stock } = req.body;
        const product = await Product.findOneAndUpdate({ _id: req.params.id, user: req.userId }, { name, description, price, category: categoryId, stock }, { new: true });
        if (!product) return res.status(404).json({ message: "Produto não encontrado." });
        res.status(200).json({ message: "Produto atualizado com sucesso.", product });
    } catch (error) { res.status(500).json({ message: "Erro ao atualizar o produto." }); }
};

exports.deleteProduct = async (req, res) => {
    try {
        const product = await Product.findOneAndDelete({ _id: req.params.id, user: req.userId });
        if (!product) return res.status(404).json({ message: "Produto não encontrado." });

        let totalFreedSize = 0;
        if (product.images?.length > 0) {
            for (const image of product.images) {
                await deleteFromCloudinary(image.public_id);
                totalFreedSize += image.size || 0;
            }
        }
        if (product.video?.public_id) {
            await deleteFromCloudinary(product.video.public_id, 'video');
            totalFreedSize += product.video.size || 0;
        }

        if (totalFreedSize > 0) await User.findByIdAndUpdate(req.userId, { $inc: { storageUsed: -totalFreedSize } });
        res.status(200).json({ message: "Produto deletado com sucesso." });
    } catch (error) { res.status(500).json({ message: "Erro ao deletar o produto." }); }
};

exports.getCatalogSettings = async (req, res) => {
    try {
        const user = await User.findById(req.userId).select('catalogSettings socialLinks paymentInstructions');
        if (!user) return res.status(404).json({ message: "Usuário não encontrado." });
        res.status(200).json({ settings: user.catalogSettings, socials: user.socialLinks, payments: user.paymentInstructions });
    } catch (error) { res.status(500).json({ message: "Erro ao buscar configurações." }); }
};

exports.updateCatalogSettings = async (req, res) => {
    try {
        const { catalogSettings, socialLinks, paymentInstructions } = req.body;
        const user = await User.findById(req.userId).populate('plan');
        if (user.plan.name === 'Free' && catalogSettings?.primaryColor) return res.status(403).json({ message: "Customização de cores não disponível no plano Free." });

        const updateData = {};
        if (catalogSettings) updateData.catalogSettings = catalogSettings;
        if (socialLinks) updateData.socialLinks = socialLinks;
        if (paymentInstructions) updateData.paymentInstructions = paymentInstructions;
        
        await User.findByIdAndUpdate(req.userId, { $set: updateData });
        res.status(200).json({ message: "Configurações atualizadas com sucesso." });
    } catch (error) { res.status(500).json({ message: "Erro ao atualizar configurações." }); }
};

exports.getPlanDetails = async (req, res) => {
    try {
        const user = await User.findById(req.userId).populate('plan').select('plan planExpiryDate');
        if (!user) return res.status(404).json({ message: "Usuário não encontrado." });
        res.status(200).json(user);
    } catch (error) { res.status(500).json({ message: "Erro ao buscar detalhes do plano." }); }
};

exports.uploadPaymentProof = async (req, res) => {
    if (!req.file) return res.status(400).json({ message: 'Nenhum arquivo de comprovativo enviado.' });
    
    try {
        await PaymentProof.create({ user: req.userId, fileUrl: req.file.path, fileName: req.file.filename, status: 'pending' });
        res.status(201).json({ message: "Comprovativo enviado com sucesso. Aguardando aprovação." });
    } catch (error) { res.status(500).json({ message: "Erro ao salvar o comprovativo." }); }
};