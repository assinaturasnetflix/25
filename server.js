const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');

const app = express();
const port = process.env.PORT || 3000;

// Conexão MongoDB (sem env, direto)
const mongoURI = 'mongodb+srv://BRAINSKILL:Acass123%40%2312@cluster0.lxephlp.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';
mongoose.connect(mongoURI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log('MongoDB conectado!'))
.catch(err => console.error('Erro MongoDB:', err));

// Schema da loja/catalogo
const storeSchema = new mongoose.Schema({
  subdomain: { type: String, unique: true, required: true },
  storeName: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
  products: [
    {
      name: String,
      price: Number,
      description: String,
      images: [String], // URLs das imagens no Cloudinary
      whatsappLink: String
    }
  ],
  // Pode expandir depois com mais campos...
});

const Store = mongoose.model('Store', storeSchema);

// Middleware
app.use(cors());
app.use(express.json());

// Função para limpar e gerar subdomínio (igual do frontend)
function gerarSubdominio(nome) {
  return nome
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove acentos
    .replace(/[^a-z0-9]+/g, '-') // substitui por hífen
    .replace(/(^-|-$)/g, '');
}

// Endpoint criar loja
app.post('/create-store', async (req, res) => {
  try {
    const { storeName } = req.body;
    if (!storeName) return res.status(400).json({ success: false, message: 'Nome da loja é obrigatório.' });

    const subdomain = gerarSubdominio(storeName);
    if (!subdomain) return res.status(400).json({ success: false, message: 'Nome inválido para subdomínio.' });

    const exists = await Store.findOne({ subdomain });
    if (exists) return res.status(400).json({ success: false, message: 'Subdomínio já está em uso. Tente outro nome.' });

    const newStore = new Store({ storeName, subdomain });
    await newStore.save();

    res.json({ success: true, message: 'Loja criada com sucesso.', subdomain });
  } catch (error) {
    console.error('Erro criar loja:', error);
    res.status(500).json({ success: false, message: 'Erro interno do servidor.' });
  }
});

// Middleware para capturar subdomínio e buscar loja
app.use(async (req, res, next) => {
  try {
    const host = req.headers.host; // exemplo: subdomain.veedeo.xyz:3000
    let subdomain = null;

    if (host) {
      const parts = host.split('.');
      // Considerando domínio principal veedeo.xyz (2 partes) e subdomínio antes
      // Exemplo: loja1.veedeo.xyz => parts = ['loja1','veedeo','xyz']
      if (parts.length === 3) {
        subdomain = parts[0];
      } else if (parts.length > 3) {
        // Domínios com mais subdomínios tipo loja1.app.veedeo.xyz
        subdomain = parts.slice(0, parts.length - 2).join('.');
      }
    }

    if (!subdomain || subdomain === 'www') return next(); // Pode ignorar www ou domínio raiz

    const store = await Store.findOne({ subdomain });
    if (!store) return res.status(404).json({ success: false, message: 'Loja não encontrada pelo subdomínio.' });

    req.store = store; // guarda a loja no request para usar depois
    next();
  } catch (error) {
    console.error('Erro middleware subdomínio:', error);
    next();
  }
});

// Endpoint para pegar produtos da loja (exemplo)
app.get('/catalog', (req, res) => {
  if (!req.store) return res.status(400).json({ success: false, message: 'Subdomínio inválido ou não encontrado.' });
  res.json({ success: true, storeName: req.store.storeName, products: req.store.products });
});

// Teste básico na raiz
app.get('/', (req, res) => {
  res.send('API Luettelo rodando!');
});

app.listen(port, () => {
  console.log(`Servidor rodando na porta ${port}`);
});