const express = require('express');
const bodyParser = require('body-parser');
const { MongoClient, ObjectId } = require('mongodb');
const jwt = require('jsonwebtoken');


const app = express();
const port = 3000;

const uri = "database/?retryWrites=true&w=majority&appName=Cluster0y";
const client = new MongoClient(uri, {});

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

// Chave secreta para assinar o token (mantenha segura e não compartilhe publicamente)
const secretKey = 'mykeysecretahahahahah';

// Função para gerar token
const generateToken = (userId, userType) => {
	return jwt.sign({ userId, userType }, secretKey, { expiresIn: '1h' }); // Expira em 1 hora (você pode ajustar conforme necessário)
};







// Rota para a página de administração com verificação de admin
app.get('/admin', (req, res) => {
	res.render('admin'); // Renderize a página de administração
});

app.post('/create/class', async (req, res) => {
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




// Rota GET para a página de login
app.get('/', (req, res) => {
	res.render('login'); // Renderize a página de login
});




const generateClassToken = (classId, className) => {
	return jwt.sign({ classId, className }, secretKey, { expiresIn: '1h' }); // Expira em 1 hora (ajuste conforme necessário)
};

// Rota para autenticar e gerar token para acesso à sala de aula
app.post('/login', async (req, res) => {
	const { id, password } = req.body;

	try {
		const db = client.db();

		// Verificar se o classIdentifier é um ID ObjectId válido
		let classQuery;
		if (ObjectId.isValid(id)) {
			classQuery = { _id: new ObjectId(id) };
		} else {
			classQuery = { className: id };
		}

		console.log(classQuery)

		// Procurar a sala pelo ID ou nome
		const classe = await db.collection('classes').findOne({ className: id });

		if (!classe) {
			return res.status(401).send('Sala não encontrada');
		}

		// Verificar a senha da sala
		if (classe.password !== password) {
			return res.status(401).send('Senha incorreta');
		}

		console.log(classe.password)
		console.log(password)
		// Gerar token com ID da sala e nome da sala
		const token = generateClassToken(classe._id, classe.className);

		res.redirect(`/classroom/${token}`);
	} catch (err) {
		console.error(err);
		res.status(500).send('Erro ao buscar alunos');
	}
});




const verifyClassToken = (req, res, next) => {
	const token = req.params.token;

	jwt.verify(token, secretKey, (err, decoded) => {
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

// principal de cada sala
app.get('/classroom/:token', verifyClassToken, async (req, res) => {
	const { classId, className } = req.classInfo;
	try {
		const db = client.db();
		const listas = await db.collection('listas_presenca').find({ classId, className }).toArray();
		res.render('index', { listas, token: req.params.token });
	} catch (err) {
		console.error(err);
		res.status(500).send('Erro ao buscar listas de presença');
	}
});




// adicionar aluno forms
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
});


// Rota para deletar aluno, requer autenticação/token
app.get('/delete/student/:id/:token', verifyClassToken, async (req, res) => {
	const { id, token } = req.params;

	try {

		const db = client.db();
		const result = await db.collection('alunos').deleteOne({ _id: new ObjectId(id) });

		res.redirect('/alunos/' + token);
	} catch (err) {
		console.error(err);
		res.status(500).send('Erro ao remover aluno');
	}
});


app.post('/add/student/:token', verifyClassToken, async (req, res) => {
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
});

// criar lista diacordo com a sala
app.get('/create-lista/:token', verifyClassToken, async (req, res) => {
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
		res.redirect(`/list/${lista.insertedId}/${req.params.token}`);
	} catch (err) {
		console.error(err);
		res.status(500).send('Erro ao buscar listas de presença');
	}
});


app.get('/list/:id/:token', verifyClassToken, async (req, res) => {
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


		console.log(alunos)


		res.render('lista', { alunos, classId, token: req.params.token, listaId });
	} catch (err) {
		console.error(err);
		res.status(500).send('Erro ao buscar lista de presença');
	}
});

// Rota para salvar a presença de todos os alunos
app.post('/save-all-presence/:id/:token', verifyClassToken, async (req, res) => {
	const listaId = req.params.id;
	const alunosPresentes = req.body.presentes || [];

	try {
		const db = client.db();
		const lista = await db.collection('listas_presenca').findOne({ _id: new ObjectId(listaId) });

		if (!lista) {
			console.error('Lista de presença não encontrada');
			return res.status(404).send('Lista de presença não encontrada');
		}

		console.log('Lista encontrada:', lista);

		lista.alunos.forEach(aluno => {
			aluno.presente = alunosPresentes.includes(aluno.aluno.toString());
		});

		console.log('Alunos presentes:', alunosPresentes);

		await db.collection('listas_presenca').updateOne({ _id: new ObjectId(listaId) }, { $set: { alunos: lista.alunos } });

		console.log('Presença de alunos atualizada com sucesso');

		res.redirect(`/list/${listaId}/${req.params.token}`);
	} catch (err) {
		console.error('Erro ao salvar presença de todos os alunos:', err);
		res.status(500).send('Erro ao salvar presença de todos os alunos');
	}
});

app.listen(port, () => {
	console.log(`Servidor rodando em http://localhost:${port}`);
});
