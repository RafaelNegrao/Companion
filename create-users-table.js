// Script para criar a tabela de usuários no Supabase
const crud = require('./crud');


async function createUsersTable() {
  console.log('🔄 Criando tabela de usuários no Supabase...\n');
  
  // SQL para criar a tabela
  const createTableSQL = `
    CREATE TABLE IF NOT EXISTS usuarios (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      nome VARCHAR(255) NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      senha VARCHAR(255) NOT NULL,
      privilegio VARCHAR(50) DEFAULT 'usuario',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    -- Criar índice no email para buscas mais rápidas
    CREATE INDEX IF NOT EXISTS idx_usuarios_email ON usuarios(email);

    -- Adicionar comentários
    COMMENT ON TABLE usuarios IS 'Tabela de usuários do sistema';
    COMMENT ON COLUMN usuarios.privilegio IS 'Tipos: admin, usuario, visitante';
  `;

  try {
    // Executar SQL via RPC ou usando o SQL Editor do Supabase
    console.log('📋 SQL para criar a tabela:');
    console.log(createTableSQL);
    console.log('\n⚠️  IMPORTANTE: Execute este SQL no SQL Editor do Supabase Dashboard\n');
    console.log('1. Acesse: https://supabase.com/dashboard/project/hxdosbkbffbixpycfvcn/editor');
    console.log('2. Cole o SQL acima no editor');
    console.log('3. Clique em "Run"\n');
    
    // Criar usuário administrador padrão
    console.log('👤 Criando usuário administrador padrão...');
    
    const { data, error } = await crud.insert('usuarios',
        { 
          nome: 'Administrador',
          email: 'admin@companion.com',
          senha: 'admin123', // Em produção, use hash de senha!
          privilegio: 'admin'
        }
    );

    if (error) {
      if (error.message.includes('relation "usuarios" does not exist')) {
        console.log('❌ Tabela ainda não foi criada. Execute o SQL no dashboard primeiro!');
      } else if (error.message.includes('duplicate key')) {
        console.log('✅ Usuário administrador já existe!');
      } else {
        console.log('❌ Erro ao criar usuário:', error.message);
      }
    } else {
      console.log('✅ Usuário administrador criado com sucesso!');
      console.log(data);
    }
    
  } catch (err) {
    console.error('❌ Erro:', err.message);
  }
}

// Executar
createUsersTable();
