const jwt 							= require('jsonwebtoken');
const bodyParser					= require('body-parser');
const express 						= require('express');
const { MongoClient, ObjectId } 	= require('mongodb');

const PORT = process.env['PORT'];
const JWT_KEY = process.env['JWT_KEY'];
const DATABASE_URL = process.env['DATABASE_URL'];

const app = express();
const client = new MongoClient(DATABASE_URL, {});

async function connectDB() {
	try {
		await client.connect();
		console.log("Connected to MongoDB");
	} catch (error) {
		console.error("Error connecting to MongoDB:", error);
	}
}
connectDB();

app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(bodyParser.urlencoded({ extended: true }));

// Funções
const generateToken = (classId, className) => {
	return jwt.sign({ classId, className }, JWT_KEY, { expiresIn: '1h' }); // Expira em 1 hora (ajuste conforme necessário)
};
const verifyClassToken = (req, res, next) => {
	const token = req.params.token;

	jwt.verify(token, JWT_KEY, (err, decoded) => {
		if (err) {
			return res.status(403).send('Token inválido');
		}

		// Verificar se o token contém as informações necessárias da classe
		if (decoded.classId && decoded.className) {
			req.classInfo = decoded;
			next();
		} else {
			res.status(403).send('Token inválido para esta rota');
		}
	});
};

// APP ADMIN
app.get('/admin', (req, res) => {
	res.render('admin'); // Renderize a página de administração
});
app.post('/criar/sala', async (req, res) => {
	try {
		const { className, password } = req.body;

		const db = client.db();

		// Criar a nova classe com a senha e sem alunos associados inicialmente
		const novaClasse = await db.collection('classes').insertOne({ className, password, alunos: [] });

		const responseData = {
			_id: novaClasse.insertedId,
			className,
			password // Você pode decidir se deseja retornar a senha ou não
		};

		res.send(responseData);
	} catch (err) {
		console.error(err);
		res.status(500).send('Erro ao criar classe');
	}
});

// APP PROFESSOR
app.get('/', (req, res) => {
	res.render('login');
}); // login
app.get('/sala/:token', verifyClassToken, async (req, res) => {
	const { classId, className } = req.classInfo;
	
	try {
		const db = client.db();
		const listas = await db.collection('listas_presenca').find({ classId, className }).toArray();
		res.render('index', { listas, token: req.params.token });
	} catch (err) {
		console.error(err);
		res.status(500).send('Erro ao buscar listas de presença');
	}
}); // sala
app.get('/alunos/:token', verifyClassToken, async (req, res) => {
	const { classId, className } = req.classInfo;

	try {
		const db = client.db();
		const alunos = await db.collection('alunos').find({ classId, className }).toArray();
		res.render('alunos', { alunos, token: req.params.token });
	} catch (err) {
		console.error(err);
		res.status(500).send('Erro ao buscar alunos');
	}
}); // alunos
app.get('/criar/lista/:token', verifyClassToken, async (req, res) => {
	const { classId, className } = req.classInfo;

	try {
		const db = client.db();
		const alunos = await db.collection('alunos').find({ classId, className }).toArray();

		const novaLista = {
			classId,
			className,
			data: new Date().toLocaleDateString(),
			hora: new Date().toLocaleTimeString(),
			alunos: alunos.map(aluno => ({ aluno: aluno._id, presente: false }))
		};

		const lista = await db.collection('listas_presenca').insertOne(novaLista);
		
		res.redirect(`/lista/${lista.insertedId}/${req.params.token}`);
	} catch (err) {
		console.error(err);
		res.status(500).send('Erro ao buscar listas de presença');
	}
}); //crie uma lista nova
app.post('/login', async (req, res) => {
	const { id, password } = req.body;

	try {
		const db = client.db();
		let classQuery;
		if (ObjectId.isValid(id)) {
			classQuery = { _id: new ObjectId(id) };
		} else {
			classQuery = { className: id };
		}
		const classe = await db.collection('classes').findOne({ className: id });

		if (!classe) {
			return res.status(401).send('Sala não encontrada');
		}

		if (classe.password !== password) {
			return res.status(401).send('Senha incorreta');
		}

		const token = generateToken(classe._id, classe.className);

		res.redirect(`/sala/${token}`);
	} catch (err) {
		console.error(err);
		res.status(500).send('Erro ao buscar alunos');
	}
}); // post do login
app.get('/excluir/aluno/:id/:token', verifyClassToken, async (req, res) => {
	const { id, token } = req.params;

	try {

		const db = client.db();
		const result = await db.collection('alunos').deleteOne({ _id: new ObjectId(id) });

		res.redirect('/alunos/' + token);
	} catch (err) {
		console.error(err);
		res.status(500).send('Erro ao remover aluno');
	}
}); // deletar aluno
app.post('/criar/aluno/:token', verifyClassToken, async (req, res) => {
	const { nome, serie } = req.body;
	const { classId, className } = req.classInfo;

	try {
		const db = client.db();
		await db.collection('alunos').insertOne({ nome, serie, classId, className });
		res.redirect('/alunos/' + req.params.token);
	} catch (err) {
		console.error(err);
		res.status(500).send('Erro ao adicionar aluno');
	}
}); // criar aluno
app.get('/lista/:id/:token', verifyClassToken, async (req, res) => {
	const { classId, className } = req.classInfo;
	const listaId = req.params.id;

	try {
		const db = client.db();
		const lista = await db.collection('listas_presenca').findOne({ _id: new ObjectId(listaId), classId, className });

		if (!lista) {
			return res.status(404).send('Lista de presença não encontrada para esta classe');
		}

		const alunosInfo = await Promise.all(lista.alunos.map(async aluno => {
			const alunoInfo = await db.collection('alunos').findOne({ _id: aluno.aluno });
			return { ...aluno, nome: alunoInfo.nome, serie: alunoInfo.serie };
		}));

		const alunos = alunosInfo.map(aluno => ({
			...aluno,
			presente: aluno.presente ? 'checked' : '' // Define 'checked' se o aluno está presente
		}));

		res.render('lista', { alunos, classId, token: req.params.token, listaId });
	} catch (err) {
		console.error(err);
		res.status(500).send('Erro ao buscar lista de presença');
	}
}); // lista com os alunos para com remova e adicione presença
app.post('/save/:id/:token', verifyClassToken, async (req, res) => {
	const listaId = req.params.id;
	const alunosPresentes = req.body.presentes || [];

	try {
		const db = client.db();
		const lista = await db.collection('listas_presenca').findOne({ _id: new ObjectId(listaId) });

		if (!lista) {
			console.error('Lista de presença não encontrada');
			return res.status(404).send('Lista de presença não encontrada');
		}

		lista.alunos.forEach(aluno => {
			aluno.presente = alunosPresentes.includes(aluno.aluno.toString());
		});

		await db.collection('listas_presenca').updateOne({ _id: new ObjectId(listaId) }, { $set: { alunos: lista.alunos } });

		res.redirect(`/lista/${listaId}/${req.params.token}`);
	} catch (err) {
		console.error('Erro ao salvar presença de todos os alunos:', err);
		res.status(500).send('Erro ao salvar presença de todos os alunos');
	}
}); // salvar presença de todos os alunos

app.listen(PORT, () => {
	console.log(`Servidor rodando em http://localhost:${PORT}`);
});